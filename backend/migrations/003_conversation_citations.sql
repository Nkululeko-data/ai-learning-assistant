ALTER TABLE messages
  ADD COLUMN citations jsonb NOT NULL DEFAULT '[]'::jsonb;
