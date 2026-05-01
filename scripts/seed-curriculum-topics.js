// ============================================================
// Seed: curriculum_topics
// Reads TAXONOMY from taxonomy.js and inserts one row per
// learning objective (subtopic) into Supabase.
//
// Run: node scripts/seed-curriculum-topics.js
// Requires .env with SUPABASE_URL + SUPABASE_SERVICE_KEY
// ============================================================

require('dotenv').config();

const { TAXONOMY, CURRICULUM_CONFIG, isCapstoneLevel } = require('../src/config/taxonomy');
const getSupabase = require('../src/config/supabase');

const CURRICULUM = 'tt_primary';
const BATCH_SIZE = 50;

function buildRows() {
  const rows = [];

  for (const [levelId, levelData] of Object.entries(TAXONOMY)) {
    const capstone = isCapstoneLevel(CURRICULUM, levelId);

    if (capstone) {
      // Capstone levels (std_5): flat array per subject, no period nesting
      // TAXONOMY.std_5.math = [ { topic: "...", subtopics: [...] }, ... ]
      for (const [subjectKey, topicList] of Object.entries(levelData)) {
        topicList.forEach((mod, modIndex) => {
          mod.subtopics.forEach((subtopic, subIndex) => {
            rows.push({
              curriculum:    CURRICULUM,
              level:         levelId,
              period:        null,
              subject:       subjectKey,
              module_number: null,                          // no module numbering for capstone
              module_title:  mod.topic,
              sort_order:    (modIndex * 100) + subIndex,
              topic:         subtopic,
              source:        'manual',
              status:        'active',
            });
          });
        });
      }
    } else {
      // Period-scoped levels (std_4):
      // TAXONOMY.std_4.math.term_1 = [ { topic: "...", subtopics: [...] }, ... ]
      for (const [subjectKey, periodMap] of Object.entries(levelData)) {
        for (const [periodId, modules] of Object.entries(periodMap)) {
          modules.forEach((mod, modIndex) => {
            mod.subtopics.forEach((subtopic, subIndex) => {
              rows.push({
                curriculum:    CURRICULUM,
                level:         levelId,
                period:        periodId,
                subject:       subjectKey,
                module_number: modIndex + 1,
                module_title:  mod.topic,
                sort_order:    (modIndex * 100) + subIndex,
                topic:         subtopic,
                source:        'manual',
                status:        'active',
              });
            });
          });
        }
      }
    }
  }

  return rows;
}

async function seed() {
  const supabase = getSupabase();
  const rows = buildRows();

  console.log(`\ncurriculum_topics seed — ${rows.length} rows across ${CURRICULUM}\n`);

  // Print a breakdown before inserting
  const byLevel = rows.reduce((acc, r) => {
    const key = `${r.level}/${r.period || 'capstone'}/${r.subject}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  Object.entries(byLevel).forEach(([key, count]) => console.log(`  ${key}: ${count} topics`));
  console.log('');

  // Insert in batches
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from('curriculum_topics').insert(batch);

    if (error) {
      console.error(`✗ Batch ${Math.floor(i / BATCH_SIZE) + 1} failed:`, error.message);
      process.exit(1);
    }

    console.log(`  ✓ Rows ${i + 1}–${Math.min(i + BATCH_SIZE, rows.length)}`);
  }

  console.log('\n✓ curriculum_topics seed complete.\n');
}

seed().catch(err => {
  console.error('Seed error:', err.message);
  process.exit(1);
});
