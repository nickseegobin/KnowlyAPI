const express = require('express');
const router  = express.Router();
const { generateContent } = require('../services/ai');
const { PROMPTS }         = require('../config/prompts');
const getSupabase = require('../config/supabase');

function requireServerKey(req, res, next) {
  const key = req.headers['x-aep-server-key'];
  if (!key || key !== process.env.AEP_SERVER_KEY) {
    return res.status(401).json({ error: 'Server key required', code: 'unauthorized' });
  }
  next();
}

// ── POST /api/v1/lesson/generate-questions ────────────────────────────────────
// Server-key only. Generates 3 comprehension MCQs for a lesson module and stores
// them in lesson_questions. Replaces any existing active questions for the same
// quest_id.
router.post('/generate-questions', requireServerKey, async (req, res) => {
  const {
    curriculum   = 'tt_primary',
    level,
    period       = null,
    subject,
    quest_id,
    module_title,
    topics       = [],
  } = req.body;

  if (!level || !subject || !quest_id || !module_title) {
    return res.status(400).json({
      error: 'level, subject, quest_id, and module_title are required',
      code: 'missing_fields',
    });
  }

  try {
    const prompts = PROMPTS[curriculum];
    if (!prompts?.lesson_questions) {
      return res.status(500).json({ error: 'Prompt not configured for curriculum', code: 'config_error' });
    }

    let curriculumChunks = '';
    try {
      const { getEmbedding } = require('../services/embeddings');
      const { getIndex }     = require('../services/pinecone');
      const queryText = `${curriculum} ${level} ${subject} ${period || ''} ${module_title} lesson comprehension`.trim();
      const embedding = await getEmbedding(queryText);
      const index     = getIndex();
      const filter    = { curriculum, level, subject };
      if (period) filter.period = period;
      const results   = await index.query({ vector: embedding, topK: 8, filter, includeMetadata: true });
      curriculumChunks = results.matches.map(m => m.metadata?.text || '').filter(Boolean).join('\n\n');
    } catch (_) {}

    const prompt = prompts.lesson_questions({ level, period, subject, moduleTitle: module_title, topics, curriculumChunks });
    const raw    = await generateContent(prompt);

    const jsonMatch = raw.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      return res.status(500).json({ error: 'AI returned invalid format', code: 'generation_error' });
    }
    const questions = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(questions) || questions.length === 0) {
      return res.status(500).json({ error: 'No questions generated', code: 'generation_error' });
    }

    // Retire existing active questions for this quest
    await getSupabase()
      .from('lesson_questions')
      .update({ status: 'retired' })
      .eq('quest_id', quest_id)
      .eq('status', 'active');

    const rows = questions.map(q => ({
      quest_id,
      sort_order:      q.sort_order,
      difficulty:      q.difficulty,
      topic:           q.topic,
      question:        q.question,
      options:         q.options,
      correct_answer:  q.correct_answer,
      explanation:     q.explanation     || null,
      tip:             q.tip             || null,
      cognitive_level: q.cognitive_level || null,
      status:          'active',
    }));

    const { error: insertErr } = await getSupabase()
      .from('lesson_questions')
      .insert(rows);

    if (insertErr) throw insertErr;

    console.log(`[lesson/generate-questions] Generated ${rows.length} questions for quest=${quest_id}`);
    return res.status(201).json({ quest_id, question_count: rows.length });

  } catch (err) {
    console.error('[lesson/generate-questions] Error:', err.message);
    return res.status(500).json({ error: 'Question generation failed', code: 'generation_error', details: err.message });
  }
});

// ── GET /api/v1/lesson/:quest_id/questions ────────────────────────────────────
// Returns active lesson questions for a quest.
// Bearer JWT → questions without correct_answer (student delivery).
// Server key  → questions with correct_answer (WP scoring).
router.get('/:quest_id/questions', async (req, res) => {
  const authHeader = req.headers['authorization'] || '';
  const serverKey  = req.headers['x-aep-server-key'];
  const isAdmin    = serverKey && serverKey === process.env.AEP_SERVER_KEY;

  if (!isAdmin && !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required', code: 'unauthorized' });
  }

  const { quest_id } = req.params;

  const selectFields = isAdmin
    ? 'id, quest_id, sort_order, difficulty, topic, question, options, correct_answer, explanation, tip, cognitive_level'
    : 'id, quest_id, sort_order, difficulty, topic, question, options, explanation, tip, cognitive_level';

  const { data, error } = await getSupabase()
    .from('lesson_questions')
    .select(selectFields)
    .eq('quest_id', quest_id)
    .eq('status', 'active')
    .order('sort_order', { ascending: true });

  if (error) {
    console.error('[lesson/questions] Supabase error:', error);
    return res.status(500).json({ error: 'Failed to fetch questions', code: 'server_error' });
  }

  return res.json({ quest_id, questions: data || [], count: (data || []).length });
});

module.exports = router;
