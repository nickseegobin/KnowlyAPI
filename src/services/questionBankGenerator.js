const crypto              = require('crypto');
const { getEmbedding }    = require('./embeddings');
const { getIndex }        = require('./pinecone');
const { generateContent } = require('./ai');
const curriculumDB        = require('./curriculumDB');
const { PROMPTS }         = require('../config/prompts');
const getSupabase         = require('../config/supabase');

const TARGET_COUNT  = 30;
const LOW_WATERMARK = 15;

// ── Fingerprint ───────────────────────────────────────────────────────────────
// SHA-256 of normalised question + options. Deduplicates identical questions
// generated across separate runs.

function makeFingerprint(question, options) {
  const normalised = [
    question.trim().toLowerCase(),
    (options.A || '').trim().toLowerCase(),
    (options.B || '').trim().toLowerCase(),
    (options.C || '').trim().toLowerCase(),
    (options.D || '').trim().toLowerCase(),
  ].join('|');
  return crypto.createHash('sha256').update(normalised).digest('hex');
}

// ── Pinecone RAG context ──────────────────────────────────────────────────────

async function getRAGChunks(curriculum, level, subject, period, moduleTitle) {
  try {
    const queryText = `${curriculum} ${level} ${subject} ${period || ''} ${moduleTitle}`.trim();
    const embedding = await getEmbedding(queryText);
    const index     = getIndex();
    const filter    = { curriculum, level, subject };
    if (period) filter.period = period;
    const results = await index.query({ vector: embedding, topK: 8, filter, includeMetadata: true });
    return results.matches.map(m => m.metadata?.text || '').filter(Boolean).join('\n\n');
  } catch (err) {
    console.error('[qbGen] Pinecone query failed:', err.message);
    return '';
  }
}

// ── Response parsing ──────────────────────────────────────────────────────────

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
// Generates `count` questions for one slot: (curriculum, level, period, subject,
// module_number, difficulty). Upserts into question_bank, skipping duplicates
// by fingerprint.

async function generateQuestions({
  curriculum    = 'tt_primary',
  level,
  period,
  subject,
  module_number,
  difficulty,
  count         = TARGET_COUNT,
}) {
  const supabase = getSupabase();

  // Query curriculum_topics directly for this module's subtopics — getTopicsForExam omits module_number
  let moduleQuery = supabase
    .from('curriculum_topics')
    .select('module_number, module_title, topic')
    .eq('curriculum', curriculum)
    .eq('level', level)
    .eq('subject', subject)
    .eq('module_number', module_number)
    .eq('status', 'active');

  moduleQuery = period ? moduleQuery.eq('period', period) : moduleQuery.is('period', null);

  const { data: moduleRows, error: moduleErr } = await moduleQuery;
  if (moduleErr) throw new Error(`curriculum_topics query failed: ${moduleErr.message}`);

  if (!moduleRows?.length) {
    throw new Error(
      `No curriculum topics found for module_number ${module_number} (${level}/${period || 'cap'}/${subject})`
    );
  }

  const moduleTitle = moduleRows[0].module_title || `Module ${module_number}`;
  const subtopics   = moduleRows.map(r => r.topic);
  const chunks      = await getRAGChunks(curriculum, level, subject, period, moduleTitle);

  const prompts = PROMPTS[curriculum];
  if (!prompts?.question_bank_module) {
    throw new Error(`No question_bank_module prompt defined for curriculum: ${curriculum}`);
  }

  const prompt = prompts.question_bank_module({
    level,
    period,
    subject,
    module_number,
    moduleTitle,
    subtopics,
    difficulty,
    count,
    curriculumChunks: chunks,
    now: new Date().toISOString(),
  });

  const raw       = await generateContent(prompt, { maxTokens: 4000 });
  const questions = parseResponse(raw);
  const valid     = questions.filter(isValidQuestion);

  if (!valid.length) {
    throw new Error(`No valid questions in AI response (received ${questions.length} total)`);
  }

  const rows = valid.map(q => ({
    curriculum,
    level,
    period:          period || null,
    subject,
    module_number,
    module_title:    moduleTitle,
    topic:           q.topic || subtopics[0] || moduleTitle,
    question:        q.question,
    options:         q.options,
    correct_answer:  q.correct_answer,
    explanation:     q.explanation  || null,
    tip:             q.tip          || null,
    cognitive_level: q.cognitive_level || null,
    difficulty,
    fingerprint:     makeFingerprint(q.question, q.options),
    status:          'active',
  }));

  const { data: inserted, error } = await supabase
    .from('question_bank')
    .upsert(rows, { onConflict: 'fingerprint', ignoreDuplicates: true })
    .select('id');

  if (error) throw new Error(`DB insert failed: ${error.message}`);

  const insertedCount    = inserted?.length ?? 0;
  const duplicateSkipped = rows.length - insertedCount;

  // Count active questions in this slot after insert
  const { count: totalActive } = await supabase
    .from('question_bank')
    .select('id', { count: 'exact', head: true })
    .eq('curriculum', curriculum)
    .eq('level', level)
    .eq('subject', subject)
    .eq('module_number', module_number)
    .eq('difficulty', difficulty)
    .eq('status', 'active')
    .then(r => ({ count: r.count ?? null, error: r.error }));

  console.log(
    `[qbGen] ${insertedCount} inserted, ${duplicateSkipped} duplicates skipped, ${totalActive ?? '?'} total active` +
    ` — ${curriculum}/${level}/${period || 'cap'}/${subject}/module_${module_number}/${difficulty}`
  );

  return {
    slot:             `${level}/${period || 'cap'}/${subject}/module_${module_number}/${difficulty}`,
    generated:        valid.length,
    inserted:         insertedCount,
    duplicate_skipped: duplicateSkipped,
    total:            totalActive,
  };
}

// ── Replenishment check ───────────────────────────────────────────────────────
// Called async after /trial/assemble. If the slot's active count has dropped
// below LOW_WATERMARK, triggers a background generateQuestions call.

async function checkAndReplenish({ curriculum = 'tt_primary', level, period, subject, module_number, difficulty }) {
  const supabase = getSupabase();

  let q = supabase
    .from('question_bank')
    .select('*', { count: 'exact', head: true })
    .eq('curriculum', curriculum)
    .eq('level', level)
    .eq('subject', subject)
    .eq('module_number', module_number)
    .eq('difficulty', difficulty)
    .eq('status', 'active');

  if (period) q = q.eq('period', period);
  else        q = q.is('period', null);

  const { count: available } = await q;

  if ((available ?? 0) >= LOW_WATERMARK) {
    return { needed: false, available: available ?? 0 };
  }

  const needed = TARGET_COUNT - (available ?? 0);
  console.log(
    `[qbGen] Low pool (${available ?? 0} active) for module_${module_number}/${difficulty} — replenishing ${needed}`
  );

  setImmediate(async () => {
    try {
      await generateQuestions({ curriculum, level, period, subject, module_number, difficulty, count: needed });
    } catch (err) {
      console.error('[qbGen] Async replenishment failed:', err.message);
    }
  });

  return { needed: true, available: available ?? 0, target: needed };
}

module.exports = { generateQuestions, checkAndReplenish };
