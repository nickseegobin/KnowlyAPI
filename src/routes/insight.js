    const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { generateContent } = require('../services/ai');

router.post('/', authenticateToken, async (req, res) => {
  const { user_id, standard, subject, topic_breakdown } = req.body;

  if (!user_id || !standard || !subject || !topic_breakdown) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const topicSummary = topic_breakdown
      .map(t => `- ${t.topic}: ${t.percentage}% (${t.correct}/${t.total})`)
      .join('\n');

    const prompt = `You are a friendly Caribbean primary school tutor. A student just completed a ${subject} exam for ${standard === 'std_4' ? 'Standard 4' : 'Standard 5 SEA Prep'}.

Their topic results:
${topicSummary}

Write a short, encouraging coaching note (3-4 sentences max) that:
1. Acknowledges what they did well
2. Identifies their weakest area and gives one specific study tip
3. Motivates them to keep going

Be warm, direct, and use simple language appropriate for a primary school student. Do not use bullet points.`;

    const insight = await generateContent(prompt);

    return res.json({ insight: insight.trim() });

  } catch (err) {
    console.error('Insight error:', err);
    return res.status(500).json({ error: 'Failed to generate insight', details: err.message });
  }
});

module.exports = router;