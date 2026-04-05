const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const getSupabase = require('../config/supabase');

// GET /api/v1/pool
// Returns paginated pool packages for WordPress to seed its local pool.
// Supports filtering by curriculum, level, period, subject, trial_type, difficulty.
// Existing package IDs can be excluded via ?exclude= (comma-separated).

router.get('/', authenticateToken, async (req, res) => {
  const {
    status = 'approved',
    curriculum,
    level,
    period,
    subject,
    trial_type,
    difficulty,
    exclude,
    limit = 50,
    offset = 0
  } = req.query;

  const serverKey = req.headers['x-aep-server-key'];
  const isServerRequest = serverKey && serverKey === process.env.AEP_SERVER_KEY;

  try {
    let query = getSupabase()
      .from('exam_pool')
      .select('package_data, sequence_index', { count: 'exact' })
      .eq('status', status)
      .order('sequence_index', { ascending: true })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (curriculum) query = query.eq('curriculum', curriculum);
    if (level) query = query.eq('level', level);
    if (subject) query = query.eq('subject', subject);
    if (trial_type) query = query.eq('trial_type', trial_type);

    if (period === 'null' || period === 'none') {
      query = query.is('period', null);
    } else if (period) {
      query = query.eq('period', period);
    }

    if (difficulty === 'null') {
      query = query.is('difficulty', null);
    } else if (difficulty) {
      query = query.eq('difficulty', difficulty);
    }

    // Exclude known package IDs (for WP replenishment — pull only packages WP doesn't have)
    if (exclude) {
      const excludeIds = exclude.split(',').map(id => id.trim()).filter(Boolean);
      if (excludeIds.length > 0) {
        query = query.not('package_id', 'in', `(${excludeIds.map(id => `"${id}"`).join(',')})`);
      }
    }

    const { data: packages, error, count } = await query;

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
    console.error('[pool] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch pool', code: 'server_error', details: err.message });
  }
});

module.exports = router;
