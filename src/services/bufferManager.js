const { generateExamPackage } = require('./examGenerator');
const getSupabase = require('../config/supabase');

const BUFFER_THRESHOLD = 1; // exams with times_served > 0 before triggering generation

async function checkAndRefill({ standard, term, subject, difficulty }) {
  try {
    // Count packages in this category where times_served > 0
    let query = getSupabase()
      .from('exam_pool')
      .select('package_id', { count: 'exact' })
      .eq('standard', standard)
      .eq('subject', subject)
      .eq('difficulty', difficulty)
      .eq('status', 'approved')
      .eq('times_served', 0);

    if (term) query = query.eq('term', term);

    const { count, error } = await query;

    if (error) throw error;

    if (count < BUFFER_THRESHOLD) {
      console.log(`Buffer low for ${standard} ${term} ${subject} ${difficulty} (${count}/${BUFFER_THRESHOLD}) — generating...`);
      await generateAndStore({ standard, term, subject, difficulty });
    }

  } catch (err) {
    console.error('Buffer check error:', err.message);
    await logFailure({ standard, term, subject, difficulty, error: err.message });
  }
}

async function generateAndStore({ standard, term, subject, difficulty }) {
  try {
    const { packageData, fingerprints } = await generateExamPackage({ standard, term, subject, difficulty });

    // Store with status: approved immediately
    await getSupabase().from('exam_pool').insert({
      package_id: packageData.package_id,
      standard,
      term: term || null,
      subject,
      difficulty,
      question_count: packageData.questions?.length || 0,
      topics_covered: packageData.meta?.topics_covered || [],
      package_data: packageData,
      status: 'approved',
      uniqueness_score: packageData.meta?.uniqueness_score || 1,
      source: 'auto_generated',
    });

    // Store fingerprints
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

    console.log(`Buffer refilled: ${packageData.package_id}`);

  } catch (err) {
    console.error('Background generation failed:', err.message);
    await logFailure({ standard, term, subject, difficulty, error: err.message });
  }
}

async function logFailure({ standard, term, subject, difficulty, error }) {
  try {
    await getSupabase().from('generation_failures').insert({
      standard,
      term: term || null,
      subject,
      difficulty,
      error_message: error,
      attempted_at: new Date().toISOString(),
      retried: false
    });
  } catch (logErr) {
    console.error('Failed to log generation failure:', logErr.message);
  }
}

module.exports = { checkAndRefill };