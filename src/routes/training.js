const express = require('express');
const router = express.Router();
const { getIndex } = require('../services/pinecone');
const { getEmbedding } = require('../services/embeddings');

// All training routes require the server key.
function requireServerKey(req, res, next) {
  const key = req.headers['x-aep-server-key'];
  if (!key || key !== process.env.AEP_SERVER_KEY) {
    return res.status(401).json({ error: 'Server key required', code: 'unauthorized' });
  }
  next();
}

// ── POST /api/v1/training/upsert ─────────────────────────────────────────────
// Upsert a single vector into Pinecone.
// Body: { vector_id, content_text, metadata: { curriculum, level, period, subject, topic, subtopic } }
router.post('/upsert', requireServerKey, async (req, res) => {
  const { vector_id, content_text, metadata = {} } = req.body;

  if (!vector_id || !content_text) {
    return res.status(400).json({ error: 'vector_id and content_text are required', code: 'missing_fields' });
  }

  try {
    const embedding = await getEmbedding(content_text);

    const index = getIndex();
    await index.upsert([{
      id: vector_id,
      values: embedding,
      metadata: {
        curriculum: metadata.curriculum || 'tt_primary',
        level:      metadata.level      || '',
        period:     metadata.period     || null,
        subject:    metadata.subject    || '',
        topic:      metadata.topic      || '',
        subtopic:   metadata.subtopic   || null,
        text:       content_text,
      },
    }]);

    console.log(`[training/upsert] Upserted vector: ${vector_id}`);
    return res.json({ vector_id, status: 'upserted' });

  } catch (err) {
    console.error('[training/upsert] Error:', err);
    return res.status(500).json({ error: 'Failed to upsert vector', code: 'server_error', details: err.message });
  }
});

// ── GET /api/v1/training/list ─────────────────────────────────────────────────
// Lists all training vectors stored in Pinecone for a given curriculum.
// Uses list() to page through all vector IDs (by prefix), then fetch() in batches
// to retrieve metadata (including the original content_text stored as 'text').
//
// Query params:
//   curriculum (default: tt_primary)
//   level, period, subject — optional metadata filters applied client-side after fetch
//
// This is the source of truth — use it to re-sync the WP local mirror table.
router.get('/list', requireServerKey, async (req, res) => {
  const { curriculum = 'tt_primary', level, period, subject } = req.query;

  try {
    const index = getIndex();

    // Page through all vector IDs matching our curriculum prefix
    const allIds = [];
    let paginationToken;

    do {
      const listResult = await index.listPaginated({
        prefix:          `tm-${curriculum}`,
        limit:           100,
        paginationToken,
      });
      (listResult.vectors || []).forEach(v => allIds.push(v.id));
      paginationToken = listResult.pagination?.next;
    } while (paginationToken);

    if (!allIds.length) {
      return res.json({ items: [], total: 0 });
    }

    // Fetch metadata in batches of 100 (Pinecone per-request limit)
    const items = [];
    for (let i = 0; i < allIds.length; i += 100) {
      const batch    = allIds.slice(i, i + 100);
      const fetched  = await index.fetch(batch);
      for (const [id, vec] of Object.entries(fetched.records || {})) {
        const meta = vec.metadata || {};
        // Apply optional filters
        if (level   && meta.level   !== level)   continue;
        if (period  && meta.period  !== period)  continue;
        if (subject && meta.subject !== subject) continue;
        items.push({
          vector_id:    id,
          curriculum:   meta.curriculum || curriculum,
          level:        meta.level      || '',
          period:       meta.period     || null,
          subject:      meta.subject    || '',
          topic:        meta.topic      || '',
          subtopic:     meta.subtopic   || null,
          content_text: meta.text       || '',
        });
      }
    }

    console.log(`[training/list] Found ${items.length} vectors for ${curriculum}`);
    return res.json({ items, total: items.length });

  } catch (err) {
    console.error('[training/list] Error:', err);
    return res.status(500).json({ error: 'Failed to list training material', code: 'server_error', details: err.message });
  }
});

// ── DELETE /api/v1/training/delete ───────────────────────────────────────────
// Delete a single vector from Pinecone.
// Body: { vector_id }
router.delete('/delete', requireServerKey, async (req, res) => {
  const { vector_id } = req.body;

  if (!vector_id) {
    return res.status(400).json({ error: 'vector_id is required', code: 'missing_fields' });
  }

  try {
    const index = getIndex();
    await index.deleteOne(vector_id);

    console.log(`[training/delete] Deleted vector: ${vector_id}`);
    return res.json({ vector_id, status: 'deleted' });

  } catch (err) {
    console.error('[training/delete] Error:', err);
    return res.status(500).json({ error: 'Failed to delete vector', code: 'server_error', details: err.message });
  }
});

module.exports = router;
