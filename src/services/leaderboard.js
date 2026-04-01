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
//Condemed Method - not used anymore, but keeping for reference until we are sure the new one works well
/* async function upsertLeaderboardEntry({ user_id, nickname, standard, term, subject, difficulty, correct_count, score_pct, points }) {
  const entry_date = getTrinidadDate();
  const board_key = getBoardKey(standard, term, subject);

  // Use pre-calculated points from WP if provided, fallback to local calc
  const new_points = (typeof points === 'number') ? points : calcPoints(correct_count, difficulty);

  const display_nickname = nickname || `Player${user_id}`;

  // Get previous entry for today
  const { data: existing } = await getSupabase()
    .from('leaderboard_entries')
    .select('total_points')
    .eq('user_id', user_id)
    .eq('standard', standard)
    .eq('term', term || null)
    .eq('subject', subject)
    .eq('entry_date', entry_date)
    .single();

  let previous_rank = null;
  if (existing) {
    const { count: above } = await getSupabase()
      .from('leaderboard_entries')
      .select('id', { count: 'exact', head: true })
      .eq('standard', standard)
      .eq('term', term || null)
      .eq('subject', subject)
      .eq('entry_date', entry_date)
      .gt('total_points', existing.total_points);
    previous_rank = (above || 0) + 1;
  }

  // Accumulate points
  const previous_total = existing?.total_points || 0;
  const new_total = previous_total + new_points;

  await getSupabase()
    .from('leaderboard_entries')
    .upsert({
      user_id,
      nickname: display_nickname,
      standard,
      term: term || null,
      subject,
      difficulty,
      board_key,
      total_points: new_total,
      last_score_pct: score_pct,
      entry_date,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,standard,term,subject,entry_date' });

  // Get new rank after upsert
  const { count: newAbove } = await getSupabase()
    .from('leaderboard_entries')
    .select('id', { count: 'exact', head: true })
    .eq('standard', standard)
    .eq('term', term || null)
    .eq('subject', subject)
    .eq('entry_date', entry_date)
    .gt('total_points', new_total);

  const new_rank = (newAbove || 0) + 1;

  return {
    was_updated: true,
    total_points_today: new_total,
    previous_rank,
    new_rank,
    board_key
  };
} */

  async function upsertLeaderboardEntry({ user_id, nickname, standard, term, subject, difficulty, correct_count, score_pct, points }) {
  // Normalize term — treat 'none', null, undefined, '' all as null
  const normalised_term = (!term || term === 'none') ? null : term;
  
  const entry_date = getTrinidadDate();
  const board_key = getBoardKey(standard, normalised_term, subject);
  const new_points = (typeof points === 'number') ? points : calcPoints(correct_count, difficulty);
  const display_nickname = nickname || `Player${user_id}`;

  const { data: existing } = await getSupabase()
    .from('leaderboard_entries')
    .select('total_points')
    .eq('user_id', user_id)
    .eq('standard', standard)
    .eq('term', normalised_term)        // ← use normalised_term
    .eq('subject', subject)
    .eq('entry_date', entry_date)
    .single();

  let previous_rank = null;
  if (existing) {
    const { count: above } = await getSupabase()
      .from('leaderboard_entries')
      .select('id', { count: 'exact', head: true })
      .eq('standard', standard)
      .eq('term', normalised_term)      // ← use normalised_term
      .eq('subject', subject)
      .eq('entry_date', entry_date)
      .gt('total_points', existing.total_points);
    previous_rank = (above || 0) + 1;
  }

  const previous_total = existing?.total_points || 0;
  const new_total = previous_total + new_points;

  await getSupabase()
    .from('leaderboard_entries')
    .upsert({
      user_id,
      nickname: display_nickname,
      standard,
      term: normalised_term,            // ← use normalised_term
      subject,
      difficulty,
      board_key,
      total_points: new_total,
      last_score_pct: score_pct,
      entry_date,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id,standard,term,subject,entry_date' });

  const { count: newAbove } = await getSupabase()
    .from('leaderboard_entries')
    .select('id', { count: 'exact', head: true })
    .eq('standard', standard)
    .eq('term', normalised_term)        // ← use normalised_term
    .eq('subject', subject)
    .eq('entry_date', entry_date)
    .gt('total_points', new_total);

  const new_rank = (newAbove || 0) + 1;

  return {
    was_updated: true,
    total_points_today: new_total,
    previous_rank,
    new_rank,
    board_key
  };
}

module.exports = { getTrinidadDate, getBoardKey, calcPoints, generateNickname, upsertLeaderboardEntry };