const { generateExamPackage, storePackage } = require('./examGenerator');
const { CURRICULUM_CONFIG, TAXONOMY, isCapstoneLevel, getCapstoneSubjectConfig, supportsSeaPaper } = require('../config/taxonomy');
const getSupabase = require('../config/supabase');

// ── Config ────────────────────────────────────────────────────────────────────

const BUFFER_ENABLED = process.env.BUFFER_ENABLED !== 'false';
const BUFFER_THRESHOLD = parseInt(process.env.BUFFER_THRESHOLD || '2', 10);
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_BACKOFF_BASE_MS = 2000;

// ── Count unserved packages ahead of the furthest user pointer ───────────────

async function countAheadOfFurthestPointer(curriculum, level, period, subject, trial_type, difficulty, topic) {
  // Find the max next_package_index for this combination across all users
  let progressQuery = getSupabase()
    .from('user_progress')
    .select('next_package_index')
    .eq('curriculum', curriculum)
    .eq('level', level)
    .eq('subject', subject)
    .eq('trial_type', trial_type)
    .order('next_package_index', { ascending: false })
    .limit(1);

  if (period) {
    progressQuery = progressQuery.eq('period', period);
  } else {
    progressQuery = progressQuery.is('period', null);
  }

  if (difficulty) {
    progressQuery = progressQuery.eq('difficulty', difficulty);
  } else {
    progressQuery = progressQuery.is('difficulty', null);
  }

  if (topic) {
    progressQuery = progressQuery.eq('topic', topic);
  } else {
    progressQuery = progressQuery.is('topic', null);
  }

  const { data: progressRows } = await progressQuery;
  const furthestPointer = progressRows?.[0]?.next_package_index || 0;

  // Count approved packages with sequence_index >= furthestPointer
  let poolQuery = getSupabase()
    .from('exam_pool')
    .select('id', { count: 'exact', head: true })
    .eq('curriculum', curriculum)
    .eq('level', level)
    .eq('subject', subject)
    .eq('trial_type', trial_type)
    .eq('status', 'approved')
    .gte('sequence_index', furthestPointer);

  if (period) {
    poolQuery = poolQuery.eq('period', period);
  } else {
    poolQuery = poolQuery.is('period', null);
  }

  if (difficulty) {
    poolQuery = poolQuery.eq('difficulty', difficulty);
  } else {
    poolQuery = poolQuery.is('difficulty', null);
  }

  if (topic) {
    poolQuery = poolQuery.eq('topic', topic);
  } else {
    poolQuery = poolQuery.is('topic', null);
  }

  const { count } = await poolQuery;
  return count || 0;
}

// ── Generate and store one package for a combination ─────────────────────────

async function generateAndStore(combo) {
  const { curriculum, level, period, subject, difficulty, trial_type, topic } = combo;
  const { packageData, fingerprints } = await generateExamPackage({
    curriculum, level, period, subject, difficulty, trial_type, topic
  });
  await storePackage({ packageData, fingerprints, status: 'approved', source: 'auto_generated' });
  console.log(`[buffer] Generated: ${packageData.package_id}`);
}

// ── Log failure to Supabase ───────────────────────────────────────────────────

async function logFailure({ curriculum, level, period, subject, difficulty, trial_type, topic, error }) {
  try {
    await getSupabase().from('generation_failures').insert({
      curriculum: curriculum || 'tt_primary',
      level,
      period: period || null,
      subject,
      difficulty: difficulty || null,
      trial_type: trial_type || 'practice',
      topic: topic || null,
      error_message: error,
      attempted_at: new Date().toISOString(),
      retried: false,
      retry_count: 0
    });
  } catch (logErr) {
    console.error('[buffer] Failed to log generation failure:', logErr.message);
  }
}

// ── Check and refill after a serve event ─────────────────────────────────────

async function checkAndRefill(combo) {
  if (!BUFFER_ENABLED) return;

  const { curriculum, level, period, subject, difficulty, trial_type, topic } = combo;

  try {
    const ahead = await countAheadOfFurthestPointer(
      curriculum, level, period, subject, trial_type, difficulty, topic
    );

    if (ahead < BUFFER_THRESHOLD) {
      console.log(`[buffer] Low on ${level}/${period || 'null'}/${subject}/${trial_type}/${difficulty || 'null'} (${ahead}/${BUFFER_THRESHOLD}) — generating...`);
      await generateAndStore(combo);
    }
  } catch (err) {
    console.error('[buffer] checkAndRefill error:', err.message);
    await logFailure({ ...combo, error: err.message });
  }
}

// ── Build all combinations for a curriculum ───────────────────────────────────

