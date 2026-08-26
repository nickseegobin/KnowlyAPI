/**
 * Diagnostic script — Quest Progression Flow
 *
 * Tests the full chain:
 *   1. POST /quest/complete-progression  → writes exam_sessions row
 *   2. GET  /progression/child           → reads back the topic status
 *
 * Run: node scripts/test-quest-progression.js <user_id> <topic>
 *
 * user_id  — the WP user ID of the authenticated user (parent or child JWT owner).
 *             Find it via /auth/me → user_id field.
 * topic    — exact sub-topic name from curriculum_topics (e.g. "Repeating Increasing and Decreasing Patterns")
 *
 * Example:
 *   node scripts/test-quest-progression.js 5 "Repeating Increasing and Decreasing Patterns"
 */

require('dotenv').config();
const https = require('https');
const http  = require('http');

const BASE       = (process.env.RAILWAY_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
const SERVER_KEY = process.env.AEP_SERVER_KEY;
const JWT_SECRET = process.env.JWT_SECRET;

const user_id = parseInt(process.argv[2], 10);
const topic   = process.argv[3];

if (!user_id || !topic) {
  console.error('Usage: node scripts/test-quest-progression.js <user_id> "<topic>"');
  process.exit(1);
}

if (!SERVER_KEY) {
  console.error('AEP_SERVER_KEY not set in .env');
  process.exit(1);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeJwt(userId) {
  const jwt = require('jsonwebtoken');
  return jwt.sign({ user_id: userId }, JWT_SECRET, { expiresIn: '5m' });
}

function request(method, path, body, headers) {
  return new Promise((resolve, reject) => {
    const url     = new URL(BASE + path);
    const isHttps = url.protocol === 'https:';
    const lib     = isHttps ? https : http;
    const payload = body ? JSON.stringify(body) : null;

    const req = lib.request({
      hostname: url.hostname,
      port:     url.port || (isHttps ? 443 : 80),
      path:     url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
        ...headers,
      },
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ── Test sequence ────────────────────────────────────────────────────────────

async function run() {
  const testSessionId = `test-${Date.now()}`;
  const jwt = JWT_SECRET ? makeJwt(user_id) : null;

  console.log('\n── Quest Progression Diagnostic ────────────────────────────');
  console.log(`Base URL : ${BASE}`);
  console.log(`user_id  : ${user_id}`);
  console.log(`topic    : "${topic}"`);
  console.log(`session  : ${testSessionId}`);
  console.log('────────────────────────────────────────────────────────────\n');

  // ── Step 1: Write exam_session via complete-progression ──────────────────
  console.log('Step 1 — POST /quest/complete-progression');
  const writeRes = await request(
    'POST',
    '/api/v1/quest/complete-progression',
    {
      session_id:  testSessionId,
      user_id,
      quest_id:    'test-quest',
      subject:     'math',
      topic,
      curriculum:  'tt_primary',
      level:       'std_4',
      period:      'term_1',
      score:       100,
    },
    { 'X-AEP-Server-Key': SERVER_KEY }
  );
  console.log(`  Status : ${writeRes.status}`);
  console.log(`  Body   :`, writeRes.body);

  if (writeRes.status !== 200) {
    console.error('\n❌ complete-progression failed — check server key and Railway connection.');
    process.exit(1);
  }
  console.log('  ✅ Exam session written\n');

  // ── Step 2: Read back via progression endpoint ───────────────────────────
  if (!JWT_SECRET) {
    console.log('Step 2 — Skipped (JWT_SECRET not in .env — run against local Railway only)');
    console.log('\nManual check: GET /api/v1/progression/child?level=std_4&curriculum=tt_primary&period=term_1');
    console.log('with Authorization: Bearer <user jwt>');
    return;
  }

  console.log('Step 2 — GET /progression/child');
  const progRes = await request(
    'GET',
    `/api/v1/progression/child?level=std_4&curriculum=tt_primary&period=term_1`,
    null,
    { 'Authorization': `Bearer ${jwt}` }
  );
  console.log(`  Status : ${progRes.status}`);

  if (progRes.status !== 200) {
    console.error('  ❌ Progression fetch failed:', progRes.body);
    process.exit(1);
  }

  const subjects  = progRes.body?.subjects ?? {};
  const mathTopics = subjects?.math?.topics ?? [];
  const match      = mathTopics.find(t => t.topic === topic);

  if (!match) {
    console.error(`  ❌ Topic "${topic}" NOT found in progression response.`);
    console.log('     Available math topics:', mathTopics.map(t => t.topic));
  } else {
    const icon = match.status === 'mastered' ? '✅' : '⚠️ ';
    console.log(`  ${icon} Topic found — status: ${match.status}, sessions: ${match.sessions_count}, best_score: ${match.best_score}`);
    if (match.status !== 'mastered') {
      console.log('     Expected "mastered" — check MASTERY_THRESHOLD (currently 80) vs score written (100)');
    }
  }

  console.log('\n── Summary ─────────────────────────────────────────────────');
  console.log(`  Sessions total : ${progRes.body?.summary?.sessions_total}`);
  console.log(`  Math mastered  : ${subjects?.math?.topics_mastered}/${subjects?.math?.topics_total}`);

  // Clean up test row
  console.log('\nStep 3 — Cleanup (delete test exam_session from Supabase)');
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { error } = await supabase.from('exam_sessions').delete().eq('session_id', `quest-${testSessionId}`);
  if (error) console.log('  ⚠️  Cleanup failed:', error.message);
  else       console.log('  ✅ Test row removed');
}

run().catch(err => { console.error('Fatal:', err); process.exit(1); });
