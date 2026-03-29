const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const getSupabase = require('../config/supabase');
const { getTrinidadDate, getBoardKey, generateNickname, upsertLeaderboardEntry } = require('../services/leaderboard');

function requireServerKey(req, res) {
  const serverKey = req.headers['x-aep-server-key'];
  if (!serverKey || serverKey !== process.env.AEP_SERVER_KEY) {
    res.status(401).json({ error: 'Server key required' });
    return false;
  }
  return true;
}

// GET /api/v1/leaderboard/:standard/:term/:subject
router.get('/:standard/:term/:subject', async (req, res) => {
  const { standard, subject } = req.params;
  const term = req.params.term === 'none' ? null : req.params.term;
  const entry_date = getTrinidadDate();
  const board_key = getBoardKey(standard, term, subject);

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
    const { data: entries, error } = await getSupabase()
      .from('leaderboard_entries')
      .select('user_id, nickname, total_points, last_score_pct')
      .eq('standard', standard)
      .eq('term', term || null)
      .eq('subject', subject)
      .eq('entry_date', entry_date)
      .order('total_points', { ascending: false })
      .limit(10);

    if (error) throw error;

    const { count: total_participants } = await getSupabase()
      .from('leaderboard_entries')
      .select('id', { count: 'exact', head: true })
      .eq('standard', standard)
      .eq('term', term || null)
      .eq('subject', subject)
      .eq('entry_date', entry_date);

    let my_position = null;
    if (requesting_user_id) {
      const userInTop = entries?.findIndex(e => e.user_id === requesting_user_id);
      if (userInTop >= 0) {
        my_position = userInTop + 1;
      } else {
        const { data: myEntry } = await getSupabase()
          .from('leaderboard_entries')
          .select('total_points')
          .eq('user_id', requesting_user_id)
          .eq('standard', standard)
          .eq('term', term || null)
          .eq('subject', subject)
          .eq('entry_date', entry_date)
          .single();

        if (myEntry) {
          const { count: above } = await getSupabase()
            .from('leaderboard_entries')
            .select('id', { count: 'exact', head: true })
            .eq('standard', standard)
            .eq('term', term || null)
            .eq('subject', subject)
            .eq('entry_date', entry_date)
            .gt('total_points', myEntry.total_points);
          my_position = (above || 0) + 1;
        }
      }
    }

    return res.json({
      board_key,
      standard,
      term: term || null,
      subject,
      date: entry_date,
      total_participants: total_participants || 0,
      my_position,
      entries: (entries || []).map((e, i) => ({
        rank: i + 1,
        nickname: e.nickname,
        total_points: e.total_points,
        last_score_pct: e.last_score_pct,
        is_current_user: e.user_id === requesting_user_id
      }))
    });

  } catch (err) {
    console.error('Leaderboard error:', err);
    return res.status(500).json({ error: 'Failed to fetch leaderboard', details: err.message });
  }
});

// GET /api/v1/leaderboard/me/:user_id
router.get('/me/:user_id', authenticateToken, async (req, res) => {
  const { user_id } = req.params;
  const entry_date = getTrinidadDate();

  try {
    const { data: profile } = await getSupabase()
      .from('user_profiles')
      .select('standard, term')
      .eq('user_id', user_id)
      .single();

    const { data: entries, error } = await getSupabase()
      .from('leaderboard_entries')
      .select('board_key, subject, total_points, last_score_pct, standard, term')
      .eq('user_id', user_id)
      .eq('entry_date', entry_date);

    if (error) throw error;

    const boards = await Promise.all((entries || []).map(async e => {
      const { count: above } = await getSupabase()
        .from('leaderboard_entries')
        .select('id', { count: 'exact', head: true })
        .eq('standard', e.standard)
        .eq('term', e.term || null)
        .eq('subject', e.subject)
        .eq('entry_date', entry_date)
        .gt('total_points', e.total_points);

      return {
        board_key: e.board_key,
        subject: e.subject,
        total_points: e.total_points,
        last_score_pct: e.last_score_pct,
        rank: (above || 0) + 1
      };
    }));

    return res.json({
      user_id,
      standard: profile?.standard || null,
      term: profile?.term || null,
      date: entry_date,
      boards
    });

  } catch (err) {
    console.error('Leaderboard me error:', err);
    return res.status(500).json({ error: 'Failed to fetch personal boards', details: err.message });
  }
});

