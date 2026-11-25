CREATE TABLE conversations (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  course_id uuid NOT NULL,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX conversations_user_course_updated_idx
  ON conversations(user_id, course_id, updated_at DESC);

CREATE TABLE messages (
  id uuid PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  execution_id uuid,
  intent text,
  grounding_status text CHECK (
    grounding_status IN ('grounded', 'insufficient', 'unverified')
  ),
  cited_chunk_ids text[] NOT NULL DEFAULT '{}',
  cited_document_ids text[] NOT NULL DEFAULT '{}',
  retrieval_score_top double precision,
  question_embedding_ref text
);

CREATE INDEX messages_conversation_created_idx
  ON messages(conversation_id, created_at);

CREATE INDEX messages_grounding_status_idx
  ON messages(grounding_status)
  WHERE grounding_status IS NOT NULL;
