CREATE TABLE IF NOT EXISTS user_id_aliases (
  legacy_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_id_aliases_not_self CHECK (legacy_id <> user_id)
);

CREATE INDEX IF NOT EXISTS user_id_aliases_user_id_idx
  ON user_id_aliases(user_id);
