const { getEmbedding } = require('./embeddings');
const { getIndex } = require('./pinecone');
const { generateContent } = require('./ai');
const { TAXONOMY, EXAM_CONFIG, CURRICULUM_CONFIG, isCapstoneLevel, getCapstoneSubjectConfig } = require('../config/taxonomy');
const { PROMPTS } = require('../config/prompts');
const getSupabase = require('../config/supabase');
const crypto = require('crypto');

// ── Pinecone RAG ──────────────────────────────────────────────────────────────

async function getCurriculumChunks(curriculum, level, subject, period, topic) {
  try {
    const queryText = `${curriculum} ${level} ${subject} ${period || ''} ${topic || ''} curriculum topics`.trim();
    const embedding = await getEmbedding(queryText);
    const index = getIndex();
    const filter = { curriculum, level, subject };
    if (period) filter.period = period;
    if (topic) filter.topic = topic;
    const results = await index.query({
      vector: embedding,
      topK: 8,
      filter,
      includeMetadata: true,
    });
    return results.matches.map(m => m.metadata?.text || '').filter(Boolean).join('\n\n');
  } catch (err) {
    console.error('Pinecone query failed, using taxonomy only:', err.message);
    return '';
  }
}

// ── Taxonomy helpers ──────────────────────────────────────────────────────────

function getTopicsForExam(curriculum, level, subject, period, topic) {
  const subjectKey = subject.replace('-', '_');

  if (curriculum === 'tt_primary') {
    if (isCapstoneLevel(curriculum, level)) {
      // std_5: topic practice — find matching topic in taxonomy
      const allTopics = TAXONOMY.std_5[subjectKey] || [];
      if (topic) {
        const match = allTopics.find(t => t.topic === topic);
        return match ? [match] : allTopics;
      }
      return allTopics;
    } else {
      // std_4: period-scoped
      const termTopics = TAXONOMY.std_4[subjectKey]?.[period];
      if (!termTopics) throw new Error(`No taxonomy found for ${level} ${subject} ${period}`);
      return termTopics;
    }
  }

  throw new Error(`Unsupported curriculum: ${curriculum}`);
}

function getTopicsForSeaPaper(curriculum, subject) {
  const capstoneConfig = getCapstoneSubjectConfig(curriculum, subject);
  if (!capstoneConfig) throw new Error(`No capstone config for ${curriculum} ${subject}`);
  return capstoneConfig;
}

// ── Fingerprinting ─────────────────────────────────────────────────────────────

