const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const getSupabase = require('../config/supabase');
const { getTrinidadDate, getBoardKey, generateNickname, upsertLeaderboardEntry } = require('../services/leaderboard');

// GET /api/v1/leaderboard/:standard/:term/:subject/:difficulty
router.get('/:standard/:term/:subject/:difficulty', async (req, res) => {
  const { standard, subject, difficulty } = req.params;
  const term = req.params.term === 'none' ? null : req.params.term;
  const entry_date = getTrinidadDate();
  const board_key = getBoardKey(standard, term, subject, difficulty);

  // Try to get user_id from JWT if present
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
      .select('user_id, nickname, best_points, best_score_pct, correct_count, total_questions')
      .eq('standard', standard)
      .eq('term', term || '')
      .eq('subject', subject)
      .eq('difficulty', difficulty)
      .eq('entry_date', entry_date)
      .order('best_points', { ascending: false })
      .limit(10);

    if (error) throw error;

    const { count: total_participants } = await getSupabase()
      .from('leaderboard_entries')
      .select('id', { count: 'exact', head: true })
      .eq('standard', standard)
      .eq('term', term || '')
      .eq('subject', subject)
      .eq('difficulty', difficulty)
      .eq('entry_date', entry_date);

    // Get my_position if user not in top 10
    let my_position = null;
    if (requesting_user_id) {
      const userInTop = entries?.findIndex(e => e.user_id === requesting_user_id);
      if (userInTop >= 0) {
        my_position = userInTop + 1;
      } else {
        const { data: myEntry } = await getSupabase()
          .from('leaderboard_entries')
          .select('best_points')
          .eq('user_id', requesting_user_id)
          .eq('standard', standard)
          .eq('term', term || '')
          .eq('subject', subject)
          .eq('difficulty', difficulty)
          .eq('entry_date', entry_date)
          .single();

        if (myEntry) {
          const { count: above } = await getSupabase()
            .from('leaderboard_entries')
            .select('id', { count: 'exact', head: true })
            .eq('standard', standard)
            .eq('term', term || '')
            .eq('subject', subject)
            .eq('difficulty', difficulty)
            .eq('entry_date', entry_date)
            .gt('best_points', myEntry.best_points);
          my_position = (above || 0) + 1;
        }
      }
    }

    return res.json({
      board_key,
      standard,
      term: term || null,
      subject,
      difficulty,
      date: entry_date,
      total_participants: total_participants || 0,
      my_position,
      entries: (entries || []).map((e, i) => ({
        rank: i + 1,
        nickname: e.nickname,
        best_score_pct: e.best_score_pct,
        best_points: e.best_points,
        correct_count: e.correct_count,
        total_questions: e.total_questions,
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
      .select('board_key, subject, difficulty, best_score_pct, best_points, standard, term')
      .eq('user_id', user_id)
      .eq('entry_date', entry_date);

    if (error) throw error;

    const boards = await Promise.all((entries || []).map(async e => {
      const { count: above } = await getSupabase()
        .from('leaderboard_entries')
        .select('id', { count: 'exact', head: true })
        .eq('standard', e.standard)
        .eq('term', e.term || '')
        .eq('subject', e.subject)
        .eq('difficulty', e.difficulty)
        .eq('entry_date', entry_date)
        .gt('best_points', e.best_points);

      return {
        board_key: e.board_key,
        subject: e.subject,
        difficulty: e.difficulty,
        best_score_pct: e.best_score_pct,
        best_points: e.best_points,
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
  const { role } = req.user;
  if (role !== 'server') {
    return res.status(403).json({ error: 'Server JWT required' });
  }

  const { user_id, standard, term } = req.body;
  if (!user_id || !standard) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // Idempotent — return existing if already created
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
  const { role } = req.user;
  if (role !== 'server') {
    return res.status(403).json({ error: 'Server JWT required' });
  }

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

    // Update profile
    await getSupabase()
      .from('user_profiles')
      .update({ nickname: new_nickname, updated_at })
      .eq('user_id', user_id);

    // Update all leaderboard entries atomically
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

module.exports = router;