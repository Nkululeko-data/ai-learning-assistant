CREATE TABLE chat_daily_usage (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  usage_date date NOT NULL,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  token_count integer NOT NULL DEFAULT 0 CHECK (token_count >= 0),
  PRIMARY KEY (user_id, usage_date)
);
