const { getIndex }     = require('./pinecone');
const { getEmbedding } = require('./embeddings');

// Vector ID convention: ct-{supabase_id}
function vectorId(topicId) {
  return `ct-${topicId}`;
}

// Build the text chunk that gets embedded + stored in Pinecone metadata.
// Rich enough for semantic retrieval; metadata fields must match what
// getRAGChunks() filters on (curriculum, level, period, subject, topic).
function buildContentText(row) {
  return [
    row.topic,
    row.module_title ? `Module: ${row.module_title}` : null,
    `Level: ${row.level}`,
    row.period ? `Period: ${row.period}` : 'Period: capstone (year-round)',
    `Subject: ${row.subject}`,
    `Curriculum: ${row.curriculum}`,
  ].filter(Boolean).join('\n');
}

// Upsert one curriculum_topics row into Pinecone.
async function syncTopic(row) {
  const vid  = vectorId(row.id);
  const text = buildContentText(row);

  const embedding = await getEmbedding(text);
  const index     = getIndex();

  await index.upsert({ records: [{
    id:     vid,
    values: embedding,
    metadata: {
      curriculum:   row.curriculum || 'tt_primary',
      level:        row.level,
      period:       row.period     || null,
      subject:      row.subject,
      topic:        row.topic,
      module_title: row.module_title || null,
      text,
    },
  }] });

  console.log(`[pineconeSync] upserted ${vid}: ${row.topic}`);
  return vid;
}

// Remove a curriculum topic's vector from Pinecone (called on archive).
async function removeTopicVector(topicId) {
  const vid   = vectorId(topicId);
  const index = getIndex();
  await index.deleteOne({ id: vid });
  console.log(`[pineconeSync] deleted ${vid}`);
  return vid;
}

// Bulk-upsert an array of curriculum_topics rows. Continues on individual errors.
async function bulkSyncTopics(rows) {
  let synced = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      await syncTopic(row);
      synced++;
    } catch (err) {
      console.error(`[pineconeSync] bulk: failed id=${row.id} — ${err.message}`);
      failed++;
    }
  }

  console.log(`[pineconeSync] bulk done: ${synced} synced, ${failed} failed of ${rows.length}`);
  return { synced, failed, total: rows.length };
}

module.exports = { syncTopic, removeTopicVector, bulkSyncTopics, vectorId };
