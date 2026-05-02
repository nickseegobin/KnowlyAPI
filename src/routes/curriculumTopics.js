const express = require('express');
const router  = express.Router();
const getSupabase   = require('../config/supabase');
const { syncTopic, removeTopicVector, bulkSyncTopics } = require('../services/pineconeSync');

function fireSyncTopic(row) {
  setImmediate(() =>
    syncTopic(row).catch(err => console.error(`[curriculum-topics] Pinecone sync failed id=${row.id}: ${err.message}`))
  );
}

function fireRemoveTopic(id) {
  setImmediate(() =>
    removeTopicVector(id).catch(err => console.error(`[curriculum-topics] Pinecone remove failed id=${id}: ${err.message}`))
  );
}

function requireServerKey(req, res, next) {
  const key = req.headers['x-aep-server-key'];
  if (!key || key !== process.env.AEP_SERVER_KEY) {
    return res.status(401).json({ error: 'Server key required', code: 'unauthorized' });
  }
  next();
}

// ── GET /api/v1/curriculum-topics ─────────────────────────────────────────────
// Query: curriculum, level, period ('null' for capstone), subject, status, page, per_page
router.get('/', requireServerKey, async (req, res) => {
  const {
    curriculum = 'tt_primary',
    level, period, subject,
    status = 'active',
    page = 1, per_page = 200,
  } = req.query;

  try {
    let query = getSupabase()
      .from('curriculum_topics')
      .select('*', { count: 'exact' })
      .eq('curriculum', curriculum)
      .eq('status', status)
      .order('level',      { ascending: true })
      .order('subject',    { ascending: true })
      .order('sort_order', { ascending: true });

    if (level)   query = query.eq('level', level);
    if (subject) query = query.eq('subject', subject);

    if (period !== undefined) {
      if (period === 'null' || period === '') {
        query = query.is('period', null);
      } else {
        query = query.eq('period', period);
      }
    }

    const offset = (parseInt(page, 10) - 1) * parseInt(per_page, 10);
    query = query.range(offset, offset + parseInt(per_page, 10) - 1);

    const { data, error, count } = await query;
    if (error) throw error;

    return res.json({ items: data || [], total: count || 0 });
  } catch (err) {
    console.error('[curriculum-topics] list error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch curriculum topics', code: 'server_error' });
  }
});

// ── POST /api/v1/curriculum-topics ────────────────────────────────────────────
router.post('/', requireServerKey, async (req, res) => {
  const { curriculum, level, period, subject, module_number, module_title, sort_order, topic, source = 'manual' } = req.body;

  if (!curriculum || !level || !subject || !topic || sort_order === undefined || sort_order === null) {
    return res.status(400).json({ error: 'curriculum, level, subject, topic, sort_order are required', code: 'validation_error' });
  }

  try {
    const { data, error } = await getSupabase()
      .from('curriculum_topics')
      .insert({
        curriculum,
        level,
        period:        period || null,
        subject,
        module_number: module_number != null ? parseInt(module_number, 10) : null,
        module_title:  module_title || null,
        sort_order:    parseInt(sort_order, 10),
        topic,
        source,
        status: 'active',
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return res.status(409).json({ error: 'A topic at that sort_order already exists for this combination', code: 'conflict' });
      }
      throw error;
    }

    fireSyncTopic(data);
    return res.status(201).json(data);
  } catch (err) {
    console.error('[curriculum-topics] create error:', err.message);
    return res.status(500).json({ error: 'Failed to create topic', code: 'server_error' });
  }
});

// ── PATCH /api/v1/curriculum-topics/:id ──────────────────────────────────────
router.patch('/:id', requireServerKey, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id', code: 'validation_error' });

  const ALLOWED = ['module_title', 'sort_order', 'topic', 'status'];
  const updates = {};
  for (const key of ALLOWED) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields to update', code: 'validation_error' });
  }

  try {
    const { data, error } = await getSupabase()
      .from('curriculum_topics')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Topic not found', code: 'not_found' });

    if (data.status === 'archived') {
      fireRemoveTopic(data.id);
    } else {
      fireSyncTopic(data);
    }

    return res.json(data);
  } catch (err) {
    console.error('[curriculum-topics] update error:', err.message);
    return res.status(500).json({ error: 'Failed to update topic', code: 'server_error' });
  }
});

// ── DELETE /api/v1/curriculum-topics/:id ─────────────────────────────────────
// Archives the row (status = 'archived') — does not hard-delete.
router.delete('/:id', requireServerKey, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'Invalid id', code: 'validation_error' });

  try {
    const { data, error } = await getSupabase()
      .from('curriculum_topics')
      .update({ status: 'archived' })
      .eq('id', id)
      .select('id')
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Topic not found', code: 'not_found' });

    fireRemoveTopic(id);
    return res.json({ id, archived: true });
  } catch (err) {
    console.error('[curriculum-topics] archive error:', err.message);
    return res.status(500).json({ error: 'Failed to archive topic', code: 'server_error' });
  }
});

// ── POST /api/v1/curriculum-topics/sync ──────────────────────────────────────
// Bulk-upsert all active curriculum topics into Pinecone.
// Optional body: { curriculum, level, period, subject } to scope the backfill.
// Safe to run multiple times (upsert is idempotent).
router.post('/sync', requireServerKey, async (req, res) => {
  const { curriculum = 'tt_primary', level, period, subject } = req.body || {};

  try {
    let query = getSupabase()
      .from('curriculum_topics')
      .select('*')
      .eq('status', 'active')
      .eq('curriculum', curriculum)
      .order('sort_order', { ascending: true });

    if (level)   query = query.eq('level', level);
    if (subject) query = query.eq('subject', subject);
    if (period !== undefined) {
      if (period === null || period === 'null' || period === '') {
        query = query.is('period', null);
      } else {
        query = query.eq('period', period);
      }
    }

    const { data: rows, error } = await query;
    if (error) throw error;

    if (!rows || !rows.length) {
      return res.json({ synced: 0, failed: 0, total: 0, message: 'No active topics matched the filter.' });
    }

    const result = await bulkSyncTopics(rows);
    return res.json(result);

  } catch (err) {
    console.error('[curriculum-topics/sync] error:', err.message);
    return res.status(500).json({ error: 'Bulk sync failed', code: 'server_error', details: err.message });
  }
});

module.exports = router;
