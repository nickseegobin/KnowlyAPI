const express    = require('express');
const router     = express.Router();
const getSupabase = require('../config/supabase');
const { buildFingerprint } = require('../services/examGenerator');

// All routes in this file are server-key only — admin Editor use exclusively.
function requireServerKey(req, res, next) {
  const key = req.headers['x-aep-server-key'];
  if (!key || key !== process.env.AEP_SERVER_KEY) {
    return res.status(401).json({ error: 'Server key required', code: 'unauthorized' });
  }
  next();
}

// ── GET /api/v1/trial-editor/list ─────────────────────────────────────────────
// Paginated, filterable list of exam_pool packages — all statuses.
// Query params: curriculum, level, period, subject, difficulty, trial_type,
//               status, page, per_page
router.get('/list', requireServerKey, async (req, res) => {
  const {
    curriculum  = 'tt_primary',
    level,
    period,
    subject,
    difficulty,
    trial_type,
    status,
    page     = 1,
    per_page = 25,
  } = req.query;

  const offset = (parseInt(page, 10) - 1) * parseInt(per_page, 10);

  let query = getSupabase()
    .from('exam_pool')
    .select(
      'package_id, curriculum, level, period, subject, difficulty, trial_type, topic, status, uniqueness_score, times_served, generated_at, sequence_index',
      { count: 'exact' }
    )
    .eq('curriculum', curriculum)
    .order('generated_at', { ascending: false })
    .range(offset, offset + parseInt(per_page, 10) - 1);

  if (level)      query = query.eq('level', level);
  if (subject)    query = query.eq('subject', subject);
  if (difficulty) query = query.eq('difficulty', difficulty);
  if (trial_type) query = query.eq('trial_type', trial_type);
  if (status)     query = query.eq('status', status);

  if (period !== undefined) {
    query = period ? query.eq('period', period) : query.is('period', null);
  }

  const { data, error, count } = await query;
  if (error) {
    console.error('[trial-editor/list] Supabase error:', error);
    return res.status(500).json({ error: 'Failed to fetch trial list', code: 'server_error' });
  }

  return res.json({
    packages: data || [],
    total:    count || 0,
    page:     parseInt(page, 10),
    per_page: parseInt(per_page, 10),
  });
});

// ── GET /api/v1/trial-editor/:package_id ──────────────────────────────────────
// Returns full package_data (including answer_sheet) for a single package.
// Used by the Editor view/edit panel.
router.get('/:package_id', requireServerKey, async (req, res) => {
  const { package_id } = req.params;

  const { data, error } = await getSupabase()
    .from('exam_pool')
    .select('package_id, status, times_served, uniqueness_score, generated_at, package_data')
    .eq('package_id', package_id)
    .single();

  if (error || !data) {
    return res.status(404).json({ error: 'Package not found', code: 'not_found' });
  }

  return res.json({
    package_id:       data.package_id,
    status:           data.status,
    times_served:     data.times_served,
    uniqueness_score: data.uniqueness_score,
    generated_at:     data.generated_at,
    package:          data.package_data,
  });
});

