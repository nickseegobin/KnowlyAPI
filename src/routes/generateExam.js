const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const supabase = require('../config/supabase');
const { generateExamPackage } = require('../services/examGenerator');

router.post('/', authenticateToken, async (req, res) => {
  const { standard, term, subject, difficulty, user_id, completed_package_ids = [] } = req.body;

  // Validate required fields
  if (!standard || !subject || !difficulty || !user_id) {
    return res.status(400).json({ error: 'Missing required fields: standard, subject, difficulty, user_id' });
  }
  if (standard === 'std_4' && !term) {
    return res.status(400).json({ error: 'term is required for std_4' });
  }

  try {
    // 1. POOL QUERY — find an approved undelivered package
    let query = supabase
      .from('exam_pool')
      .select('package_id, package_data, meta:package_data->meta')
      .eq('standard', standard)
      .eq('subject', subject)
      .eq('difficulty', difficulty)
      .eq('status', 'approved')
      .order('times_served', { ascending: true })
      .limit(1);

    if (standard === 'std_4') {
      query = query.eq('term', term);
    } else {
      query = query.is('term', null);
    }

    if (completed_package_ids.length > 0) {
      query = query.not('package_id', 'in', `(${completed_package_ids.map(id => `"${id}"`).join(',')})`);
    }

    const { data: poolResults } = await query;

    if (poolResults && poolResults.length > 0) {
      // POOL HIT
      const pkg = poolResults[0];

      // Increment times_served
      await supabase
        .from('exam_pool')
        .update({ times_served: supabase.rpc('increment', { row_id: pkg.package_id }) })
        .eq('package_id', pkg.package_id);

      const packageData = pkg.package_data;

      // Strip answer sheet
      const { answer_sheet, ...safePackage } = packageData;

      return res.json({
        package_id: pkg.package_id,
        source: 'pool',
        meta: packageData.meta,
        questions: packageData.questions,
      });
    }

    // 2. GENERATE — no suitable pool package found
    console.log(`Generating new exam: ${standard} ${term || 'SEA'} ${subject} ${difficulty}`);
    const { packageData, fingerprints } = await generateExamPackage({ standard, term, subject, difficulty });

    // 3. STORE in exam_pool
    const { error: insertError } = await supabase
      .from('exam_pool')
      .insert({
        package_id: packageData.package_id,
        standard,
        term: term || null,
        subject,
        difficulty,
        question_count: packageData.questions.length,
        topics_covered: packageData.meta.topics_covered,
        package_data: packageData,
        status: 'pending_review',
        uniqueness_score: packageData.meta.uniqueness_score,
        source: 'generated',
      });

    if (insertError) {
      console.error('Failed to store package:', insertError);
    }

    // 4. STORE questions in question_bank
    const questionRows = packageData.questions.map((q, i) => ({
      question_id: `${packageData.package_id}_${q.question_id}`,
      package_id: packageData.package_id,
      standard,
      term: term || null,
      subject,
      topic: q.meta?.topic || '',
      subtopic: q.meta?.subtopic || '',
      cognitive_level: q.meta?.cognitive_level || 'knowledge',
      difficulty_weight: q.meta?.difficulty_weight || 1,
      fingerprint: fingerprints[i]?.fingerprint || '',
      question_text: q.question,
      correct_answer: q.correct_answer,
    }));

    await supabase.from('question_bank').upsert(questionRows, { onConflict: 'question_id' });

    // 5. RETURN — strip answer sheet
    return res.json({
      package_id: packageData.package_id,
      source: 'generated',
      meta: packageData.meta,
      questions: packageData.questions,
    });

  } catch (err) {
    console.error('Generate exam error:', err);
    return res.status(500).json({ error: 'Failed to generate exam', details: err.message });
  }
});

module.exports = router;