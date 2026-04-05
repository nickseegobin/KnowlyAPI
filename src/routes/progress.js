const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const getSupabase = require('../config/supabase');

router.get('/:user_id', authenticateToken, async (req, res) => {
  const { user_id } = req.params;

  try {
    const { data: sessions, error } = await getSupabase()
      .from('exam_sessions')
      .select('*')
      .eq('user_id', user_id)
      .eq('state', 'completed')
      .order('completed_at', { ascending: false });

    if (error) throw error;

    if (!sessions || sessions.length === 0) {
      return res.json({
        total_trials_completed: 0,
        average_score_percentage: 0,
        trials_by_subject: {},
        recent_trials: []
      });
    }

    const total = sessions.length;
    const avgScore = Math.round(sessions.reduce((sum, s) => sum + (s.percentage || 0), 0) / total);

    const bySubject = {};
    for (const s of sessions) {
      if (!bySubject[s.subject]) bySubject[s.subject] = { count: 0, total: 0 };
      bySubject[s.subject].count++;
      bySubject[s.subject].total += s.percentage || 0;
    }
    const trials_by_subject = {};
    for (const [subject, data] of Object.entries(bySubject)) {
      trials_by_subject[subject] = {
        count: data.count,
        average: Math.round(data.total / data.count)
      };
    }

    const recent_trials = sessions.slice(0, 10).map(s => ({
      session_id: s.session_id,
      package_id: s.package_id,
      curriculum: s.curriculum || 'tt_primary',
      level: s.level,
      period: s.period || null,
      subject: s.subject,
      difficulty: s.difficulty || null,
      trial_type: s.trial_type || 'practice',
      topic: s.topic || null,
      source: s.source || 'direct',
      score: s.percentage,
      completed_at: s.completed_at
    }));

    return res.json({
      total_trials_completed: total,
      average_score_percentage: avgScore,
      trials_by_subject,
      recent_trials
    });

  } catch (err) {
    console.error('[progress] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch progress', code: 'server_error', details: err.message });
  }
});

module.exports = router;
