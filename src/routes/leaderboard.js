const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const getSupabase = require('../config/supabase');
const { getTrinidadDate, getBoardKey, generateNickname, upsertLeaderboardEntry, applyPeriodFilter } = require('../services/leaderboard');

function requireServerKey(req, res) {
  const serverKey = req.headers['x-aep-server-key'];
  if (!serverKey || serverKey !== process.env.AEP_SERVER_KEY) {
    res.status(401).json({ error: 'Server key required', code: 'unauthorized' });
    return false;
  }
  return true;
}

// GET /api/v1/leaderboard/:level/:period/:subject
// Pass 'none' as period for capstone-level boards (std_5)
router.get('/:level/:period/:subject', async (req, res) => {
  const { level, subject } = req.params;
  const period = req.params.period === 'none' ? null : req.params.period;
  const entry_date = getTrinidadDate();
  const board_key = getBoardKey(level, period, subject);

  let requesting_user_id = null;
  try {
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const jwt = require('jsonwebtoken');
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      requesting_user_id = decoded.user_id;
    }
  } catch (_) {}

  try {
    const { data: entries, error } = await applyPeriodFilter(
      getSupabase()
        .from('leaderboard_entries')
        .select('user_id, nickname, total_points, last_score_pct')
        .eq('level', level)
        .eq('subject', subject)
        .eq('entry_date', entry_date)
        .order('total_points', { ascending: false })
        .limit(10),
      period
    );

    if (error) throw error;

    const { count: total_participants } = await applyPeriodFilter(
      getSupabase()
        .from('leaderboard_entries')
        .select('id', { count: 'exact', head: true })
        .eq('level', level)
        .eq('subject', subject)
        .eq('entry_date', entry_date),
      period
    );

    let my_position = null;
    if (requesting_user_id) {
      const userInTop = entries?.findIndex(e => e.user_id === requesting_user_id);
      if (userInTop >= 0) {
        my_position = userInTop + 1;
      } else {
        const { data: myEntry } = await applyPeriodFilter(
          getSupabase()
            .from('leaderboard_entries')
            .select('total_points')
            .eq('user_id', requesting_user_id)
            .eq('level', level)
            .eq('subject', subject)
            .eq('entry_date', entry_date),
          period
        ).single();

        if (myEntry) {
          const { count: above } = await applyPeriodFilter(
            getSupabase()
              .from('leaderboard_entries')
              .select('id', { count: 'exact', head: true })
              .eq('level', level)
              .eq('subject', subject)
              .eq('entry_date', entry_date)
              .gt('total_points', myEntry.total_points),
            period
          );
          my_position = (above || 0) + 1;
        }
      }
    }

    return res.json({
      board_key,
      level,
      period: period || null,
      subject,
      entry_date,
      total_participants: total_participants || 0,
      my_position,
      entries: (entries || []).map((e, i) => ({
        rank: i + 1,
        user_id: e.user_id,
        nickname: e.nickname,
        total_points: e.total_points,
        last_score_pct: e.last_score_pct
      }))
    });

  } catch (err) {
    console.error('[leaderboard] GET error:', err);
    return res.status(500).json({ error: 'Failed to fetch leaderboard', code: 'server_error', details: err.message });
  }
});

// GET /api/v1/leaderboard/me/:user_id
router.get('/me/:user_id', authenticateToken, async (req, res) => {
  const { user_id } = req.params;
  const entry_date = getTrinidadDate();

  try {
    const { data: entries, error } = await getSupabase()
      .from('leaderboard_entries')
      .select('level, period, subject, total_points, last_score_pct, board_key, entry_date')
      .eq('user_id', user_id)
      .eq('entry_date', entry_date);

    if (error) throw error;

    return res.json({ user_id, entry_date, boards: entries || [] });
  } catch (err) {
    console.error('[leaderboard] me error:', err);
    return res.status(500).json({ error: 'Failed to fetch user leaderboard', code: 'server_error', details: err.message });
  }
});

// POST /api/v1/leaderboard/generate-nickname
router.post('/generate-nickname', authenticateToken, async (req, res) => {
  if (!requireServerKey(req, res)) return;

  const { user_id, curriculum = 'tt_primary', level, period } = req.body;
  if (!user_id || !level) {
    return res.status(400).json({ error: 'Missing required fields', code: 'missing_fields' });
  }

  try {
    const { data: existing } = await getSupabase()
      .from('user_profiles')
      .select('nickname')
      .eq('user_id', user_id)
      .single();

    if (existing) {
      return res.json({ user_id, nickname: existing.nickname, is_new: false });
    }

    const nickname = await generateNickname();

    await getSupabase().from('user_profiles').insert({
      user_id,
      curriculum,
      level,
      period: period || null,
      nickname,
      gem_balance: 0,
      total_gems_received: 0,
      total_gems_spent: 0
    });

    return res.json({ user_id, nickname, is_new: true });

  } catch (err) {
    console.error('[leaderboard] generate-nickname error:', err);
    return res.status(500).json({ error: 'Failed to generate nickname', code: 'server_error', details: err.message });
  }
});

