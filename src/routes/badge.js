const express = require('express');
const router  = express.Router();
const { generateContent } = require('../services/ai');

function requireServerKey(req, res, next) {
  const key = req.headers['x-aep-server-key'];
  if (!key || key !== process.env.AEP_SERVER_KEY) {
    return res.status(401).json({ error: 'Server key required', code: 'unauthorized' });
  }
  next();
}

const SUBJECT_LABEL = {
  math:          'Mathematics',
  english:       'English Language Arts',
  science:       'Science',
  social_studies: 'Social Studies',
};

const PERIOD_LABEL = {
  term_1: 'Term 1',
  term_2: 'Term 2',
  term_3: 'Term 3',
  semester_1: 'Semester 1',
  semester_2: 'Semester 2',
};

// ── POST /api/v1/badge/generate ───────────────────────────────────────────────
// Server-key only. Generates a badge name and description for a given definition.
// Called synchronously from the WP admin Badges panel "✦ Suggest" button.
// Input: { trigger_type, curriculum, level, period, subject, module_number, threshold }
// Output: { name, description }
router.post('/generate', requireServerKey, async (req, res) => {
  const {
    trigger_type,
    curriculum = 'tt_primary',
    level,
    period,
    subject,
    module_number,
    threshold,
  } = req.body;

  if (!trigger_type || !level || !subject) {
    return res.status(400).json({ error: 'trigger_type, level, and subject are required', code: 'missing_fields' });
  }

  const subjectLabel = SUBJECT_LABEL[subject] || subject;
  const periodLabel  = period ? (PERIOD_LABEL[period] || period) : null;

  let contextDesc;
  if (trigger_type === 'quest_module_completion') {
    contextDesc = `completing all lessons in Module ${module_number} of ${subjectLabel}` + (periodLabel ? ` (${periodLabel})` : '');
  } else if (trigger_type === 'trial_count') {
    contextDesc = `completing ${threshold} practice trial${threshold !== 1 ? 's' : ''} in ${subjectLabel}`;
  } else {
    contextDesc = `completing ${threshold} lesson${threshold !== 1 ? 's' : ''} in ${subjectLabel}`;
  }

  const levelLabel = level.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());

  const prompt = `You are writing achievement badge names and descriptions for a children's learning app.

Context:
- Curriculum: ${curriculum}
- Level: ${levelLabel}
- Earned by: ${contextDesc}

Generate a short, motivating badge name (3–6 words, no punctuation at end) and a one-sentence description (max 20 words, encouraging tone) for a student who earned this badge.

Respond with ONLY valid JSON in this exact format:
{"name": "...", "description": "..."}`;

  try {
    const raw  = await generateContent(prompt);
    const text = raw.trim();

    // Extract JSON even if wrapped in markdown fences
    const match = text.match(/\{[\s\S]*"name"[\s\S]*"description"[\s\S]*\}/);
    if (!match) {
      console.error('[badge/generate] Could not parse AI response:', text);
      return res.status(502).json({ error: 'AI returned unexpected format', code: 'ai_error' });
    }

    const parsed = JSON.parse(match[0]);
    return res.json({
      name:        parsed.name        || '',
      description: parsed.description || '',
    });
  } catch (err) {
    console.error('[badge/generate] Error:', err.message);
    return res.status(500).json({ error: 'Badge generation failed', code: 'server_error' });
  }
});

module.exports = router;
