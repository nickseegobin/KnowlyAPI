const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const getSupabase = require('../config/supabase');

router.get('/:user_id', authenticateToken, async (req, res) => {
  const { user_id } = req.params;

  try {
    const { data: session, error } = await getSupabase()
      .from('exam_sessions')
      .select('*')
      .eq('user_id', user_id)
      .eq('state', 'active')
      .order('started_at', { ascending: false })
      .limit(1)
      .single();

    if (error || !session) {
      return res.status(404).json({ error: 'No active exam found' });
    }

    const { data: pkgData } = await getSupabase()
      .from('exam_pool')
      .select('package_data')
      .eq('package_id', session.package_id)
      .single();

    const packageData = pkgData?.package_data;
    const { answer_sheet, ...safePackage } = packageData;

    return res.json({
      session_id: session.session_id,
      package_id: session.package_id,
      current_question_index: session.checkpoint_data?.current_question_index || 0,
      time_remaining_seconds: session.checkpoint_data?.time_remaining_seconds || packageData.meta?.total_time_seconds,
      package_meta: packageData.meta,
      questions: packageData.questions,
      answers_so_far: session.checkpoint_data?.answers_so_far || []
    });

  } catch (err) {
    console.error('Resume exam error:', err);
    return res.status(500).json({ error: 'Failed to resume exam', details: err.message });
  }
});

module.exports = router;