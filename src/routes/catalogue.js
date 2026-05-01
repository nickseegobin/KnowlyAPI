const express = require('express');
const router = express.Router();
const { getAllCombinations } = require('../services/bufferManager');
const getSupabase = require('../config/supabase');

// ── GET /api/v1/catalogue ─────────────────────────────────────────────────────
// Returns pool inventory for all level × period × subject × difficulty × trial_type combinations.
// Includes curriculum, level, period, topic, trial_type fields per spec Section 9.1.
// sea_paper entries return difficulty: null, topic: null.

router.get('/', async (req, res) => {
  const { curriculum = 'tt_primary' } = req.query;

  try {
    // ── Build all combinations from DB ─────────────────────────────────────
    const combinations = await getAllCombinations(curriculum);

    // ── Pull approved pool counts from Supabase ────────────────────────────
    const { data: poolRows, error } = await getSupabase()
      .from('exam_pool')
      .select('curriculum, level, period, subject, topic, trial_type, difficulty, generated_at, sequence_index')
      .eq('curriculum', curriculum)
      .eq('status', 'approved');

    if (error) throw error;

    // Index pool rows by composite key
    const poolMap = {};
    for (const row of poolRows || []) {
      const key = [
        row.level,
        row.period || 'null',
        row.subject,
        row.topic || 'null',
        row.trial_type,
        row.difficulty || 'null'
      ].join('|');

      if (!poolMap[key]) poolMap[key] = { count: 0, latest: null, max_sequence: -1 };
      poolMap[key].count++;
      if (!poolMap[key].latest || row.generated_at > poolMap[key].latest) {
        poolMap[key].latest = row.generated_at;
      }
      if ((row.sequence_index || 0) > poolMap[key].max_sequence) {
        poolMap[key].max_sequence = row.sequence_index || 0;
      }
    }

    // ── Build response ─────────────────────────────────────────────────────
    const catalogue = combinations.map(c => {
      const key = [
        c.level,
        c.period || 'null',
        c.subject,
        c.topic || 'null',
        c.trial_type,
        c.difficulty || 'null'
      ].join('|');

      const pool = poolMap[key] || { count: 0, latest: null, max_sequence: -1 };

      return {
        curriculum: c.curriculum,
        level: c.level,
        period: c.period,
        subject: c.subject,
        topic: c.topic,
        trial_type: c.trial_type,
        difficulty: c.difficulty,
        available_count: pool.count,
        max_sequence_index: pool.max_sequence >= 0 ? pool.max_sequence : null,
        latest_generated_at: pool.latest || null
      };
    });

    return res.json(catalogue);

  } catch (err) {
    console.error('[catalogue] Error:', err);
    return res.status(500).json({ error: 'Failed to fetch catalogue', code: 'server_error', details: err.message });
  }
});

module.exports = router;
