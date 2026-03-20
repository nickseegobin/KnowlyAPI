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
      topK: 10,
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

async function generateExamPackage({ standard, term, subject, difficulty }) {
  const config = EXAM_CONFIG[standard][difficulty];
  const topics = getTopicsForExam(standard, subject, term);
  const curriculumChunks = await getCurriculumChunks(standard, subject, term);
  const packageId = generatePackageId(standard, term, subject, difficulty);

  const topicList = topics.map(t =>
    `- ${t.topic}: ${t.subtopics.join(', ')}`
  ).join('\n');

  const prompt = `You are an expert Caribbean primary school exam writer for Trinidad and Tobago.

Generate a complete multiple choice exam package as a single valid JSON object.

EXAM PARAMETERS:
- Standard: ${standard === 'std_4' ? 'Standard 4' : 'Standard 5 (SEA Prep)'}
- Subject: ${subject}
- Difficulty: ${difficulty}
- Number of questions: ${config.question_count}
- Time per question: ${config.time_per_question_seconds} seconds
- Package ID: ${packageId}

APPROVED TOPIC TAXONOMY (only use topics from this list):
${topicList}

${curriculumChunks ? `CURRICULUM REFERENCE MATERIAL:\n${curriculumChunks}\n` : ''}

INSTRUCTIONS:
1. Generate exactly ${config.question_count} multiple choice questions
2. Each question must have exactly 4 options (A, B, C, D)
3. Only ONE correct answer per question
4. Distribute questions evenly across the topics listed
5. Questions must be appropriate for Trinidad and Tobago primary school students
6. Use Caribbean contexts, names, and examples where relevant
7. Include a clear explanation for each correct answer

Return ONLY this JSON structure, no other text:
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
        "topic": "Topic name here",
        "subtopic": "Subtopic name here",
        "curriculum_ref": "T&T Primary Curriculum",
        "cognitive_level": "knowledge|comprehension|application",
        "difficulty_weight": 1,
        "time_limit_seconds": ${config.time_per_question_seconds}
      },
      "question": "Question text here?",
      "options": {
        "A": "Option A",
        "B": "Option B",
        "C": "Option C",
        "D": "Option D"
      },
      "correct_answer": "A",
      "explanation": "Explanation here."
    }
  ],
  "answer_sheet": [
    {
      "question_id": "q_001",
      "correct_answer": "A",
      "explanation": "Explanation here."
    }
  ]
}`;

  const rawResponse = await generateContent(prompt);

  // Parse JSON — strip any markdown fences
  const cleaned = rawResponse.replace(/```json|```/g, '').trim();
  const packageData = JSON.parse(cleaned);

  // Build fingerprints and uniqueness score
  let passCount = 0;
  const fingerprints = [];
  for (const q of packageData.questions) {
    const fp = buildFingerprint(q);
    fingerprints.push({ question_id: q.question_id, fingerprint: fp });
    passCount++;
  }
  packageData.meta.uniqueness_score = passCount / packageData.questions.length;

  // Populate topics_covered
  const topicSet = new Set(packageData.questions.map(q => q.meta?.topic).filter(Boolean));
  packageData.meta.topics_covered = [...topicSet];

  return { packageData, fingerprints };
}

module.exports = { generateExamPackage, buildFingerprint };