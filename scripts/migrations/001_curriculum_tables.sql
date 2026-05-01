-- ============================================================
-- Migration 001 — Curriculum Tables
-- Run in Supabase SQL Editor (knowly-production)
-- Phase A1 — Taxonomy Formalization
-- ============================================================

-- ── 1. curriculum_topics ─────────────────────────────────────────────────────
-- One row per learning objective (subtopic).
-- Replaces the TAXONOMY object in taxonomy.js.
-- Used by: RAG layer, quest generator, exam generator.

CREATE TABLE IF NOT EXISTS curriculum_topics (
  id             BIGSERIAL PRIMARY KEY,
  curriculum     TEXT        NOT NULL,          -- 'tt_primary'
  level          TEXT        NOT NULL,          -- 'std_4' | 'std_5'
  period         TEXT,                          -- 'term_1' | NULL for capstone levels
  subject        TEXT        NOT NULL,          -- 'math' | 'english' | 'science' | 'social_studies'
  module_number  INTEGER,                       -- 1-based module index (period-scoped only, NULL for capstone)
  module_title   TEXT,                          -- e.g. "Number Concepts and Place Value"
  sort_order     INTEGER     NOT NULL,          -- (moduleIndex * 100) + subtopicIndex
  topic          TEXT        NOT NULL,          -- the single learning objective string
  subtopics      JSONB       DEFAULT '[]',      -- reserved for future nested detail
  source         TEXT        DEFAULT 'manual',  -- 'manual' | 'pdf_import' | 'ai_generated'
  status         TEXT        DEFAULT 'active',  -- 'active' | 'archived'
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_curriculum_topics_unique
  ON curriculum_topics (curriculum, level, COALESCE(period, ''), subject, sort_order);

CREATE INDEX IF NOT EXISTS idx_curriculum_topics_lookup
  ON curriculum_topics (curriculum, level, subject, status);

CREATE INDEX IF NOT EXISTS idx_curriculum_topics_period
  ON curriculum_topics (curriculum, level, period, subject, status);


-- ── 2. curriculum_structure ──────────────────────────────────────────────────
-- One row per (curriculum, level, period, subject, trial_type, difficulty).
-- Replaces CURRICULUM_CONFIG + EXAM_CONFIG in taxonomy.js.
-- Used by: bufferManager (getAllCombinations), examGenerator (getExamConfig),
--          questGenerator (isCapstoneLevel), admin UI subject listing.

CREATE TABLE IF NOT EXISTS curriculum_structure (
  id                        BIGSERIAL PRIMARY KEY,
  curriculum_id             TEXT        NOT NULL,          -- 'tt_primary'
  display_name              TEXT,                          -- 'T&T Primary (SEA)'
  level_id                  TEXT        NOT NULL,          -- 'std_4' | 'std_5'
  level_label               TEXT,                         -- 'Standard 4'
  level_sort_order          INTEGER     DEFAULT 0,
  is_capstone               BOOLEAN     DEFAULT false,
  period_id                 TEXT,                          -- 'term_1' | NULL for capstone
  period_label              TEXT,                         -- 'Term 1' | NULL
  period_sort_order         INTEGER,
  subject                   TEXT        NOT NULL,          -- 'math'
  subject_status            TEXT        DEFAULT 'active',  -- 'active' | 'coming_soon'
  trial_type                TEXT        NOT NULL,          -- 'practice' | 'sea_paper'
  difficulty                TEXT,                          -- 'easy'|'medium'|'hard' | NULL for sea_paper
  question_count            INTEGER,
  time_per_question_seconds INTEGER,
  total_time_seconds        INTEGER,
  full_paper_question_count INTEGER,                       -- NULL for practice rows
  status                    TEXT        DEFAULT 'active',
  created_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_curriculum_structure_unique
  ON curriculum_structure (
    curriculum_id,
    level_id,
    COALESCE(period_id, ''),
    subject,
    trial_type,
    COALESCE(difficulty, '')
  );

CREATE INDEX IF NOT EXISTS idx_curriculum_structure_lookup
  ON curriculum_structure (curriculum_id, level_id, is_capstone, status);


-- ── 3. capstone_topic_weightings ─────────────────────────────────────────────
-- SEA paper topic distribution per subject.
-- Replaces capstone_subjects.topic_weightings in CURRICULUM_CONFIG.
-- Used by: examGenerator (buildSeaTopicWeightings), bufferManager.

CREATE TABLE IF NOT EXISTS capstone_topic_weightings (
  id             BIGSERIAL PRIMARY KEY,
  curriculum_id  TEXT        NOT NULL,  -- 'tt_primary'
  level_id       TEXT        NOT NULL,  -- 'std_5'
  subject        TEXT        NOT NULL,  -- 'math' | 'english'
  topic          TEXT        NOT NULL,  -- 'Number Theory', 'Fractions', etc.
  question_count INTEGER     NOT NULL,
  sort_order     INTEGER     DEFAULT 0,
  UNIQUE (curriculum_id, level_id, subject, topic)
);

CREATE INDEX IF NOT EXISTS idx_capstone_weights_lookup
  ON capstone_topic_weightings (curriculum_id, level_id, subject);


-- ── 4. updated_at trigger for curriculum_topics ──────────────────────────────

CREATE OR REPLACE FUNCTION knowly_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_curriculum_topics_updated_at ON curriculum_topics;
CREATE TRIGGER trg_curriculum_topics_updated_at
  BEFORE UPDATE ON curriculum_topics
  FOR EACH ROW EXECUTE PROCEDURE knowly_set_updated_at();
