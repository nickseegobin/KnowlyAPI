const express    = require('express');
const router     = express.Router();
const getSupabase = require('../config/supabase');

router.get('/', (req, res) => {
  res.json({
    status: 'ok',
    version: '1.0.0',
    service: 'Knowly Exam Platform API',
    timestamp: new Date().toISOString()
  });
});

// ── GET /api/v1/health/db-check ───────────────────────────────────────────────
// Returns row counts for Phase 3 tables + confirms renamed fingerprint table.
// Protected by AEP server key — admin/test use only.
router.get('/db-check', async (req, res) => {
  const key = req.headers['x-aep-server-key'];
  if (!key || key !== process.env.AEP_SERVER_KEY) {
    return res.status(401).json({ error: 'Server key required', code: 'unauthorized' });
  }

  const supabase = getSupabase();
  const tables   = [
    'curriculum_topics',
    'curriculum_structure',
    'capstone_topic_weightings',
    'question_fingerprints',
    'exam_pool',
  ];

  const results = {};
  for (const table of tables) {
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true });

    results[table] = error
      ? { exists: false, error: error.message }
      : { exists: true,  count };
  }

  const allOk = Object.values(results).every(r => r.exists);
  return res.status(allOk ? 200 : 500).json({ ok: allOk, tables: results });
});

module.exports = router;