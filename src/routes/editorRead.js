const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const getSupabase = require('../config/supabase');

router.get('/:package_id', authenticateToken, async (req, res) => {
  const serverKey = req.headers['x-aep-server-key'];
  if (!serverKey || serverKey !== process.env.AEP_SERVER_KEY) {
    return res.status(401).json({ status: 'error', message: 'Server key required' });
  }

  const { package_id } = req.params;

  try {
    const { data, error } = await getSupabase()
      .from('exam_pool')
      .select('package_data')
      .eq('package_id', package_id)
      .single();

    if (error || !data) {
      return res.status(404).json({ status: 'not_found', message: 'Package not found' });
    }

    return res.json({ status: 'found', package: data.package_data });

  } catch (err) {
    console.error('Editor read error:', err);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;