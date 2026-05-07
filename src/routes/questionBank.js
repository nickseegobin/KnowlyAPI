const express       = require('express');
const router        = express.Router();
const getSupabase   = require('../config/supabase');
const curriculumDB  = require('../services/curriculumDB');
const { generateQuestions } = require('../services/questionBankGenerator');

const requireServerKey = (req, res, next) => {
  const key = req.headers['x-aep-server-key'];
  if (!key || key !== process.env.AEP_SERVER_KEY) {
    return res.status(401).json({ error: 'Server key required', code: 'unauthorized' });
  }
  next();
};

// ── GET /api/v1/question-bank/list ────────────────────────────────────────────
// Slot coverage stats for the WP Admin slot board.
// Returns one row per (module_number × difficulty) combination for the given
// curriculum/level/period/subject scope, including question counts.
//
// Query params: curriculum, level, period, subject
router.get('/list', requireServerKey, async (req, res) => {
  const { curriculum = 'tt_primary', level, subject, period } = req.query;

  if (!level || !subject) {
    return res.status(400).json({ error: 'level and subject are required', code: 'missing_fields' });
  }

  const supabase = getSupabase();

  // Get all subtopics for this scope to derive the module list
  const allRows = await curriculumDB
    .getTopicsForExam(curriculum, level, subject, period || null, null)
    .catch(() => []);

  // Deduplicate to one entry per module_number
  const moduleMap = new Map();
  for (const row of allRows) {
    if (row.module_number == null) continue;
    if (!moduleMap.has(row.module_number)) {
      moduleMap.set(row.module_number, {
        module_number: row.module_number,
        module_title:  row.module_title || `Module ${row.module_number}`,
        sort_order:    row.sort_order   ?? row.module_number * 100,
      });
    }
  }

  if (!moduleMap.size) {
    return res.json({ curriculum, level, period: period || null, subject, slots: [] });
  }

  // Count questions in the bank per (module_number, difficulty, status)
  let countQuery = supabase
    .from('question_bank')
    .select('module_number, difficulty, status')
    .eq('curriculum', curriculum)
    .eq('level', level)
    .eq('subject', subject);

  if (period) countQuery = countQuery.eq('period', period);
  else        countQuery = countQuery.is('period', null);

  const { data: bankRows, error } = await countQuery;
  if (error) return res.status(500).json({ error: error.message });

  // Aggregate per slot key
  const slotCounts = {};
  for (const row of bankRows || []) {
    const key = `${row.module_number}::${row.difficulty}`;
    if (!slotCounts[key]) slotCounts[key] = { total: 0, active: 0 };
    slotCounts[key].total++;
    if (row.status === 'active') slotCounts[key].active++;
  }

  const modules      = [...moduleMap.values()].sort((a, b) => a.sort_order - b.sort_order);
  const difficulties = ['easy', 'medium', 'hard'];

  const slots = [];
  for (const mod of modules) {
    for (const diff of difficulties) {
      const key    = `${mod.module_number}::${diff}`;
      const counts = slotCounts[key] || { total: 0, active: 0 };
      slots.push({
        module_number:  mod.module_number,
        module_title:   mod.module_title,
        difficulty:     diff,
        question_count: counts.total,
        active_count:   counts.active,
      });
    }
  }

  return res.json({ curriculum, level, period: period || null, subject, slots });
});

// ── POST /api/v1/question-bank/generate ──────────────────────────────────────
// Generate questions for one slot (curriculum, level, period, subject,
// module_number, difficulty).
//
// sync=false (default): returns immediately, generation runs in background.
// sync=true:            waits for generation to complete (~30–60s).
//
// Body: { curriculum, level, period, subject, module_number, difficulty, count, sync }
router.post('/generate', requireServerKey, async (req, res) => {
  const {
    curriculum    = 'tt_primary',
    level,
    period,
    subject,
    module_number,
    difficulty,
    count         = 30,
    sync          = false,
  } = req.body;

  if (!level || !subject || module_number == null || !difficulty) {
    return res.status(400).json({
      error: 'Missing required fields: level, subject, module_number, difficulty',
      code:  'missing_fields',
    });
  }

  if (!['easy', 'medium', 'hard'].includes(difficulty)) {
    return res.status(400).json({ error: 'difficulty must be easy | medium | hard', code: 'invalid_difficulty' });
  }

  const slotLabel = `${level}/${period || 'cap'}/${subject}/module_${module_number}/${difficulty}`;

  if (sync) {
    try {
      const result = await generateQuestions({
        curriculum, level, period: period || null, subject, module_number, difficulty, count,
      });
      return res.json({ sync: true, ...result });
    } catch (err) {
      console.error(`[question-bank/generate] Sync failed for ${slotLabel}:`, err.message);
      return res.status(500).json({ error: err.message, code: 'generation_failed' });
    }
  }

  // Fire-and-forget: respond immediately, generate in background
  res.json({ sync: false, queued: true, slot: slotLabel });

  setImmediate(async () => {
    try {
      await generateQuestions({
        curriculum, level, period: period || null, subject, module_number, difficulty, count,
      });
    } catch (err) {
      console.error(`[question-bank/generate] Background generation failed for ${slotLabel}:`, err.message);
    }
  });
});

module.exports = router;
