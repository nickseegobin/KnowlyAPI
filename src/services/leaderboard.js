const getSupabase = require('../config/supabase');
const { generateContent } = require('./ai');

function getTrinidadDate() {
  const now = new Date();
  const trinidad = new Date(now.toLocaleString('en-US', { timeZone: 'America/Port_of_Spain' }));
  return trinidad.toISOString().split('T')[0];
}

function getBoardKey(standard, term, subject) {
  return [standard, term, subject].filter(Boolean).join('_');
}

function calcPoints(correct_count, difficulty) {
  const bonus = difficulty === 'hard' ? 2 : difficulty === 'medium' ? 1 : 0;
  return correct_count + bonus;
}

// Supabase requires .is() not .eq() for NULL comparisons.
// .eq('term', null) uses SQL = which never matches NULL — use .is('term', null) instead.
function applyTermFilter(query, term) {
  return term === null ? query.is('term', null) : query.eq('term', term);
}

async function generateNickname(existingNicknames = [], retries = 3) {
  const prompt = `Generate a single fun Caribbean-flavoured nickname for a primary school student on an exam platform in Trinidad and Tobago.

Rules:
- One word or two words joined (no spaces): e.g. CoralBolt, TurboMango, SteelWave, FlameConch
- Caribbean theme: sea creatures, tropical fruits, steel pan, Carnival, local nature
- Child-safe, positive, energetic
- 8-14 characters
- No numbers unless necessary
- Must NOT be any of these already-taken nicknames: ${existingNicknames.join(', ') || 'none'}

Return ONLY the nickname, nothing else.`;

  for (let i = 0; i < retries; i++) {
    const raw = await generateContent(prompt);
    const nickname = raw.trim().replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '');

    const { data } = await getSupabase()
      .from('user_profiles')
      .select('nickname')
      .eq('nickname', nickname)
      .single();

    if (!data) return nickname;
    existingNicknames.push(nickname);
  }

  const base = await generateContent(`Generate a single fun Caribbean-flavoured nickname for a primary school student. One word, 6-10 chars, child-safe. Return ONLY the nickname.`);
  const clean = base.trim().replace(/\s+/g, '').replace(/[^a-zA-Z]/g, '');
  return clean + String(Math.floor(Math.random() * 90) + 10);
}

async function upsertLeaderboardEntry({ user_id, nickname, standard, term, subject, difficulty, correct_count, score_pct, points }) {
  const normalised_term  = (!term || term === 'none') ? null : term;
  const entry_date       = getTrinidadDate();
  const board_key        = getBoardKey(standard, normalised_term, subject);
  const new_points       = (typeof points === 'number') ? points : calcPoints(correct_count, difficulty);
  const display_nickname = nickname || `Player${user_id}`;

  // ── Fetch existing entry ─────────────────────────────────────────────────────
  const { data: existing } = await applyTermFilter(
    getSupabase()
      .from('leaderboard_entries')
      .select('id, total_points')
      .eq('user_id', user_id)
      .eq('standard', standard)
      .eq('subject', subject)
      .eq('entry_date', entry_date),
    normalised_term
  ).single();

  // ── Previous rank ────────────────────────────────────────────────────────────
  let previous_rank = null;
  if (existing) {
    const { count: above } = await applyTermFilter(
      getSupabase()
        .from('leaderboard_entries')
        .select('id', { count: 'exact', head: true })
        .eq('standard', standard)
        .eq('subject', subject)
        .eq('entry_date', entry_date)
        .gt('total_points', existing.total_points),
      normalised_term
    );
    previous_rank = (above || 0) + 1;
  }

  // ── Best score wins — only update if new attempt beats current best ──────────
  const current_best = existing?.total_points || 0;
  const is_new_best  = new_points > current_best;
  const final_total  = is_new_best ? new_points : current_best;

  // ── Write only if new best OR first entry ────────────────────────────────────
  if (existing) {
    if (is_new_best) {
      await applyTermFilter(
        getSupabase()
          .from('leaderboard_entries')
          .update({
            nickname:       display_nickname,
            total_points:   final_total,
            last_score_pct: score_pct,
            difficulty,
            board_key,
            updated_at:     new Date().toISOString(),
          })
          .eq('user_id', user_id)
          .eq('standard', standard)
          .eq('subject', subject)
          .eq('entry_date', entry_date),
        normalised_term
      );
    }
    // If not a new best — no write needed, rank stays the same
  } else {
    await getSupabase()
      .from('leaderboard_entries')
      .insert({
        user_id,
        nickname:       display_nickname,
        standard,
        term:           normalised_term,
        subject,
        difficulty,
        board_key,
        total_points:   final_total,
        last_score_pct: score_pct,
        entry_date,
        updated_at:     new Date().toISOString(),
      });
  }

  // ── New rank ──────────────────────────────────────────────────────────────────
  const { count: newAbove } = await applyTermFilter(
    getSupabase()
      .from('leaderboard_entries')
      .select('id', { count: 'exact', head: true })
      .eq('standard', standard)
      .eq('subject', subject)
      .eq('entry_date', entry_date)
      .gt('total_points', final_total),
    normalised_term
  );
  const new_rank = (newAbove || 0) + 1;

  return {
    was_updated:        is_new_best || !existing,
    total_points_today: final_total,
    previous_rank,
    new_rank,
    board_key,
  };
}


module.exports = {
  getTrinidadDate,
  getBoardKey,
  calcPoints,
  generateNickname,
  upsertLeaderboardEntry,
  applyTermFilter,  // exported so routes/leaderboard.js can use it for GET queries
};