const express    = require('express');
const router     = express.Router();
const getSupabase = require('../config/supabase');
const { generateQuestions: generateQBQuestions, checkAndReplenish } = require('../services/questionBankGenerator');
const { checkAndAutoGenerate } = require('../services/autoGenerate');

const requireServerKey = (req, res, next) => {
  const key = req.headers['x-aep-server-key'];
  if (!key || key !== process.env.AEP_SERVER_KEY) {
    return res.status(401).json({ error: 'Server key required', code: 'unauthorized' });
  }
  next();
};

// ── POST /api/v1/trial/assemble ───────────────────────────────────────────────
// Assembles a trial from the question_bank (module_number-based slots).
// Returns the same { meta, questions, answer_sheet } shape as the exam_pool
// packages so the WP delivery layer requires no changes.
//
// Body:
//   curriculum           string   default 'tt_primary'
//   level                string   required
//   period               string   nullable
//   subject              string   required
//   difficulty           string   required  'easy' | 'medium' | 'hard'
//   module_numbers       int[]    required  one or more module_numbers to draw from
//   question_count       int      default 10
//   exclude_question_ids string[] optional  UUIDs of questions to skip (cross-session dedup)
router.post('/assemble', requireServerKey, async (req, res) => {
  const {
    curriculum           = 'tt_primary',
    level,
    period               = null,
    subject,
    difficulty,
    module_numbers,
    question_count       = 10,
    exclude_question_ids = [],
  } = req.body;

  if (!level || !subject || !difficulty || !module_numbers?.length) {
    return res.status(400).json({
      error: 'Missing required fields: level, subject, difficulty, module_numbers',
      code:  'missing_fields',
    });
  }

  if (!['easy', 'medium', 'hard'].includes(difficulty)) {
    return res.status(400).json({ error: 'Invalid difficulty', code: 'invalid_difficulty' });
  }

  const supabase = getSupabase();

  // ── 1. Query the bank for all matching slots ────────────────────────────────
  let query = supabase
    .from('question_bank')
    .select('*')
    .eq('curriculum', curriculum)
    .eq('level', level)
    .eq('subject', subject)
    .eq('difficulty', difficulty)
    .eq('status', 'active')
    .in('module_number', module_numbers);

  if (period) query = query.eq('period', period);
  else        query = query.is('period', null);

  if (exclude_question_ids.length) {
    query = query.not('id', 'in', `(${exclude_question_ids.map(id => `"${id}"`).join(',')})`);
  }

  // Order: least-served first, then by oldest served timestamp
  query = query
    .order('times_served', { ascending: true })
    .order('last_served_at', { ascending: true, nullsFirst: true });

  const { data: poolRows, error: poolErr } = await query;
  if (poolErr) return res.status(500).json({ error: poolErr.message });

  let candidates = poolRows || [];
  let fromPool   = candidates.length;
  let fromGen    = 0;

  // ── 2. Fill shortfall with immediate generation ────────────────────────────
  // Only attempt generation for single-module requests (multi-module shortfalls
  // are left to the caller to handle via retries or difficulty fallback).
  if (candidates.length < question_count && module_numbers.length === 1) {
    const shortfall = question_count - candidates.length;
    console.log(`[trial/assemble] Pool has ${candidates.length}/${question_count} — generating ${shortfall + 5} now`);

    try {
      await generateQBQuestions({
        curriculum,
        level,
        period,
        subject,
        module_number: module_numbers[0],
        difficulty,
        count: shortfall + 5,
      });

      // Re-query after generation
      const { data: fresh, error: freshErr } = await query;
      if (!freshErr && fresh?.length) {
        fromGen    = Math.max(0, fresh.length - fromPool);
        candidates = fresh;
      }
    } catch (genErr) {
      console.error('[trial/assemble] Fallback generation failed:', genErr.message);
      if (!candidates.length) {
        return res.status(503).json({
          error:   'No questions available and generation failed',
          code:    'pool_empty',
          details: genErr.message,
        });
      }
    }
  }

  if (!candidates.length) {
    return res.status(503).json({
      error: 'No questions available for the requested slot(s)',
      code:  'pool_empty',
    });
  }

  // ── 3. Distribute proportionally across modules when multiple requested ─────
  let selected;
  if (module_numbers.length === 1) {
    selected = candidates.slice(0, question_count);
  } else {
    // Round-robin across modules to ensure breadth
    const byModule = {};
    for (const row of candidates) {
      if (!byModule[row.module_number]) byModule[row.module_number] = [];
      byModule[row.module_number].push(row);
    }
    const moduleQueues = Object.values(byModule);
    selected = [];
    let i = 0;
    while (selected.length < question_count && moduleQueues.some(q => q.length > 0)) {
      const queue = moduleQueues[i % moduleQueues.length];
      if (queue.length) selected.push(queue.shift());
      i++;
    }
  }

  // Shuffle to avoid predictable question ordering
  for (let i = selected.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [selected[i], selected[j]] = [selected[j], selected[i]];
  }

  // ── 4. Mark questions served ────────────────────────────────────────────────
  const now = new Date().toISOString();
  const ids  = selected.map(q => q.id);

  await supabase
    .from('question_bank')
    .update({ last_served_at: now })
    .in('id', ids);

  // Increment times_served per row (Supabase doesn't support rpc-free increment in bulk,
  // so we do it individually — acceptable given question_count ≤ 20)
  for (const q of selected) {
    await supabase
      .from('question_bank')
      .update({ times_served: (q.times_served || 0) + 1 })
      .eq('id', q.id);
  }

  // ── 5. Async replenishment check ────────────────────────────────────────────
  for (const mn of module_numbers) {
    setImmediate(() =>
      checkAndReplenish({ curriculum, level, period, subject, module_number: mn, difficulty })
        .catch(err => console.error('[trial/assemble] Replenish check failed:', err.message))
    );
  }

  // ── 6. Build response ───────────────────────────────────────────────────────
  const answerSheet = selected.map(q => ({
    question_id:    q.id,
    correct_answer: q.correct_answer,
    explanation:    q.explanation || '',
  }));

  const safeQuestions = selected.map(q => ({
    question_id: q.id,
    question:    q.question,
    options:     q.options,
    tip:         q.tip || null,
    meta: {
      topic:           q.topic,
      module_title:    q.module_title,
      module_number:   q.module_number,
      cognitive_level: q.cognitive_level,
      difficulty:      q.difficulty,
    },
  }));

  const topicsCovered = [...new Set(selected.map(q => q.module_title).filter(Boolean))];

  return res.json({
    meta: {
      curriculum,
      level,
      period:                  period || null,
      subject,
      difficulty,
      module_numbers,
      question_count:          selected.length,
      time_per_question_seconds: 90,
      total_time_seconds:      selected.length * 90,
      topics_covered:          topicsCovered,
      source:                  fromGen > 0 ? 'mixed' : 'pool',
      from_pool:               fromPool,
      from_generated:          fromGen,
    },
    questions:    safeQuestions,
    answer_sheet: answerSheet,
  });
});


