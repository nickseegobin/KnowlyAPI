// ============================================================
// Seed: curriculum_structure + capstone_topic_weightings
// Reads CURRICULUM_CONFIG + EXAM_CONFIG from taxonomy.js and
// inserts into Supabase.
//
// Run: node scripts/seed-curriculum-structure.js
// Requires .env with SUPABASE_URL + SUPABASE_SERVICE_KEY
// ============================================================

require('dotenv').config();

const { CURRICULUM_CONFIG, EXAM_CONFIG } = require('../src/config/taxonomy');
const getSupabase = require('../src/config/supabase');

function buildStructureRows() {
  const structureRows = [];
  const weightingRows = [];

  for (const [curriculumId, config] of Object.entries(CURRICULUM_CONFIG)) {
    // Skip placeholder curricula that have no exam config (caribbean_cxc, north_american)
    if (!EXAM_CONFIG[curriculumId]) continue;

    const examConfig = EXAM_CONFIG[curriculumId];

    config.levels.forEach((levelConfig, levelSortOrder) => {
      const { id: levelId, label: levelLabel, is_capstone, has_periods } = levelConfig;

      // Period list: period-scoped levels use config.periods; capstone uses [null]
      const periods = has_periods ? config.periods : [null];

      periods.forEach((periodId, periodIndex) => {
        const periodLabel = periodId && config.period_label
          ? `${config.period_label} ${parseInt(periodId.split('_')[1], 10)}`
          : null;

        config.subjects.forEach(subject => {
          // ── Practice rows (easy / medium / hard) ──────────────────────────
          for (const difficulty of ['easy', 'medium', 'hard']) {
            const dc = examConfig.practice?.[difficulty];
            if (!dc) continue;

            structureRows.push({
              curriculum_id:             curriculumId,
              display_name:              config.display_name,
              level_id:                  levelId,
              level_label:               levelLabel,
              level_sort_order:          levelSortOrder,
              is_capstone,
              period_id:                 periodId,
              period_label:              periodLabel,
              period_sort_order:         periodId ? periodIndex : null,
              subject,
              subject_status:            'active',
              trial_type:                'practice',
              difficulty,
              question_count:            dc.question_count,
              time_per_question_seconds: dc.time_per_question_seconds,
              total_time_seconds:        dc.total_time_seconds,
              full_paper_question_count: null,
            });
          }

          // ── SEA paper row (capstone subjects only) ─────────────────────────
          if (is_capstone && examConfig.sea_paper?.[subject]) {
            const sc = examConfig.sea_paper[subject];
            structureRows.push({
              curriculum_id:             curriculumId,
              display_name:              config.display_name,
              level_id:                  levelId,
              level_label:               levelLabel,
              level_sort_order:          levelSortOrder,
              is_capstone,
              period_id:                 null,
              period_label:              null,
              period_sort_order:         null,
              subject,
              subject_status:            'active',
              trial_type:                'sea_paper',
              difficulty:                null,
              question_count:            sc.question_count,
              time_per_question_seconds: sc.time_per_question_seconds,
              total_time_seconds:        sc.total_time_seconds,
              full_paper_question_count: sc.question_count,
            });
          }
        });
      });

      // ── Capstone topic weightings ──────────────────────────────────────────
      if (is_capstone && config.capstone_subjects) {
        for (const [subject, capConfig] of Object.entries(config.capstone_subjects)) {
          if (!capConfig.topic_weightings) continue;

          Object.entries(capConfig.topic_weightings).forEach(([topic, count], sortOrder) => {
            weightingRows.push({
              curriculum_id: curriculumId,
              level_id:      levelId,
              subject,
              topic,
              question_count: count,
              sort_order:    sortOrder,
            });
          });
        }
      }
    });
  }

  return { structureRows, weightingRows };
}

async function seed() {
  const supabase = getSupabase();
  const { structureRows, weightingRows } = buildStructureRows();

  // ── curriculum_structure ──────────────────────────────────────────────────
  console.log(`\ncurriculum_structure seed — ${structureRows.length} rows\n`);

  const byCombo = structureRows.reduce((acc, r) => {
    const key = `${r.curriculum_id}/${r.level_id}/${r.period_id || 'capstone'}/${r.subject}/${r.trial_type}/${r.difficulty || 'n/a'}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  Object.keys(byCombo).forEach(key => console.log(`  ${key}`));
  console.log('');

  const { error: se } = await supabase.from('curriculum_structure').insert(structureRows);
  if (se) {
    console.error('✗ curriculum_structure insert failed:', se.message);
    process.exit(1);
  }
  console.log('✓ curriculum_structure seeded.\n');

  // ── capstone_topic_weightings ─────────────────────────────────────────────
  console.log(`capstone_topic_weightings seed — ${weightingRows.length} rows\n`);
  weightingRows.forEach(r => console.log(`  ${r.curriculum_id}/${r.level_id}/${r.subject}: ${r.topic} (${r.question_count}q)`));
  console.log('');

  const { error: we } = await supabase.from('capstone_topic_weightings').insert(weightingRows);
  if (we) {
    console.error('✗ capstone_topic_weightings insert failed:', we.message);
    process.exit(1);
  }
  console.log('✓ capstone_topic_weightings seeded.\n');
}

seed().catch(err => {
  console.error('Seed error:', err.message);
  process.exit(1);
});
