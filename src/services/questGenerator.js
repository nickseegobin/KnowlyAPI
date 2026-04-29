// ============================================================
// Knowly — Quest Generator
// Generates AI Quest content and stores to Supabase quests table.
//
// Two generation paths (driven by level.is_capstone from taxonomy):
//   Path A — Period-scoped (e.g. Standard 4): module-scoped
//   Path B — Capstone     (e.g. Standard 5):  topic-scoped
// ============================================================

const { getEmbedding } = require('./embeddings');
const { getIndex } = require('./pinecone');
const { generateContent } = require('./ai');
const { TAXONOMY, isCapstoneLevel, getSubtopicData } = require('../config/taxonomy');
const { PROMPTS } = require('../config/prompts');
const getSupabase = require('../config/supabase');

// ── Pinecone RAG ──────────────────────────────────────────────────────────────

async function getCurriculumChunks(curriculum, level, subject, period, topicHint) {
  try {
    const queryText = `${curriculum} ${level} ${subject} ${period || ''} ${topicHint || ''} learning objectives curriculum`.trim();
    const embedding = await getEmbedding(queryText);
    const index = getIndex();
    const filter = { curriculum, level, subject };
    if (period)     filter.period = period;
    if (topicHint)  filter.topic  = topicHint;
    const results = await index.query({ vector: embedding, topK: 10, filter, includeMetadata: true });
    return results.matches.map(m => m.metadata?.text || '').filter(Boolean).join('\n\n');
  } catch (err) {
    console.error('[questGenerator] Pinecone query failed, continuing without RAG:', err.message);
    return '';
  }
}

// ── Taxonomy helpers ──────────────────────────────────────────────────────────

function getModuleData(curriculum, level, subject, period, moduleIndex) {
  if (curriculum !== 'tt_primary') throw new Error(`Unsupported curriculum: ${curriculum}`);
  const subjectKey = subject.replace(/-/g, '_');
  const modules = TAXONOMY[level]?.[subjectKey]?.[period];
  if (!modules) throw new Error(`No taxonomy for ${level}/${subject}/${period}`);
  const mod = modules[moduleIndex];
  if (!mod) throw new Error(`No module at index ${moduleIndex} for ${level}/${subject}/${period} (${modules.length} modules available)`);
  return { module_number: moduleIndex + 1, module_title: mod.topic, objectives: mod.subtopics };
}

function getTopicData(curriculum, level, subject, topic) {
  if (curriculum !== 'tt_primary') throw new Error(`Unsupported curriculum: ${curriculum}`);
  const subjectKey = subject.replace(/-/g, '_');
  const allTopics = TAXONOMY[level]?.[subjectKey];
  if (!Array.isArray(allTopics)) throw new Error(`No capstone taxonomy for ${level}/${subject}`);
  const match = allTopics.find(t => t.topic === topic);
  if (!match) throw new Error(`Topic "${topic}" not found in ${level}/${subject} taxonomy`);
  return { objectives: match.subtopics };
}

// ── Quest ID builder ──────────────────────────────────────────────────────────

function buildQuestId(curriculum, level, period, subject, moduleNumber, topic, subtopic) {
  if (subtopic) {
    const slug = subtopic.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    return `quest-${curriculum}-${level}-${period}-${subject}-${slug}`;
  }
  if (topic) {
    const slug = topic.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    return `quest-${curriculum}-${level}-${subject}-${slug}`;
  }
  return `quest-${curriculum}-${level}-${period}-${subject}-module_${moduleNumber}`;
}

// ── Main generation ───────────────────────────────────────────────────────────

/**
 * Generate Quest content via Claude.
 *
 * Three generation paths:
 *   Path A — module-scoped (legacy std_4): moduleIndex only
 *   Path B — capstone topic-scoped (std_5): topic only
 *   Path C — single subtopic (std_4 new): moduleIndex + subtopicIndex
 *
 * @param {object} params
 * @param {string} params.curriculum      e.g. 'tt_primary'
 * @param {string} params.level           e.g. 'std_4' | 'std_5'
 * @param {string} [params.period]        e.g. 'term_1' — null for capstone
 * @param {string} params.subject         e.g. 'math'
 * @param {string} [params.topic]         Capstone topic name (Path B)
 * @param {number} [params.moduleIndex]   0-based module index (Path A / Path C)
 * @param {number} [params.subtopicIndex] 0-based subtopic index within module (Path C)
 */
