const express = require('express');
const router = express.Router();
const { TAXONOMY, CURRICULUM_CONFIG, isCapstoneLevel, getCapstoneSubjectConfig, supportsSeaPaper } = require('../config/taxonomy');
const getSupabase = require('../config/supabase');

// ── GET /api/v1/catalogue ─────────────────────────────────────────────────────
// Returns pool inventory for all level × period × subject × difficulty × trial_type combinations.
// Includes curriculum, level, period, topic, trial_type fields per spec Section 9.1.
// sea_paper entries return difficulty: null, topic: null.

router.get('/', async (req, res) => {
  const { curriculum = 'tt_primary' } = req.query;

  try {
    const config = CURRICULUM_CONFIG[curriculum];
    if (!config) {
      return res.status(400).json({ error: `Unknown curriculum: ${curriculum}`, code: 'invalid_curriculum' });
    }

    // ── Build all combinations ─────────────────────────────────────────────
    const combinations = [];

    for (const levelObj of config.levels) {
      const { id: level, has_periods, is_capstone } = levelObj;

      for (const subject of config.subjects) {
        if (is_capstone) {
          // ── Capstone topic practice per topic ──────────────────────────
          const subjectKey = subject.replace('-', '_');
          const subjectTopics = TAXONOMY[level]?.[subjectKey] || [];

          for (const topicObj of subjectTopics) {
            for (const diff of ['easy', 'medium', 'hard']) {
              combinations.push({
                curriculum,
                level,
                period: null,
                subject,
                topic: topicObj.topic,
                trial_type: 'practice',
                difficulty: diff
              });
            }
          }

          // ── Capstone full SEA paper (only subjects that support it) ────
          if (supportsSeaPaper(curriculum, subject)) {
            combinations.push({
              curriculum,
              level,
              period: null,
              subject,
              topic: null,
              trial_type: 'sea_paper',
              difficulty: null
            });
          }

        } else if (has_periods) {
          // ── Period-scoped practice ─────────────────────────────────────
          for (const period of config.periods) {
            for (const diff of ['easy', 'medium', 'hard']) {
              combinations.push({
                curriculum,
                level,
                period,
                subject,
                topic: null,
                trial_type: 'practice',
                difficulty: diff
              });
            }
          }
        } else {
          // ── No periods, no capstone ────────────────────────────────────
          for (const diff of ['easy', 'medium', 'hard']) {
            combinations.push({
              curriculum,
              level,
              period: null,
              subject,
              topic: null,
              trial_type: 'practice',
              difficulty: diff
            });
          }
        }
      }
    }

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
