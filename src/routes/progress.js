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
        total_exams_completed: 0,
        average_score_percentage: 0,
        exams_by_subject: {},
        recent_exams: []
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
    const exams_by_subject = {};
    for (const [subject, data] of Object.entries(bySubject)) {
      exams_by_subject[subject] = {
        count: data.count,
        average: Math.round(data.total / data.count)
      };
    }

    const recent_exams = sessions.slice(0, 10).map(s => ({
      session_id: s.session_id,
      package_id: s.package_id,
      subject: s.subject,
      difficulty: s.difficulty,
      score: s.percentage,
      completed_at: s.completed_at
    }));

    return res.json({
      total_exams_completed: total,
      average_score_percentage: avgScore,
      exams_by_subject,
      recent_exams
    });

  } catch (err) {
    console.error('Progress error:', err);
    return res.status(500).json({ error: 'Failed to fetch progress', details: err.message });
  }
});

module.exports = router;