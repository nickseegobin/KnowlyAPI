-- Migration 004: Quest progression support
--
-- exam_sessions.package_id is NOT NULL, but quest sessions have no package.
-- Make it nullable so quest completions can be recorded without a package reference.

ALTER TABLE exam_sessions
  ALTER COLUMN package_id DROP NOT NULL;
