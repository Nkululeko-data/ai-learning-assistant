CREATE TABLE learning_summaries (
  id uuid PRIMARY KEY,
  payload jsonb NOT NULL
);
CREATE INDEX learning_summaries_course_idx
  ON learning_summaries ((payload->>'courseId'));
CREATE INDEX learning_summaries_owner_idx
  ON learning_summaries ((payload->>'ownerId'));
CREATE UNIQUE INDEX learning_summaries_source_version_idx
  ON learning_summaries (
    (payload->>'courseId'),
    (COALESCE(payload->>'ownerId', '')),
    (payload->>'sourceHash'),
    ((payload->>'version')::integer)
  );

CREATE TABLE flashcards (
  id uuid PRIMARY KEY,
  payload jsonb NOT NULL
);
CREATE INDEX flashcards_course_idx ON flashcards ((payload->>'courseId'));
CREATE INDEX flashcards_owner_idx ON flashcards ((payload->>'ownerId'));
CREATE UNIQUE INDEX flashcards_source_version_idx
  ON flashcards (
    (payload->>'courseId'),
    (COALESCE(payload->>'ownerId', '')),
    (payload->>'sourceHash'),
    ((payload->>'version')::integer)
  );

CREATE TABLE quizzes (
  id uuid PRIMARY KEY,
  payload jsonb NOT NULL
);
CREATE INDEX quizzes_course_idx ON quizzes ((payload->>'courseId'));
CREATE UNIQUE INDEX quizzes_lineage_version_idx
  ON quizzes ((payload->>'lineageId'), ((payload->>'version')::integer));

CREATE TABLE quiz_attempts (
  id uuid PRIMARY KEY,
  payload jsonb NOT NULL
);
CREATE INDEX quiz_attempts_quiz_idx ON quiz_attempts ((payload->>'quizId'));
CREATE INDEX quiz_attempts_user_idx ON quiz_attempts ((payload->>'userId'));
CREATE INDEX quiz_attempts_course_idx ON quiz_attempts ((payload->>'courseId'));

CREATE TABLE feedback (
  id uuid PRIMARY KEY,
  payload jsonb NOT NULL
);
CREATE UNIQUE INDEX feedback_message_user_idx
  ON feedback ((payload->>'messageId'), (payload->>'userId'));
CREATE INDEX feedback_course_idx ON feedback ((payload->>'courseId'));

CREATE TABLE activity_events (
  id uuid PRIMARY KEY,
  payload jsonb NOT NULL
);
CREATE UNIQUE INDEX activity_events_dedupe_idx
  ON activity_events ((payload->>'dedupeKey'));
CREATE INDEX activity_events_course_idx
  ON activity_events ((payload->>'courseId'));

CREATE TABLE gap_reports (
  id uuid PRIMARY KEY,
  payload jsonb NOT NULL
);
CREATE INDEX gap_reports_course_created_idx
  ON gap_reports ((payload->>'courseId'), ((payload->>'createdAt') DESC));

CREATE TABLE config_versions (
  id uuid PRIMARY KEY,
  payload jsonb NOT NULL
);
CREATE INDEX config_versions_version_idx
  ON config_versions (((payload->>'version')::integer) DESC);

CREATE TABLE agent_executions (
  id uuid PRIMARY KEY,
  payload jsonb NOT NULL
);
CREATE INDEX agent_executions_created_idx
  ON agent_executions (((payload->>'createdAt') DESC));
CREATE INDEX agent_executions_execution_idx
  ON agent_executions ((payload->>'executionId'));

CREATE TABLE chat_daily_usage (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  usage_date date NOT NULL,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  token_count bigint NOT NULL DEFAULT 0 CHECK (token_count >= 0),
  PRIMARY KEY (user_id, usage_date)
);

CREATE TABLE distributed_rate_limits (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  hit_count integer NOT NULL CHECK (hit_count >= 0)
);
