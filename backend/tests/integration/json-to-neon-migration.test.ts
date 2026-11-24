import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Pool } from "pg";
import { openConversationDatabase } from "../../src/infra/sqlite/database";
import { migrateJsonToNeon } from "../../scripts/migrate-json-to-neon";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithTestDatabase = testDatabaseUrl ? describe : describe.skip;
const collectionNames = [
  "roles",
  "permissions",
  "role_permissions",
  "users",
  "user_permission_overrides",
  "coach_requests",
  "refresh_tokens",
  "audit_logs",
  "courses",
  "enrolments",
];
let temporaryRoot: string | undefined;

afterEach(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

async function createDataDirectory(): Promise<string> {
  temporaryRoot = await mkdtemp(join(tmpdir(), "ai-learning-assistant-json-migration-"));
  const dataDirectory = join(temporaryRoot, "data");
  const jsonDirectory = join(dataDirectory, "json");
  await mkdir(jsonDirectory, { recursive: true });
  await Promise.all(
    collectionNames.map((name) =>
      writeFile(join(jsonDirectory, `${name}.json`), "[]", "utf8"),
    ),
  );
  return dataDirectory;
}

test("dry run backs up and validates source files without requiring PostgreSQL", async () => {
  const dataDirectory = await createDataDirectory();
  const result = await migrateJsonToNeon({ dataDirectory, dryRun: true });

  expect(result.dryRun).toBe(true);
  expect(result.tables).toHaveLength(12);
  expect(result.tables.every((table) => table.sourceCount === 0)).toBe(true);
  expect(result.tables.every((table) => table.targetCount === null)).toBe(true);
  expect(await readdir(join(result.backupDirectory, "json"))).toHaveLength(10);
});

test("dry run validates SQLite conversation arrays and complete citations", async () => {
  const dataDirectory = await createDataDirectory();
  const database = openConversationDatabase(dataDirectory);
  const userId = randomUUID();
  const conversationId = randomUUID();
  const courseId = randomUUID();
  const documentId = randomUUID();
  const now = new Date().toISOString();
  try {
    database
      .prepare(
        `INSERT INTO conversations
         (id, user_id, course_id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(conversationId, userId, courseId, "A conversation", now, now);
    database
      .prepare(
        `INSERT INTO messages
         (id, conversation_id, role, content, created_at, cited_chunk_ids,
          cited_document_ids, citations)
         VALUES (?, ?, 'assistant', ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        conversationId,
        "A response",
        now,
        JSON.stringify(["chunk-1"]),
        JSON.stringify([documentId]),
        JSON.stringify([
          {
            marker: 1,
            chunkId: "chunk-1",
            documentId,
            documentName: "Source document",
            pageStart: 1,
            pageEnd: 1,
            section: null,
          },
        ]),
      );
  } finally {
    database.close();
  }

  const result = await migrateJsonToNeon({ dataDirectory, dryRun: true });
  expect(result.tables.find((table) => table.table === "conversations"))
    .toMatchObject({ sourceCount: 1 });
  expect(result.tables.find((table) => table.table === "messages"))
    .toMatchObject({ sourceCount: 1 });
  expect(await readdir(join(result.backupDirectory, "sqlite"))).toContain(
    "conversations.db",
  );
});

test("invalid records are rejected without exposing field values, after backup", async () => {
  const dataDirectory = await createDataDirectory();
  const jsonDirectory = join(dataDirectory, "json");
  await writeFile(
    join(jsonDirectory, "users.json"),
    JSON.stringify([{ id: "invalid-id", email: "private@example.test" }]),
    "utf8",
  );

  const failure = await migrateJsonToNeon({
    dataDirectory,
    dryRun: true,
  }).then(
    () => null,
    (error: unknown) => error,
  );
  expect(failure).toBeInstanceOf(Error);
  if (!(failure instanceof Error)) throw new Error("Expected invalid source error");
  expect(failure.message).toContain("Invalid record in users.json (row 1)");
  expect(failure.message).not.toContain("private@example.test");
  const backups = await readdir(join(dataDirectory, "backups"));
  expect(backups).toHaveLength(1);
});

describeWithTestDatabase("JSON-to-Neon migration", () => {
  let adminPool: Pool;
  let migrationPool: Pool;
  let schemaName: string;
  let dataDirectory: string;

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error("TEST_DATABASE_URL is required for JSON migration tests");
    }
    adminPool = new Pool({ connectionString: testDatabaseUrl });
    schemaName = `json_migration_${randomUUID().replace(/-/g, "")}`;
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    migrationPool = new Pool({
      connectionString: testDatabaseUrl,
      options: `-c search_path=${schemaName}`,
    });
  });

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "ai-learning-assistant-json-pg-"));
    dataDirectory = join(temporaryRoot, "data");
    await writeCompleteSourceFixture(dataDirectory);
  });

  afterAll(async () => {
    if (migrationPool) await migrationPool.end();
    if (adminPool) {
      await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
      await adminPool.end();
    }
    if (temporaryRoot) {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
    temporaryRoot = undefined;
  });

  test("preserves IDs and citations, reports counts, and is safe to rerun", async () => {
    const first = await migrateJsonToNeon({
      dataDirectory,
      pool: migrationPool,
      dryRun: false,
    });
    expect(first.tables).toHaveLength(12);
    expect(
      first.tables.every(
        (table) =>
          table.insertedCount === (table.table === "refresh_tokens" ? 2 : 1),
      ),
    ).toBe(true);
    expect(
      first.tables.every(
        (table) =>
          table.targetCount === (table.table === "refresh_tokens" ? 2 : 1),
      ),
    ).toBe(true);

    const stored = await migrationPool.query<{
      cited_chunk_ids: string[];
      cited_document_ids: string[];
      citations: Array<Record<string, unknown>>;
    }>(
      "SELECT cited_chunk_ids, cited_document_ids, citations FROM messages",
    );
    expect(stored.rows[0]).toMatchObject({
      cited_chunk_ids: ["chunk-1"],
      cited_document_ids: [sourceIds.documentId],
      citations: [
        {
          marker: 1,
          chunkId: "chunk-1",
          documentId: sourceIds.documentId,
          documentName: "Source document",
          pageStart: 2,
          pageEnd: 3,
          section: "Overview",
        },
      ],
    });

    const second = await migrateJsonToNeon({
      dataDirectory,
      pool: migrationPool,
      dryRun: false,
    });
    expect(second.tables.every((table) => table.insertedCount === 0)).toBe(true);
    expect(
      second.tables.every(
        (table) =>
          table.targetCount === (table.table === "refresh_tokens" ? 2 : 1),
      ),
    ).toBe(true);
  });

  test("refuses PostgreSQL rows outside the source instead of merging seeded data", async () => {
    await migrationPool.query(
      "INSERT INTO roles(id, name, created_at) VALUES ($1, 'learner', now())",
      [randomUUID()],
    );
    await expect(
      migrateJsonToNeon({
        dataDirectory,
        pool: migrationPool,
        dryRun: false,
      }),
    ).rejects.toThrow(
      "PostgreSQL roles contains records not present in the source",
    );
  });
});

