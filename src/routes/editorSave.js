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
    const { data: existing } = await getSupabase()
      .from('exam_pool')
      .select('package_id')
      .eq('package_id', package_id)
      .single();

    if (existing) {
      return res.status(409).json({ status: 'conflict', message: 'Package ID already exists' });
    }

    // Get next sequence index for this combination
    let seqQuery = getSupabase()
      .from('exam_pool')
      .select('sequence_index')
      .eq('curriculum', meta.curriculum || 'tt_primary')
      .eq('level', meta.level)
      .eq('subject', meta.subject)
      .eq('trial_type', meta.trial_type || 'practice')
      .order('sequence_index', { ascending: false })
      .limit(1);

    if (meta.period) {
      seqQuery = seqQuery.eq('period', meta.period);
    } else {
      seqQuery = seqQuery.is('period', null);
    }

    if (meta.difficulty) {
      seqQuery = seqQuery.eq('difficulty', meta.difficulty);
    } else {
      seqQuery = seqQuery.is('difficulty', null);
    }

    const { data: seqRows } = await seqQuery;
    const sequenceIndex = seqRows?.[0]?.sequence_index != null ? seqRows[0].sequence_index + 1 : 0;

    const { error: insertError } = await getSupabase()
      .from('exam_pool')
      .insert({
        package_id,
        curriculum: meta.curriculum || 'tt_primary',
        level: meta.level,
        period: meta.period || null,
        subject: meta.subject,
        difficulty: meta.difficulty || null,
        trial_type: meta.trial_type || 'practice',
        topic: meta.topic || null,
        status: meta.status || 'pending_review',
        source: 'manual',
        package_data: packageData,
        uniqueness_score: meta.uniqueness_score || 1,
        times_served: 0,
        sequence_index: sequenceIndex,
        generated_at: generated_at || new Date().toISOString()
      });

    if (insertError) throw insertError;

    if (questions.length > 0) {
      const rows = questions.map(q => ({
        package_id,
        question_id: q.question_id,
        fingerprint: buildFingerprint(q),
        curriculum: meta.curriculum || 'tt_primary',
        level: meta.level,
        period: meta.period || null,
        subject: meta.subject,
        difficulty: meta.difficulty || null,
        question_text: q.question || '',
        correct_answer: q.correct_answer || ''
      }));

      const { error: qbError } = await getSupabase()
        .from('question_bank')
        .insert(rows);

      if (qbError) throw qbError;
    }

    const saved_at = new Date().toISOString();
    console.log(`[editor-save] Saved: ${package_id}`);

    return res.json({ status: 'saved', package_id, saved_at });

  } catch (err) {
    console.error('[editor-save] Error:', err);
    return res.status(500).json({ status: 'error', message: err.message });
  }
});

module.exports = router;
