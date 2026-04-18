const express = require('express');
const router  = express.Router();
const getSupabase = require('../config/supabase');
const { authenticateToken } = require('../middleware/auth');

// ── Auth ──────────────────────────────────────────────────────────────────────

function requireServerKey(req, res) {
  const key = req.headers['x-aep-server-key'];
  if (!key || key !== process.env.AEP_SERVER_KEY) {
    res.status(401).json({ error: 'Server key required', code: 'unauthorized' });
    return false;
  }
  return true;
}

// ── Shared computation helpers ────────────────────────────────────────────────

/**
 * Build 4-week rolling trend from exam_session rows (sorted desc by completed_at).
 * Returns array oldest→newest: [W-3, W-2, W-1, W-current]
 */
function buildTrend(trials) {
  const now = Date.now();
  return [3, 2, 1, 0].map(weeksAgo => {
    const start  = new Date(now - (weeksAgo + 1) * 7 * 86400 * 1000);
    const end    = new Date(now - weeksAgo * 7 * 86400 * 1000);
    const bucket = trials.filter(t => {
      if (!t.completed_at) return false;
      const d = new Date(t.completed_at);
      return d >= start && d < end;
    });
    const scores = bucket.filter(t => t.percentage !== null).map(t => t.percentage);
    return {
      label:       weeksAgo === 0 ? 'This week' : `${weeksAgo}w ago`,
      start:       start.toISOString().slice(0, 10),
      end:         end.toISOString().slice(0, 10),
      trial_count: bucket.length,
      avg_score:   scores.length
                     ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
                     : null,
    };
  });
}

/**
 * Aggregate exam_results rows into per-topic stats.
 * Returns [{topic, subject, total_questions, correct_count, correct_rate,
 *           student_count, is_strength, is_weakness}]
 * student_set is only populated when user_id is present on each row (class view).
 */
function buildTopicBreakdown(results) {
  const map = {};
  for (const r of results) {
    const key = `${r.subject || ''}||${r.topic || 'General'}`;
    if (!map[key]) {
      map[key] = {
        topic:       r.topic   || 'General',
        subject:     r.subject || '',
        total:       0,
        correct:     0,
        student_set: new Set(),
      };
    }
    map[key].total++;
    if (r.is_correct) map[key].correct++;
    if (r.user_id)    map[key].student_set.add(String(r.user_id));
  }

  return Object.values(map).map(t => {
    const rate = t.total > 0 ? Math.round((t.correct / t.total) * 100) : null;
    return {
      topic:           t.topic,
      subject:         t.subject,
      total_questions: t.total,
      correct_count:   t.correct,
      correct_rate:    rate,
      student_count:   t.student_set.size,
      is_strength:     rate !== null && rate >= 70,
      is_weakness:     rate !== null && rate < 50,
    };
  }).sort((a, b) => `${a.subject}${a.topic}`.localeCompare(`${b.subject}${b.topic}`));
}

/**
 * Compute per-subject summary enriched with topic counts.
 */
function buildSubjectBreakdown(trials, topicBreakdown) {
  const map = {};
  for (const t of trials) {
    if (!t.subject) continue;
    if (!map[t.subject]) {
      map[t.subject] = { subject: t.subject, trial_count: 0, scores: [], direct: 0, assignment: 0 };
    }
    map[t.subject].trial_count++;
    if (t.percentage !== null) map[t.subject].scores.push(t.percentage);
    t.source === 'assignment' ? map[t.subject].assignment++ : map[t.subject].direct++;
  }

  return Object.values(map).map(s => {
    const subTopics = topicBreakdown.filter(t => t.subject === s.subject);
    return {
      subject:          s.subject,
      trial_count:      s.trial_count,
      avg_score:        s.scores.length
                          ? Math.round(s.scores.reduce((a, b) => a + b, 0) / s.scores.length)
                          : null,
      direct_count:     s.direct,
      assignment_count: s.assignment,
      topics_covered:   subTopics.length,
      topics_strong:    subTopics.filter(t => t.is_strength).length,
      topics_weak:      subTopics.filter(t => t.is_weakness).length,
    };
  });
}

/**
 * Retry effectiveness: for each subject+topic with ≥ 2 attempts, compare
 * first attempt score to the average of subsequent attempts.
 * Trials must be passed in chronological order (oldest first).
 */
