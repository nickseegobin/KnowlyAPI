const { getEmbedding } = require('./embeddings');
const { getIndex } = require('./pinecone');
const { generateContent } = require('./ai');
const { TAXONOMY, EXAM_CONFIG } = require('../config/taxonomy');
const crypto = require('crypto');

async function getCurriculumChunks(standard, subject, term) {
  try {
    const queryText = `${standard} ${subject} ${term || ''} curriculum topics`;
    const embedding = await getEmbedding(queryText);
    const index = getIndex();
    const filter = { standard, subject };
    if (term) filter.term = term;
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

function getTopicsForExam(standard, subject, term) {
  const subjectKey = subject.replace('-', '_');
  if (standard === 'std_4') {
    const termTopics = TAXONOMY.std_4[subjectKey]?.[term];
    if (!termTopics) throw new Error(`No taxonomy found for ${standard} ${subject} ${term}`);
    return termTopics;
  } else {
    return TAXONOMY.std_5[subjectKey] || [];
  }
}

function buildFingerprint(question) {
  const numerals = (question.question || '').match(/\d+(\.\d+)?/g) || [];
  const raw = [
    (question.meta?.subtopic || '').toLowerCase().trim(),
    (question.correct_answer || '').toUpperCase(),
    numerals.sort().join('-')
  ].join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function generatePackageId(standard, term, subject, difficulty) {
  const rand = Math.floor(Math.random() * 9000) + 1000;
  if (standard === 'std_5') {
    return `pkg-std5-sea-${subject}-${difficulty}-${rand}`;
  }
  return `pkg-${standard}-${term}-${subject}-${difficulty}-${rand}`;
}

function buildTopicList(topics) {
  return topics.map(t =>
    `- ${t.topic}: ${t.subtopics.slice(0, 4).join(', ')}`
  ).join('\n');
}

async function generateExamPackage({ standard, term, subject, difficulty }) {
  const config = EXAM_CONFIG[standard][difficulty];
  const topics = getTopicsForExam(standard, subject, term);
  const curriculumChunks = await getCurriculumChunks(standard, subject, term);
  const packageId = generatePackageId(standard, term, subject, difficulty);
  const topicList = buildTopicList(topics);

  const prompt = `You are a T&T primary school exam writer. Generate a JSON exam package. Return ONLY valid JSON, no other text.

PARAMETERS:
- Standard: ${standard === 'std_4' ? 'Standard 4' : 'Standard 5 SEA Prep'}
- Subject: ${subject}
- Difficulty: ${difficulty}
- Questions: ${config.question_count}
- Time per question: ${config.time_per_question_seconds}s
- Package ID: ${packageId}

TOPICS (use only these):
${topicList}
${curriculumChunks ? `\nCURRICULUM NOTES:\n${curriculumChunks.slice(0, 800)}\n` : ''}
RULES:
1. Exactly ${config.question_count} questions, 4 options each (A/B/C/D)
2. One correct answer per question
3. Use Caribbean names and contexts (Marcus, Keisha, Rajiv, Asha, etc.)
4. Each question needs: question_id, meta (topic, subtopic, cognitive_level, difficulty_weight, time_limit_seconds), question, options, correct_answer, explanation, tip
5. tip = specific hint for THIS question that guides thinking without revealing the answer
6. explanation = why the correct answer is right (shown after submission)
7. Distribute questions across all topics listed

Return this exact structure:
{
  "package_id": "${packageId}",
  "version": "1.0",
  "generated_at": "${new Date().toISOString()}",
  "meta": {
    "standard": "${standard}",
    "term": ${term ? `"${term}"` : 'null'},
    "subject": "${subject}",
    "difficulty": "${difficulty}",
    "level": "Primary",
    "question_count": ${config.question_count},
    "time_per_question_seconds": ${config.time_per_question_seconds},
    "total_time_seconds": ${config.total_time_seconds},
    "syllabus_ref": "T&T Primary Curriculum — ${standard} ${term || 'SEA'}",
    "topics_covered": [],
    "status": "pending_review",
    "source": "generated",
    "uniqueness_score": null
  },
  "questions": [
    {
      "question_id": "q_001",
      "meta": {
        "topic": "Topic name",
        "subtopic": "Subtopic name",
        "cognitive_level": "knowledge",
        "difficulty_weight": 1,
        "time_limit_seconds": ${config.time_per_question_seconds}
      },
      "question": "Question text?",
      "options": {"A": "...", "B": "...", "C": "...", "D": "..."},
      "correct_answer": "A",
      "explanation": "Why A is correct.",
      "tip": "Specific thinking hint for this question without revealing the answer."
    }
  ],
  "answer_sheet": [
    {
      "question_id": "q_001",
      "correct_answer": "A",
      "explanation": "Why A is correct."
    }
  ]
}`;

  const rawResponse = await generateContent(prompt);
  const cleaned = rawResponse.replace(/```json|```/g, '').trim();
  const packageData = JSON.parse(cleaned);

  // Fingerprints and uniqueness
  let passCount = 0;
  const fingerprints = [];
  for (const q of packageData.questions) {
    const fp = buildFingerprint(q);
    fingerprints.push({ question_id: q.question_id, fingerprint: fp });
    passCount++;
  }
  packageData.meta.uniqueness_score = passCount / packageData.questions.length;

  const topicSet = new Set(packageData.questions.map(q => q.meta?.topic).filter(Boolean));
  packageData.meta.topics_covered = [...topicSet];

  return { packageData, fingerprints };
}

module.exports = { generateExamPackage, buildFingerprint };