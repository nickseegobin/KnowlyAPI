const express      = require('express');
const router       = express.Router();
const getSupabase  = require('../config/supabase');
const { buildPack, buildDynamicPack, difficultyMix, shuffle, fetchUnassigned, PACK_SIZE } = require('../services/packBuilder');

const requireServerKey = (req, res, next) => {
  const key = req.headers['x-aep-server-key'];
  if (!key || key !== process.env.AEP_SERVER_KEY) {
    return res.status(401).json({ error: 'Server key required', code: 'unauthorized' });
  }
  next();
};

// difficultyMix, shuffle, fetchUnassigned, PACK_SIZE imported from packBuilder

// ── POST /api/v1/trial-packs/build ───────────────────────────────────────────
// Build a pre-assembled trial pack from unassigned QB questions.
//
// Body: { curriculum, level, period, subject, module_number,
//         pack_type ('topic'|'general'), difficulty, preview }
//
// preview=true  → returns questions without saving or assigning anything.
// preview=false → creates trial_packs row + marks questions as assigned.
router.post('/build', requireServerKey, async (req, res) => {
  const {
    curriculum    = 'tt_primary',
    level,
    period        = null,
    subject,
    module_number = null,
    pack_type     = 'topic',
    difficulty,
    preview       = false,
  } = req.body;

  if (!level || !subject || !difficulty) {
    return res.status(400).json({ error: 'level, subject, difficulty are required', code: 'missing_fields' });
  }
  if (!['easy', 'medium', 'hard'].includes(difficulty)) {
    return res.status(400).json({ error: 'difficulty must be easy | medium | hard', code: 'invalid_difficulty' });
  }
  if (!['topic', 'general'].includes(pack_type)) {
    return res.status(400).json({ error: 'pack_type must be topic | general', code: 'invalid_pack_type' });
  }

  // ── Preview: return questions without saving ──────────────────────────────
  if (preview) {
    const supabase = getSupabase();
    const mix      = difficultyMix(difficulty);
    const modNum   = module_number != null ? parseInt(module_number, 10) : null;
    const filters  = { curriculum, level, period: period || null, subject, module_number: modNum };

    let easyQs, mediumQs, hardQs;
    try {
      [easyQs, mediumQs, hardQs] = await Promise.all([
        fetchUnassigned(supabase, filters, ['easy'],   mix.easy),
        fetchUnassigned(supabase, filters, ['medium'], mix.medium),
        fetchUnassigned(supabase, filters, ['hard'],   mix.hard),
      ]);
    } catch (err) {
      return res.status(500).json({ error: err.message, code: 'query_failed' });
    }

    const shortfalls = [
      easyQs.length   < mix.easy   && { difficulty: 'easy',   need: mix.easy,   found: easyQs.length   },
      mediumQs.length < mix.medium && { difficulty: 'medium', need: mix.medium, found: mediumQs.length },
      hardQs.length   < mix.hard   && { difficulty: 'hard',   need: mix.hard,   found: hardQs.length   },
    ].filter(Boolean);

    return res.json({
      preview:        true,
      difficulty,
      pack_type,
      question_count: (easyQs.length + mediumQs.length + hardQs.length),
      shortfalls,
      questions:      shuffle([...easyQs, ...mediumQs, ...hardQs]),
    });
  }

  // ── Build + save via shared service ──────────────────────────────────────
  try {
    const result = await buildPack({
      curriculum, level, period: period || null, subject,
      module_number, pack_type, difficulty,
    });
    console.log(`[trial-packs/build] Pack ${result.pack_id}: ${result.question_count}q, ${difficulty}, ${subject}/${level} [seq ${result.sequence_number}]`);
    return res.status(201).json({
      pack_id:        result.pack_id,
      difficulty,
      pack_type,
      module_numbers: result.questions ? [...new Set(result.questions.map(q => q.module_number).filter(Boolean))].sort((a,b)=>a-b) : [],
      question_count: result.question_count,
      sequence_number: result.sequence_number,
      questions:      result.questions,
    });
  } catch (err) {
    if (err.code === 'insufficient_questions') {
      return res.status(422).json({
        error:      'Insufficient unassigned questions in one or more difficulty pools.',
        code:       'insufficient_questions',
        shortfalls: err.shortfalls,
        tip:        'Generate more questions for the indicated difficulty slots first.',
      });
    }
    console.error('[trial-packs/build] Failed:', err.message);
    return res.status(500).json({ error: err.message, code: 'build_failed' });
  }
});

