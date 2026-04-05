const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { generateExamPackage, storePackage } = require('../services/examGenerator');
const { checkAndRefill } = require('../services/bufferManager');
const getSupabase = require('../config/supabase');

// ── POST /api/v1/generate-exam ────────────────────────────────────────────────
// Serves next Trial in sequence for a user, or force-generates for server/editor.
//
// Request body:
//   user_id      string   required
//   curriculum   string   default 'tt_primary'
//   level        string   required  (e.g. 'std_4', 'std_5')
//   period       string   nullable  (e.g. 'term_1', null for capstone)
//   subject      string   required
//   difficulty   string   required for practice, null for sea_paper
//   trial_type   string   default 'practice'
//   topic        string   nullable  (required for std_5 topic practice)
//   source       string   default 'direct'
//   force_generate boolean  server-only — bypasses pool, forces Claude generation

router.post('/', authenticateToken, async (req, res) => {
  const {
    user_id,
    curriculum = 'tt_primary',
    level,
    period = null,
    subject,
    difficulty = null,
    trial_type = 'practice',
    topic = null,
    source = 'direct',
    force_generate = false
  } = req.body;

  if (!user_id || !level || !subject) {
    return res.status(400).json({
      error: 'Missing required fields: user_id, level, subject',
      code: 'missing_fields'
    });
  }

  if (trial_type === 'practice' && !difficulty) {
    return res.status(400).json({
      error: 'difficulty is required for trial_type: practice',
      code: 'missing_fields'
    });
  }

  const serverKey = req.headers['x-aep-server-key'];
  const isServerRequest = serverKey && serverKey === process.env.AEP_SERVER_KEY;

  // ── Force generate mode (editor/admin only) ──────────────────────────────
  if (force_generate && isServerRequest) {
    try {
      const { packageData, fingerprints } = await generateExamPackage({
        curriculum, level, period, subject, difficulty, trial_type, topic
      });
      await storePackage({ packageData, fingerprints, status: 'pending_review', source: 'editor' });
      return res.json({ ...packageData, source: 'generated' });
    } catch (err) {
      console.error('[generate-exam] Force generate error:', err);
      return res.status(500).json({ error: 'Generation failed', code: 'generation_error', details: err.message });
    }
  }

  try {
    // ── Get or initialise user sequence pointer ────────────────────────────
    let progressQuery = getSupabase()
      .from('user_progress')
      .select('id, next_package_index')
      .eq('user_id', user_id)
      .eq('curriculum', curriculum)
      .eq('level', level)
      .eq('subject', subject)
      .eq('trial_type', trial_type);

    if (period) {
      progressQuery = progressQuery.eq('period', period);
    } else {
      progressQuery = progressQuery.is('period', null);
    }

    if (difficulty) {
      progressQuery = progressQuery.eq('difficulty', difficulty);
    } else {
      progressQuery = progressQuery.is('difficulty', null);
    }

    if (topic) {
      progressQuery = progressQuery.eq('topic', topic);
    } else {
      progressQuery = progressQuery.is('topic', null);
    }

    const { data: progressRows } = await progressQuery;
    const progressRow = progressRows?.[0] || null;

    const nextIndex = progressRow?.next_package_index || 0;

    // ── Find the next package in sequence ─────────────────────────────────
    let poolQuery = getSupabase()
      .from('exam_pool')
      .select('package_id, package_data, sequence_index, times_served')
      .eq('curriculum', curriculum)
      .eq('level', level)
      .eq('subject', subject)
      .eq('trial_type', trial_type)
      .eq('status', 'approved')
      .gte('sequence_index', nextIndex)
      .order('sequence_index', { ascending: true })
      .limit(1);

    if (period) {
      poolQuery = poolQuery.eq('period', period);
    } else {
      poolQuery = poolQuery.is('period', null);
    }

    if (difficulty) {
      poolQuery = poolQuery.eq('difficulty', difficulty);
    } else {
      poolQuery = poolQuery.is('difficulty', null);
    }

    if (topic) {
      poolQuery = poolQuery.eq('topic', topic);
    } else {
      poolQuery = poolQuery.is('topic', null);
    }

    const { data: poolResults, error: poolError } = await poolQuery;

    if (poolError) throw poolError;

    if (!poolResults || poolResults.length === 0) {
      // Pool empty — trigger background generation, return 503
      console.log(`[generate-exam] Pool empty for ${level}/${period}/${subject}/${trial_type}/${difficulty} — triggering background gen`);
      setImmediate(() => checkAndRefill({ curriculum, level, period, subject, difficulty, trial_type, topic }));
      return res.status(503).json({
        error: 'No trials available right now. Please try again shortly.',
        code: 'pool_empty'
      });
    }

    const selected = poolResults[0];
    const packageData = selected.package_data;

    // ── Advance the user's sequence pointer ────────────────────────────────
    const newPointer = selected.sequence_index + 1;

    if (progressRow) {
      await getSupabase()
        .from('user_progress')
        .update({ next_package_index: newPointer, updated_at: new Date().toISOString() })
        .eq('id', progressRow.id);
    } else {
      // Create new progress row
      await getSupabase().from('user_progress').insert({
        user_id,
        curriculum,
        level,
        period: period || null,
        subject,
        trial_type,
        difficulty: difficulty || null,
        topic: topic || null,
        next_package_index: newPointer,
        updated_at: new Date().toISOString()
      });
    }

    // ── Increment times_served ─────────────────────────────────────────────
    await getSupabase()
      .from('exam_pool')
      .update({ times_served: (selected.times_served || 0) + 1 })
      .eq('package_id', selected.package_id);

    console.log(`[generate-exam] Pool hit: ${selected.package_id} (seq ${selected.sequence_index}) → pointer now ${newPointer}`);

    // ── Fire buffer check in background ───────────────────────────────────
    setImmediate(() => checkAndRefill({ curriculum, level, period, subject, difficulty, trial_type, topic }));

    // ── Return package (strip answer_sheet for non-server requests) ────────
    const responsePackage = isServerRequest
      ? { ...packageData, source: 'pool' }
      : (({ answer_sheet, ...safe }) => ({ ...safe, source: 'pool' }))(packageData);

    return res.json(responsePackage);

  } catch (err) {
    console.error('[generate-exam] Error:', err);
    return res.status(500).json({ error: 'Failed to generate exam', code: 'server_error', details: err.message });
  }
});

module.exports = router;
