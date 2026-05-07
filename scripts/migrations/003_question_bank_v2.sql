-- ============================================================
-- Phase 3B v2: Question Bank — module_number-based slots
--
-- Replaces the scope/scope_ref model (now question_bank_scope)
-- with a curriculum_topics-aligned model keyed by module_number.
--
-- Run in Supabase SQL editor after 002_question_bank_tables.sql
-- ============================================================

-- ── Retire old tables (rename, don't drop — data preserved) ──────────────────

ALTER TABLE question_bank       RENAME TO question_bank_scope;
ALTER TABLE question_bank_queue RENAME TO question_bank_scope_queue;

-- ── New question_bank: module_number-based slots ──────────────────────────────
-- One row per question. Slot = (curriculum, level, period, subject, module_number, difficulty).
-- module_number matches curriculum_topics.module_number.
-- fingerprint deduplicates identical questions on re-generation.

CREATE TABLE question_bank (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum     TEXT         NOT NULL DEFAULT 'tt_primary',
  level          TEXT         NOT NULL,
  period         TEXT,                        -- NULL for capstone levels
  subject        TEXT         NOT NULL,
  module_number  INTEGER      NOT NULL,       -- matches curriculum_topics.module_number
  module_title   TEXT         NOT NULL,       -- human label, e.g. "Place value up to 1,000,000"
  topic          TEXT         NOT NULL,       -- specific subtopic within the module
  question       TEXT         NOT NULL,
  options        JSONB        NOT NULL,       -- { "A": "...", "B": "...", "C": "...", "D": "..." }
  correct_answer TEXT         NOT NULL CHECK (correct_answer IN ('A','B','C','D')),
  explanation    TEXT,
  tip            TEXT,
  cognitive_level TEXT,
  difficulty     TEXT         NOT NULL CHECK (difficulty IN ('easy','medium','hard')),
  fingerprint    TEXT         NOT NULL,       -- SHA-256(question + options) for dedup
  status         TEXT         NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired','pending_review')),
  times_served   INTEGER      NOT NULL DEFAULT 0,
  last_served_at TIMESTAMPTZ,
  generated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Deduplication: one fingerprint per bank
CREATE UNIQUE INDEX question_bank_fingerprint_idx
  ON question_bank (fingerprint);

-- Slot lookup: fast queries for the admin board and assembly
CREATE INDEX question_bank_slot_idx
  ON question_bank (curriculum, level, subject, module_number, difficulty, status);

-- Freshness ordering for assembly: least-served first
CREATE INDEX question_bank_served_idx
  ON question_bank (times_served ASC, last_served_at ASC NULLS FIRST)
  WHERE status = 'active';
