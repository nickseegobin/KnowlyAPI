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

// ── PATCH /api/v1/pool/approve ────────────────────────────────────────────────
// Approve or reject a pending_review package.
// Body: { package_id, action: 'approve' | 'reject' }
router.patch('/approve', async (req, res) => {
  const serverKey = req.headers['x-aep-server-key'];
  if (!serverKey || serverKey !== process.env.AEP_SERVER_KEY) {
    return res.status(401).json({ error: 'Server key required', code: 'unauthorized' });
  }

  const { package_id, action } = req.body;
  if (!package_id || !['approve', 'reject'].includes(action)) {
    return res.status(400).json({ error: 'package_id and action (approve|reject) required', code: 'missing_fields' });
  }

  const newStatus = action === 'approve' ? 'approved' : 'rejected';

  try {
    const { data, error } = await getSupabase()
      .from('exam_pool')
      .update({ status: newStatus, approved_at: action === 'approve' ? new Date().toISOString() : null })
      .eq('package_id', package_id)
      .eq('status', 'pending_review')
      .select('package_id, status')
      .single();

    if (error || !data) {
      return res.status(404).json({ error: 'Package not found or not in pending_review status', code: 'not_found' });
    }

    console.log(`[pool/approve] ${package_id} → ${newStatus}`);
    return res.json({ package_id: data.package_id, status: data.status });

  } catch (err) {
    console.error('[pool/approve] Error:', err);
    return res.status(500).json({ error: 'Failed to update package status', code: 'server_error', details: err.message });
  }
});

// ── GET /api/v1/pool/summary ──────────────────────────────────────────────────
// Returns inventory counts grouped by level/period/subject/difficulty.
// Used by WP Admin Pool Manager to show slot inventory without fetching full packages.
router.get('/summary', async (req, res) => {
  const serverKey = req.headers['x-aep-server-key'];
  if (!serverKey || serverKey !== process.env.AEP_SERVER_KEY) {
    return res.status(401).json({ error: 'Server key required', code: 'unauthorized' });
  }

  const { status = 'approved' } = req.query;

  try {
    const { data, error } = await getSupabase()
      .from('exam_pool')
      .select('curriculum, level, period, subject, difficulty, status, sequence_index, times_served')
      .eq('status', status)
      .order('level')
      .order('subject');

    if (error) throw error;

    // Group by slot key
    const slots = {};
    for (const row of (data || [])) {
      const key = `${row.level}|${row.period || ''}|${row.subject}|${row.difficulty}`;
      if (!slots[key]) {
        slots[key] = {
          level: row.level,
          period: row.period || null,
          subject: row.subject,
          difficulty: row.difficulty,
          curriculum: row.curriculum || 'tt_primary',
          count: 0,
          total_served: 0,
          max_sequence: 0,
        };
      }
      slots[key].count++;
      slots[key].total_served += row.times_served || 0;
      if (row.sequence_index > slots[key].max_sequence) {
        slots[key].max_sequence = row.sequence_index;
      }
    }

    return res.json({
      status,
      total_packages: (data || []).length,
      slot_count: Object.keys(slots).length,
      slots: Object.values(slots),
    });

  } catch (err) {
    console.error('[pool/summary] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch pool summary', code: 'server_error', details: err.message });
  }
});

module.exports = router;
