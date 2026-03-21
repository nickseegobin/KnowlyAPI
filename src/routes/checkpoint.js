const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const getSupabase = require('../config/supabase');

router.post('/', authenticateToken, async (req, res) => {
  const { session_id, user_id, package_id, current_question_index, time_remaining_seconds, answers_so_far, standard, term, subject, difficulty } = req.body;

  if (!session_id || !user_id || !package_id) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const { error } = await getSupabase()
      .from('exam_sessions')
      .upsert({
        session_id,
        user_id,
        package_id,
        standard: standard || 'std_4',
        term: term || null,
        subject: subject || 'unknown',
        difficulty: difficulty || 'medium',
        state: 'active',
        time_remaining: time_remaining_seconds,
        checkpoint_data: {
          current_question_index,
          time_remaining_seconds,
          answers_so_far
        }
      }, { onConflict: 'session_id' });

    if (error) throw error;

    return res.json({
      status: 'saved',
      checkpoint_at: new Date().toISOString()
    });

  } catch (err) {
    console.error('Checkpoint error:', err);
    return res.status(500).json({ error: 'Failed to save checkpoint', details: err.message });
  }
});

module.exports = router;