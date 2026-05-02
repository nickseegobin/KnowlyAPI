const { getEmbedding }   = require('./embeddings');
const { getIndex }        = require('./pinecone');
const { generateContent } = require('./ai');
const curriculumDB        = require('./curriculumDB');
const { PROMPTS }         = require('../config/prompts');
const getSupabase         = require('../config/supabase');
const crypto              = require('crypto');

const LOW_WATERMARK = 15;
const TARGET_COUNT  = 30;

// ── Slug helpers ──────────────────────────────────────────────────────────────

function slugify(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .replace(/\s+/g, '_');
}

function buildScopeRef(scope, { topic, moduleTitle, period }) {
  if (scope === 'subtopic')      return slugify(topic || '');
  if (scope === 'general_topic') return slugify(moduleTitle || '');
  if (scope === 'period')        return period || '';
  throw new Error(`Unknown scope: ${scope}`);
}

function makeQuestionId() {
  return `qb-${crypto.randomBytes(4).toString('hex')}`;
}

// ── Pinecone RAG context ──────────────────────────────────────────────────────

async function getRAGChunks(curriculum, level, subject, period, topic) {
  try {
    const queryText = `${curriculum} ${level} ${subject} ${period || ''} ${topic || ''} curriculum`.trim();
    const embedding = await getEmbedding(queryText);
    const index  = getIndex();
    const filter = { curriculum, level, subject };
    if (period) filter.period = period;
    if (topic)  filter.topic  = topic;
    const results = await index.query({ vector: embedding, topK: 6, filter, includeMetadata: true });
    return results.matches.map(m => m.metadata?.text || '').filter(Boolean).join('\n\n');
  } catch (err) {
    console.error('[qbGen] Pinecone query failed:', err.message);
    return '';
  }
}

// ── Prompt builder ────────────────────────────────────────────────────────────

async function buildPrompt(curriculum, level, period, subject, scope, scopeRef, difficulty, count) {
  const prompts = PROMPTS[curriculum];
  if (!prompts) throw new Error(`No prompts defined for curriculum: ${curriculum}`);

  const now = new Date().toISOString();

  if (scope === 'subtopic') {
    const allRows = await curriculumDB.getTopicsForExam(curriculum, level, subject, period || null, null);
    const topicRow = allRows.find(r => slugify(r.topic) === scopeRef);

    let topicName, moduleTitle;
    if (topicRow) {
      topicName   = topicRow.topic;
      moduleTitle = topicRow.module_title || topicName;
    } else {
      // Fallback: humanize the scope_ref when no exact curriculum match found
      topicName   = scopeRef.replace(/_/g, ' ');
      moduleTitle = topicName;
      console.warn(`[qbGen] No curriculum row for subtopic scope_ref: ${scopeRef} — using humanized fallback`);
    }

    const topicDetail = `Topic: ${topicName}\nModule: ${moduleTitle}`;
    const chunks      = await getRAGChunks(curriculum, level, subject, period, topicName);

    return {
      prompt:      prompts.question_bank_subtopic({ level, subject, topic: topicName, moduleTitle, difficulty, count, topicDetail, curriculumChunks: chunks, now }),
      topic:       topicName,
      moduleTitle,
    };
  }

  if (scope === 'general_topic') {
    const allRows    = await curriculumDB.getTopicsForExam(curriculum, level, subject, period || null, null);
    const moduleRows = allRows.filter(r => slugify(r.module_title || '') === scopeRef);

    let moduleTitle, topics;
    if (moduleRows.length) {
      moduleTitle = moduleRows[0].module_title;
      topics      = moduleRows.map(r => r.topic);
    } else {
      // Fallback: humanize the scope_ref when no exact curriculum match found
      moduleTitle = scopeRef.replace(/_/g, ' ');
      topics      = [moduleTitle];
      console.warn(`[qbGen] No rows for general_topic scope_ref: ${scopeRef} — using humanized fallback`);
    }

    const chunks = await getRAGChunks(curriculum, level, subject, period, moduleTitle);

    return {
      prompt:      prompts.question_bank_general_topic({ level, subject, moduleTitle, topics, difficulty, count, curriculumChunks: chunks, now }),
      topic:       null,
      moduleTitle,
    };
  }

  if (scope === 'period') {
    const allRows = await curriculumDB.getTopicsForExam(curriculum, level, subject, period || null, null);
    if (!allRows.length) throw new Error(`No curriculum rows for ${level}/${period}/${subject}`);

    const allTopics = allRows.map(r => ({ topic: r.topic, moduleTitle: r.module_title || '' }));
    const chunks    = await getRAGChunks(curriculum, level, subject, period, null);

    return {
      prompt:      prompts.question_bank_period({ level, period, subject, allTopics, difficulty, count, curriculumChunks: chunks, now }),
      topic:       null,
      moduleTitle: null,
    };
  }

  throw new Error(`Unknown scope: ${scope}`);
}

// ── Response parsing + validation ─────────────────────────────────────────────

