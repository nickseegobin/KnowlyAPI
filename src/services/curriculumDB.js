// ============================================================
// curriculumDB — Curriculum data access layer
// Replaces hardcoded taxonomy.js lookups with Supabase queries.
// All public functions are async.
//
// In-memory caching:
//   curriculum_structure  → 5 min TTL  (config, rarely changes)
//   curriculum_topics     → 30 min TTL (content, rarely changes)
// ============================================================

const getSupabase = require('../config/supabase');

// ── Cache ─────────────────────────────────────────────────────────────────────

const STRUCTURE_TTL = 5  * 60 * 1000;
const TOPICS_TTL    = 30 * 60 * 1000;

let _structureCache    = null;
let _structureCacheTs  = 0;
const _topicsCache     = new Map(); // cacheKey → { value, expires }

function _topicsCacheGet(key) {
  const entry = _topicsCache.get(key);
  if (!entry || Date.now() > entry.expires) { _topicsCache.delete(key); return null; }
  return entry.value;
}
function _topicsCacheSet(key, value) {
  _topicsCache.set(key, { value, expires: Date.now() + TOPICS_TTL });
}

async function _getStructure(curriculum = 'tt_primary') {
  if (_structureCache && (Date.now() - _structureCacheTs) < STRUCTURE_TTL) {
    return _structureCache;
  }
  const { data, error } = await getSupabase()
    .from('curriculum_structure')
    .select('*')
    .eq('curriculum_id', curriculum)
    .eq('status', 'active');
  if (error) throw new Error(`[curriculumDB] curriculum_structure fetch failed: ${error.message}`);
  _structureCache   = data;
  _structureCacheTs = Date.now();
  return data;
}

// ── Structure queries ─────────────────────────────────────────────────────────

async function isCapstoneLevel(curriculum, level) {
  const rows = await _getStructure(curriculum);
  const row  = rows.find(r => r.level_id === level);
  return row ? row.is_capstone : false;
}

/**
 * Returns { question_count, time_per_question_seconds, total_time_seconds }
 * trialType = 'practice' | 'sea_paper'
 * difficultyOrSubject = difficulty string for practice, subject string for sea_paper
 */
async function getExamConfig(curriculum, trialType, difficultyOrSubject) {
  const rows = await _getStructure(curriculum);
  let row;
  if (trialType === 'sea_paper') {
    row = rows.find(r => r.trial_type === 'sea_paper' && r.subject === difficultyOrSubject);
  } else {
    row = rows.find(r => r.trial_type === 'practice' && r.difficulty === difficultyOrSubject);
  }
  if (!row) return null;
  return {
    question_count:            row.question_count,
    time_per_question_seconds: row.time_per_question_seconds,
    total_time_seconds:        row.total_time_seconds,
  };
}

async function supportsSeaPaper(curriculum, subject) {
  const rows = await _getStructure(curriculum);
  return rows.some(r => r.trial_type === 'sea_paper' && r.subject === subject);
}

/** Returns full curriculum_structure rows for bufferManager.getAllCombinations() */
async function getAllActiveStructure(curriculum = 'tt_primary') {
  return _getStructure(curriculum);
}

// ── Topic queries ─────────────────────────────────────────────────────────────

/**
 * Returns [ { topic: moduleTitle, subtopics: string[] }, ... ]
 * Matches the shape of TAXONOMY lookups used by examGenerator.
 *
 * topicFilter: if provided (capstone topic practice), filters to one module.
 */
async function getTopicsForExam(curriculum, level, subject, period, topicFilter = null) {
  const subjectKey = subject.replace(/-/g, '_');
  const cacheKey   = `topics:${curriculum}:${level}:${subjectKey}:${period || 'null'}:${topicFilter || 'all'}`;
  const cached     = _topicsCacheGet(cacheKey);
  if (cached) return cached;

  let query = getSupabase()
    .from('curriculum_topics')
    .select('module_title, topic, sort_order')
    .eq('curriculum', curriculum)
    .eq('level', level)
    .eq('subject', subjectKey)
    .eq('status', 'active')
    .order('sort_order', { ascending: true });

  query = period ? query.eq('period', period) : query.is('period', null);

  const { data, error } = await query;
  if (error) throw new Error(`[curriculumDB] getTopicsForExam failed: ${error.message}`);

  // Group subtopics by module_title, preserving sort_order
  const modulesMap = new Map();
  for (const row of data) {
    const title = row.module_title || row.topic;
    if (!modulesMap.has(title)) modulesMap.set(title, []);
    modulesMap.get(title).push(row.topic);
  }

  let result = Array.from(modulesMap.entries()).map(([topic, subtopics]) => ({ topic, subtopics }));

  // Capstone topic filter — scope to one module
  if (topicFilter) {
    const match = result.find(r => r.topic === topicFilter);
    result = match ? [match] : result;
  }

  _topicsCacheSet(cacheKey, result);
  return result;
}

/**
 * Returns { topics, full_paper_question_count, topic_weightings }
 * Matches the shape returned by getCapstoneSubjectConfig() / buildSeaTopicWeightings().
 */