function buildFingerprint(question) {
  const numerals = (question.question || '').match(/\d+(\.\d+)?/g) || [];
  const raw = [
    (question.meta?.subtopic || '').toLowerCase().trim(),
    (question.correct_answer || '').toUpperCase(),
    numerals.sort().join('-')
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// ── Package ID generation ─────────────────────────────────────────────────────

function generatePackageId(curriculum, level, period, subject, difficulty, trialType, topic) {
  const rand = Math.floor(Math.random() * 9000) + 1000;
  if (trialType === 'sea_paper') {
    return `pkg-${curriculum}-${level}-sea-${subject}-${rand}`;
  }
  if (topic) {
    const topicSlug = topic.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    return `pkg-${curriculum}-${level}-${subject}-${topicSlug}-${difficulty}-${rand}`;
  }
  return `pkg-${curriculum}-${level}-${period}-${subject}-${difficulty}-${rand}`;
}

// ── Next sequence index for a combination ────────────────────────────────────

async function getNextSequenceIndex(curriculum, level, period, subject, trialType, difficulty, topic) {
  let query = getSupabase()
    .from('exam_pool')
    .select('sequence_index')
    .eq('curriculum', curriculum)
    .eq('level', level)
    .eq('subject', subject)
    .eq('trial_type', trialType)
    .order('sequence_index', { ascending: false })
    .limit(1);

  if (period) {
    query = query.eq('period', period);
  } else {
    query = query.is('period', null);
  }

  if (difficulty) {
    query = query.eq('difficulty', difficulty);
  } else {
    query = query.is('difficulty', null);
  }

  if (topic) {
    query = query.eq('topic', topic);
  } else {
    query = query.is('topic', null);
  }

  const { data } = await query;
  if (data && data.length > 0 && data[0].sequence_index !== null) {
    return data[0].sequence_index + 1;
  }
  return 0;
}

// ── Topic list builder ────────────────────────────────────────────────────────

function buildTopicList(topics) {
  return topics.map(t =>
    `- ${t.topic}: ${t.subtopics.slice(0, 4).join(', ')}`
  ).join('\n');
}

function buildSeaTopicWeightings(capstoneConfig) {
  const { topics, full_paper_question_count, topic_weightings } = capstoneConfig;
  return topics.map(t => {
    const count = topic_weightings?.[t] || Math.floor(full_paper_question_count / topics.length);
    return `- ${t}: ${count} questions`;
  }).join('\n');
}

// ── Shuffle ───────────────────────────────────────────────────────────────────

function shuffleArray(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function shuffleQuestions(questions) {
  const shuffled = shuffleArray(questions);
  return shuffled.map((q, index) => ({
    ...q,
    question_id: `q_${String(index + 1).padStart(3, '0')}`
  }));
}

function buildAnswerSheet(questions) {
  return questions.map(q => ({
    question_id: q.question_id,
    correct_answer: q.correct_answer,
    explanation: q.explanation || ''
  }));
}

// ── Main generation function ──────────────────────────────────────────────────

async function generateExamPackage({ curriculum = 'tt_primary', level, period, subject, difficulty, trial_type = 'practice', topic = null }) {
  const now = new Date().toISOString();
  const isCapstone = isCapstoneLevel(curriculum, level);
  const isSeaPaper = trial_type === 'sea_paper';

  let promptFn, config, topics, curriculumChunks, packageId, prompt;

  if (isSeaPaper) {
    // ── Full SEA Paper ──────────────────────────────────────────────────────
    const capstoneConfig = getTopicsForSeaPaper(curriculum, subject);
    config = EXAM_CONFIG[curriculum]?.sea_paper?.[subject];
    if (!config) throw new Error(`No sea_paper config for ${curriculum} ${subject}`);

    packageId = generatePackageId(curriculum, level, null, subject, null, 'sea_paper', null);

    // Build full topic list from capstone subject taxonomy
    const allTopics = TAXONOMY[level]?.[subject.replace('-', '_')] || [];
    const topicList = buildTopicList(allTopics);
    const topicWeightings = buildSeaTopicWeightings(capstoneConfig);

    curriculumChunks = await getCurriculumChunks(curriculum, level, subject, null, null);

    prompt = PROMPTS[curriculum].sea_paper({
      subject,
      questionCount: config.question_count,
      timePerQuestion: config.time_per_question_seconds,
      totalTime: config.total_time_seconds,
      packageId,
      topicWeightings,
      topicList,
      curriculumChunks,
      now
    });

  } else if (isCapstone && topic) {
    // ── Std 5 Topic Practice ────────────────────────────────────────────────
    config = EXAM_CONFIG[curriculum]?.practice?.[difficulty];
    if (!config) throw new Error(`No practice config for ${curriculum} ${difficulty}`);

    topics = getTopicsForExam(curriculum, level, subject, null, topic);
    packageId = generatePackageId(curriculum, level, null, subject, difficulty, 'practice', topic);
    curriculumChunks = await getCurriculumChunks(curriculum, level, subject, null, topic);
    const topicList = buildTopicList(topics);

    prompt = PROMPTS[curriculum].topic_practice({
      level,
      subject,
      difficulty,
      topic,
      questionCount: config.question_count,
      timePerQuestion: config.time_per_question_seconds,
      totalTime: config.total_time_seconds,
      packageId,
      topicList,
      curriculumChunks,
      now
    });

  } else {
    // ── Standard period-scoped practice (e.g. Std 4 term_1) ────────────────
    config = EXAM_CONFIG[curriculum]?.practice?.[difficulty];
    if (!config) throw new Error(`No practice config for ${curriculum} ${difficulty}`);

    topics = getTopicsForExam(curriculum, level, subject, period, null);
    packageId = generatePackageId(curriculum, level, period, subject, difficulty, 'practice', null);
    curriculumChunks = await getCurriculumChunks(curriculum, level, subject, period, null);
    const topicList = buildTopicList(topics);

    prompt = PROMPTS[curriculum].practice({
      level,
      period,
      subject,
      difficulty,
      questionCount: config.question_count,
      timePerQuestion: config.time_per_question_seconds,
      totalTime: config.total_time_seconds,
      packageId,
      topicList,
      curriculumChunks,
      now
    });
  }

  const rawResponse = await generateContent(prompt);
  const cleaned = rawResponse.replace(/```json|```/g, '').trim();
  const packageData = JSON.parse(cleaned);

  // Shuffle questions and rebuild answer_sheet
  packageData.questions = shuffleQuestions(packageData.questions);
  packageData.answer_sheet = buildAnswerSheet(packageData.questions);

  // Fingerprints and uniqueness score
  const fingerprints = packageData.questions.map(q => ({
    question_id: q.question_id,
    fingerprint: buildFingerprint(q)
  }));
  packageData.meta.uniqueness_score = fingerprints.length / packageData.questions.length;

  const topicSet = new Set(packageData.questions.map(q => q.meta?.topic).filter(Boolean));
  packageData.meta.topics_covered = [...topicSet];

  return { packageData, fingerprints };
}

// ── Store a generated package in exam_pool ────────────────────────────────────

async function storePackage({ packageData, fingerprints, status = 'approved', source = 'auto_generated' }) {
  const { meta, package_id, questions } = packageData;

  const sequenceIndex = await getNextSequenceIndex(
    meta.curriculum,
    meta.level,
    meta.period || null,
    meta.subject,
    meta.trial_type,
    meta.difficulty || null,
    meta.topic || null
  );

  const { error: insertError } = await getSupabase().from('exam_pool').insert({
    package_id,
    curriculum: meta.curriculum,
    level: meta.level,
    period: meta.period || null,
    subject: meta.subject,
    difficulty: meta.difficulty || null,
    trial_type: meta.trial_type || 'practice',
    topic: meta.topic || null,
    status,
    source,
    package_data: packageData,
    uniqueness_score: meta.uniqueness_score || 1,
    times_served: 0,
    sequence_index: sequenceIndex,
    generated_at: packageData.generated_at || new Date().toISOString()
  });

  if (insertError) throw insertError;

  if (fingerprints?.length > 0) {
    const rows = fingerprints.map(f => ({
      package_id,
      question_id: f.question_id,
      fingerprint: f.fingerprint,
      curriculum: meta.curriculum,
      level: meta.level,
      period: meta.period || null,
      subject: meta.subject,
      difficulty: meta.difficulty || null,
      question_text: questions?.find(q => q.question_id === f.question_id)?.question || '',
      correct_answer: questions?.find(q => q.question_id === f.question_id)?.correct_answer || ''
    }));

    const { error: qbError } = await getSupabase().from('question_fingerprints').insert(rows);
    if (qbError) console.error('question_fingerprints insert error:', qbError.message);
  }

  return sequenceIndex;
}

module.exports = { generateExamPackage, storePackage, buildFingerprint };
