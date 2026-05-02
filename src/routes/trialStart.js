const express  = require('express');
const router   = express.Router();
const getSupabase = require('../config/supabase');
const { generateQuestions, checkAndReplenish } = require('../services/questionBankGenerator');

const requireServerKey = (req, res, next) => {
  const key = req.headers['x-aep-server-key'];
  if (!key || key !== process.env.AEP_SERVER_KEY) {
    return res.status(401).json({ error: 'Server key required', code: 'unauthorized' });
  }
  next();
};

// ── POST /api/v1/trial/start ──────────────────────────────────────────────────
// Assembles a trial from the question_bank.
// Falls back to immediate generation if pool is below question_count.
//
// Body:
//   curriculum    string  default 'tt_primary'
//   level         string  required
//   period        string  nullable
//   subject       string  required
//   scope         string  required  'subtopic' | 'general_topic' | 'period'
//   scope_ref     string  required  slugified topic/module/period key
//   difficulty    string  required  'easy' | 'medium' | 'hard'
//   question_count int    default 10
//
// Response:
//   { meta, questions (no answers), answer_sheet }
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

  // ── 1. Query pool: prefer unused, then least-recently-used ───────────────
  const buildQuery = () => {
    let q = supabase
      .from('question_bank')
      .select('*')
      .eq('curriculum', curriculum)
      .eq('level', level)
      .eq('subject', subject)
      .eq('scope', scope)
      .eq('scope_ref', scope_ref)
      .eq('difficulty', difficulty)
      .eq('status', 'active')
      .order('used_count', { ascending: true })
      .order('last_used_at', { ascending: true, nullsFirst: true })
      .limit(question_count);

    if (period) {
      q = q.eq('period', period);
    } else {
      q = q.is('period', null);
    }
    return q;
  };

  const { data: poolQuestions, error: poolErr } = await buildQuery();
  if (poolErr) return res.status(500).json({ error: poolErr.message });

  let questions = poolQuestions || [];
  let fromPool  = questions.length;
  let fromGen   = 0;

  // ── 2. Fill shortfall with immediate generation ───────────────────────────
  const shortfall = question_count - questions.length;
  if (shortfall > 0) {
    console.log(`[trial/start] Pool has ${questions.length}/${question_count} — generating ${shortfall + 5} now`);
    try {
      await generateQuestions({
        curriculum, level, period, subject, scope, scopeRef: scope_ref,
        difficulty, count: shortfall + 5,
      });
      const { data: fresh, error: freshErr } = await buildQuery();
      if (!freshErr && fresh?.length) {
        fromGen   = Math.max(0, fresh.length - fromPool);
        questions = fresh;
      }
    } catch (genErr) {
      console.error('[trial/start] Fallback generation failed:', genErr.message);
      if (!questions.length) {
        return res.status(503).json({
          error:   'No questions available and generation failed',
          code:    'pool_empty',
          details: genErr.message,
        });
      }
    }
  }

  questions = questions.slice(0, question_count);

  // ── 3. Mark questions used ───────────────────────────────────────────────
  const now = new Date().toISOString();
  for (const q of questions) {
    await supabase
      .from('question_bank')
      .update({ last_used_at: now, used_count: q.used_count + 1 })
      .eq('id', q.id);
  }

  // ── 4. Async replenishment check ─────────────────────────────────────────
  setImmediate(() =>
    checkAndReplenish({ curriculum, level, period, subject, scope, scopeRef: scope_ref, difficulty })
      .catch(err => console.error('[trial/start] Replenish check failed:', err.message))
  );

  // ── 5. Build response ────────────────────────────────────────────────────
  const answerSheet = questions.map(q => ({
    question_id:    q.question_id,
    correct_answer: q.correct_answer,
    explanation:    q.explanation || '',
  }));

  const safeQuestions = questions.map(q => ({
    question_id: q.question_id,
    question:    q.question,
    options:     q.options,
    meta: {
      topic:           q.topic,
      module_title:    q.module_title,
      cognitive_level: q.cognitive_level,
      difficulty:      q.difficulty,
    },
    tip: q.tip || null,
  }));

  return res.json({
    meta: {
      curriculum,
      level,
      period:         period || null,
      subject,
      scope,
      scope_ref,
      difficulty,
      question_count: questions.length,
      source:         fromGen > 0 ? 'mixed' : 'pool',
      from_pool:      fromPool,
      from_generated: fromGen,
    },
    questions:    safeQuestions,
    answer_sheet: answerSheet,
  });
});

module.exports = router;
