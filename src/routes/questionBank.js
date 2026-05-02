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

// ── GET /api/v1/question-bank/status ─────────────────────────────────────────
// Pool counts grouped by (scope, scope_ref, difficulty).
// Query: ?curriculum=tt_primary&level=std_4&subject=math
router.get('/status', requireServerKey, async (req, res) => {
  const { curriculum = 'tt_primary', level, subject } = req.query;
  const supabase = getSupabase();

  let query = supabase
    .from('question_bank')
    .select('scope, scope_ref, difficulty, used_count')
    .eq('status', 'active')
    .eq('curriculum', curriculum);

  if (level)   query = query.eq('level', level);
  if (subject) query = query.eq('subject', subject);

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  const map = {};
  for (const row of data || []) {
    const key = `${row.scope}::${row.scope_ref}::${row.difficulty}`;
    if (!map[key]) map[key] = { scope: row.scope, scope_ref: row.scope_ref, difficulty: row.difficulty, total: 0, unused: 0 };
    map[key].total++;
    if (row.used_count === 0) map[key].unused++;
  }

  return res.json({ curriculum, level: level || null, subject: subject || null, pools: Object.values(map) });
});

// ── POST /api/v1/question-bank/replenish ─────────────────────────────────────
// Enqueue a generation job (async) or run it immediately (sync=true).
// Body: { curriculum, level, period, subject, scope, scope_ref, difficulty, target_count, sync }
router.post('/replenish', requireServerKey, async (req, res) => {
  const {
    curriculum = 'tt_primary',
    level,
    period,
    subject,
    scope,
    scope_ref,
    difficulty,
    target_count = 30,
    sync = false,
  } = req.body;

  if (!level || !subject || !scope || !scope_ref || !difficulty) {
    return res.status(400).json({
      error: 'Missing required fields: level, subject, scope, scope_ref, difficulty',
      code: 'missing_fields',
    });
  }

  if (!['subtopic', 'general_topic', 'period'].includes(scope)) {
    return res.status(400).json({ error: 'scope must be: subtopic | general_topic | period', code: 'invalid_scope' });
  }

  if (!['easy', 'medium', 'hard'].includes(difficulty)) {
    return res.status(400).json({ error: 'difficulty must be: easy | medium | hard', code: 'invalid_difficulty' });
  }

  if (sync) {
    try {
      const result = await generateQuestions({
        curriculum, level, period, subject, scope, scopeRef: scope_ref, difficulty, count: target_count,
      });
      return res.json({ queued: false, generated: true, ...result });
    } catch (err) {
      console.error('[question-bank/replenish] Sync generation failed:', err.message);
      return res.status(500).json({ error: err.message, code: 'generation_failed' });
    }
  }

  const supabase = getSupabase();
  const { data: job, error } = await supabase
    .from('question_bank_queue')
    .insert({ curriculum, level, period: period || null, subject, scope, scope_ref, difficulty, target_count })
    .select('id')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  setImmediate(async () => {
    try {
      await generateQuestions({
        curriculum, level, period, subject, scope, scopeRef: scope_ref, difficulty, count: target_count, jobId: job.id,
      });
    } catch (err) {
      console.error('[question-bank/replenish] Background generation failed:', err.message);
    }
  });

  return res.json({ queued: true, job_id: job.id, target_count });
});

// ── POST /api/v1/question-bank/process-queue ─────────────────────────────────
// Dequeue and process one pending job (called by cron every 6h).
router.post('/process-queue', requireServerKey, async (req, res) => {
  const supabase = getSupabase();

  const { data: jobs } = await supabase
    .from('question_bank_queue')
    .select('*')
    .eq('status', 'pending')
    .order('requested_at', { ascending: true })
    .limit(1);

  if (!jobs?.length) return res.json({ processed: 0, message: 'No pending jobs' });

  const job = jobs[0];
  try {
    const result = await generateQuestions({
      curriculum: job.curriculum,
      level:      job.level,
      period:     job.period,
      subject:    job.subject,
      scope:      job.scope,
      scopeRef:   job.scope_ref,
      difficulty: job.difficulty,
      count:      job.target_count,
      jobId:      job.id,
    });
    return res.json({ processed: 1, job_id: job.id, ...result });
  } catch (err) {
    return res.status(500).json({ processed: 0, error: err.message, job_id: job.id });
  }
});

module.exports = router;
