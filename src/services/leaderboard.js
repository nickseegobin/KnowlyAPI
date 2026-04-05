const getSupabase = require('../config/supabase');
const { generateContent } = require('./ai');

function getTrinidadDate() {
  const now = new Date();
  const trinidad = new Date(now.toLocaleString('en-US', { timeZone: 'America/Port_of_Spain' }));
  return trinidad.toISOString().split('T')[0];
}

// board_key format: {level}:{period}:{subject}
// Capstone (period=null): {level}:none:{subject}
function getBoardKey(level, period, subject) {
  const p = (!period || period === 'none') ? 'none' : period;
  return `${level}:${p}:${subject}`;
}

function calcPoints(correct_count, difficulty) {
  const bonus = difficulty === 'hard' ? 2 : difficulty === 'medium' ? 1 : 0;
  return correct_count + bonus;
}

// Supabase requires .is() not .eq() for NULL comparisons.
function applyPeriodFilter(query, period) {
  return (!period || period === 'none') ? query.is('period', null) : query.eq('period', period);
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

async function upsertLeaderboardEntry({ user_id, nickname, level, period, subject, difficulty, curriculum = 'tt_primary', trial_type = 'practice', correct_count, score_pct, points }) {
  const normalised_period = (!period || period === 'none') ? null : period;
  const entry_date        = getTrinidadDate();
  const board_key         = getBoardKey(level, normalised_period, subject);
  const new_points        = (typeof points === 'number') ? points : calcPoints(correct_count, difficulty);
  const display_nickname  = nickname || `Player${user_id}`;

  // ── Fetch existing entry ─────────────────────────────────────────────────────
  const { data: existing } = await applyPeriodFilter(
    getSupabase()
      .from('leaderboard_entries')
      .select('id, total_points')
      .eq('user_id', user_id)
      .eq('level', level)
      .eq('subject', subject)
      .eq('entry_date', entry_date),
    normalised_period
  ).single();

  // ── Previous rank ────────────────────────────────────────────────────────────
  let previous_rank = null;
  if (existing) {
    const { count: above } = await applyPeriodFilter(
      getSupabase()
        .from('leaderboard_entries')
        .select('id', { count: 'exact', head: true })
        .eq('level', level)
        .eq('subject', subject)
        .eq('entry_date', entry_date)
        .gt('total_points', existing.total_points),
      normalised_period
    );
    previous_rank = (above || 0) + 1;
  }

  // ── Best score wins ──────────────────────────────────────────────────────────
  const current_best = existing?.total_points || 0;
  const is_new_best  = new_points > current_best;
  const final_total  = is_new_best ? new_points : current_best;

  if (existing) {
    if (is_new_best) {
      await applyPeriodFilter(
        getSupabase()
          .from('leaderboard_entries')
          .update({
            nickname:       display_nickname,
            curriculum,
            total_points:   final_total,
            last_score_pct: score_pct,
            difficulty,
            board_key,
            updated_at:     new Date().toISOString(),
          })
          .eq('user_id', user_id)
          .eq('level', level)
          .eq('subject', subject)
          .eq('entry_date', entry_date),
        normalised_period
      );
    }
  } else {
    await getSupabase()
      .from('leaderboard_entries')
      .insert({
        user_id,
        nickname:       display_nickname,
        curriculum,
        level,
        period:         normalised_period,
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
  const { count: newAbove } = await applyPeriodFilter(
    getSupabase()
      .from('leaderboard_entries')
      .select('id', { count: 'exact', head: true })
      .eq('level', level)
      .eq('subject', subject)
      .eq('entry_date', entry_date)
      .gt('total_points', final_total),
    normalised_period
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
  applyPeriodFilter,
};
