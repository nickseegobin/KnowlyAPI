const express    = require('express');
const router     = express.Router();
const getSupabase = require('../config/supabase');

const requireServerKey = (req, res, next) => {
  const key = req.headers['x-aep-server-key'];
  if (!key || key !== process.env.AEP_SERVER_KEY) {
    return res.status(401).json({ error: 'Server key required', code: 'unauthorized' });
  }
  next();
};

// ── Pack configuration ────────────────────────────────────────────────────────

const PACK_SIZE = { easy: 12, medium: 18, hard: 24 };

// Returns the number of questions to draw from each pool for a given pack difficulty.
// Easy:   90% easy  + 10% hard  (challenge sprinkle)
// Medium: 75% easy|medium pool + 25% hard
// Hard:   50% hard  + 50% easy|medium pool (randomly drawn together)
function difficultyMix(packDifficulty) {
  const total = PACK_SIZE[packDifficulty];
  if (packDifficulty === 'easy') {
    const hard = Math.round(total * 0.10);       // ~1
    return { easy: total - hard, mixed: 0, hard };
  }
  if (packDifficulty === 'medium') {
    const hard  = Math.round(total * 0.25);      // ~5
    return { easy: 0, mixed: total - hard, hard };
  }
  // hard
  const hard = Math.round(total * 0.50);         // 12
  return { easy: 0, mixed: total - hard, hard };
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Fetch unassigned active questions from specific difficulty pools, randomly ordered.
async function fetchUnassigned(supabase, filters, difficultyList, count) {
  if (count <= 0) return [];

  const { curriculum, level, period, subject, module_number } = filters;

  let query = supabase
    .from('question_bank')
    .select('id, question, options, correct_answer, difficulty, explanation, tip, module_number, module_title, topic')
    .eq('curriculum', curriculum)
    .eq('level', level)
    .eq('subject', subject)
    .eq('status', 'active')
    .is('assigned_pack_id', null)
    .in('difficulty', difficultyList);

  if (period) query = query.eq('period', period);
  else        query = query.is('period', null);

  if (module_number != null) query = query.eq('module_number', module_number);

  const { data, error } = await query;
  if (error) throw error;

  return shuffle(data || []).slice(0, count);
}

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

  const supabase = getSupabase();
  const mix      = difficultyMix(difficulty);
  const modNum   = module_number != null ? parseInt(module_number, 10) : null;
  const filters  = { curriculum, level, period: period || null, subject, module_number: modNum };

  let selected;
  try {
    if (difficulty === 'easy') {
      // Easy pool + hard accent questions
      const easyQs = await fetchUnassigned(supabase, filters, ['easy'], mix.easy);
      const hardQs = await fetchUnassigned(supabase, filters, ['hard'], mix.hard);
      selected = shuffle([...easyQs, ...hardQs]);
    } else {
      // Combined easy+medium pool + hard accent
      const mixedQs = await fetchUnassigned(supabase, filters, ['easy', 'medium'], mix.mixed);
      const hardQs  = await fetchUnassigned(supabase, filters, ['hard'],           mix.hard);
      selected = shuffle([...mixedQs, ...hardQs]);
    }
  } catch (err) {
    console.error('[trial-packs/build] Query failed:', err.message);
    return res.status(500).json({ error: err.message, code: 'query_failed' });
  }

  const target = PACK_SIZE[difficulty];
  if (selected.length < target) {
    return res.status(422).json({
      error: `Insufficient unassigned questions: need ${target}, found ${selected.length}.`,
      code:   'insufficient_questions',
      found:  selected.length,
      needed: target,
      tip:    'Generate more questions for this slot first.',
    });
  }

  // Trim to exact pack size
  selected = selected.slice(0, target);

  if (preview) {
    return res.json({
      preview:        true,
      difficulty,
      pack_type,
      question_count: selected.length,
      questions:      selected,
    });
  }

  // ── Save pack ─────────────────────────────────────────────────────────────
  const question_ids   = selected.map(q => q.id);
  const module_numbers = modNum != null
    ? [modNum]
    : [...new Set(selected.map(q => q.module_number).filter(Boolean))].sort((a, b) => a - b);

  const { data: pack, error: packErr } = await supabase
    .from('trial_packs')
    .insert({
      curriculum,
      level,
      period:         period || null,
      subject,
      pack_type,
      module_numbers,
      difficulty,
      question_ids,
      question_count: selected.length,
    })
    .select()
    .single();

  if (packErr) {
    console.error('[trial-packs/build] Insert failed:', packErr.message);
    return res.status(500).json({ error: packErr.message, code: 'pack_insert_failed' });
  }

  // Mark questions as assigned to this pack
  const { error: assignErr } = await supabase
    .from('question_bank')
    .update({ assigned_pack_id: pack.id })
    .in('id', question_ids);

  if (assignErr) {
    console.error('[trial-packs/build] Assignment failed:', assignErr.message);
    return res.status(207).json({
      warning:        'Pack created but question assignment failed — run a repair.',
      pack_id:        pack.id,
      question_count: selected.length,
      questions:      selected,
    });
  }

  console.log(`[trial-packs/build] Pack ${pack.id}: ${selected.length}q, ${difficulty}, ${subject}/${level}`);
  return res.status(201).json({
    pack_id:        pack.id,
    difficulty,
    pack_type,
    module_numbers,
    question_count: selected.length,
    questions:      selected,
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
    .select('id, curriculum, level, period, subject, pack_type, module_numbers, difficulty, question_count, status, created_at', { count: 'exact' })
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
