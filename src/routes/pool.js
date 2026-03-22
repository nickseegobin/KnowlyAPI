const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const getSupabase = require('../config/supabase');

router.get('/', authenticateToken, async (req, res) => {
  const { status = 'approved', limit = 50, offset = 0 } = req.query;

  const serverKey = req.headers['x-aep-server-key'];
  const isServerRequest = serverKey && serverKey === process.env.AEP_SERVER_KEY;

  try {
    const { data: packages, error, count } = await getSupabase()
      .from('exam_pool')
      .select('package_data', { count: 'exact' })
      .eq('status', status)
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (error) throw error;

    const result = (packages || []).map(row => {
      const pkg = row.package_data;
      if (isServerRequest) return pkg;
      const { answer_sheet, ...safe } = pkg;
      return safe;
    });

    return res.json({
      packages: result,
      total: count || 0,
      returned: result.length,
      offset: Number(offset)
    });

  } catch (err) {
    console.error('Pool endpoint error:', err);
    return res.status(500).json({ error: 'Failed to fetch pool', details: err.message });
  }
});

module.exports = router;