// POST /api/v1/leaderboard/generate-nickname
router.post('/generate-nickname', authenticateToken, async (req, res) => {
  if (!requireServerKey(req, res)) return;

  const { user_id, standard, term } = req.body;
  if (!user_id || !standard) {
    return res.status(400).json({ error: 'Missing required fields' });
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
      nickname,
      standard,
      term: term || null
    });

    return res.json({ user_id, nickname, is_new: true });

  } catch (err) {
    console.error('Generate nickname error:', err);
    return res.status(500).json({ error: 'Failed to generate nickname', details: err.message });
  }
});

// POST /api/v1/leaderboard/regenerate-nickname
router.post('/regenerate-nickname', authenticateToken, async (req, res) => {
  if (!requireServerKey(req, res)) return;

  const { user_id } = req.body;
  if (!user_id) {
    return res.status(400).json({ error: 'Missing user_id' });
  }

  try {
    const { data: profile } = await getSupabase()
      .from('user_profiles')
      .select('nickname')
      .eq('user_id', user_id)
      .single();

    if (!profile) {
      return res.status(404).json({ error: 'User profile not found' });
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
    console.error('Regenerate nickname error:', err);
    return res.status(500).json({ error: 'Failed to regenerate nickname', details: err.message });
  }
});

// POST /api/v1/leaderboard/upsert
router.post('/upsert', async (req, res) => {
  if (!requireServerKey(req, res)) return;
  try {
    const result = await upsertLeaderboardEntry(req.body);
    res.json(result);
  } catch (err) {
    console.error('[leaderboard] upsert failed', err.stack);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/leaderboard/reset
router.post('/reset', async (req, res) => {
  if (!requireServerKey(req, res)) return;

  try {
    const { data: toArchive, error: fetchError } = await getSupabase()
      .from('leaderboard_entries')
      .select('user_id, nickname, standard, term, subject, total_points, last_score_pct, entry_date');

    if (fetchError) throw fetchError;

    if (toArchive && toArchive.length > 0) {
      const archiveRows = toArchive.map(e => ({
        user_id: e.user_id,
        nickname: e.nickname,
        standard: e.standard,
        term: e.term,
        subject: e.subject,
        total_points: e.total_points,
        last_score_pct: e.last_score_pct,
        board_date: e.entry_date,
        archived_at: new Date().toISOString()
      }));
      await getSupabase().from('leaderboard_archive').insert(archiveRows);
    }

    const boardSet = new Set((toArchive || []).map(e => getBoardKey(e.standard, e.term, e.subject)));

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
    console.error('Leaderboard reset error:', err);
    return res.status(500).json({ error: 'Failed to reset leaderboard', details: err.message });
  }
});

// POST /api/v1/leaderboard/test/inject
router.post('/test/inject', async (req, res) => {
  if (!requireServerKey(req, res)) return;
  try {
    const result = await upsertLeaderboardEntry({
      user_id:    req.body.user_id || `test_${Date.now()}`,
      nickname:   req.body.nickname,
      standard:   req.body.standard,
      term:       req.body.term || null,
      subject:    req.body.subject,
      difficulty: req.body.difficulty || 'easy',
      points:     req.body.points,
      score_pct:  req.body.score_pct
    });
    res.json({ injected: true, ...result });
  } catch (err) {
    console.error('[leaderboard] test inject failed', err.stack);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/v1/leaderboard/test/reset-board
router.post('/test/reset-board', async (req, res) => {
  if (!requireServerKey(req, res)) return;

  const { standard, term, subject } = req.body;
  if (!standard || !subject) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const entry_date = getTrinidadDate();
  const board_key = getBoardKey(standard, term, subject);

  try {
    const { data: toDelete } = await getSupabase()
      .from('leaderboard_entries')
      .select('id')
      .eq('standard', standard)
      .eq('term', term || null)
      .eq('subject', subject)
      .eq('entry_date', entry_date);

    await getSupabase()
      .from('leaderboard_entries')
      .delete()
      .eq('standard', standard)
      .eq('term', term || null)
      .eq('subject', subject)
      .eq('entry_date', entry_date);

    return res.json({
      reset: true,
      entries_cleared: toDelete?.length || 0,
      board_key
    });

  } catch (err) {
    console.error('Reset board error:', err);
    return res.status(500).json({ error: 'Failed to reset board', details: err.message });
  }
});

module.exports = router;