const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const getSupabase = require('../config/supabase');
const crypto = require('crypto');

router.post('/', authenticateToken, async (req, res) => {
  const { package_id, user_id, state, time_elapsed_seconds, time_remaining_seconds, answers } = req.body;

  if (!package_id || !user_id || !answers) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const { data: pkgData, error: pkgError } = await getSupabase()
      .from('exam_pool')
      .select('package_data')
      .eq('package_id', package_id)
      .single();

    if (pkgError || !pkgData) {
      return res.status(404).json({ error: 'Package not found' });
    }

    const packageData = pkgData.package_data;
    const answerSheet = packageData.answer_sheet || [];

    const answerKey = {};
    for (const a of answerSheet) {
      answerKey[a.question_id] = a.correct_answer;
    }

    let score = 0;
    const scoredAnswers = answers.map(a => {
      const correct = answerKey[a.question_id];
      const is_correct = a.selected_answer === correct;
      if (is_correct) score++;
      return { ...a, correct_answer: correct, is_correct };
    });

    const total = answers.length;
    const percentage = Math.round((score / total) * 100);

    const topicMap = {};
    for (const a of scoredAnswers) {
      const t = a.topic || a.meta?.topic || 'General';
      if (!topicMap[t]) topicMap[t] = { correct: 0, total: 0 };
      topicMap[t].total++;
      if (a.is_correct) topicMap[t].correct++;
    }
    const topic_breakdown = Object.entries(topicMap).map(([topic, data]) => ({
      topic,
      correct: data.correct,
      total: data.total,
      percentage: Math.round((data.correct / data.total) * 100)
    }));

    const session_id = `sess_${crypto.randomBytes(6).toString('hex')}`;

    await getSupabase().from('exam_sessions').insert({
      session_id,
      user_id,
      package_id,
      standard: packageData.meta?.standard,
      term: packageData.meta?.term || null,
      subject: packageData.meta?.subject,
      difficulty: packageData.meta?.difficulty,
      state: 'completed',
      score,
      percentage,
      time_elapsed: time_elapsed_seconds,
      time_remaining: time_remaining_seconds,
      completed_at: new Date().toISOString()
    });

    const resultRows = scoredAnswers.map(a => ({
      session_id,
      user_id,
      question_id: a.question_id,
      topic: a.topic || 'General',
      subtopic: a.subtopic || '',
      cognitive_level: a.cognitive_level || 'knowledge',
      difficulty_weight: a.difficulty_weight || 1,
      selected_answer: a.selected_answer,
      correct_answer: a.correct_answer,
      is_correct: a.is_correct,
      time_taken: a.time_taken_seconds || null
    }));

    await getSupabase().from('exam_results').insert(resultRows);

    return res.json({
      session_id,
      score,
      total,
      percentage,
      topic_breakdown,
      answer_sheet: scoredAnswers.map(a => ({
        question_id: a.question_id,
        selected_answer: a.selected_answer,
        correct_answer: a.correct_answer,
        is_correct: a.is_correct,
        explanation: answerSheet.find(x => x.question_id === a.question_id)?.explanation || ''
      }))
    });

  } catch (err) {
    console.error('Submit exam error:', err);
    return res.status(500).json({ error: 'Failed to submit exam', details: err.message });
  }
});

module.exports = router;