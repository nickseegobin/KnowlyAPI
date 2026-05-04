const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const getSupabase = require('../config/supabase');

const MASTERY_THRESHOLD = 80;  // best_score >= 80 → mastered
const WEAK_THRESHOLD    = 60;  // avg_score  <  60 → weak (needs practice)

// ── GET /api/v1/progression/child ─────────────────────────────────────────────
// Returns the full curriculum path map for the authenticated user at a given level.
//
// Query params:
//   level       (required) — e.g. std_4
//   curriculum  (default: tt_primary)
//   period      (optional) — filter to one term; omit for all periods / capstone
//   subject     (optional) — filter to one subject; omit for all subjects
//
// Response shape:
//   { user_id, curriculum, level, period, summary, subjects }
//   subjects[subject] = { sessions_count, avg_score, topics_total, topics_attempted,
//                         topics_mastered, coverage_pct, mastery_pct,
//                         weak_areas, recommended_next, topics[] }
//   topics[i] = { topic, module_title, period, sort_order,
//                 sessions_count, avg_score, best_score, status }
//   status: 'not_started' | 'in_progress' | 'weak' | 'mastered'
//   recommended_next reason: 'needs_practice' | 'next_in_sequence'
router.get('/child', authenticateToken, async (req, res) => {
  const user_id   = req.user?.user_id;
  const { curriculum = 'tt_primary', level, period, subject } = req.query;

  if (!level) {
    return res.status(400).json({ error: 'level is required', code: 'missing_fields' });
  }

  try {
    const supabase = getSupabase();

    // ── 1. Fetch completed exam sessions ─────────────────────────────────────
    let sessionsQ = supabase
      .from('exam_sessions')
      .select('session_id, subject, topic, difficulty, trial_type, percentage, completed_at')
      .eq('user_id', user_id)
      .eq('curriculum', curriculum)
      .eq('level', level)
      .eq('state', 'completed');

    if (period)  sessionsQ = sessionsQ.eq('period', period);
    if (subject) sessionsQ = sessionsQ.eq('subject', subject);

    const { data: sessions, error: sessionsErr } = await sessionsQ
      .order('completed_at', { ascending: false });

    if (sessionsErr) throw sessionsErr;

    // ── 2. Fetch curriculum topics ────────────────────────────────────────────
    let topicsQ = supabase
      .from('curriculum_topics')
      .select('id, subject, module_title, sort_order, topic, period')
      .eq('curriculum', curriculum)
      .eq('level', level)
      .eq('status', 'active');

    if (period)  topicsQ = topicsQ.eq('period', period);
    if (subject) topicsQ = topicsQ.eq('subject', subject);

    const { data: allTopics, error: topicsErr } = await topicsQ
      .order('subject')
      .order('sort_order');

    if (topicsErr) throw topicsErr;

    // ── 3. Index sessions by topic name ───────────────────────────────────────
    const sessionsByTopic = {};
    for (const s of sessions || []) {
      if (!s.topic) continue;
      if (!sessionsByTopic[s.topic]) sessionsByTopic[s.topic] = [];
      sessionsByTopic[s.topic].push(s);
    }

    // ── 4. Build per-subject topic stats ─────────────────────────────────────
    const subjectBuckets = {};

    for (const t of allTopics || []) {
      if (!subjectBuckets[t.subject]) {
        subjectBuckets[t.subject] = { topics: [], sessions_count: 0, score_sum: 0, scored_topics: 0 };
      }

      const topicSessions = sessionsByTopic[t.topic] || [];
      const attempted     = topicSessions.length > 0;
      const scores        = topicSessions.map(s => s.percentage ?? 0);
      const avgScore      = attempted ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null;
      const bestScore     = attempted ? Math.max(...scores) : null;

      let status = 'not_started';
      if (attempted) {
        if (bestScore >= MASTERY_THRESHOLD)  status = 'mastered';
        else if (avgScore < WEAK_THRESHOLD)  status = 'weak';
        else                                 status = 'in_progress';
      }

      subjectBuckets[t.subject].topics.push({
        topic:          t.topic,
        module_title:   t.module_title || null,
        period:         t.period       || null,
        sort_order:     t.sort_order,
        sessions_count: topicSessions.length,
        avg_score:      avgScore,
        best_score:     bestScore,
        status,
      });

      subjectBuckets[t.subject].sessions_count += topicSessions.length;
      if (avgScore !== null) {
        subjectBuckets[t.subject].score_sum     += avgScore;
        subjectBuckets[t.subject].scored_topics += 1;
      }
    }

    // ── 5. Build subject summaries + recommendations ──────────────────────────
    const subjects = {};
    let totalSessions  = 0;
    let overallSum     = 0;
    let overallCount   = 0;

    for (const [subj, bucket] of Object.entries(subjectBuckets)) {
      const { topics } = bucket;

      const attempted = topics.filter(t => t.status !== 'not_started');
      const mastered  = topics.filter(t => t.status === 'mastered');
      const weak      = topics.filter(t => t.status === 'weak');
      const notStarted = topics.filter(t => t.status === 'not_started');

      const avgScore = bucket.scored_topics > 0
        ? Math.round(bucket.score_sum / bucket.scored_topics)
        : null;

      // Recommendations: weak areas first (up to 2), then next in sequence (up to 3)
      const recommended_next = [
        ...weak.slice(0, 2).map(t => ({ topic: t.topic, module_title: t.module_title, reason: 'needs_practice' })),
        ...notStarted.slice(0, 3).map(t => ({ topic: t.topic, module_title: t.module_title, reason: 'next_in_sequence' })),
      ].slice(0, 5);

      subjects[subj] = {
        sessions_count:   bucket.sessions_count,
        avg_score:        avgScore,
        topics_total:     topics.length,
        topics_attempted: attempted.length,
        topics_mastered:  mastered.length,
        coverage_pct:     topics.length > 0 ? Math.round((attempted.length  / topics.length) * 100) : 0,
        mastery_pct:      topics.length > 0 ? Math.round((mastered.length   / topics.length) * 100) : 0,
        weak_areas:       weak.map(t => t.topic),
        recommended_next,
        topics,
      };

      totalSessions += bucket.sessions_count;
      if (avgScore !== null) { overallSum += avgScore; overallCount++; }
    }

    return res.json({
      user_id,
      curriculum,
      level,
      period:  period  || null,
      subject: subject || null,
      summary: {
        sessions_total:   totalSessions,
        subjects_active:  Object.keys(subjects).length,
        overall_avg_score: overallCount > 0 ? Math.round(overallSum / overallCount) : null,
      },
      subjects,
    });

  } catch (err) {
    console.error('[progression/child] Error:', err);
    return res.status(500).json({ error: 'Failed to build progression map', code: 'server_error', details: err.message });
  }
});

module.exports = router;