// ── POST /api/v1/trial/start ──────────────────────────────────────────────────
// Legacy endpoint — serves from question_bank_scope (old scope/scope_ref model).
// Not called by React. Kept for backward compatibility until WP is updated to
// use /trial/assemble.
router.post('/start', requireServerKey, async (req, res) => {
  const {
    curriculum     = 'tt_primary',
    level,
    period         = null,
    subject,
    scope,
    scope_ref,
    difficulty,
    question_count = 10,
  } = req.body;

  if (!level || !subject || !scope || !scope_ref || !difficulty) {
    return res.status(400).json({
      error: 'Missing required fields: level, subject, scope, scope_ref, difficulty',
      code:  'missing_fields',
    });
  }

  if (!['subtopic', 'general_topic', 'period'].includes(scope)) {
    return res.status(400).json({ error: 'Invalid scope', code: 'invalid_scope' });
  }

  if (!['easy', 'medium', 'hard'].includes(difficulty)) {
    return res.status(400).json({ error: 'Invalid difficulty', code: 'invalid_difficulty' });
  }

  const supabase = getSupabase();

  const buildQuery = () => {
    let q = supabase
      .from('question_bank_scope')   // renamed from question_bank
      .select('*')
      .eq('curriculum', curriculum)
      .eq('level', level)
      .eq('subject', subject)
      .eq('scope', scope)
      .eq('scope_ref', scope_ref)
      .eq('difficulty', difficulty)
      .eq('status', 'active')
      .order('used_count',    { ascending: true })
      .order('last_used_at',  { ascending: true, nullsFirst: true })
      .limit(question_count);

    return period ? q.eq('period', period) : q.is('period', null);
  };

  const { data: questions, error } = await buildQuery();
  if (error) return res.status(500).json({ error: error.message });

  if (!questions?.length) {
    return res.status(503).json({
      error: 'No questions available in legacy scope pool',
      code:  'pool_empty',
    });
  }

  const now = new Date().toISOString();
  for (const q of questions) {
    await supabase
      .from('question_bank_scope')
      .update({ last_used_at: now, used_count: (q.used_count || 0) + 1 })
      .eq('id', q.id);
  }

  const answerSheet = questions.map(q => ({
    question_id:    q.question_id,
    correct_answer: q.correct_answer,
    explanation:    q.explanation || '',
  }));

  const safeQuestions = questions.map(q => ({
    question_id: q.question_id,
    question:    q.question,
    options:     q.options,
    tip:         q.tip || null,
    meta: {
      topic:           q.topic,
      module_title:    q.module_title,
      cognitive_level: q.cognitive_level,
      difficulty:      q.difficulty,
    },
  }));

  return res.json({
    meta: { curriculum, level, period: period || null, subject, scope, scope_ref, difficulty, question_count: questions.length, source: 'pool' },
    questions:    safeQuestions,
    answer_sheet: answerSheet,
  });
});