function buildRetryEffectiveness(trialsChronological) {
  const byKey = {};
  for (const t of trialsChronological) {
    if (t.percentage === null) continue;
    const key = `${t.subject || ''}||${t.topic || ''}`;
    if (!byKey[key]) byKey[key] = { subject: t.subject || '', topic: t.topic || null, scores: [] };
    byKey[key].scores.push(t.percentage);
  }

  return Object.values(byKey)
    .filter(e => e.scores.length >= 2)
    .map(e => {
      const first      = e.scores[0];
      const rest       = e.scores.slice(1);
      const subsequent = Math.round(rest.reduce((a, b) => a + b, 0) / rest.length);
      return {
        subject:        e.subject,
        topic:          e.topic || null,
        attempts:       e.scores.length,
        first_attempt:  first,
        subsequent_avg: subsequent,
        improvement:    subsequent - first,
      };
    })
    .sort((a, b) => b.improvement - a.improvement);
}

/**
 * At-risk: avg < 40% overall, OR < 50% avg on 2+ subjects with ≥ 2 trials each.
 */
function isAtRisk(subjects, avgScore) {
  if (avgScore !== null && avgScore < 40) return true;
  const weak = subjects.filter(s => s.avg_score !== null && s.avg_score < 50 && s.trial_count >= 2);
  return weak.length >= 2;
}

// ── Core student analytics (shared by /student and /student/self) ─────────────

async function fetchStudentAnalytics(user_id, period, subject) {
  // ── Trial sessions ──────────────────────────────────────────────────────────
  let sessionQuery = getSupabase()
    .from('exam_sessions')
    .select('session_id, subject, topic, difficulty, percentage, source, trial_type, completed_at')
    .eq('user_id', user_id)
    .eq('state', 'completed')
    .order('completed_at', { ascending: false });

  if (period)  sessionQuery = sessionQuery.eq('period', period);
  if (subject) sessionQuery = sessionQuery.eq('subject', subject);

  const { data: trials, error: trialErr } = await sessionQuery;
  if (trialErr) throw trialErr;

  // ── Quest sessions ──────────────────────────────────────────────────────────
  const { data: quests, error: questErr } = await getSupabase()
    .from('quest_sessions')
    .select('session_id, quest_id, source, badge_awarded, started_at, completed_at')
    .eq('user_id', user_id)
    .eq('state', 'completed')
    .order('completed_at', { ascending: false });

  if (questErr) throw questErr;

  // ── Exam results (per-question topic data) ──────────────────────────────────
  let resultsQuery = getSupabase()
    .from('exam_results')
    .select('topic, subject, is_correct')
    .eq('user_id', user_id);

  if (period)  resultsQuery = resultsQuery.eq('period', period);
  if (subject) resultsQuery = resultsQuery.eq('subject', subject);

  const { data: results, error: resultsErr } = await resultsQuery;
  if (resultsErr) throw resultsErr;

  // ── Computations ────────────────────────────────────────────────────────────
  const topicBreakdown  = buildTopicBreakdown(results || []);
  const subjects        = buildSubjectBreakdown(trials || [], topicBreakdown);
  const trend           = buildTrend(trials || []);
  const trialsChron     = [...(trials || [])].reverse();
  const retryEfficiency = buildRetryEffectiveness(trialsChron);

  const allScores  = (trials || []).filter(t => t.percentage !== null).map(t => t.percentage);
  const avg_score  = allScores.length
    ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
    : null;

  const now       = Date.now();
  const cutoff7d  = new Date(now - 7 * 86400 * 1000);
  const weekly_trials = (trials || []).filter(t => t.completed_at && new Date(t.completed_at) >= cutoff7d).length;

  const topics_attempted = [...new Set((trials || []).map(t => t.topic).filter(Boolean))].length;
  const strengths  = topicBreakdown.filter(t => t.is_strength).map(t => ({ topic: t.topic, subject: t.subject, correct_rate: t.correct_rate }));
  const weaknesses = topicBreakdown.filter(t => t.is_weakness).map(t => ({ topic: t.topic, subject: t.subject, correct_rate: t.correct_rate }));

  return {
    user_id,
    trial_count:      (trials  || []).length,
    quest_count:      (quests  || []).length,
    badges_earned:    (quests  || []).filter(q => q.badge_awarded).length,
    avg_score,
    weekly_trials,
    topics_attempted,
    direct_count:     (trials  || []).filter(t => t.source === 'direct').length,
    assignment_count: (trials  || []).filter(t => t.source === 'assignment').length,
    at_risk:          isAtRisk(subjects, avg_score),
    subjects,
    topic_breakdown:  topicBreakdown,
    strengths,
    weaknesses,
    trend,
    retry_effectiveness: retryEfficiency,
    recent_trials:    (trials  || []).slice(0, 10),
    recent_quests:    (quests  || []).slice(0, 10),
    filters:          { period: period || null, subject: subject || null },
  };
}