function getAllCombinations(curriculumId = 'tt_primary') {
  const config = CURRICULUM_CONFIG[curriculumId];
  if (!config) return [];

  const combos = [];

  for (const levelObj of config.levels) {
    const { id: level, has_periods, is_capstone } = levelObj;

    for (const subject of config.subjects) {
      if (is_capstone) {
        // Topic practice (each topic × each difficulty)
        const subjectTopics = TAXONOMY[level]?.[subject.replace('-', '_')] || [];
        for (const topicObj of subjectTopics) {
          for (const diff of ['easy', 'medium', 'hard']) {
            combos.push({
              curriculum: curriculumId,
              level,
              period: null,
              subject,
              trial_type: 'practice',
              difficulty: diff,
              topic: topicObj.topic
            });
          }
        }

        // Full SEA paper (only subjects that support it)
        if (supportsSeaPaper(curriculumId, subject)) {
          combos.push({
            curriculum: curriculumId,
            level,
            period: null,
            subject,
            trial_type: 'sea_paper',
            difficulty: null,
            topic: null
          });
        }

      } else if (has_periods) {
        // Period-scoped practice
        for (const period of config.periods) {
          for (const diff of ['easy', 'medium', 'hard']) {
            combos.push({
              curriculum: curriculumId,
              level,
              period,
              subject,
              trial_type: 'practice',
              difficulty: diff,
              topic: null
            });
          }
        }
      } else {
        // No periods, no capstone (e.g. future CXC Form 4)
        for (const diff of ['easy', 'medium', 'hard']) {
          combos.push({
            curriculum: curriculumId,
            level,
            period: null,
            subject,
            trial_type: 'practice',
            difficulty: diff,
            topic: null
          });
        }
      }
    }
  }

  return combos;
}

// ── Nightly proactive scan ─────────────────────────────────────────────────────
// Called by POST /api/v1/cron/buffer-scan (secured by AEP_SERVER_KEY)

async function nightlyScan(curriculumId = 'tt_primary') {
  if (!BUFFER_ENABLED) {
    console.log('[buffer] BUFFER_ENABLED=false — skipping nightly scan');
    return { skipped: true };
  }

  const combos = getAllCombinations(curriculumId);
  let generated = 0;
  let errors = 0;

  for (const combo of combos) {
    try {
      const ahead = await countAheadOfFurthestPointer(
        combo.curriculum, combo.level, combo.period,
        combo.subject, combo.trial_type, combo.difficulty, combo.topic
      );

      if (ahead < BUFFER_THRESHOLD) {
        const needed = BUFFER_THRESHOLD - ahead;
        for (let i = 0; i < needed; i++) {
          await generateAndStore(combo);
          generated++;
        }
      }
    } catch (err) {
      console.error(`[buffer] nightlyScan error for ${JSON.stringify(combo)}:`, err.message);
      await logFailure({ ...combo, error: err.message });
      errors++;
    }
  }

  console.log(`[buffer] Nightly scan complete: ${generated} generated, ${errors} errors`);
  return { combinations_checked: combos.length, generated, errors };
}

// ── Retry generation failures ──────────────────────────────────────────────────
// Called by POST /api/v1/cron/retry-failures (secured by AEP_SERVER_KEY)

async function retryFailures() {
  const { data: failures, error } = await getSupabase()
    .from('generation_failures')
    .select('*')
    .eq('retried', false)
    .lt('retry_count', MAX_RETRY_ATTEMPTS)
    .order('attempted_at', { ascending: true })
    .limit(20);

  if (error) throw error;
  if (!failures || failures.length === 0) {
    console.log('[buffer] No pending failures to retry');
    return { retried: 0, succeeded: 0, failed: 0 };
  }

  let succeeded = 0;
  let failed = 0;

  for (const failure of failures) {
    const backoffMs = RETRY_BACKOFF_BASE_MS * Math.pow(2, failure.retry_count);
    await new Promise(resolve => setTimeout(resolve, backoffMs));

    const combo = {
      curriculum: failure.curriculum || 'tt_primary',
      level: failure.level,
      period: failure.period || null,
      subject: failure.subject,
      difficulty: failure.difficulty || null,
      trial_type: failure.trial_type || 'practice',
      topic: failure.topic || null
    };

    try {
      await generateAndStore(combo);

      await getSupabase()
        .from('generation_failures')
        .update({ retried: true, retry_count: failure.retry_count + 1 })
        .eq('id', failure.id);

      succeeded++;
      console.log(`[buffer] Retry succeeded for failure #${failure.id}`);
    } catch (err) {
      await getSupabase()
        .from('generation_failures')
        .update({ retry_count: failure.retry_count + 1 })
        .eq('id', failure.id);

      failed++;
      console.error(`[buffer] Retry failed for failure #${failure.id}:`, err.message);
    }
  }

  console.log(`[buffer] Retry run complete: ${succeeded} succeeded, ${failed} failed`);
  return { retried: failures.length, succeeded, failed };
}

module.exports = { checkAndRefill, nightlyScan, retryFailures, getAllCombinations };