// ── POST /api/v1/trial-packs/dynamic-preview ─────────────────────────────────
// Preview a multi-topic dynamic pack. Each selected module is randomly assigned
// a difficulty; questions_per_module questions are drawn from that module's pool
// at the assigned difficulty. Nothing is saved — preview only.
//
// Body: { curriculum, level, period, subject, modules: number[], questions_per_module }
//
// Response includes module_assignments showing which difficulty each module drew.
router.post('/dynamic-preview', requireServerKey, async (req, res) => {
  const {
    curriculum           = 'tt_primary',
    level,
    period               = null,
    subject,
    modules              = [],
    questions_per_module = 4,
  } = req.body;

  if (!level || !subject) {
    return res.status(400).json({ error: 'level and subject are required', code: 'missing_fields' });
  }
  if (!Array.isArray(modules) || modules.length === 0) {
    return res.status(400).json({ error: 'modules must be a non-empty array of module numbers', code: 'missing_modules' });
  }
  const qpm = Math.min(10, Math.max(1, parseInt(questions_per_module, 10) || 4));

  const DIFFICULTIES = ['easy', 'medium', 'hard'];
  const supabase     = getSupabase();

  const allQuestions      = [];
  const module_assignments = [];

  for (const modNum of modules) {
    // Randomly assign a difficulty to this module
    const assignedDiff = DIFFICULTIES[Math.floor(Math.random() * DIFFICULTIES.length)];
    const filters      = { curriculum, level, period: period || null, subject, module_number: parseInt(modNum, 10) };

    let qs;
    try {
      qs = await fetchUnassigned(supabase, filters, [assignedDiff], qpm);
      // Fallback: if randomly-assigned pool is empty, try any difficulty
      if (qs.length === 0) {
        qs = await fetchUnassigned(supabase, filters, DIFFICULTIES, qpm);
      }
    } catch (err) {
      return res.status(500).json({ error: err.message, code: 'query_failed' });
    }

    module_assignments.push({
      module_number:    parseInt(modNum, 10),
      difficulty_drawn: assignedDiff,
      questions_drawn:  qs.length,
    });
    allQuestions.push(...qs);
  }

  return res.json({
    preview:             true,
    dynamic:             true,
    question_count:      allQuestions.length,
    questions_per_module: qpm,
    module_assignments,
    questions:           shuffle(allQuestions),
  });
});

// ── GET /api/v1/trial-packs/watermark ────────────────────────────────────────
// Returns unassigned active question counts per (module_number × difficulty) slot.
// Used by Health Checks and the auto-generation trigger.
//
// Query: { curriculum, level, period, subject }
router.get('/watermark', requireServerKey, async (req, res) => {
  const { curriculum = 'tt_primary', level, subject, period } = req.query;

  if (!level || !subject) {
    return res.status(400).json({ error: 'level and subject are required', code: 'missing_fields' });
  }

  const supabase   = getSupabase();
  const MIN_DYNAMIC = 6;            // minimum per slot for dynamic pack assembly
  const PACK_BUFFER = 36;           // enough for ~3 easy packs (3 × 12)

  let query = supabase
    .from('question_bank')
    .select('module_number, module_title, difficulty')
    .eq('curriculum', curriculum)
    .eq('level', level)
    .eq('subject', subject)
    .eq('status', 'active')
    .is('assigned_pack_id', null);

  if (period) query = query.eq('period', period);
  else        query = query.is('period', null);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  // Aggregate counts per slot
  const counts     = {};
  const titleMap   = {};
  for (const row of data || []) {
    const key = `${row.module_number}::${row.difficulty}`;
    counts[key]              = (counts[key] || 0) + 1;
    titleMap[row.module_number] = titleMap[row.module_number] || row.module_title;
  }

  const modules      = [...new Set((data || []).map(r => r.module_number).filter(Boolean))].sort((a, b) => a - b);
  const difficulties = ['easy', 'medium', 'hard'];
  const slots        = [];

  for (const mod of modules) {
    for (const diff of difficulties) {
      const count = counts[`${mod}::${diff}`] || 0;
      slots.push({
        module_number: mod,
        module_title:  titleMap[mod] || `Module ${mod}`,
        difficulty:    diff,
        unassigned:    count,
        status:        count >= PACK_BUFFER ? 'healthy' : count >= MIN_DYNAMIC ? 'low' : 'critical',
        min_dynamic:   MIN_DYNAMIC,
        pack_buffer:   PACK_BUFFER,
      });
    }
  }

  const healthy  = slots.filter(s => s.status === 'healthy').length;
  const low      = slots.filter(s => s.status === 'low').length;
  const critical = slots.filter(s => s.status === 'critical').length;

  return res.json({
    curriculum,
    level,
    period:   period || null,
    subject,
    slots,
    summary:  { healthy, low, critical, total: slots.length },
  });
});

// ── GET /api/v1/trial-packs/list ─────────────────────────────────────────────
// List pre-built packs with optional filters.
//
// Query: { curriculum, level, period, subject, difficulty, status, page, per_page }
router.get('/list', requireServerKey, async (req, res) => {
  const {
    curriculum = 'tt_primary',
    level, subject, period, difficulty,
    status     = 'active',
    page       = 1,
    per_page   = 20,
  } = req.query;

  const supabase = getSupabase();
  const pageNum  = Math.max(1, parseInt(page, 10) || 1);
  const perPage  = Math.min(100, Math.max(1, parseInt(per_page, 10) || 20));
  const offset   = (pageNum - 1) * perPage;

  let query = supabase
    .from('trial_packs')
    .select('id, curriculum, level, period, subject, pack_type, module_numbers, difficulty, branch, pack_sequence_number, question_count, status, created_at', { count: 'exact' })
    .eq('curriculum', curriculum)
    .order('created_at', { ascending: false })
    .range(offset, offset + perPage - 1);

  if (level)                      query = query.eq('level', level);
  if (subject)                    query = query.eq('subject', subject);
  if (difficulty)                 query = query.eq('difficulty', difficulty);
  if (status && status !== 'all') query = query.eq('status', status);
  if (period)                     query = query.eq('period', period);

  const { data, error, count } = await query;
  if (error) return res.status(500).json({ error: error.message });

  return res.json({
    packs:    data || [],
    total:    count ?? 0,
    page:     pageNum,
    per_page: perPage,
    pages:    Math.max(1, Math.ceil((count ?? 0) / perPage)),
  });
});

