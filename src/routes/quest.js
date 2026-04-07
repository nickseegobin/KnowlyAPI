const express = require('express');
const router  = express.Router();
const { authenticateToken } = require('../middleware/auth');
const { generateQuestContent, storeQuest } = require('../services/questGenerator');
const getSupabase = require('../config/supabase');
const crypto = require('crypto');

// ── GET /api/v1/quest/catalogue ───────────────────────────────────────────────
// Returns approved Quests for a given level, optional period and subject.
router.get('/catalogue', authenticateToken, async (req, res) => {
  const { curriculum = 'tt_primary', level, period, subject } = req.query;

  if (!level) {
    return res.status(400).json({ error: 'level is required', code: 'missing_fields' });
  }

  let query = getSupabase()
    .from('quests')
    .select('quest_id, curriculum, level, period, subject, topic, module_number, module_title, generated_at')
    .eq('curriculum', curriculum)
    .eq('level', level)
    .eq('status', 'approved')
    .order('module_number', { ascending: true, nullsFirst: false });

  if (subject) query = query.eq('subject', subject);

  if (period) {
    query = query.eq('period', period);
  } else {
    query = query.is('period', null);
  }

  const { data, error } = await query;
  if (error) {
    console.error('[quest/catalogue] Supabase error:', error);
    return res.status(500).json({ error: 'Failed to fetch quest catalogue', code: 'server_error' });
  }

  return res.json({ quests: data || [], count: (data || []).length });
});

// ── GET /api/v1/quest/:quest_id/completed ─────────────────────────────────────
// Returns whether the user has a prior completed session for this Quest.
// Used by WP plugin to determine first-attempt vs retake gem cost.
router.get('/:quest_id/completed', authenticateToken, async (req, res) => {
  const { quest_id } = req.params;
  const { user_id }  = req.query;

  if (!user_id) {
    return res.status(400).json({ error: 'user_id is required', code: 'missing_fields' });
  }

  const { data } = await getSupabase()
    .from('quest_sessions')
    .select('session_id')
    .eq('quest_id', quest_id)
    .eq('user_id', user_id)
    .eq('state', 'completed')
    .limit(1);

  return res.json({ completed: !!(data && data.length > 0) });
});

// ── GET /api/v1/quest/:quest_id ───────────────────────────────────────────────
// Returns full Quest content for an approved Quest.
router.get('/:quest_id', authenticateToken, async (req, res) => {
  const { quest_id } = req.params;

  const { data, error } = await getSupabase()
    .from('quests')
    .select('*')
    .eq('quest_id', quest_id)
    .eq('status', 'approved')
    .single();

  if (error || !data) {
    return res.status(404).json({ error: 'Quest not found or not yet approved', code: 'not_found' });
  }

  return res.json(data);
});

// ── POST /api/v1/quest/start ──────────────────────────────────────────────────
// Creates a quest_session in Supabase. Gem deduction is handled by the WP
// plugin before this is called. Returns session_id and is_first_attempt flag.
router.post('/start', authenticateToken, async (req, res) => {
  const { user_id, quest_id, source = 'direct' } = req.body;

  if (!user_id || !quest_id) {
    return res.status(400).json({ error: 'user_id and quest_id are required', code: 'missing_fields' });
  }

  // Verify quest exists and is approved
  const { data: quest, error: questError } = await getSupabase()
    .from('quests')
    .select('quest_id')
    .eq('quest_id', quest_id)
    .eq('status', 'approved')
    .single();

  if (questError || !quest) {
    return res.status(404).json({ error: 'Quest not found or not approved', code: 'not_found' });
  }

  // Check for prior completed session for is_first_attempt flag
  const { data: prior } = await getSupabase()
    .from('quest_sessions')
    .select('session_id')
    .eq('quest_id', quest_id)
    .eq('user_id', user_id)
    .eq('state', 'completed')
    .limit(1);

  const is_first_attempt = !(prior && prior.length > 0);
  const session_id = `qs-${crypto.randomBytes(8).toString('hex')}-${Date.now()}`;

  const { error: insertError } = await getSupabase()
    .from('quest_sessions')
    .insert({
      session_id,
      user_id,
      quest_id,
      state:              'in_progress',
      sections_completed: [],
      badge_awarded:      false,
      source,
      started_at:         new Date().toISOString(),
    });

  if (insertError) {
    console.error('[quest/start] Session insert error:', insertError);
    return res.status(500).json({ error: 'Failed to create quest session', code: 'server_error' });
  }

  console.log(`[quest/start] session=${session_id} user=${user_id} quest=${quest_id} first_attempt=${is_first_attempt}`);
  return res.json({ session_id, is_first_attempt });
});

