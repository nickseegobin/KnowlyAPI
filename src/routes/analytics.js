const express = require('express');
const router  = express.Router();
const getSupabase = require('../config/supabase');

// All analytics routes are internal — called only by the WP plugin.
// Auth: X-AEP-Server-Key header (same pattern as leaderboard/cron).
function requireServerKey(req, res) {
  const key = req.headers['x-aep-server-key'];
  if (!key || key !== process.env.AEP_SERVER_KEY) {
    res.status(401).json({ error: 'Server key required', code: 'unauthorized' });
    return false;
  }
  return true;
}

// ── GET /api/v1/analytics/class ───────────────────────────────────────────────
// Accepts user_ids as a comma-separated query param.
// Returns aggregate class stats and a per-student summary row.
// WP plugin owns access control — we trust the user_ids list.
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

  try {
    // ── Trial sessions ────────────────────────────────────────────────────────
    const { data: trials, error: trialErr } = await getSupabase()
      .from('exam_sessions')
      .select('user_id, subject, percentage, source, completed_at')
      .in('user_id', user_ids)
      .eq('state', 'completed')
      .order('completed_at', { ascending: false });

    if (trialErr) throw trialErr;

    // ── Quest sessions ────────────────────────────────────────────────────────
    const { data: quests, error: questErr } = await getSupabase()
      .from('quest_sessions')
      .select('user_id, quest_id, source, badge_awarded, completed_at')
      .in('user_id', user_ids)
      .eq('state', 'completed')
      .order('completed_at', { ascending: false });

    if (questErr) throw questErr;

    // ── Build per-student summary ─────────────────────────────────────────────
    const studentMap = {};

    for (const uid of user_ids) {
      studentMap[uid] = {
        user_id:         uid,
        trial_count:     0,
        quest_count:     0,
        avg_score:       null,
        subjects:        [],
        direct_count:    0,
        assignment_count: 0,
        badges_earned:   0,
        last_active:     null,
      };
    }

    const trialsByUser = {};
    for (const t of (trials || [])) {
      if (!trialsByUser[t.user_id]) trialsByUser[t.user_id] = [];
      trialsByUser[t.user_id].push(t);
    }

    for (const [uid, rows] of Object.entries(trialsByUser)) {
      if (!studentMap[uid]) continue;
      const s = studentMap[uid];
      s.trial_count = rows.length;
      const scores = rows.filter(r => r.percentage !== null).map(r => r.percentage);
      s.avg_score = scores.length > 0
        ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
        : null;
      s.subjects = [...new Set(rows.map(r => r.subject).filter(Boolean))];
      s.direct_count     = rows.filter(r => r.source === 'direct').length;
      s.assignment_count = rows.filter(r => r.source === 'assignment').length;
      const dates = rows.map(r => r.completed_at).filter(Boolean).sort().reverse();
      if (dates[0]) s.last_active = dates[0];
    }

    for (const q of (quests || [])) {
      if (!studentMap[q.user_id]) continue;
      const s = studentMap[q.user_id];
      s.quest_count++;
      if (q.badge_awarded) s.badges_earned++;
      if (!s.last_active || q.completed_at > s.last_active) {
        s.last_active = q.completed_at;
      }
    }

    const students = Object.values(studentMap);

    // ── Class-level aggregates ────────────────────────────────────────────────
    const allScores    = students.filter(s => s.avg_score !== null).map(s => s.avg_score);
    const classAvgScore = allScores.length > 0
      ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
      : null;

    const subjectCounts = {};
    for (const t of (trials || [])) {
      if (t.subject) subjectCounts[t.subject] = (subjectCounts[t.subject] || 0) + 1;
    }
    const mostActiveSubject = Object.keys(subjectCounts).sort((a, b) => subjectCounts[b] - subjectCounts[a])[0] || null;

    const totalTrials      = (trials || []).length;
    const totalQuests      = (quests || []).length;
    const totalDirect      = (trials || []).filter(t => t.source === 'direct').length;
    const totalAssignment  = (trials || []).filter(t => t.source === 'assignment').length;
    const totalBadges      = (quests || []).filter(q => q.badge_awarded).length;

    return res.json({
      student_count:        user_ids.length,
      total_trials:         totalTrials,
      total_quests:         totalQuests,
      total_badges:         totalBadges,
      class_avg_score:      classAvgScore,
      most_active_subject:  mostActiveSubject,
      direct_count:         totalDirect,
      assignment_count:     totalAssignment,
      students,
    });

  } catch (err) {
    console.error('[analytics/class] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch class analytics', code: 'server_error', details: err.message });
  }
});

// ── GET /api/v1/analytics/student ─────────────────────────────────────────────
// Full per-student breakdown — trial sessions, quest sessions, subject performance.
router.get('/student', async (req, res) => {
  if (!requireServerKey(req, res)) return;

  const { user_id } = req.query;
  if (!user_id) {
    return res.status(400).json({ error: 'user_id is required', code: 'missing_fields' });
  }

  try {
    // ── Trial sessions ────────────────────────────────────────────────────────
    const { data: trials, error: trialErr } = await getSupabase()
      .from('exam_sessions')
      .select('session_id, subject, difficulty, percentage, source, trial_type, completed_at')
      .eq('user_id', user_id)
      .eq('state', 'completed')
      .order('completed_at', { ascending: false });

    if (trialErr) throw trialErr;

    // ── Quest sessions ────────────────────────────────────────────────────────
    const { data: quests, error: questErr } = await getSupabase()
      .from('quest_sessions')
      .select('session_id, quest_id, source, badge_awarded, started_at, completed_at')
      .eq('user_id', user_id)
      .eq('state', 'completed')
      .order('completed_at', { ascending: false });

    if (questErr) throw questErr;

    // ── Subject breakdown ─────────────────────────────────────────────────────
    const subjectMap = {};
    for (const t of (trials || [])) {
      if (!t.subject) continue;
      if (!subjectMap[t.subject]) {
        subjectMap[t.subject] = { subject: t.subject, trial_count: 0, scores: [], direct: 0, assignment: 0 };
      }
      subjectMap[t.subject].trial_count++;
      if (t.percentage !== null) subjectMap[t.subject].scores.push(t.percentage);
      if (t.source === 'assignment') subjectMap[t.subject].assignment++;
      else subjectMap[t.subject].direct++;
    }

    const subjects = Object.values(subjectMap).map(s => ({
      subject:          s.subject,
      trial_count:      s.trial_count,
      avg_score:        s.scores.length > 0
                          ? Math.round(s.scores.reduce((a, b) => a + b, 0) / s.scores.length)
                          : null,
      direct_count:     s.direct,
      assignment_count: s.assignment,
    }));

    // ── Summary ───────────────────────────────────────────────────────────────
    const allScores = (trials || []).filter(t => t.percentage !== null).map(t => t.percentage);
    const avg_score = allScores.length > 0
      ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
      : null;

    return res.json({
      user_id,
      trial_count:      (trials || []).length,
      quest_count:      (quests || []).length,
      badges_earned:    (quests || []).filter(q => q.badge_awarded).length,
      avg_score,
      direct_count:     (trials || []).filter(t => t.source === 'direct').length,
      assignment_count: (trials || []).filter(t => t.source === 'assignment').length,
      subjects,
      recent_trials:    (trials || []).slice(0, 10),
      recent_quests:    (quests || []).slice(0, 10),
    });

  } catch (err) {
    console.error('[analytics/student] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch student analytics', code: 'server_error', details: err.message });
  }
});

module.exports = router;
