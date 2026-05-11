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

  // Query curriculum_topics directly — getTopicsForExam omits module_number
  let moduleQuery = supabase
    .from('curriculum_topics')
    .select('module_number, module_title, sort_order')
    .eq('curriculum', curriculum)
    .eq('level', level)
    .eq('subject', subject)
    .eq('status', 'active')
    .not('module_number', 'is', null)
    .order('sort_order', { ascending: true });

  if (period) moduleQuery = moduleQuery.eq('period', period);
  else        moduleQuery = moduleQuery.is('period', null);

  const { data: topicRows, error: topicErr } = await moduleQuery;
  if (topicErr) return res.status(500).json({ error: topicErr.message });

  // Deduplicate to one entry per module_number
  const moduleMap = new Map();
  for (const row of topicRows || []) {
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

// ── GET /api/v1/question-bank/questions ──────────────────────────────────────
// Browse questions with optional filters. Returns paginated results.
//
// Query params: curriculum, level, period, subject, module_number, difficulty,
//               status (active|retired|pending_review|all), page, per_page
router.get('/questions', requireServerKey, async (req, res) => {
  const {
    curriculum    = 'tt_primary',
    level,
    subject,
    period,
    module_number,
    difficulty,
    status        = 'active',
    page          = 1,
    per_page      = 25,
  } = req.query;

  if (!level || !subject) {
    return res.status(400).json({ error: 'level and subject are required', code: 'missing_fields' });
  }

  const supabase   = getSupabase();
  const pageNum    = Math.max(1, parseInt(page, 10) || 1);
  const perPageNum = Math.min(100, Math.max(1, parseInt(per_page, 10) || 25));
  const offset     = (pageNum - 1) * perPageNum;

  let query = supabase
    .from('question_bank')
    .select(
      'id, module_number, module_title, topic, question, options, correct_answer, ' +
      'difficulty, cognitive_level, times_served, last_served_at, status',
      { count: 'exact' }
    )
    .eq('curriculum', curriculum)
    .eq('level', level)
    .eq('subject', subject);

  if (period)                         query = query.eq('period', period);
  else                                query = query.is('period', null);
  if (module_number != null)          query = query.eq('module_number', parseInt(module_number, 10));
  if (difficulty)                     query = query.eq('difficulty', difficulty);
  if (status && status !== 'all')     query = query.eq('status', status);

  query = query
    .order('module_number', { ascending: true })
    .order('times_served',  { ascending: true })
    .order('id',            { ascending: true })
    .range(offset, offset + perPageNum - 1);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  return res.json({
    questions: data || [],
    total:     count ?? 0,
    page:      pageNum,
    per_page:  perPageNum,
    pages:     Math.max(1, Math.ceil((count ?? 0) / perPageNum)),
  });
});

// ── PATCH /api/v1/question-bank/questions/:id ─────────────────────────────────
// Update a single question's status.
//
// Body: { status: 'active' | 'retired' | 'pending_review' }
router.patch('/questions/:id', requireServerKey, async (req, res) => {
  const { id }     = req.params;
  const { status } = req.body;

  if (!id) {
    return res.status(400).json({ error: 'id is required', code: 'missing_id' });
  }

  const allowed = ['active', 'retired', 'pending_review'];
  if (!allowed.includes(status)) {
    return res.status(400).json({
      error: `status must be one of: ${allowed.join(', ')}`,
      code:  'invalid_status',
    });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('question_bank')
    .update({ status })
    .eq('id', id)
    .select('id, question, status, module_number, difficulty, times_served')
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return res.status(404).json({ error: 'Question not found', code: 'not_found' });
    }
    return res.status(500).json({ error: error.message });
  }

  return res.json({ updated: true, question: data });
});

// ── DELETE /api/v1/question-bank/purge ───────────────────────────────────────
// Retires ALL active questions in question_bank. Irreversible.
router.delete('/purge', requireServerKey, async (req, res) => {
  try {
    const { error, count } = await getSupabase()
      .from('question_bank')
      .update({ status: 'retired' })
      .in('status', ['active', 'pending_review'])
      .select('id', { count: 'exact', head: true });

    if (error) throw error;

    console.log(`[question-bank/purge] Retired ${count ?? '?'} questions`);
    return res.json({ retired: count ?? 0 });

  } catch (err) {
    console.error('[question-bank/purge] Error:', err.message);
    return res.status(500).json({ error: 'Purge failed', code: 'server_error', details: err.message });
  }
});

module.exports = router;
