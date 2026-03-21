const express = require('express');
const router = express.Router();
const { TAXONOMY, EXAM_CONFIG } = require('../config/taxonomy');
const getSupabase = require('../config/supabase');

router.get('/', async (req, res) => {
  try {
    // Build all combinations from taxonomy
    const combinations = [];

    // std_4 — term-scoped
    const std4Subjects = Object.keys(TAXONOMY.std_4);
    const std4Terms = Object.keys(TAXONOMY.std_4[std4Subjects[0]]);
    const std4Difficulties = Object.keys(EXAM_CONFIG.std_4);

    for (const subject of std4Subjects) {
      for (const term of std4Terms) {
        for (const difficulty of std4Difficulties) {
          combinations.push({ standard: 'std_4', term, subject, difficulty });
        }
      }
    }

    // std_5 — no terms
    const std5Subjects = Object.keys(TAXONOMY.std_5);
    const std5Difficulties = Object.keys(EXAM_CONFIG.std_5);

    for (const subject of std5Subjects) {
      for (const difficulty of std5Difficulties) {
        combinations.push({ standard: 'std_5', term: null, subject, difficulty });
      }
    }

    // Pull pool counts from Supabase
    const { data: poolRows, error } = await getSupabase()
      .from('exam_pool')
      .select('standard, term, subject, difficulty, generated_at')
      .eq('status', 'approved');

    if (error) throw error;

    // Index pool rows by key
    const poolMap = {};
    for (const row of poolRows || []) {
      const key = `${row.standard}|${row.term || 'null'}|${row.subject}|${row.difficulty}`;
      if (!poolMap[key]) poolMap[key] = { count: 0, latest: null };
      poolMap[key].count++;
      if (!poolMap[key].latest || row.generated_at > poolMap[key].latest) {
        poolMap[key].latest = row.generated_at;
      }
    }

    // Build response
    const catalogue = combinations.map(c => {
      const key = `${c.standard}|${c.term || 'null'}|${c.subject}|${c.difficulty}`;
      const pool = poolMap[key] || { count: 0, latest: null };
      return {
        standard: c.standard,
        term: c.term,
        subject: c.subject,
        difficulty: c.difficulty,
        available_count: pool.count,
        latest_generated_at: pool.latest || null
      };
    });

    return res.json(catalogue);

  } catch (err) {
    console.error('Catalogue error:', err);
    return res.status(500).json({ error: 'Failed to fetch catalogue', details: err.message });
  }
});

module.exports = router;