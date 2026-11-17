import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isConversationDatabaseReady,
  openConversationDatabase,
} from "../../src/infra/sqlite/database";

/**
 * Creates a unique temporary directory for SQLite integration testing.
 */
async function createTemporaryDirectory(): Promise<string> {
  return mkdtemp(join(tmpdir(), "ai-learning-assistant-sqlite-"));
}

/**
 * Verifies the SQLite schema, readiness query, and message cascade deletion.
 */
async function verifiesConversationSchemaAndCascade(): Promise<void> {
  const temporaryDirectory = await createTemporaryDirectory();
  const database = openConversationDatabase(temporaryDirectory);
  try {
    expect(isConversationDatabaseReady(database)).toBe(true);
    expect(database.prepare("PRAGMA foreign_keys").get()).toMatchObject({
      foreign_keys: 1,
    });
    expect(database.prepare("PRAGMA journal_mode").get()).toMatchObject({
      journal_mode: "wal",
    });
    expect(database.prepare("PRAGMA busy_timeout").get()).toMatchObject({
      timeout: 5000,
    });
    database
      .prepare(
        "INSERT INTO conversations (id, user_id, course_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("conversation-1", "user-1", "course-1", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    database
      .prepare(
        "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run("message-1", "conversation-1", "user", "Question", "2026-01-01T00:00:01.000Z");

    database.prepare("DELETE FROM conversations WHERE id = ?").run("conversation-1");
    const remaining = database
      .prepare("SELECT COUNT(*) AS count FROM messages")
      .get();
    expect(remaining).toMatchObject({ count: 0 });
  } finally {
    database.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

describe("SQLite conversation storage", () => {
  test(
    "creates the schema and cascades message deletion with its conversation",
    verifiesConversationSchemaAndCascade,
  );
});