function parseResponse(raw) {
  let text = raw.trim().replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const match = text.match(/\[[\s\S]+\]/);
    if (match) parsed = JSON.parse(match[0]);
    else throw new Error('Response is not valid JSON');
  }
  if (!Array.isArray(parsed)) throw new Error('Response must be a JSON array');
  return parsed;
}

function isValidQuestion(q) {
  if (!q || typeof q !== 'object') return false;
  if (typeof q.question !== 'string' || q.question.length < 10) return false;
  if (!q.options || typeof q.options !== 'object') return false;
  if (!['A', 'B', 'C', 'D'].every(k => k in q.options && q.options[k])) return false;
  if (!['A', 'B', 'C', 'D'].includes(q.correct_answer)) return false;
  return true;
}

// ── Main generation function ──────────────────────────────────────────────────

async function generateQuestions({
  curriculum = 'tt_primary',
  level,
  period,
  subject,
  scope,
  scopeRef,
  difficulty,
  count = TARGET_COUNT,
  jobId = null,
}) {
  const supabase = getSupabase();

  if (jobId) {
    await supabase.from('question_bank_queue').update({ status: 'processing' }).eq('id', jobId);
  }

  try {
    const { prompt, topic, moduleTitle } = await buildPrompt(
      curriculum, level, period, subject, scope, scopeRef, difficulty, count
    );

    const raw       = await generateContent(prompt, { maxTokens: 4000 });
    const questions = parseResponse(raw);
    const valid     = questions.filter(isValidQuestion);

    if (!valid.length) {
      throw new Error(`No valid questions in response (received ${questions.length} total)`);
    }

    const rows = valid.map(q => ({
      question_id:    q.question_id && /^qb-[a-f0-9]{8}$/.test(q.question_id)
                        ? q.question_id
                        : makeQuestionId(),
      curriculum,
      level,
      period:          period || null,
      subject,
      scope,
      scope_ref:       scopeRef,
      topic:           q.topic    || topic       || null,
      module_title:    q.module_title || moduleTitle || null,
      difficulty,
      question:        q.question,
      options:         q.options,
      correct_answer:  q.correct_answer,
      explanation:     q.explanation     || null,
      tip:             q.tip             || null,
      cognitive_level: q.cognitive_level || null,
      source:          'generated',
    }));

    const { data: inserted, error } = await supabase
      .from('question_bank')
      .upsert(rows, { onConflict: 'question_id', ignoreDuplicates: true })
      .select('id');

    if (error) throw new Error(`DB insert failed: ${error.message}`);

    const insertedCount = inserted?.length ?? rows.length;
    console.log(`[qbGen] ${insertedCount} questions inserted — ${curriculum}/${level}/${period || 'cap'}/${subject}/${scope}/${scopeRef}/${difficulty}`);

    if (jobId) {
      await supabase.from('question_bank_queue').update({
        status:       'done',
        completed_at: new Date().toISOString(),
      }).eq('id', jobId);
    }

    return { inserted: insertedCount, valid: valid.length, total: questions.length };

  } catch (err) {
    console.error('[qbGen] Generation failed:', err.message);

    if (jobId) {
      await supabase.from('question_bank_queue').update({
        status:        'failed',
        error_message: err.message,
        completed_at:  new Date().toISOString(),
      }).eq('id', jobId);
    }

    throw err;
  }
}

// ── Replenishment check ────────────────────────────────────────────────────────

async function checkAndReplenish({ curriculum = 'tt_primary', level, period, subject, scope, scopeRef, difficulty }) {
  const supabase = getSupabase();

  const { count: available } = await supabase
    .from('question_bank')
    .select('*', { count: 'exact', head: true })
    .eq('curriculum', curriculum)
    .eq('level', level)
    .eq('subject', subject)
    .eq('scope', scope)
    .eq('scope_ref', scopeRef)
    .eq('difficulty', difficulty)
    .eq('status', 'active')
    .eq('used_count', 0);

  if ((available ?? 0) >= LOW_WATERMARK) {
    return { needed: false, available: available ?? 0 };
  }

  const needed = TARGET_COUNT - (available ?? 0);
  console.log(`[qbGen] Low pool (${available ?? 0} unused) for ${scope}/${scopeRef}/${difficulty} — queuing ${needed}`);

  // Avoid duplicate pending jobs
  const { data: existing } = await supabase
    .from('question_bank_queue')
    .select('id')
    .eq('curriculum', curriculum)
    .eq('level', level)
    .eq('subject', subject)
    .eq('scope', scope)
    .eq('scope_ref', scopeRef)
    .eq('difficulty', difficulty)
    .eq('status', 'pending')
    .limit(1);

  if (existing?.length) {
    return { needed: true, available: available ?? 0, queued: false, reason: 'already_queued' };
  }

  await supabase.from('question_bank_queue').insert({
    curriculum,
    level,
    period:       period || null,
    subject,
    scope,
    scope_ref:    scopeRef,
    difficulty,
    target_count: needed,
  });

  return { needed: true, available: available ?? 0, queued: true, target: needed };
}

module.exports = { generateQuestions, checkAndReplenish, slugify, buildScopeRef };
