const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { buildFingerprint } = require('../services/examGenerator');
const getSupabase = require('../config/supabase');

router.post('/', authenticateToken, async (req, res) => {
  const serverKey = req.headers['x-aep-server-key'];
  if (!serverKey || serverKey !== process.env.AEP_SERVER_KEY) {
    return res.status(401).json({ status: 'error', message: 'Server key required' });
  }

  const packageData = req.body;
  const { package_id, meta, questions, generated_at } = packageData;

  if (!package_id || !meta || !questions) {
    return res.status(400).json({ status: 'error', message: 'Missing required fields' });
  }

  try {
    // Check for conflict
    const { data: existing } = await getSupabase()
      .from('exam_pool')
      .select('package_id')
      .eq('package_id', package_id)
      .single();

    if (existing) {
      return res.status(409).json({ status: 'conflict', message: 'Package ID already exists' });
    }

    // Insert into exam_pool
    const { error: insertError } = await getSupabase()
      .from('exam_pool')
      .insert({
        package_id,
        standard: meta.standard,
        term: meta.term || null,
        subject: meta.subject,
        difficulty: meta.difficulty,
        status: meta.status || 'pending_review',
        source: 'manual',
        package_data: packageData,
        uniqueness_score: meta.uniqueness_score || 1,
        question_count: questions.length,
        topics_covered: meta.topics_covered || [],
        times_served: 0,
        generated_at: generated_at || new Date().toISOString()
      });

    if (insertError) throw insertError;

    // Insert into question_bank
    if (questions.length > 0) {
      const rows = questions.map(q => ({
        package_id,
        question_id: q.question_id,
        fingerprint: buildFingerprint(q),
        standard: meta.standard,
        term: meta.term || null,
        subject: meta.subject,
        difficulty: meta.difficulty,
        question_text: q.question || '',
        correct_answer: q.correct_answer || ''
      }));

      const { error: qbError } = await getSupabase()
        .from('question_bank')
        .insert(rows);

      if (qbError) throw qbError;
    }

    const saved_at = new Date().toISOString();
    console.log(`Editor save: ${package_id}`);

    return res.json({ status: 'saved', package_id, saved_at });

  } catch (err) {
    console.error('Editor save error:', err);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;