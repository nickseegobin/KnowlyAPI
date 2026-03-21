const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const getSupabase = require('../config/supabase');

router.post('/', authenticateToken, async (req, res) => {
  const { session_id, user_id } = req.body;

  if (!session_id || !user_id) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const { error } = await getSupabase()
      .from('exam_sessions')
      .update({
        state: 'cancelled',
        completed_at: new Date().toISOString()
      })
      .eq('session_id', session_id)
      .eq('user_id', user_id)
      .eq('state', 'active');

    if (error) throw error;

    return res.json({
      status: 'cancelled',
      cancelled_at: new Date().toISOString()
    });

  } catch (err) {
    console.error('Cancel exam error:', err);
    return res.status(500).json({ error: 'Failed to cancel exam', details: err.message });
  }
});

module.exports = router;