async function getTopicsForSeaPaper(curriculum, subject) {
  const rows      = await _getStructure(curriculum);
  const structRow = rows.find(r => r.trial_type === 'sea_paper' && r.subject === subject);
  if (!structRow) throw new Error(`[curriculumDB] No sea_paper config for ${curriculum}/${subject}`);

  const { data: weightings, error } = await getSupabase()
    .from('capstone_topic_weightings')
    .select('topic, question_count, sort_order')
    .eq('curriculum_id', curriculum)
    .eq('subject', subject)
    .order('sort_order', { ascending: true });

  if (error) throw new Error(`[curriculumDB] capstone_topic_weightings fetch failed: ${error.message}`);

  const topics           = weightings.map(w => w.topic);
  const topic_weightings = Object.fromEntries(weightings.map(w => [w.topic, w.question_count]));

  return {
    topics,
    full_paper_question_count: structRow.full_paper_question_count,
    topic_weightings,
  };
}

// ── Quest generation helpers ──────────────────────────────────────────────────

/**
 * Path A — all subtopics in a module (by 0-based index).
 * Returns { module_number, module_title, objectives: string[] }
 */
async function getModuleByIndex(curriculum, level, subject, period, moduleIndex) {
  const subjectKey = subject.replace(/-/g, '_');
  let query = getSupabase()
    .from('curriculum_topics')
    .select('module_number, module_title, topic, sort_order')
    .eq('curriculum', curriculum)
    .eq('level', level)
    .eq('subject', subjectKey)
    .eq('module_number', moduleIndex + 1)  // module_number is 1-based in DB
    .eq('status', 'active')
    .order('sort_order', { ascending: true });

  query = period ? query.eq('period', period) : query.is('period', null);

  const { data, error } = await query;
  if (error) throw new Error(`[curriculumDB] getModuleByIndex failed: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(`[curriculumDB] No module at index ${moduleIndex} for ${curriculum}/${level}/${period}/${subject}`);
  }

  return {
    module_number: data[0].module_number,
    module_title:  data[0].module_title,
    objectives:    data.map(r => r.topic),
  };
}

/**
 * Path B — all subtopics under a capstone topic (by module_title).
 * Returns { objectives: string[] }
 */
async function getTopicByTitle(curriculum, level, subject, topicTitle) {
  const subjectKey = subject.replace(/-/g, '_');
  const { data, error } = await getSupabase()
    .from('curriculum_topics')
    .select('module_title, topic, sort_order')
    .eq('curriculum', curriculum)
    .eq('level', level)
    .eq('subject', subjectKey)
    .eq('module_title', topicTitle)
    .eq('status', 'active')
    .order('sort_order', { ascending: true });

  if (error) throw new Error(`[curriculumDB] getTopicByTitle failed: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(`[curriculumDB] Topic "${topicTitle}" not found in ${curriculum}/${level}/${subject}`);
  }

  return { objectives: data.map(r => r.topic) };
}

/**
 * Path C — single subtopic (by 0-based moduleIndex + subtopicIndex → sort_order).
 * Returns { module_number, module_title, subtopic, sort_order }
 */
async function getSubtopicByOrder(curriculum, level, subject, period, moduleIndex, subtopicIndex) {
  const sortOrder  = (moduleIndex * 100) + subtopicIndex;
  const subjectKey = subject.replace(/-/g, '_');

  let query = getSupabase()
    .from('curriculum_topics')
    .select('module_number, module_title, topic, sort_order')
    .eq('curriculum', curriculum)
    .eq('level', level)
    .eq('subject', subjectKey)
    .eq('sort_order', sortOrder)
    .eq('status', 'active');

  query = period ? query.eq('period', period) : query.is('period', null);

  const { data, error } = await query;
  if (error) throw new Error(`[curriculumDB] getSubtopicByOrder failed: ${error.message}`);
  if (!data || data.length === 0) {
    throw new Error(`[curriculumDB] No subtopic at sort_order ${sortOrder} for ${curriculum}/${level}/${period}/${subject}`);
  }

  return {
    module_number: data[0].module_number,
    module_title:  data[0].module_title,
    subtopic:      data[0].topic,
    sort_order:    data[0].sort_order,
  };
}

/**
 * bufferManager — distinct module_title values for a capstone subject.
 * Used to expand capstone practice structure rows into per-topic combos.
 */
async function getDistinctModuleTitles(curriculum, level, subject, period = null) {
  const subjectKey = subject.replace(/-/g, '_');
  let query = getSupabase()
    .from('curriculum_topics')
    .select('module_title, sort_order')
    .eq('curriculum', curriculum)
    .eq('level', level)
    .eq('subject', subjectKey)
    .eq('status', 'active')
    .order('sort_order', { ascending: true });

  query = period ? query.eq('period', period) : query.is('period', null);

  const { data, error } = await query;
  if (error) throw new Error(`[curriculumDB] getDistinctModuleTitles failed: ${error.message}`);

  const seen = new Set();
  return data
    .filter(r => r.module_title && !seen.has(r.module_title) && seen.add(r.module_title))
    .map(r => r.module_title);
}

module.exports = {
  isCapstoneLevel,
  getExamConfig,
  supportsSeaPaper,
  getAllActiveStructure,
  getTopicsForExam,
  getTopicsForSeaPaper,
  getModuleByIndex,
  getTopicByTitle,
  getSubtopicByOrder,
  getDistinctModuleTitles,
};
