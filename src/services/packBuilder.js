const getSupabase = require('../config/supabase');

const PACK_SIZE = { easy: 12, medium: 18, hard: 24 };

function difficultyMix(packDifficulty) {
  if (packDifficulty === 'easy')   return { easy: 9,  medium: 2, hard: 1  };
  if (packDifficulty === 'medium') return { easy: 4,  medium: 9, hard: 5  };
  /* hard */                       return { easy: 3,  medium: 9, hard: 12 };
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

// Get the next sequence number for a scope+branch.
async function nextSequenceNumber(supabase, { curriculum, level, period, subject, branch }) {
  const { data } = await supabase
    .from('trial_packs')
    .select('pack_sequence_number')
    .eq('curriculum', curriculum)
    .eq('level', level)
    .eq('subject', subject)
    .eq('branch', branch)
    .not('pack_sequence_number', 'is', null)
    .order('pack_sequence_number', { ascending: false })
    .limit(1)
    .single();

  const q = period ? supabase.eq('period', period) : supabase.is('period', null);
  void q; // period filter applied inline above via chaining — handled in calling query

  return (data?.pack_sequence_number || 0) + 1;
}

// Correct version — period must be in the same query chain
async function getNextSeq(supabase, { curriculum, level, period, subject, branch }) {
  let q = supabase
    .from('trial_packs')
    .select('pack_sequence_number')
    .eq('curriculum', curriculum)
    .eq('level', level)
    .eq('subject', subject)
    .eq('branch', branch)
    .not('pack_sequence_number', 'is', null)
    .order('pack_sequence_number', { ascending: false })
    .limit(1);

  if (period) q = q.eq('period', period);
  else        q = q.is('period', null);

  const { data } = await q.maybeSingle();
  return (data?.pack_sequence_number || 0) + 1;
}

/**
 * Build and save a single-difficulty (easy|medium|hard) pack.
 *
 * Throws if any difficulty pool is short. Callers should ensure the question
 * bank is stocked (via autoGenerate.js) before calling.
 *
 * @returns {{ pack_id, branch, sequence_number, question_count, questions }}
 */
async function buildPack({
  curriculum   = 'tt_primary',
  level,
  period       = null,
  subject,
  module_number = null,
  pack_type    = 'topic',
  difficulty,
}) {
  const supabase = getSupabase();
  const mix      = difficultyMix(difficulty);
  const modNum   = module_number != null ? parseInt(module_number, 10) : null;
  const branch   = difficulty; // 'easy' | 'medium' | 'hard'
  const filters  = { curriculum, level, period, subject, module_number: modNum };

  const [easyQs, mediumQs, hardQs] = await Promise.all([
    fetchUnassigned(supabase, filters, ['easy'],   mix.easy),
    fetchUnassigned(supabase, filters, ['medium'], mix.medium),
    fetchUnassigned(supabase, filters, ['hard'],   mix.hard),
  ]);

  const shortfalls = [
    easyQs.length   < mix.easy   && { difficulty: 'easy',   need: mix.easy,   found: easyQs.length   },
    mediumQs.length < mix.medium && { difficulty: 'medium', need: mix.medium, found: mediumQs.length },
    hardQs.length   < mix.hard   && { difficulty: 'hard',   need: mix.hard,   found: hardQs.length   },
  ].filter(Boolean);

  if (shortfalls.length) {
    const err  = new Error('Insufficient unassigned questions in one or more difficulty pools');
    err.code   = 'insufficient_questions';
    err.shortfalls = shortfalls;
    throw err;
  }

  const selected       = shuffle([...easyQs, ...mediumQs, ...hardQs]);
  const question_ids   = selected.map(q => q.id);
  const module_numbers = modNum != null
    ? [modNum]
    : [...new Set(selected.map(q => q.module_number).filter(Boolean))].sort((a, b) => a - b);

  const sequence_number = await getNextSeq(supabase, { curriculum, level, period, subject, branch });

  const { data: pack, error: packErr } = await supabase
    .from('trial_packs')
    .insert({
      curriculum,
      level,
      period:               period || null,
      subject,
      pack_type,
      module_numbers,
      difficulty,
      branch,
      pack_sequence_number: sequence_number,
      question_ids,
      question_count:       selected.length,
    })
    .select()
    .single();

  if (packErr) throw new Error(packErr.message);

  await supabase
    .from('question_bank')
    .update({ assigned_pack_id: pack.id })
    .in('id', question_ids);

  return { pack_id: pack.id, branch, sequence_number, question_count: selected.length, questions: selected };
}

/**
 * Build and save a dynamic pack (all modules, random difficulty per module).
 *
 * @param {object} params
 * @param {number[]} params.module_numbers  All active modules for the scope
 * @param {number}  [params.questions_per_module=4]
 * @returns {{ pack_id, branch, sequence_number, question_count, questions, module_assignments }}
 */
async function buildDynamicPack({
  curriculum            = 'tt_primary',
  level,
  period                = null,
  subject,
  module_numbers,
  questions_per_module  = 4,
}) {
  const supabase    = getSupabase();
  const branch      = 'dynamic';
  const difficulties = ['easy', 'medium', 'hard'];

  // Randomly assign a difficulty to each module
  const module_assignments = module_numbers.map(mn => ({
    module_number:     mn,
    difficulty_drawn:  difficulties[Math.floor(Math.random() * difficulties.length)],
  }));

  // Draw questions per module at its assigned difficulty
  const draws = await Promise.all(
    module_assignments.map(({ module_number, difficulty_drawn }) =>
      fetchUnassigned(
        supabase,
        { curriculum, level, period, subject, module_number },
        [difficulty_drawn],
        questions_per_module,
      ).then(qs => ({ module_number, difficulty_drawn, questions: qs }))
    )
  );

  const selected     = shuffle(draws.flatMap(d => d.questions));
  const question_ids = selected.map(q => q.id);

  const enrichedAssignments = draws.map(d => ({
    module_number:    d.module_number,
    difficulty_drawn: d.difficulty_drawn,
    questions_drawn:  d.questions.length,
  }));

  const sequence_number = await getNextSeq(supabase, { curriculum, level, period, subject, branch });

  const { data: pack, error: packErr } = await supabase
    .from('trial_packs')
    .insert({
      curriculum,
      level,
      period:               period || null,
      subject,
      pack_type:            'dynamic',
      module_numbers,
      difficulty:           null,
      branch,
      pack_sequence_number: sequence_number,
      module_assignments:   enrichedAssignments,
      question_ids,
      question_count:       selected.length,
    })
    .select()
    .single();

  if (packErr) throw new Error(packErr.message);

  await supabase
    .from('question_bank')
    .update({ assigned_pack_id: pack.id })
    .in('id', question_ids);

  return {
    pack_id:            pack.id,
    branch,
    sequence_number,
    question_count:     selected.length,
    questions:          selected,
    module_assignments: enrichedAssignments,
  };
}

module.exports = { buildPack, buildDynamicPack, difficultyMix, shuffle, fetchUnassigned, PACK_SIZE };
