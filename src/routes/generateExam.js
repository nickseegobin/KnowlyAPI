const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { generateExamPackage } = require('../services/examGenerator');
const getSupabase = require('../config/supabase');

router.post('/', authenticateToken, async (req, res) => {
  const { standard, term, subject, difficulty, user_id, completed_package_ids = [] } = req.body;

  // Change 1: user_id no longer required
  if (!standard || !subject || !difficulty) {
    return res.status(400).json({ error: 'Missing required fields: standard, subject, difficulty' });
  }

  // Change 2: server-to-server mode
  const serverKey = req.headers['x-aep-server-key'];
  const isServerRequest = serverKey && serverKey === process.env.AEP_SERVER_KEY;

  try {
    // Query pool first
    let query = getSupabase()
      .from('exam_pool')
      .select('package_id, package_data')
      .eq('standard', standard)
      .eq('subject', subject)
      .eq('difficulty', difficulty)
      .eq('status', 'approved')
      .order('times_served', { ascending: true })
      .limit(10);

    if (term) query = query.eq('term', term);

    const { data: poolPackages, error: poolError } = await query;

    if (!poolError && poolPackages && poolPackages.length > 0) {
      // Filter out completed packages
      const available = poolPackages.filter(p => !completed_package_ids.includes(p.package_id));

      if (available.length > 0) {
        const selected = available[0];
        const packageData = selected.package_data;

        // Increment times_served
        await getSupabase()
          .from('exam_pool')
          .update({ times_served: (packageData.times_served || 0) + 1 })
          .eq('package_id', selected.package_id);

        console.log(`Pool hit: ${selected.package_id}`);

        const responsePackage = isServerRequest
          ? { ...packageData, source: 'pool' }
          : (({ answer_sheet, ...safe }) => ({ ...safe, source: 'pool' }))(packageData);

        return res.json(responsePackage);
      }
    }

    // Generate new package
    console.log(`Generating new exam: ${standard} ${term} ${subject} ${difficulty}`);
    const { packageData, fingerprints } = await generateExamPackage({ standard, term, subject, difficulty });

    // Store in exam_pool
    await getSupabase().from('exam_pool').insert({
      package_id: packageData.package_id,
      standard,
      term: term || null,
      subject,
      difficulty,
      question_count: packageData.questions?.length || 0,
      topics_covered: packageData.meta?.topics_covered || [],
      package_data: packageData,
      status: 'pending_review',
      uniqueness_score: packageData.meta?.uniqueness_score || 1,
      source: 'generated',
    });

    // Store fingerprints in question_bank
    if (fingerprints?.length > 0) {
      const rows = fingerprints.map(f => ({
        package_id: packageData.package_id,
        question_id: f.question_id,
        fingerprint: f.fingerprint,
        standard,
        term: term || null,
        subject,
        difficulty,
        question_text: packageData.questions?.find(q => q.question_id === f.question_id)?.question || '',
        correct_answer: packageData.questions?.find(q => q.question_id === f.question_id)?.correct_answer || '',
      }));
      await getSupabase().from('question_bank').insert(rows);
    }

    const responsePackage = isServerRequest
      ? { ...packageData, source: 'generated' }
      : (({ answer_sheet, ...safe }) => ({ ...safe, source: 'generated' }))(packageData);

    return res.json(responsePackage);

  } catch (err) {
    console.error('Generate exam error:', err);
    return res.status(500).json({ error: 'Failed to generate exam', details: err.message });
  }
});

module.exports = router;