// ── GET /api/v1/analytics/class ───────────────────────────────────────────────
// Server-key auth. WP plugin owns access control; we trust the user_ids list.
//
// Query params:
//   user_ids   (required) — comma-separated WP user IDs
//   period     (optional) — e.g. 'term_1', 'term_2', 'term_3'
//   subject    (optional) — e.g. 'math', 'english'
//
// Returns class-level aggregates, per-student summary, topic heatmap,
// strengths/weaknesses, at-risk roster, and engagement stats.
router.get('/class', async (req, res) => {
  if (!requireServerKey(req, res)) return;

  const raw = req.query.user_ids || '';
  if (!raw) {
    return res.status(400).json({ error: 'user_ids is required', code: 'missing_fields' });
  }

  const user_ids = raw.split(',').map(s => s.trim()).filter(Boolean);
  if (user_ids.length === 0) {
    return res.status(400).json({ error: 'At least one user_id is required', code: 'missing_fields' });
  }

  const { period, subject } = req.query;

  try {
    // ── Trial sessions ────────────────────────────────────────────────────────
    let sessionQuery = getSupabase()
      .from('exam_sessions')
      .select('user_id, subject, topic, percentage, source, completed_at')
      .in('user_id', user_ids)
      .eq('state', 'completed')
      .order('completed_at', { ascending: false });

    if (period)  sessionQuery = sessionQuery.eq('period', period);
    if (subject) sessionQuery = sessionQuery.eq('subject', subject);

    const { data: trials, error: trialErr } = await sessionQuery;
    if (trialErr) throw trialErr;

    // ── Quest sessions ────────────────────────────────────────────────────────
    const { data: quests, error: questErr } = await getSupabase()
      .from('quest_sessions')
      .select('user_id, quest_id, source, badge_awarded, completed_at')
      .in('user_id', user_ids)
      .eq('state', 'completed')
      .order('completed_at', { ascending: false });

    if (questErr) throw questErr;

    // ── Exam results (topic-level, for heatmap) ───────────────────────────────
    let resultsQuery = getSupabase()
      .from('exam_results')
      .select('user_id, topic, subject, is_correct')
      .in('user_id', user_ids);

    if (period)  resultsQuery = resultsQuery.eq('period', period);
    if (subject) resultsQuery = resultsQuery.eq('subject', subject);

    const { data: results, error: resultsErr } = await resultsQuery;
    if (resultsErr) throw resultsErr;

    // ── Per-student summaries ─────────────────────────────────────────────────
    const now      = Date.now();
    const cutoff7d = new Date(now - 7 * 86400 * 1000);

    const studentMap = {};
    for (const uid of user_ids) {
      studentMap[uid] = {
        user_id:          uid,
        trial_count:      0,
        quest_count:      0,
        avg_score:        null,
        badges_earned:    0,
        direct_count:     0,
        assignment_count: 0,
        weekly_trials:    0,
        last_active:      null,
        at_risk:          false,
        subjects:         [],
      };
    }

    // Group trials by student
    const trialsByUser = {};
    for (const t of (trials || [])) {
      if (!trialsByUser[t.user_id]) trialsByUser[t.user_id] = [];
      trialsByUser[t.user_id].push(t);
    }

    for (const [uid, rows] of Object.entries(trialsByUser)) {
      if (!studentMap[uid]) continue;
      const s      = studentMap[uid];
      s.trial_count = rows.length;
      const scores  = rows.filter(r => r.percentage !== null).map(r => r.percentage);
      s.avg_score   = scores.length
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : null;
      s.direct_count     = rows.filter(r => r.source === 'direct').length;
      s.assignment_count = rows.filter(r => r.source === 'assignment').length;
      s.weekly_trials    = rows.filter(r => r.completed_at && new Date(r.completed_at) >= cutoff7d).length;
      const dates = rows.map(r => r.completed_at).filter(Boolean).sort().reverse();
      if (dates[0]) s.last_active = dates[0];

      // Subject-level for at-risk calc
      const subjectMap = {};
      for (const r of rows) {
        if (!r.subject) continue;
        if (!subjectMap[r.subject]) subjectMap[r.subject] = { trial_count: 0, scores: [] };
        subjectMap[r.subject].trial_count++;
        if (r.percentage !== null) subjectMap[r.subject].scores.push(r.percentage);
      }
      s.subjects = Object.entries(subjectMap).map(([subj, d]) => ({
        subject:      subj,
        trial_count:  d.trial_count,
        avg_score:    d.scores.length
                        ? Math.round(d.scores.reduce((a, b) => a + b, 0) / d.scores.length)
                        : null,
      }));
      s.at_risk = isAtRisk(s.subjects, s.avg_score);
    }

    for (const q of (quests || [])) {
      if (!studentMap[q.user_id]) continue;
      const s = studentMap[q.user_id];
      s.quest_count++;
      if (q.badge_awarded) s.badges_earned++;
      if (!s.last_active || q.completed_at > s.last_active) s.last_active = q.completed_at;
    }

    const students = Object.values(studentMap);

    // ── Class-level aggregates ────────────────────────────────────────────────
    const allScores      = students.filter(s => s.avg_score !== null).map(s => s.avg_score);
    const class_avg_score = allScores.length
      ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
      : null;

    const subjectCounts = {};
    for (const t of (trials || [])) {
      if (t.subject) subjectCounts[t.subject] = (subjectCounts[t.subject] || 0) + 1;
    }
    const most_active_subject = Object.keys(subjectCounts)
      .sort((a, b) => subjectCounts[b] - subjectCounts[a])[0] || null;

    const avg_engagement_rate = students.length
      ? Math.round(students.reduce((a, s) => a + s.weekly_trials, 0) / students.length * 10) / 10
      : 0;

    // ── Topic heatmap (class-wide) ────────────────────────────────────────────
    const topic_heatmap = buildTopicBreakdown(results || []);
    const strengths     = topic_heatmap.filter(t => t.is_strength);
    const weaknesses    = topic_heatmap.filter(t => t.is_weakness);

    return res.json({
      student_count:        user_ids.length,
      total_trials:         (trials || []).length,
      total_quests:         (quests || []).length,
      total_badges:         (quests || []).filter(q => q.badge_awarded).length,
      class_avg_score,
      most_active_subject,
      avg_engagement_rate,
      direct_count:         (trials || []).filter(t => t.source === 'direct').length,
      assignment_count:     (trials || []).filter(t => t.source === 'assignment').length,
      at_risk_count:        students.filter(s => s.at_risk).length,
      topic_heatmap,
      strengths,
      weaknesses,
      students,
      filters:              { period: period || null, subject: subject || null },
    });

  } catch (err) {
    console.error('[analytics/class] Error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch class analytics', code: 'server_error', details: err.message });
  }
});