async function generateQuestContent({
  curriculum = 'tt_primary',
  level,
  period = null,
  subject,
  topic = null,
  moduleIndex = null,
  subtopicIndex = null,
}) {
  const now = new Date().toISOString();
  const isCapstone = isCapstoneLevel(curriculum, level);

  let module_number  = null;
  let module_title   = null;
  let objectives     = [];
  let sort_order     = null;
  let subtopic       = null;
  let singleObjective = false;

  if (isCapstone) {
    // Path B — capstone topic-scoped (std_5)
    if (!topic) throw new Error('topic is required for capstone Quest generation');
    const data = getTopicData(curriculum, level, subject, topic);
    objectives = data.objectives;
  } else if (subtopicIndex !== null && subtopicIndex !== undefined && moduleIndex !== null) {
    // Path C — single subtopic per quest (std_4 new format)
    const data = getSubtopicData(curriculum, level, subject, period, moduleIndex, subtopicIndex);
    module_number   = data.module_number;
    module_title    = data.module_title;
    subtopic        = data.subtopic;
    objectives      = [data.subtopic];
    sort_order      = data.sort_order;
    singleObjective = true;
  } else {
    // Path A — module-scoped (std_4 legacy)
    if (moduleIndex === null || moduleIndex === undefined) {
      throw new Error('moduleIndex is required for period-scoped Quest generation');
    }
    const data = getModuleData(curriculum, level, subject, period, moduleIndex);
    module_number = data.module_number;
    module_title  = data.module_title;
    objectives    = data.objectives;
  }

  const questId        = buildQuestId(curriculum, level, period, subject, module_number, topic, subtopic);
  const topicHint      = subtopic || topic || module_title;
  const curriculumChunks = await getCurriculumChunks(curriculum, level, subject, period, topicHint);

  const prompt = PROMPTS[curriculum].quest({
    level,
    period,
    subject,
    topic,
    moduleNumber: module_number,
    moduleTitle:  module_title,
    objectives,
    curriculumChunks,
    questId,
    now,
    singleObjective,
  });

  const raw = await generateContent(prompt);

  let questData;
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    questData = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
  } catch (err) {
    throw new Error(`Quest JSON parse failed: ${err.message}. Raw (first 200): ${String(raw).slice(0, 200)}`);
  }

  // Ensure taxonomy fields are always populated from our data (not just Claude output)
  questData.module_number = module_number;
  questData.module_title  = module_title;
  questData.objectives    = objectives;
  if (sort_order !== null) questData.sort_order = sort_order;

  return { questId, questData, sortOrder: sort_order };
}

// ── Storage ───────────────────────────────────────────────────────────────────

/**
 * Upsert a Quest into Supabase.
 *
 * @param {object} params
 * @param {string} params.questId
 * @param {object} params.questData   Parsed Claude output with taxonomy fields merged
 * @param {string} params.status      'approved' (buffer/auto) | 'draft' (editor)
 * @param {number|null} params.sortOrder  Display order (Path C only)
 */
async function storeQuest({ questId, questData, status = 'approved', sortOrder = null }) {
  const now = new Date().toISOString();

  const { data, error } = await getSupabase()
    .from('quests')
    .upsert({
      quest_id:      questId,
      curriculum:    questData.curriculum || 'tt_primary',
      level:         questData.level,
      period:        questData.period  || null,
      subject:       questData.subject,
      topic:         questData.topic   || null,
      module_number: questData.module_number || null,
      module_title:  questData.module_title  || null,
      objectives:    questData.objectives,
      content:       questData.content,
      sort_order:    sortOrder !== null ? sortOrder : (questData.sort_order ?? null),
      status,
      generated_at:  questData.generated_at || now,
      approved_at:   status === 'approved' ? now : null,
    }, { onConflict: 'quest_id' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

module.exports = { generateQuestContent, storeQuest };
