const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { generateContent } = require('../services/ai');

router.post('/:user_id', authenticateToken, async (req, res) => {
  const { user_id } = req.params;
  const { student, period, overall, subjects } = req.body;

  if (!student || !period || !overall || !subjects) {
    return res.status(400).json({ error: 'Missing required fields', code: 'missing_fields' });
  }

  try {
    const levelLabel = student.level === 'std_4' ? 'Standard 4' : student.level === 'std_5' ? 'Standard 5 SEA Prep' : (student.level || 'Primary');
    const periodLabel = student.period ? `, ${student.period.replace('_', ' ')}` : '';

    const subjectSummaries = subjects.map(s => {
      const topicLines = s.topics.map(t =>
        `    - ${t.topic}: ${t.correct}/${t.total} (${t.pct}%)`
      ).join('\n');
      return `  ${s.subject} — ${s.exams} trial(s), average ${s.average_pct}%:\n${topicLines}`;
    }).join('\n\n');

    const prompt = `You are a warm, encouraging Caribbean primary school tutor giving feedback to a student and their family.

Student: ${levelLabel}${periodLabel}
Period: ${period.week} — ${period.exams_completed} trial(s) completed, ${Math.round(period.total_time_seconds / 60)} minutes total study time
Overall average: ${overall.average_score_pct}% — trend: ${overall.trend}

Subject breakdown:
${subjectSummaries}

Write a coaching report (4-6 sentences) that:
1. Opens with an encouraging acknowledgement of their overall effort and trend
2. Celebrates their strongest subject or topic
3. Identifies their weakest topic across all subjects and gives one specific, actionable study tip
4. Closes with warm motivation for the week ahead

Use simple language suitable for a primary school student and their parent. Be specific — mention actual subject and topic names. Do not use bullet points or headers.`;

    const insight = await generateContent(prompt);

    return res.json({
      user_id,
      period: period.week,
      insight: insight.trim()
    });

  } catch (err) {
    console.error('[overall-insight] Error:', err);
    return res.status(500).json({ error: 'Failed to generate insight', code: 'server_error', details: err.message });
  }
});

module.exports = router;
