const getSupabase = require('../config/supabase');
const { generateContent } = require('./ai');

function getTrinidadDate() {
  const now = new Date();
  const trinidad = new Date(now.toLocaleString('en-US', { timeZone: 'America/Port_of_Spain' }));
  return trinidad.toISOString().split('T')[0];
}

function getBoardKey(standard, term, subject, difficulty) {
  const parts = [standard, term, subject, difficulty].filter(Boolean);
  return parts.join('_');
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

  // Fallback: append 2-digit random number
  const base = await generateContent(`Generate a single fun Caribbean-flavoured nickname for a primary school student. One word, 6-10 chars, child-safe. Return ONLY the nickname.`);
  const clean = base.trim().replace(/\s+/g, '').replace(/[^a-zA-Z]/g, '');
  return clean + String(Math.floor(Math.random() * 90) + 10);
}

async function upsertLeaderboardEntry({ user_id, standard, term, subject, difficulty, correct_count, total_questions, score_pct }) {
  const entry_date = getTrinidadDate();
  const board_key = getBoardKey(standard, term, subject, difficulty);
  const new_points = calcPoints(correct_count, difficulty);

  // Get profile for nickname
  const { data: profile } = await getSupabase()
    .from('user_profiles')
    .select('nickname')
    .eq('user_id', user_id)
    .single();

  const nickname = profile?.nickname || `User${user_id}`;

  // Get existing entry for today
  const { data: existing } = await getSupabase()
    .from('leaderboard_entries')
    .select('best_points, id')
    .eq('user_id', user_id)
    .eq('standard', standard)
    .eq('term', term || '')
    .eq('subject', subject)
    .eq('difficulty', difficulty)
    .eq('entry_date', entry_date)
    .single();

  const previous_best_points = existing?.best_points || 0;
  const was_personal_best = !existing || new_points > previous_best_points;

  if (was_personal_best) {
    await getSupabase()
      .from('leaderboard_entries')
      .upsert({
        user_id,
        nickname,
        standard,
        term: term || null,
        subject,
        difficulty,
        board_key,
        best_points: new_points,
        best_score_pct: score_pct,
        correct_count,
        total_questions,
        entry_date,
        updated_at: new Date().toISOString()
      }, { onConflict: 'user_id,standard,term,subject,difficulty,entry_date' });
  }

  // Get rank
  const { count: above } = await getSupabase()
    .from('leaderboard_entries')
    .select('id', { count: 'exact', head: true })
    .eq('standard', standard)
    .eq('term', term || '')
    .eq('subject', subject)
    .eq('difficulty', difficulty)
    .eq('entry_date', entry_date)
    .gt('best_points', new_points);

  const new_rank = (above || 0) + 1;

  return { points_earned: new_points, board_key, new_rank, was_personal_best, previous_best_points };
}

module.exports = { getTrinidadDate, getBoardKey, calcPoints, generateNickname, upsertLeaderboardEntry };