// ── GET /api/v1/analytics/student ─────────────────────────────────────────────
// Server-key auth. WP plugin calls this for teacher or parent viewing a specific student.
//
// Query params:
//   user_id   (required)
//   period    (optional)
//   subject   (optional)
router.get('/student', async (req, res) => {
  if (!requireServerKey(req, res)) return;

  const { user_id, period, subject } = req.query;
  if (!user_id) {
    return res.status(400).json({ error: 'user_id is required', code: 'missing_fields' });
  }

  try {
    const data = await fetchStudentAnalytics(user_id, period, subject);
    return res.json(data);
  } catch (err) {
    console.error('[analytics/student] Error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch student analytics', code: 'server_error', details: err.message });
  }
});

// ── GET /api/v1/analytics/self ─────────────────────────────────────────────────
// JWT auth (parent or student). Returns the calling user's own analytics.
// No user_id param — derived from JWT payload.
//
// Query params:
//   period    (optional)
//   subject   (optional)
router.get('/self', authenticateToken, async (req, res) => {
  const user_id = req.user?.user_id;
  if (!user_id) {
    return res.status(401).json({ error: 'Invalid token payload', code: 'unauthorized' });
  }

  const { period, subject } = req.query;

  try {
    const data = await fetchStudentAnalytics(String(user_id), period, subject);
    return res.json(data);
  } catch (err) {
    console.error('[analytics/self] Error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch analytics', code: 'server_error', details: err.message });
  }
});

module.exports = router;
