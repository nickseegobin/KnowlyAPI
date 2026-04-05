// ============================================================
// Knowly — AI Prompt Templates
// Keyed by curriculum_id, then trial_type
// ============================================================

const PROMPTS = {

  tt_primary: {

    // ── Practice Trial (period-scoped levels e.g. Standard 4) ──────────────────
    practice: ({ level, period, subject, difficulty, questionCount, timePerQuestion, totalTime, packageId, topicList, curriculumChunks, now }) => `You are a T&T primary school exam writer. Generate a JSON exam package. Return ONLY valid JSON, no other text.

PARAMETERS:
- Level: ${level === 'std_4' ? 'Standard 4' : level === 'std_5' ? 'Standard 5 SEA Prep' : level}
- Period: ${period || 'N/A'}
- Subject: ${subject}
- Difficulty: ${difficulty}
- Questions: ${questionCount}
- Time per question: ${timePerQuestion}s
- Total time: ${totalTime}s
- Package ID: ${packageId}

TOPICS (use only these):
${topicList}
${curriculumChunks ? `\nCURRICULUM NOTES:\n${curriculumChunks.slice(0, 800)}\n` : ''}
RULES:
1. Exactly ${questionCount} questions, 4 options each (A/B/C/D)
2. One correct answer per question
3. Use Caribbean names and contexts (Marcus, Keisha, Rajiv, Asha, Dario, Shantel, etc.)
4. Each question needs: question_id, meta (topic, subtopic, cognitive_level, difficulty_weight, time_limit_seconds), question, options, correct_answer, explanation, tip
5. tip = specific hint for THIS question that guides thinking without revealing the answer
6. explanation = why the correct answer is right (shown after submission)
7. Distribute questions across ALL topics listed
8. SPECIAL CONTENT CODES — use these in question text when appropriate:
   - [hide]word[/hide] — hides a word for spelling/fill-in questions
   - [blank] — omits a word entirely for fill-in-the-blank questions
   - [emphasize]text[/emphasize] — highlights a key term
9. Do NOT number questions sequentially by topic — mix topics throughout
${difficulty === 'hard' ? '10. HARD DIFFICULTY: questions must span the full breadth of all topics listed — ensure every topic is represented' : ''}

Return this exact structure:
{
  "package_id": "${packageId}",
  "version": "1.0",
  "generated_at": "${now}",
  "meta": {
    "curriculum": "tt_primary",
    "level": "${level}",
    "period": ${period ? `"${period}"` : 'null'},
    "subject": "${subject}",
    "difficulty": "${difficulty}",
    "trial_type": "practice",
    "topic": null,
    "question_count": ${questionCount},
    "time_per_question_seconds": ${timePerQuestion},
    "total_time_seconds": ${totalTime},
    "syllabus_ref": "T&T Primary Curriculum — ${level} ${period || 'SEA'}",
    "topics_covered": [],
    "status": "pending_review",
    "source": "generated",
    "uniqueness_score": null
  },
  "questions": [],
  "answer_sheet": []
}`,

    // ── Standard 5 Topic Practice ──────────────────────────────────────────────
    topic_practice: ({ level, subject, difficulty, topic, questionCount, timePerQuestion, totalTime, packageId, topicList, curriculumChunks, now }) => `You are a T&T primary school exam writer preparing SEA exam practice. Generate a JSON exam package. Return ONLY valid JSON, no other text.

PARAMETERS:
- Level: Standard 5 SEA Prep
- Subject: ${subject}
- Topic: ${topic}
- Difficulty: ${difficulty}
- Questions: ${questionCount}
- Time per question: ${timePerQuestion}s
- Total time: ${totalTime}s
- Package ID: ${packageId}

TOPIC AND SUBTOPICS (all questions must stay within this topic):
${topicList}
${curriculumChunks ? `\nCURRICULUM NOTES:\n${curriculumChunks.slice(0, 800)}\n` : ''}
RULES:
1. Exactly ${questionCount} questions, 4 options each (A/B/C/D)
2. ALL questions must be scoped to the topic: ${topic}
3. Use Caribbean names and contexts (Marcus, Keisha, Rajiv, Asha, Dario, Shantel, etc.)
4. Each question needs: question_id, meta (topic, subtopic, cognitive_level, difficulty_weight, time_limit_seconds), question, options, correct_answer, explanation, tip
5. tip = specific hint for THIS question that guides thinking without revealing the answer
6. explanation = why the correct answer is right (shown after submission)
7. Cover as many subtopics as possible within the single topic
8. SPECIAL CONTENT CODES:
   - [hide]word[/hide] — hides a word for spelling/fill-in questions
   - [blank] — omits a word for fill-in-the-blank
   - [emphasize]text[/emphasize] — highlights a key term

Return this exact structure:
{
  "package_id": "${packageId}",
  "version": "1.0",
  "generated_at": "${now}",
  "meta": {
    "curriculum": "tt_primary",
    "level": "${level}",
    "period": null,
    "subject": "${subject}",
    "difficulty": "${difficulty}",
    "trial_type": "practice",
    "topic": "${topic}",
    "question_count": ${questionCount},
    "time_per_question_seconds": ${timePerQuestion},
    "total_time_seconds": ${totalTime},
    "syllabus_ref": "T&T Primary Curriculum — Standard 5 SEA Prep — ${subject} — ${topic}",
    "topics_covered": ["${topic}"],
    "status": "pending_review",
    "source": "generated",
    "uniqueness_score": null
  },
  "questions": [],
  "answer_sheet": []
}`,

    // ── Standard 5 Full SEA Paper ──────────────────────────────────────────────
    sea_paper: ({ subject, questionCount, timePerQuestion, totalTime, packageId, topicWeightings, topicList, curriculumChunks, now }) => `You are a T&T primary school exam writer preparing a full SEA examination paper. Generate a JSON exam package. Return ONLY valid JSON, no other text.

PARAMETERS:
- Subject: ${subject}
- Trial Type: Full SEA Paper
- Questions: ${questionCount}
- Time per question: ${timePerQuestion}s
- Total time: ${totalTime}s
- Package ID: ${packageId}

SEA TOPIC DISTRIBUTION (distribute questions according to these weightings):
${topicWeightings}

ALL TOPICS AND SUBTOPICS:
${topicList}
${curriculumChunks ? `\nCURRICULUM NOTES:\n${curriculumChunks.slice(0, 1200)}\n` : ''}
RULES:
1. Exactly ${questionCount} questions, 4 options each (A/B/C/D)
2. Distribute questions proportionally according to the topic weightings above
3. Use Caribbean names and contexts (Marcus, Keisha, Rajiv, Asha, Dario, Shantel, etc.)
4. Each question needs: question_id, meta (topic, subtopic, cognitive_level, difficulty_weight, time_limit_seconds), question, options, correct_answer, explanation, tip
5. tip = specific hint for THIS question that guides thinking without revealing the answer
6. explanation = why the correct answer is right (shown after submission)
7. Questions should reflect the SEA examination standard — mix of difficulty levels within the paper
8. SPECIAL CONTENT CODES:
   - [hide]word[/hide] — hides a word for spelling/fill-in questions
   - [blank] — omits a word for fill-in-the-blank
   - [emphasize]text[/emphasize] — highlights a key term
9. Do NOT number questions by topic — randomise the topic order throughout the paper

Return this exact structure:
{
  "package_id": "${packageId}",
  "version": "1.0",
  "generated_at": "${now}",
  "meta": {
    "curriculum": "tt_primary",
    "level": "std_5",
    "period": null,
    "subject": "${subject}",
    "difficulty": null,
    "trial_type": "sea_paper",
    "topic": null,
    "question_count": ${questionCount},
    "time_per_question_seconds": ${timePerQuestion},
    "total_time_seconds": ${totalTime},
    "syllabus_ref": "T&T SEA Examination — ${subject}",
    "topics_covered": [],
    "status": "pending_review",
    "source": "generated",
    "uniqueness_score": null
  },
  "questions": [],
  "answer_sheet": []
}`,

    // ── Quest Module ────────────────────────────────────────────────────────────
    quest: ({ level, period, subject, topic, moduleNumber, moduleTitle, objectives, curriculumChunks, questId, now }) => `You are a T&T primary school curriculum writer. Generate a structured Quest learning module. Return ONLY valid JSON, no other text.

PARAMETERS:
- Level: ${level === 'std_4' ? 'Standard 4' : 'Standard 5 SEA Prep'}
- Period: ${period || 'N/A (Capstone)'}
- Subject: ${subject}
- ${moduleNumber ? `Module: ${moduleNumber} — ${moduleTitle}` : `Topic: ${topic}`}
- Quest ID: ${questId}

LEARNING OBJECTIVES:
${objectives.map((o, i) => `${i + 1}. ${o}`).join('\n')}
${curriculumChunks ? `\nCURRICULUM NOTES:\n${curriculumChunks.slice(0, 1000)}\n` : ''}
RULES:
1. Generate 3-5 sections, each covering one or two learning objectives
2. Each section must have:
   - A clear title
   - Plain language explanation (2-4 paragraphs, use Caribbean context and examples)
   - 1-2 worked examples with problem, step-by-step solution, and Caribbean context
   - 3-5 knowledge check questions (unscored — MCQ only, 4 options A/B/C/D)
3. Language must be appropriate for a primary school student
4. Use Caribbean names, places, and contexts throughout
5. knowledge check questions must have: question, options, correct_answer, explanation

Return this exact structure:
{
  "quest_id": "${questId}",
  "curriculum": "tt_primary",
  "level": "${level}",
  "period": ${period ? `"${period}"` : 'null'},
  "subject": "${subject}",
  "topic": ${topic ? `"${topic}"` : 'null'},
  "module_number": ${moduleNumber || 'null'},
  "module_title": ${moduleTitle ? `"${moduleTitle}"` : 'null'},
  "objectives": ${JSON.stringify(objectives)},
  "generated_at": "${now}",
  "status": "draft",
  "content": {
    "sections": []
  }
}`,

  }

};

module.exports = { PROMPTS };