// ── PATCH /api/v1/trial-packs/:id ────────────────────────────────────────────
// Update pack status. Optionally release the pack's questions back to the
// unassigned pool when archiving.
//
// Body: { status: 'active' | 'archived', release_questions?: boolean }
//
// release_questions=true is only honoured when status='archived'.
// It NULLs assigned_pack_id on every question in the pack, making them
// available again for new pack builds.
router.patch('/:id', requireServerKey, async (req, res) => {
  const { id }                          = req.params;
  const { status, release_questions = false } = req.body;

  const allowed = ['active', 'archived'];
  if (!allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}`, code: 'invalid_status' });
  }

  const supabase = getSupabase();

  // Fetch pack first so we have question_ids for the optional release step
  const { data: pack, error: fetchErr } = await supabase
    .from('trial_packs')
    .select('id, status, question_ids')
    .eq('id', id)
    .single();

  if (fetchErr || !pack) return res.status(404).json({ error: 'Pack not found', code: 'not_found' });

  // Update pack status
  const { data: updated, error: updateErr } = await supabase
    .from('trial_packs')
    .update({ status })
    .eq('id', id)
    .select('id, status, question_ids')
    .single();

  if (updateErr) return res.status(500).json({ error: updateErr.message });

  // Optionally release questions back to the unassigned pool
  let released = 0;
  if (status === 'archived' && release_questions && (pack.question_ids || []).length > 0) {
    const { error: releaseErr, count } = await supabase
      .from('question_bank')
      .update({ assigned_pack_id: null })
      .in('id', pack.question_ids);

    if (releaseErr) {
      // Pack was archived successfully; log the release failure but don't roll back
      console.error(`[trial-packs/archive] Release failed for pack ${id}:`, releaseErr.message);
      return res.status(207).json({
        updated:  true,
        pack:     updated,
        warning:  'Pack archived but question release failed — questions remain locked to this pack.',
        released: 0,
      });
    }
    released = pack.question_ids.length;
    console.log(`[trial-packs/archive] Pack ${id} archived; ${released} questions released to pool.`);
  }

  return res.json({ updated: true, pack: updated, released });
});

// ── DELETE /api/v1/trial-packs/:id ───────────────────────────────────────────
// Disband a pack: releases all questions back to the unassigned pool, then
// permanently deletes the pack row. Irreversible.
router.delete('/:id', requireServerKey, async (req, res) => {
  const { id }   = req.params;
  const supabase = getSupabase();

  const { data: pack, error: fetchErr } = await supabase
    .from('trial_packs')
    .select('id, question_ids')
    .eq('id', id)
    .single();

  if (fetchErr || !pack) return res.status(404).json({ error: 'Pack not found', code: 'not_found' });

  // Release questions first
  const questionIds = pack.question_ids || [];
  if (questionIds.length > 0) {
    const { error: releaseErr } = await supabase
      .from('question_bank')
      .update({ assigned_pack_id: null })
      .in('id', questionIds);

    if (releaseErr) {
      return res.status(500).json({ error: `Question release failed: ${releaseErr.message}`, code: 'release_failed' });
    }
  }

  // Delete pack row
  const { error: deleteErr } = await supabase
    .from('trial_packs')
    .delete()
    .eq('id', id);

  if (deleteErr) return res.status(500).json({ error: deleteErr.message, code: 'delete_failed' });

  console.log(`[trial-packs/disband] Pack ${id} disbanded; ${questionIds.length} questions released.`);
  return res.json({ disbanded: true, released: questionIds.length });
});

// ── GET /api/v1/trial-packs/:id ──────────────────────────────────────────────
// Get a single pack with all its questions (admin preview).
router.get('/:id', requireServerKey, async (req, res) => {
  const { id }   = req.params;
  const supabase = getSupabase();

  const { data: pack, error: packErr } = await supabase
    .from('trial_packs')
    .select('*')
    .eq('id', id)
    .single();

  if (packErr || !pack) return res.status(404).json({ error: 'Pack not found', code: 'not_found' });

  const { data: questions, error: qErr } = await supabase
    .from('question_bank')
    .select('id, question, options, correct_answer, difficulty, explanation, tip, module_number, module_title, topic')
    .in('id', pack.question_ids || []);

  if (qErr) return res.status(500).json({ error: qErr.message });

  return res.json({ pack, questions: questions || [] });
});

module.exports = router;