const sourceIds = {
  roleId: randomUUID(),
  permissionId: randomUUID(),
  rolePermissionId: randomUUID(),
  userId: randomUUID(),
  overrideId: randomUUID(),
  coachRequestId: randomUUID(),
  tokenId: randomUUID(),
  replacementTokenId: randomUUID(),
  auditId: randomUUID(),
  conversationId: randomUUID(),
  userMessageId: randomUUID(),
  messageId: randomUUID(),
  courseId: randomUUID(),
  enrolmentId: randomUUID(),
  documentId: randomUUID(),
  familyId: randomUUID(),
  chunkId: "chunk-1",
};

async function writeCompleteSourceFixture(dataDirectory: string): Promise<void> {
  const jsonDirectory = join(dataDirectory, "json");
  await mkdir(jsonDirectory, { recursive: true });
  const now = new Date().toISOString();
  const sourceCollections: Record<string, unknown[]> = {
    roles: [
      {
        id: sourceIds.roleId,
        name: "admin",
        description: "Test administrator",
        createdAt: now,
      },
    ],
    permissions: [
      {
        id: sourceIds.permissionId,
        key: "user:manage",
        area: "user",
      },
    ],
    role_permissions: [
      {
        id: sourceIds.rolePermissionId,
        roleId: sourceIds.roleId,
        permissionId: sourceIds.permissionId,
      },
    ],
    users: [
      {
        id: sourceIds.userId,
        email: "migration@example.test",
        passwordHash: "test-password-hash",
        displayName: "Migration User",
        roleId: sourceIds.roleId,
        status: "active",
        mustChangePassword: false,
        failedLoginCount: 0,
        createdAt: now,
        updatedAt: now,
      },
    ],
    user_permission_overrides: [
      {
        id: sourceIds.overrideId,
        userId: sourceIds.userId,
        permissionId: sourceIds.permissionId,
        effect: "grant",
        changedBy: sourceIds.userId,
        createdAt: now,
      },
    ],
    coach_requests: [
      {
        id: sourceIds.coachRequestId,
        userId: sourceIds.userId,
        status: "approved",
        requestedAt: now,
        decidedBy: sourceIds.userId,
        decidedAt: now,
      },
    ],
    refresh_tokens: [
      {
        id: sourceIds.tokenId,
        userId: sourceIds.userId,
        familyId: sourceIds.familyId,
        tokenHash: "a".repeat(64),
        createdAt: now,
        expiresAt: now,
        replacedByTokenId: sourceIds.replacementTokenId,
      },
      {
        id: sourceIds.replacementTokenId,
        userId: sourceIds.userId,
        familyId: sourceIds.familyId,
        tokenHash: "b".repeat(64),
        createdAt: now,
        expiresAt: now,
      },
    ],
    audit_logs: [
      {
        id: sourceIds.auditId,
        actorId: "system",
        actorRole: "system",
        action: "migration.test",
        targetType: "user",
        targetId: sourceIds.userId,
        before: null,
        after: { status: "active" },
        requestId: null,
        createdAt: now,
      },
    ],
    courses: [
      {
        id: sourceIds.courseId,
        ownerId: sourceIds.userId,
        name: "Imported course",
        description: "Preserved course details",
        lessons: [],
        status: "active",
        approvalStatus: "approved",
        approvalNote: null,
        approvalRequestedAt: now,
        reviewedBy: sourceIds.userId,
        reviewedAt: now,
        archivedAt: null,
        archivedBy: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      },
    ],
    enrolments: [
      {
        id: sourceIds.enrolmentId,
        courseId: sourceIds.courseId,
        userId: sourceIds.userId,
        status: "approved",
        requestedAt: now,
        decidedBy: sourceIds.userId,
        decidedAt: now,
        decisionNote: "Approved for testing",
        createdAt: now,
        updatedAt: now,
      },
    ],
  };
  await Promise.all(
    Object.entries(sourceCollections).map(([name, records]) =>
      writeFile(
        join(jsonDirectory, `${name}.json`),
        JSON.stringify(records),
        "utf8",
      ),
    ),
  );

  const database = openConversationDatabase(dataDirectory);
  try {
    database
      .prepare(
        `INSERT INTO conversations
         (id, user_id, course_id, title, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sourceIds.conversationId,
        sourceIds.userId,
        sourceIds.courseId,
        "Test conversation",
        now,
        now,
      );
    database
      .prepare(
        `INSERT INTO messages
         (id, conversation_id, role, content, created_at, execution_id, intent,
          grounding_status, cited_chunk_ids, cited_document_ids, citations,
          retrieval_score_top, question_embedding_ref)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        sourceIds.messageId,
        sourceIds.conversationId,
        "assistant",
        "Test response",
        now,
        randomUUID(),
        "question",
        "grounded",
        JSON.stringify([sourceIds.chunkId]),
        JSON.stringify([sourceIds.documentId]),
        JSON.stringify([
          {
            marker: 1,
            chunkId: sourceIds.chunkId,
            documentId: sourceIds.documentId,
            documentName: "Source document",
            pageStart: 2,
            pageEnd: 3,
            section: "Overview",
          },
        ]),
        0.91,
        null,
      );
  } finally {
    database.close();
  }
}
