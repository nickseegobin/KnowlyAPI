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
  try {
    await index.deleteOne({ id: vid });
  } catch (err) {
    if (err?.status === 404 || err?.message?.includes('404')) {
      console.log(`[pineconeSync] ${vid} already absent — skipping delete`);
      return vid;
    }
    throw err;
  }
  console.log(`[pineconeSync] deleted ${vid}`);
  return vid;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Upsert with retry — Voyage's embedding API rate-limits under sustained
// sequential calls with no backoff of its own; a bare bulk loop over more
// than a handful of rows sees the tail fail with no way to recover.
async function syncTopicWithRetry(row, maxAttempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await syncTopic(row);
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) await sleep(500 * attempt);
    }
  }
  throw lastErr;
}

// Bulk-upsert an array of curriculum_topics rows. Continues on individual
// errors (with retry+backoff per row) and a small pause between rows so a
// large scope doesn't blow through the embedding API's rate limit.
async function bulkSyncTopics(rows) {
  let synced = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      await syncTopicWithRetry(row);
      synced++;
    } catch (err) {
      console.error(`[pineconeSync] bulk: failed id=${row.id} — ${err.message}`);
      failed++;
    }
    await sleep(150);
  }

  console.log(`[pineconeSync] bulk done: ${synced} synced, ${failed} failed of ${rows.length}`);
  return { synced, failed, total: rows.length };
}

module.exports = { syncTopic, removeTopicVector, bulkSyncTopics, vectorId };