// ── POST /api/v1/quest/section-complete ───────────────────────────────────────
// Marks a section as complete. Returns updated sections_completed array,
// quest_complete flag, and next_section_index (null when quest is complete).
router.post('/section-complete', authenticateToken, async (req, res) => {
  const { session_id, section_id, user_id } = req.body;

  if (!session_id || !section_id || !user_id) {
    return res.status(400).json({ error: 'session_id, section_id, and user_id are required', code: 'missing_fields' });
  }

  const { data: session, error: sessionError } = await getSupabase()
    .from('quest_sessions')
    .select('*')
    .eq('session_id', session_id)
    .eq('user_id', user_id)
    .eq('state', 'in_progress')
    .single();

  if (sessionError || !session) {
    return res.status(404).json({ error: 'Active quest session not found', code: 'not_found' });
  }

  const completed = Array.isArray(session.sections_completed) ? [...session.sections_completed] : [];
  if (!completed.includes(section_id)) {
    completed.push(section_id);
  }

  // Get total section count from the quest
  const { data: quest } = await getSupabase()
    .from('quests')
    .select('content')
    .eq('quest_id', session.quest_id)
    .single();

  const totalSections = quest?.content?.sections?.length || 0;
  const quest_complete = totalSections > 0 && completed.length >= totalSections;

  await getSupabase()
    .from('quest_sessions')
    .update({ sections_completed: completed })
    .eq('session_id', session_id);

  return res.json({
    sections_completed:  completed,
    quest_complete,
    next_section_index:  quest_complete ? null : completed.length,
  });
});

// ── POST /api/v1/quest/complete ───────────────────────────────────────────────
// Marks a quest session as completed. Returns badge_awarded: true if this is
// the student's first ever completion of this Quest — badge write is handled
// by the WordPress plugin on receipt of this flag.
router.post('/complete', authenticateToken, async (req, res) => {
  const { session_id, user_id } = req.body;

  if (!session_id || !user_id) {
    return res.status(400).json({ error: 'session_id and user_id are required', code: 'missing_fields' });
  }

  const { data: session, error: sessionError } = await getSupabase()
    .from('quest_sessions')
    .select('*')
    .eq('session_id', session_id)
    .eq('user_id', user_id)
    .single();

  if (sessionError || !session) {
    return res.status(404).json({ error: 'Quest session not found', code: 'not_found' });
  }

  // Idempotent — already complete
  if (session.state === 'completed') {
    return res.json({ already_complete: true, badge_awarded: session.badge_awarded, quest_id: session.quest_id });
  }

  // Badge on first completion only
  const { data: priorCompleted } = await getSupabase()
    .from('quest_sessions')
    .select('session_id')
    .eq('quest_id', session.quest_id)
    .eq('user_id', user_id)
    .eq('state', 'completed')
    .limit(1);

  const badge_awarded = !(priorCompleted && priorCompleted.length > 0);

  await getSupabase()
    .from('quest_sessions')
    .update({
      state:        'completed',
      badge_awarded,
      completed_at: new Date().toISOString(),
    })
    .eq('session_id', session_id);

  console.log(`[quest/complete] session=${session_id} user=${user_id} quest=${session.quest_id} badge=${badge_awarded}`);
  return res.json({ completed: true, badge_awarded, quest_id: session.quest_id });
});

// ── POST /api/v1/quest/generate ───────────────────────────────────────────────
// Server-key only. Generates and stores a Quest — used for seeding and editor.
// Standard generation (from buffer/auto): status defaults to 'approved'.
// Editor generation: pass status: 'draft' — requires manual admin approval.
router.post('/generate', async (req, res) => {
  const serverKey = req.headers['x-aep-server-key'];
  if (!serverKey || serverKey !== process.env.AEP_SERVER_KEY) {
    return res.status(401).json({ error: 'Server key required', code: 'unauthorized' });
  }

  const {
    curriculum   = 'tt_primary',
    level,
    period       = null,
    subject,
    topic        = null,
    module_index = null,   // 0-based index into taxonomy modules array
    status       = 'approved',
  } = req.body;

  if (!level || !subject) {
    return res.status(400).json({ error: 'level and subject are required', code: 'missing_fields' });
  }

  try {
    const { questId, questData } = await generateQuestContent({
      curriculum, level, period, subject, topic,
      moduleIndex: module_index !== null ? parseInt(module_index, 10) : null,
    });
    const stored = await storeQuest({ questId, questData, status });
    console.log(`[quest/generate] Generated ${questId} (status: ${stored.status})`);
    return res.json({ quest_id: questId, status: stored.status });
  } catch (err) {
    console.error('[quest/generate] Error:', err);
    return res.status(500).json({ error: 'Quest generation failed', code: 'generation_error', details: err.message });
  }
});

module.exports = router;
