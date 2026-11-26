-- Reconstructed from the Neon v9 catalog; original migration SQL was unavailable.
ALTER TABLE messages
  ADD COLUMN answer_source text
    CHECK (answer_source IN ('course_material', 'general_knowledge'));

ALTER TABLE chat_daily_usage
  ALTER COLUMN token_count TYPE bigint;