// ── GET /api/v1/trial/next-pack ───────────────────────────────────────────────
// Find and return the next unplayed pack for a child in a given branch.
// Called by the WP plugin (server key) before presenting a trial to a child.
//
// Query: curriculum, level, period, subject, branch, child_id
// branch = 'easy' | 'medium' | 'hard' | 'dynamic'
//
// Response: { pack_id, branch, sequence_number, question_count, meta, questions }
// 503 (no_pack_available) if no eligible pack exists — triggers background generation.
router.get('/next-pack', requireServerKey, async (req, res) => {
  const {
    curriculum = 'tt_primary',
    level,
    subject,
    period,
    branch,
    child_id,
  } = req.query;

  if (!level || !subject || !branch || !child_id) {
    return res.status(400).json({
      error: 'level, subject, branch, child_id are required',
      code:  'missing_fields',
    });
  }

  if (!['easy', 'medium', 'hard', 'dynamic'].includes(branch)) {
    return res.status(400).json({ error: 'branch must be easy | medium | hard | dynamic', code: 'invalid_branch' });
  }

  const supabase   = getSupabase();
  const childIdInt = parseInt(child_id, 10);

  // ── 1. Get the child's completed pack IDs for this scope+branch ─────────────
  const { data: history } = await supabase
    .from('child_pack_history')
    .select('pack_id')
    .eq('child_id', childIdInt);

  const completedIds = (history || []).map(r => r.pack_id);

  // ── 2. Find the lowest-sequence active pack the child hasn't completed ────────
  let packQ = supabase
    .from('trial_packs')
    .select('id, pack_sequence_number, difficulty, pack_type, module_numbers, question_count, module_assignments')
    .eq('curriculum', curriculum)
    .eq('level', level)
    .eq('subject', subject)
    .eq('branch', branch)
    .eq('status', 'active')
    .order('pack_sequence_number', { ascending: true })
    .limit(1);

  if (period) packQ = packQ.eq('period', period);
  else        packQ = packQ.is('period', null);

  if (completedIds.length) {
    packQ = packQ.not('id', 'in', `(${completedIds.map(id => `"${id}"`).join(',')})`);
  }

  const { data: packRows, error: packErr } = await packQ;
  if (packErr) return res.status(500).json({ error: packErr.message });

  const pack = packRows?.[0];

  if (!pack) {
    // No pack available — trigger background generation and tell client to retry
    const scope = { curriculum, level, period: period || null, subject };
    checkAndAutoGenerate(scope);
    return res.status(503).json({
      error: 'No pack available for this branch — generation queued.',
      code:  'no_pack_available',
      retry_after_seconds: 30,
    });
  }

  // ── 3. Fetch questions for this pack from question_bank ───────────────────────
  const { data: questions, error: qErr } = await supabase
    .from('question_bank')
    .select('id, question, options, tip, difficulty, module_number, module_title, topic, correct_answer, explanation')
    .eq('assigned_pack_id', pack.id);

  if (qErr) return res.status(500).json({ error: qErr.message });

  // Shuffle for delivery (order locked at build time, randomise at serve time)
  const qs = [...(questions || [])];
  for (let i = qs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [qs[i], qs[j]] = [qs[j], qs[i]];
  }

  const safeQuestions = qs.map(q => ({
    question_id: q.id,
    question:    q.question,
    options:     q.options,
    tip:         q.tip || null,
    meta: {
      topic:         q.topic,
      module_title:  q.module_title,
      module_number: q.module_number,
      difficulty:    q.difficulty,
    },
  }));

  // Answer sheet kept server-side — returned here for WP session storage
  const answer_sheet = qs.map(q => ({
    question_id:    q.id,
    correct_answer: q.correct_answer,
    explanation:    q.explanation || '',
  }));

  return res.json({
    pack_id:         pack.id,
    branch,
    sequence_number: pack.pack_sequence_number,
    question_count:  qs.length,
    meta: {
      curriculum,
      level,
      period:             period || null,
      subject,
      branch,
      pack_type:          pack.pack_type,
      module_numbers:     pack.module_numbers,
      module_assignments: pack.module_assignments || null,
    },
    questions:    safeQuestions,
    answer_sheet,
  });
});

// ── DELETE /api/v1/trial/child-history ───────────────────────────────────────
// Admin reset — clears all child_pack_history rows for a child.
// Called by the WP admin when an admin clicks "Reset Pack History" on a child.
//
// Query: child_id  (required, integer)
router.delete('/child-history', requireServerKey, async (req, res) => {
  const child_id = parseInt(req.query.child_id, 10);

  if (!child_id || isNaN(child_id)) {
    return res.status(400).json({ error: 'child_id is required', code: 'missing_fields' });
  }

  const supabase = getSupabase();

  const { error, count } = await supabase
    .from('child_pack_history')
    .delete({ count: 'exact' })
    .eq('child_id', child_id);

  if (error) return res.status(500).json({ error: error.message });

  console.log(`[trial/child-history] Reset pack history for child ${child_id}: ${count ?? 0} rows deleted`);

  return res.json({ deleted: count ?? 0, child_id });
});

module.exports = router;
