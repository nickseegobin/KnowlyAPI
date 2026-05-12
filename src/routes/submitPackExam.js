const express    = require('express');
const router     = express.Router();
const getSupabase = require('../config/supabase');
const { authenticateToken } = require('../middleware/auth');
const { checkAndAutoGenerate } = require('../services/autoGenerate');

// ── POST /api/v1/submit-pack-exam ─────────────────────────────────────────────
// Score a pack-based trial and record child completion history.
//
// Body:
//   pack_id               string  UUID of the trial_packs row
//   session_id            string  created by the WP plugin at trial start
//   answers               object  { question_id: 'A' | 'B' | 'C' | 'D' }
//   time_elapsed_seconds  number  optional
//   time_remaining_seconds number optional
//
// Auth: Bearer JWT (child)
router.post('/', authenticateToken, async (req, res) => {
  const {
    pack_id,
    session_id,
    answers               = {},
    time_elapsed_seconds,
    time_remaining_seconds,
  } = req.body;

  if (!pack_id || !session_id || !Object.keys(answers).length) {
    return res.status(400).json({ error: 'pack_id, session_id, answers are required', code: 'missing_fields' });
  }

  const child_id = req.user?.id || req.user?.user_id;
  if (!child_id) {
    return res.status(401).json({ error: 'Authenticated child ID not found in token', code: 'unauthorized' });
  }

  const supabase = getSupabase();

  // ── 1. Fetch the pack to get scope metadata ───────────────────────────────────
  const { data: pack, error: packErr } = await supabase
    .from('trial_packs')
    .select('id, curriculum, level, period, subject, difficulty, branch, pack_type, pack_sequence_number')
    .eq('id', pack_id)
    .single();

  if (packErr || !pack) {
    return res.status(404).json({ error: 'Pack not found', code: 'not_found' });
  }

  // ── 2. Fetch the answer sheet from question_bank ──────────────────────────────
  const { data: qbRows, error: qErr } = await supabase
    .from('question_bank')
    .select('id, correct_answer, explanation, difficulty, module_number, module_title, topic')
    .eq('assigned_pack_id', pack_id);

  if (qErr) return res.status(500).json({ error: qErr.message });

  const answerKey = {};
  for (const q of qbRows || []) {
    answerKey[q.id] = q;
  }

  // ── 3. Score ──────────────────────────────────────────────────────────────────
  let score = 0;
  const scoredAnswers = [];

  for (const [question_id, selected_answer] of Object.entries(answers)) {
    const q = answerKey[question_id];
    if (!q) continue;
    const is_correct = selected_answer === q.correct_answer;
    if (is_correct) score++;
    scoredAnswers.push({
      question_id,
      selected_answer,
      correct_answer: q.correct_answer,
      is_correct,
      explanation:    q.explanation || '',
      topic:          q.topic,
      module_number:  q.module_number,
    });
  }

  const total      = scoredAnswers.length;
  const percentage = total > 0 ? Math.round((score / total) * 100) : 0;

  // Per-topic breakdown
  const topicMap = {};
  for (const a of scoredAnswers) {
    const t = a.topic || 'General';
    if (!topicMap[t]) topicMap[t] = { correct: 0, total: 0 };
    topicMap[t].total++;
    if (a.is_correct) topicMap[t].correct++;
  }
  const topic_breakdown = Object.entries(topicMap).map(([topic, d]) => ({
    topic,
    correct:    d.correct,
    total:      d.total,
    percentage: Math.round((d.correct / d.total) * 100),
  }));

  // ── 4. Write exam_session ─────────────────────────────────────────────────────
  await supabase.from('exam_sessions').insert({
    session_id,
    user_id:     child_id,
    package_id:  pack_id,                // reuse package_id field for the pack UUID
    curriculum:  pack.curriculum,
    level:       pack.level,
    period:      pack.period || null,
    subject:     pack.subject,
    difficulty:  pack.difficulty || pack.branch,
    trial_type:  'practice',
    source:      'pack',
    state:       'completed',
    score,
    percentage,
    time_elapsed:   time_elapsed_seconds   || null,
    time_remaining: time_remaining_seconds || null,
    completed_at:   new Date().toISOString(),
  });

  // ── 5. Write child_pack_history ───────────────────────────────────────────────
  // ON CONFLICT DO NOTHING — handles the edge case of double-submit
  await supabase.from('child_pack_history').upsert(
    { child_id, pack_id, session_id, score: percentage, completed_at: new Date().toISOString() },
    { onConflict: 'child_id,pack_id', ignoreDuplicates: true }
  );

  // ── 6. Background watermark check ────────────────────────────────────────────
  checkAndAutoGenerate({
    curriculum: pack.curriculum,
    level:      pack.level,
    period:     pack.period || null,
    subject:    pack.subject,
  });

  return res.json({
    session_id,
    pack_id,
    score,
    total,
    percentage,
    topic_breakdown,
    answer_sheet: scoredAnswers.map(a => ({
      question_id:    a.question_id,
      selected_answer: a.selected_answer,
      correct_answer:  a.correct_answer,
      is_correct:      a.is_correct,
      explanation:     a.explanation,
    })),
  });
});

module.exports = router;
