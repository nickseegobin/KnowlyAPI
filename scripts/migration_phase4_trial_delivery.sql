-- Phase 4: Smart Trial Delivery — Supabase Migration
-- Run once in the Supabase SQL editor.

-- ── 1. trial_packs: add branch + sequence number + module_assignments ──────────

ALTER TABLE trial_packs
  ADD COLUMN IF NOT EXISTS branch               TEXT,
  ADD COLUMN IF NOT EXISTS pack_sequence_number INT,
  ADD COLUMN IF NOT EXISTS module_assignments   JSONB;  -- for dynamic packs only

-- Backfill branch from difficulty for all existing packs
UPDATE trial_packs SET branch = difficulty WHERE branch IS NULL AND difficulty IS NOT NULL;

-- Index for next-pack delivery lookup
CREATE INDEX IF NOT EXISTS idx_trial_packs_next_pack
  ON trial_packs (curriculum, level, subject, branch, pack_sequence_number ASC)
  WHERE status = 'active';

-- Partial index for period scoping (null period = Capstone)
CREATE INDEX IF NOT EXISTS idx_trial_packs_next_pack_period
  ON trial_packs (curriculum, level, period, subject, branch, pack_sequence_number ASC)
  WHERE status = 'active' AND period IS NOT NULL;

-- ── 2. child_pack_history ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS child_pack_history (
  id           UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
  child_id     BIGINT      NOT NULL,          -- WP user ID
  pack_id      UUID        NOT NULL,          -- references trial_packs(id)
  session_id   TEXT,                          -- exam session identifier
  score        NUMERIC(5,2),                  -- percentage score at completion
  completed_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (child_id, pack_id)                  -- one completion record per child per pack
);

-- Primary lookup: what has this child completed?
CREATE INDEX IF NOT EXISTS idx_child_pack_history_child
  ON child_pack_history (child_id);

-- Pack delivery: who has played a given pack?
CREATE INDEX IF NOT EXISTS idx_child_pack_history_pack
  ON child_pack_history (pack_id);

-- History display: ordered by completion time
CREATE INDEX IF NOT EXISTS idx_child_pack_history_child_time
  ON child_pack_history (child_id, completed_at DESC);