// ── PATCH /api/v1/trial-editor/:package_id ────────────────────────────────────
// Updates the package_data (questions, answer_sheet) for an existing package.
// Resets status to 'pending_review' on any edit — requires re-approval.
// Also rebuilds question_bank fingerprints for the updated questions.
// Body: { package_data }   (full updated package_data object)
router.patch('/:package_id', requireServerKey, async (req, res) => {
  const { package_id } = req.params;
  const { package_data } = req.body;

  if (!package_data) {
    return res.status(400).json({ error: 'package_data is required', code: 'missing_fields' });
  }

  // Verify the package exists
  const { data: existing, error: fetchError } = await getSupabase()
    .from('exam_pool')
    .select('package_id')
    .eq('package_id', package_id)
    .single();

  if (fetchError || !existing) {
    return res.status(404).json({ error: 'Package not found', code: 'not_found' });
  }

  // Force status back to pending_review on edit
  package_data.meta = { ...package_data.meta, status: 'pending_review' };

  const { error: updateError } = await getSupabase()
    .from('exam_pool')
    .update({ package_data, status: 'pending_review' })
    .eq('package_id', package_id);

  if (updateError) {
    console.error('[trial-editor/patch] Supabase error:', updateError);
    return res.status(500).json({ error: 'Failed to update package', code: 'server_error' });
  }

  // Rebuild question_fingerprints if questions were provided
  if (Array.isArray(package_data.questions) && package_data.questions.length > 0) {
    const meta = package_data.meta || {};
    const rows = package_data.questions.map(q => ({
      package_id,
      question_id:   q.question_id,
      fingerprint:   buildFingerprint(q),
      curriculum:    meta.curriculum || 'tt_primary',
      level:         meta.level,
      period:        meta.period || null,
      subject:       meta.subject,
      difficulty:    meta.difficulty || null,
      question_text: q.question || '',
      correct_answer: (package_data.answer_sheet || []).find(a => a.question_id === q.question_id)?.correct_answer || '',
    }));

    // Upsert on (package_id, question_id)
    await getSupabase()
      .from('question_fingerprints')
      .upsert(rows, { onConflict: 'package_id,question_id' });
  }

  console.log(`[trial-editor/patch] Updated ${package_id} → pending_review`);
  return res.json({ package_id, status: 'pending_review', saved_at: new Date().toISOString() });
});

// ── PATCH /api/v1/trial-editor/:package_id/status ────────────────────────────
// Updates status only — approved | rejected | pending_review.
// Body: { status }
router.patch('/:package_id/status', requireServerKey, async (req, res) => {
  const { package_id } = req.params;
  const { status } = req.body;

  const allowed = ['approved', 'rejected', 'pending_review'];
  if (!status || !allowed.includes(status)) {
    return res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}`, code: 'invalid_status' });
  }

  // Also sync the status inside package_data.meta for consistency
  const { data: existing, error: fetchError } = await getSupabase()
    .from('exam_pool')
    .select('package_id, package_data')
    .eq('package_id', package_id)
    .single();

  if (fetchError || !existing) {
    return res.status(404).json({ error: 'Package not found', code: 'not_found' });
  }

  const updatedPackageData = {
    ...existing.package_data,
    meta: { ...(existing.package_data?.meta || {}), status },
  };

  const { error: updateError } = await getSupabase()
    .from('exam_pool')
    .update({ status, package_data: updatedPackageData })
    .eq('package_id', package_id);

  if (updateError) {
    console.error('[trial-editor/status] Supabase error:', updateError);
    return res.status(500).json({ error: 'Failed to update package status', code: 'server_error' });
  }

  console.log(`[trial-editor/status] ${package_id} → ${status}`);
  return res.json({ package_id, status, updated_at: new Date().toISOString() });
});

// ── DELETE /api/v1/trial-editor/:package_id ──────────────────────────────────
// Deletes a package from exam_pool and all its question_bank rows.
// Only allowed when status is 'rejected' — approved and pending packages are protected.
router.delete('/:package_id', requireServerKey, async (req, res) => {
  const { package_id } = req.params;

  const { data: existing, error: fetchError } = await getSupabase()
    .from('exam_pool')
    .select('package_id, status')
    .eq('package_id', package_id)
    .single();

  if (fetchError || !existing) {
    return res.status(404).json({ error: 'Package not found', code: 'not_found' });
  }

  if (existing.status !== 'rejected') {
    return res.status(403).json({
      error: 'Only rejected packages can be deleted',
      code:  'forbidden',
      current_status: existing.status,
    });
  }

  // Delete question_fingerprints rows first (no FK cascade assumed)
  await getSupabase()
    .from('question_fingerprints')
    .delete()
    .eq('package_id', package_id);

  const { error: deleteError } = await getSupabase()
    .from('exam_pool')
    .delete()
    .eq('package_id', package_id);

  if (deleteError) {
    console.error('[trial-editor/delete] Supabase error:', deleteError);
    return res.status(500).json({ error: 'Failed to delete package', code: 'server_error' });
  }

  console.log(`[trial-editor/delete] Deleted ${package_id}`);
  return res.json({ package_id, deleted: true });
});

module.exports = router;
