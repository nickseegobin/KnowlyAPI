const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const getSupabase = require('../config/supabase');
const { getTrinidadDate, getBoardKey, generateNickname, upsertLeaderboardEntry } = require('../services/leaderboard');

// ─────────────────────────────────────────────────────────────────────────────
// Auth helpers
// ─────────────────────────────────────────────────────────────────────────────

function requireServerKey(req, res) {
  const serverKey = req.headers['x-aep-server-key'];
  if (!serverKey || serverKey !== process.env.AEP_SERVER_KEY) {
    res.status(401).json({ error: 'Server key required' });
    return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/leaderboard/upsert  (WordPress server-to-server)
// ─────────────────────────────────────────────────────────────────────────────
router.post('/upsert', async (req, res) => {
  if (!requireServerKey(req, res)) return;

  const { user_id, standard, subject, points, score_pct, term, difficulty, session_id } = req.body;

  const missing = ['user_id', 'standard', 'subject', 'points', 'score_pct', 'session_id'].filter(f => {
    const v = req.body[f];
    return v === undefined || v === null || v === '';
  });
  if (missing.length) {
    return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
  }

  // BUG H FIX: WP sends user_id as a string "(string) $child_id".
  // Coerce to string explicitly so Supabase .eq() comparisons are consistent
  // regardless of whether your user_profiles column is uuid/text or int.
  // If your column is integer, change this to: const uid = parseInt(user_id, 10);
  const uid = String(user_id);

  // BUG D FIX: normalise term — never store null, always use empty string "".
  // This keeps parity with the board-fetch query which also uses term || "".
  // WP sends "none" for std_5 — map that to "" as well.
  const normTerm = (!term || term === 'none') ? '' : term;

  try {
    const { data: profile, error: profileError } = await getSupabase()
      .from('user_profiles')
      .select('nickname')
      .eq('user_id', uid)
      .single();

    if (profileError || !profile) {
      return res.status(404).json({ error: 'User profile not found — nickname not generated yet' });
    }

    const nickname = profile.nickname;
    const entry_date = getTrinidadDate();
    const board_key = getBoardKey(standard, normTerm || null, subject);

    const { data: existing } = await getSupabase()
      .from('leaderboard_entries')
      .select('total_points')
      .eq('user_id', uid)
      .eq('standard', standard)
      .eq('term', normTerm)
      .eq('subject', subject)
      .eq('entry_date', entry_date)
      .single();

    const previous_total = existing?.total_points || 0;
    const new_total = previous_total + points;

    let previous_rank = null;
    if (existing) {
      const { count: abovePrev } = await getSupabase()
        .from('leaderboard_entries')
        .select('id', { count: 'exact', head: true })
        .eq('standard', standard)
        .eq('term', normTerm)
        .eq('subject', subject)
        .eq('entry_date', entry_date)
        .gt('total_points', previous_total);
      previous_rank = (abovePrev || 0) + 1;
    }

    const { error: upsertError } = await getSupabase()
      .from('leaderboard_entries')
      .upsert({
        user_id: uid,
        nickname,
        standard,
        term: normTerm,
        subject,
        difficulty: difficulty || null,
        board_key,
        total_points: new_total,
        last_score_pct: score_pct,
        entry_date,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,standard,term,subject,entry_date' });

    if (upsertError) throw upsertError;

    const { count: aboveNew } = await getSupabase()
      .from('leaderboard_entries')
      .select('id', { count: 'exact', head: true })
      .eq('standard', standard)
      .eq('term', normTerm)
      .eq('subject', subject)
      .eq('entry_date', entry_date)
      .gt('total_points', new_total);

    const new_rank = (aboveNew || 0) + 1;

    return res.json({
      was_updated: true,
      total_points_today: new_total,
      previous_rank,
      new_rank,
      board_key
    });

  } catch (err) {
    console.error('[leaderboard/upsert] error:', err.message, err.stack);
    return res.status(500).json({ error: 'Failed to upsert leaderboard entry', details: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/leaderboard/:standard/:term/:subject
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:standard/:term/:subject', async (req, res) => {
  const { standard, subject } = req.params;
  const term = req.params.term === 'none' ? '' : req.params.term;
  const entry_date = getTrinidadDate();
  const board_key = getBoardKey(standard, term || null, subject);

  // Requesting user can come from either a JWT *or* a ?user_id query param
  // (WP server calls pass user_id as a query param, not a JWT)
  let requesting_user_id = null;
  try {
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const jwt = require('jsonwebtoken');
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      requesting_user_id = decoded.user_id ? String(decoded.user_id) : null;
    }
  } catch (_) {}

  // Fallback: WP service passes child_id as ?user_id
  if (!requesting_user_id && req.query.user_id) {
    requesting_user_id = String(req.query.user_id);
  }

  try {
    const { data: entries, error } = await getSupabase()
      .from('leaderboard_entries')
      .select('user_id, nickname, total_points, last_score_pct')
      .eq('standard', standard)
      .eq('term', term)
      .eq('subject', subject)
      .eq('entry_date', entry_date)
      .order('total_points', { ascending: false })
      .limit(10);

    if (error) throw error;

    const { count: total_participants } = await getSupabase()
      .from('leaderboard_entries')
      .select('id', { count: 'exact', head: true })
      .eq('standard', standard)
      .eq('term', term)
      .eq('subject', subject)
      .eq('entry_date', entry_date);

    let my_position = null;
    if (requesting_user_id) {
      const userInTop = entries?.findIndex(e => String(e.user_id) === requesting_user_id);
      if (userInTop >= 0) {
        my_position = userInTop + 1;
      } else {
        const { data: myEntry } = await getSupabase()
          .from('leaderboard_entries')
          .select('total_points')
          .eq('user_id', requesting_user_id)
          .eq('standard', standard)
          .eq('term', term)
          .eq('subject', subject)
          .eq('entry_date', entry_date)
          .single();

        if (myEntry) {
          const { count: above } = await getSupabase()
            .from('leaderboard_entries')
            .select('id', { count: 'exact', head: true })
            .eq('standard', standard)
            .eq('term', term)
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
        is_current_user: String(e.user_id) === requesting_user_id
      }))
    });

  } catch (err) {
    console.error('Leaderboard error:', err);
    return res.status(500).json({ error: 'Failed to fetch leaderboard', details: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/v1/leaderboard/me/:user_id
//
// BUG B FIX: This was using authenticateToken (expects user JWT).
// WP calls this server-to-server with X-AEP-Server-Key only.
// Changed to requireServerKey.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/me/:user_id', async (req, res) => {
  if (!requireServerKey(req, res)) return;

  // BUG H FIX: coerce to string for consistent Supabase .eq() matching
  const user_id = String(req.params.user_id);
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
        .eq('term', e.term || '')
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

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/leaderboard/generate-nickname
//
// BUG C FIX: Had both authenticateToken AND requireServerKey stacked.
// authenticateToken rejects server-key calls before requireServerKey fires.
// Removed authenticateToken — server key is the only auth needed here.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/generate-nickname', async (req, res) => {
  if (!requireServerKey(req, res)) return;

  const { user_id, standard, term } = req.body;
  if (!user_id || !standard) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const uid = String(user_id);

  try {
    const { data: existing } = await getSupabase()
      .from('user_profiles')
      .select('nickname')
      .eq('user_id', uid)
      .single();

    if (existing?.nickname) {
      return res.json({ user_id: uid, nickname: existing.nickname, is_new: false });
    }

    const nickname = await generateNickname();

    await getSupabase().from('user_profiles').insert({
      user_id: uid,
      nickname,
      standard,
      term: term || null
    });

    return res.json({ user_id: uid, nickname, is_new: true });

  } catch (err) {
    console.error('Generate nickname error:', err);
    return res.status(500).json({ error: 'Failed to generate nickname', details: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/leaderboard/regenerate-nickname
// BUG C FIX: same dual-auth problem as generate-nickname. Removed authenticateToken.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/regenerate-nickname', async (req, res) => {
  if (!requireServerKey(req, res)) return;

  const { user_id } = req.body;
  if (!user_id) {
    return res.status(400).json({ error: 'Missing user_id' });
  }

  const uid = String(user_id);

  try {
    const { data: profile } = await getSupabase()
      .from('user_profiles')
      .select('nickname')
      .eq('user_id', uid)
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
      .eq('user_id', uid);

    await getSupabase()
      .from('leaderboard_entries')
      .update({ nickname: new_nickname })
      .eq('user_id', uid);

    return res.json({ user_id: uid, old_nickname, new_nickname, updated_at });

  } catch (err) {
    console.error('Regenerate nickname error:', err);
    return res.status(500).json({ error: 'Failed to regenerate nickname', details: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/leaderboard/reset
// BUG C FIX: Removed authenticateToken — server key only.
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/leaderboard/test/inject
//
// BUG C FIX: Removed authenticateToken.
// BUG D FIX: term stored as normTerm ("") not (term || null).
//            null breaks the unique index on (user_id,standard,term,subject,entry_date)
//            and prevents test entries from appearing when the board queries term="".
// ─────────────────────────────────────────────────────────────────────────────
router.post('/test/inject', async (req, res) => {
  if (!requireServerKey(req, res)) return;

  const { nickname, standard, term, subject, points, score_pct } = req.body;
  if (!nickname || !standard || !subject || points === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // BUG D FIX: normalise term the same way upsert does
  const normTerm = (!term || term === 'none') ? '' : term;

  const entry_date = getTrinidadDate();
  const board_key = getBoardKey(standard, normTerm || null, subject);
  const fake_user_id = `test_${Date.now()}`;

  try {
    const { data, error } = await getSupabase()
      .from('leaderboard_entries')
      .insert({
        user_id: fake_user_id,
        nickname,
        standard,
        term: normTerm,        // ← was: term || null
        subject,
        difficulty: 'easy',
        board_key,
        total_points: points,
        last_score_pct: score_pct || 0,
        entry_date,
        updated_at: new Date().toISOString()
      })
      .select()
      .single();

    if (error) throw error;

    return res.json({ injected: true, entry: data, board_key });

  } catch (err) {
    console.error('Inject test entry error:', err);
    return res.status(500).json({ error: 'Failed to inject entry', details: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/v1/leaderboard/test/reset-board
// BUG C FIX: Removed authenticateToken.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/test/reset-board', async (req, res) => {
  if (!requireServerKey(req, res)) return;

  const { standard, term, subject } = req.body;
  if (!standard || !subject) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const normTerm = (!term || term === 'none') ? '' : term;
  const entry_date = getTrinidadDate();
  const board_key = getBoardKey(standard, normTerm || null, subject);

  try {
    const { data: toDelete } = await getSupabase()
      .from('leaderboard_entries')
      .select('id')
      .eq('standard', standard)
      .eq('term', normTerm)
      .eq('subject', subject)
      .eq('entry_date', entry_date);

    await getSupabase()
      .from('leaderboard_entries')
      .delete()
      .eq('standard', standard)
      .eq('term', normTerm)
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