// POST /api/v1/leaderboard/regenerate-nickname
router.post('/regenerate-nickname', authenticateToken, async (req, res) => {
  if (!requireServerKey(req, res)) return;

  const { user_id } = req.body;
  if (!user_id) {
    return res.status(400).json({ error: 'Missing user_id', code: 'missing_fields' });
  }

  try {
    const { data: profile } = await getSupabase()
      .from('user_profiles')
      .select('nickname')
      .eq('user_id', user_id)
      .single();

    if (!profile) {
      return res.status(404).json({ error: 'User profile not found', code: 'not_found' });
    }

    const old_nickname = profile.nickname;
    const new_nickname = await generateNickname([old_nickname]);
    const updated_at = new Date().toISOString();

    await getSupabase()
      .from('user_profiles')
      .update({ nickname: new_nickname, updated_at })
      .eq('user_id', user_id);

    await getSupabase()
      .from('leaderboard_entries')
      .update({ nickname: new_nickname })
      .eq('user_id', user_id);

    return res.json({ user_id, old_nickname, new_nickname, updated_at });

  } catch (err) {
    console.error('[leaderboard] regenerate-nickname error:', err);
    return res.status(500).json({ error: 'Failed to regenerate nickname', code: 'server_error', details: err.message });
  }
});

// POST /api/v1/leaderboard/upsert
router.post('/upsert', async (req, res) => {
  if (!requireServerKey(req, res)) return;
  try {
    const result = await upsertLeaderboardEntry(req.body);
    res.json(result);
  } catch (err) {
    console.error('[leaderboard] upsert error:', err.stack);
    res.status(500).json({ error: err.message, code: 'server_error' });
  }
});

// POST /api/v1/leaderboard/reset
router.post('/reset', async (req, res) => {
  if (!requireServerKey(req, res)) return;

  try {
    const { data: toArchive, error: fetchError } = await getSupabase()
      .from('leaderboard_entries')
      .select('user_id, nickname, curriculum, level, period, subject, total_points, last_score_pct, entry_date');

    if (fetchError) throw fetchError;

    if (toArchive && toArchive.length > 0) {
      const archiveRows = toArchive.map(e => ({
        user_id: e.user_id,
        nickname: e.nickname,
        curriculum: e.curriculum || 'tt_primary',
        level: e.level,
        period: e.period,
        subject: e.subject,
        total_points: e.total_points,
        last_score_pct: e.last_score_pct,
        board_date: e.entry_date,
        archived_at: new Date().toISOString()
      }));
      await getSupabase().from('leaderboard_archive').insert(archiveRows);
    }

    const boardSet = new Set((toArchive || []).map(e => getBoardKey(e.level, e.period, e.subject)));

    await getSupabase()
      .from('leaderboard_entries')
      .delete()
      .neq('id', 0);

    return res.json({
      entries_cleared: toArchive?.length || 0,
      boards_cleared: boardSet.size,
      reset_at: new Date().toISOString()
    });

  } catch (err) {
    console.error('[leaderboard] reset error:', err);
    return res.status(500).json({ error: 'Failed to reset leaderboard', code: 'server_error', details: err.message });
  }
});

// POST /api/v1/leaderboard/test/inject
router.post('/test/inject', async (req, res) => {
  if (!requireServerKey(req, res)) return;
  try {
    const result = await upsertLeaderboardEntry({
      user_id:    req.body.user_id || `test_${Date.now()}`,
      nickname:   req.body.nickname,
      curriculum: req.body.curriculum || 'tt_primary',
      level:      req.body.level,
      period:     req.body.period || null,
      subject:    req.body.subject,
      difficulty: req.body.difficulty || 'easy',
      trial_type: req.body.trial_type || 'practice',
      points:     req.body.points,
      score_pct:  req.body.score_pct
    });
    res.json({ injected: true, ...result });
  } catch (err) {
    console.error('[leaderboard] test inject error:', err.stack);
    res.status(500).json({ error: err.message, code: 'server_error' });
  }
});

// POST /api/v1/leaderboard/test/reset-board
router.post('/test/reset-board', async (req, res) => {
  if (!requireServerKey(req, res)) return;

  const { level, period, subject } = req.body;
  if (!level || !subject) {
    return res.status(400).json({ error: 'Missing required fields', code: 'missing_fields' });
  }

  const normalised_period = (!period || period === 'none') ? null : period;
  const entry_date = getTrinidadDate();
  const board_key = getBoardKey(level, normalised_period, subject);

  try {
    const { data: toDelete } = await applyPeriodFilter(
      getSupabase()
        .from('leaderboard_entries')
        .select('id')
        .eq('level', level)
        .eq('subject', subject)
        .eq('entry_date', entry_date),
      normalised_period
    );

    await applyPeriodFilter(
      getSupabase()
        .from('leaderboard_entries')
        .delete()
        .eq('level', level)
        .eq('subject', subject)
        .eq('entry_date', entry_date),
      normalised_period
    );

    return res.json({
      reset: true,
      entries_cleared: toDelete?.length || 0,
      board_key
    });

  } catch (err) {
    console.error('[leaderboard] reset-board error:', err);
    return res.status(500).json({ error: 'Failed to reset board', code: 'server_error', details: err.message });
  }
});

module.exports = router;
