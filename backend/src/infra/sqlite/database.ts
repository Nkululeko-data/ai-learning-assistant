import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const schema = `
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    course_id TEXT NOT NULL,
    title TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TEXT NOT NULL,
    execution_id TEXT,
    intent TEXT,
    grounding_status TEXT CHECK(grounding_status IN ('grounded', 'insufficient', 'unverified')),
    answer_source TEXT CHECK(answer_source IN ('course_material', 'general_knowledge')),
    cited_chunk_ids TEXT,
    cited_document_ids TEXT,
    retrieval_score_top REAL,
    question_embedding_ref TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_conv_user_course_updated
    ON conversations(user_id, course_id, updated_at DESC);
  CREATE INDEX IF NOT EXISTS idx_msg_conv_created
    ON messages(conversation_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_msg_grounding
    ON messages(grounding_status) WHERE grounding_status IS NOT NULL;

  CREATE TABLE IF NOT EXISTS chat_daily_usage (
    user_id TEXT NOT NULL,
    usage_date TEXT NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 0,
    token_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(user_id, usage_date)
  );
`;

/**
 * Opens and initializes the SQLite conversation database.
 */
export function openConversationDatabase(dataDirectory: string): DatabaseSync {
  const databaseDirectory = join(dataDirectory, "sqlite");
  mkdirSync(databaseDirectory, { recursive: true });

  const database = new DatabaseSync(join(databaseDirectory, "conversations.db"));
  database.exec(schema);
  const messageColumns = database
    .prepare("PRAGMA table_info(messages)")
    .all() as Array<{ name: string }>;
  if (!messageColumns.some((column) => column.name === "citations")) {
    database.exec("ALTER TABLE messages ADD COLUMN citations TEXT");
  }
  if (!messageColumns.some((column) => column.name === "answer_source")) {
    database.exec(
      "ALTER TABLE messages ADD COLUMN answer_source TEXT CHECK(answer_source IN ('course_material', 'general_knowledge'))",
    );
  }
  return database;
}

/**
 * Confirms that the database connection can execute a lightweight query.
 */
export function isConversationDatabaseReady(
  database: DatabaseSync,
): boolean {
  const result: unknown = database.prepare("SELECT 1 AS ready").get();
  return (
    typeof result === "object" &&
    result !== null &&
    "ready" in result &&
    result.ready === 1
  );
}
