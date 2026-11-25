import { randomUUID } from "node:crypto";
import {
  cp,
  mkdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { join, resolve } from "node:path";
import { Pool } from "pg";
import { z } from "zod";
import { chatIntentSchema } from "../src/ai/schemas/chat.schemas";
import { loadConfig } from "../src/config/config";
import { runMigrations } from "../src/infra/postgres/migrate";
import { createPostgresPool } from "../src/infra/postgres/pool";
import {
  auditLogSchema,
  coachRequestSchema,
  courseSchema,
  enrolmentSchema,
  permissionSchema,
  refreshTokenSchema,
  rolePermissionSchema,
  roleSchema,
  userPermissionOverrideSchema,
  userSchema,
} from "../src/infra/jsonstore/system-collections";

const JSON_COLLECTIONS = [
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
] as const;
const BACKUP_DIRECTORIES = ["json", "sqlite", "uploads"] as const;
const JSONB_COLUMNS = new Set(["lessons", "before", "after", "citations"]);
const BATCH_SIZE = 250;

const citationSchema = z
  .object({
    marker: z.number().int().positive(),
    chunkId: z.string().min(1),
    documentId: z.string().uuid(),
    documentName: z.string().min(1),
    pageStart: z.number().int().positive(),
    pageEnd: z.number().int().positive(),
    section: z.string().nullable(),
  })
  .strict();
const citationsSchema = z.array(citationSchema);

const conversationSchema = z
  .object({
    id: z.string().uuid(),
    user_id: z.string().uuid(),
    course_id: z.string().uuid(),
    title: z.string().nullable(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .strict();

const messageSchema = z
  .object({
    id: z.string().uuid(),
    conversation_id: z.string().uuid(),
    role: z.enum(["user", "assistant"]),
    content: z.string(),
    created_at: z.string().datetime(),
    execution_id: z.string().uuid().nullable(),
    intent: chatIntentSchema.nullable(),
    grounding_status: z
      .enum(["grounded", "insufficient", "unverified"])
      .nullable(),
    cited_chunk_ids: z.string().nullable(),
    cited_document_ids: z.string().nullable(),
    retrieval_score_top: z.number().finite().nullable(),
    question_embedding_ref: z.string().nullable(),
    citations: z.string().nullable(),
  })
  .strict();

export interface JsonMigrationOptions {
  dataDirectory: string;
  databaseUrl?: string | undefined;
  pool?: Pool;
  dryRun: boolean;
}

export interface JsonMigrationTableResult {
  table: string;
  sourceCount: number;
  insertedCount: number;
  targetCount: number | null;
}

export interface JsonMigrationResult {
  backupDirectory: string;
  dryRun: boolean;
  tables: JsonMigrationTableResult[];
}

interface ConversationSource {
  id: string;
  userId: string;
  courseId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

interface MessageSource {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  executionId: string | null;
  intent: z.infer<typeof chatIntentSchema> | null;
  groundingStatus: "grounded" | "insufficient" | "unverified" | null;
  citedChunkIds: string[];
  citedDocumentIds: string[];
  retrievalScoreTop: number | null;
  questionEmbeddingRef: string | null;
  citations: z.infer<typeof citationsSchema>;
}

interface MigrationSource {
  roles: z.infer<typeof roleSchema>[];
  permissions: z.infer<typeof permissionSchema>[];
  rolePermissions: z.infer<typeof rolePermissionSchema>[];
  users: z.infer<typeof userSchema>[];
  userPermissionOverrides: z.infer<typeof userPermissionOverrideSchema>[];
  coachRequests: z.infer<typeof coachRequestSchema>[];
  refreshTokens: z.infer<typeof refreshTokenSchema>[];
  auditLogs: z.infer<typeof auditLogSchema>[];
  courses: z.infer<typeof courseSchema>[];
  enrolments: z.infer<typeof enrolmentSchema>[];
  conversations: ConversationSource[];
  messages: MessageSource[];
}

interface TableMigration {
  table: string;
  columns: string[];
  ids: string[];
  rows: unknown[][];
}

/**
 * Backs up source directories, validates them, and imports records in dependency order.
 */
export async function migrateJsonToNeon(
  options: JsonMigrationOptions,
): Promise<JsonMigrationResult> {
  if (!options.dryRun && !options.pool && !options.databaseUrl) {
    throw new Error("DATABASE_URL is required for a real JSON migration");
  }

  const dataDirectory = resolve(options.dataDirectory);
  const backupDirectory = await createSourceBackup(dataDirectory);
  const source = await readMigrationSource(dataDirectory);
  const tableMigrations = buildTableMigrations(source);

  if (options.dryRun) {
    return {
      backupDirectory,
      dryRun: true,
      tables: tableMigrations.map(({ table, rows }) => ({
        table,
        sourceCount: rows.length,
        insertedCount: 0,
        targetCount: null,
      })),
    };
  }

  const pool =
    options.pool ??
    createPostgresPool(requireDatabaseUrl(options.databaseUrl));
  try {
    await runMigrations(pool, resolve(__dirname, "../migrations"));
    await assertTargetIsCompatible(pool, tableMigrations);

    const results: JsonMigrationTableResult[] = [];
    for (const migration of tableMigrations) {
      const insertedCount = await migrateTable(pool, migration);
      const targetCount = await getTableCount(pool, migration.table);
      if (targetCount !== migration.rows.length) {
        throw new Error(
          `PostgreSQL ${migration.table} count does not match the source (source ${migration.rows.length}, target ${targetCount})`,
        );
      }
      results.push({
        table: migration.table,
        sourceCount: migration.rows.length,
        insertedCount,
        targetCount,
      });
    }

    return { backupDirectory, dryRun: false, tables: results };
  } finally {
    if (!options.pool) await pool.end();
  }
}

/**
 * Copies migration inputs before any source file or database is read.
 */
async function createSourceBackup(dataDirectory: string): Promise<string> {
  const backupsDirectory = join(dataDirectory, "backups");
  await mkdir(backupsDirectory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDirectory = join(
    backupsDirectory,
    `${timestamp}-${randomUUID()}`,
  );
  await mkdir(backupDirectory);

  const copiedDirectories: string[] = [];
  for (const name of BACKUP_DIRECTORIES) {
    const sourcePath = join(dataDirectory, name);
    try {
      const sourceStat = await stat(sourcePath);
      if (!sourceStat.isDirectory()) {
        throw new Error(`Migration source ${name} is not a directory`);
      }
      await cp(sourcePath, join(backupDirectory, name), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      copiedDirectories.push(name);
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
    }
  }

  await writeFile(
    join(backupDirectory, "manifest.json"),
    JSON.stringify(
      { createdAt: new Date().toISOString(), contents: copiedDirectories },
      null,
      2,
    ),
    "utf8",
  );
  return backupDirectory;
}

/**
 * Loads only the collections included in this migration and the SQLite chat tables.
 */
async function readMigrationSource(
  dataDirectory: string,
): Promise<MigrationSource> {
  const jsonDirectory = join(dataDirectory, "json");
  const [
    roles,
    permissions,
    rolePermissions,
    users,
    userPermissionOverrides,
    coachRequests,
    refreshTokens,
    auditLogs,
    courses,
    enrolments,
  ] = await Promise.all([
    readJsonCollection(jsonDirectory, "roles", roleSchema),
    readJsonCollection(jsonDirectory, "permissions", permissionSchema),
    readJsonCollection(jsonDirectory, "role_permissions", rolePermissionSchema),
    readJsonCollection(jsonDirectory, "users", userSchema),
    readJsonCollection(
      jsonDirectory,
      "user_permission_overrides",
      userPermissionOverrideSchema,
    ),
    readJsonCollection(jsonDirectory, "coach_requests", coachRequestSchema),
    readJsonCollection(jsonDirectory, "refresh_tokens", refreshTokenSchema),
    readJsonCollection(jsonDirectory, "audit_logs", auditLogSchema),
    readJsonCollection(jsonDirectory, "courses", courseSchema),
    readJsonCollection(jsonDirectory, "enrolments", enrolmentSchema),
  ]);
  const { conversations, messages } = await readSqliteConversations(dataDirectory);
  return {
    roles,
    permissions,
    rolePermissions,
    users,
    userPermissionOverrides,
    coachRequests,
    refreshTokens,
    auditLogs,
    courses,
    enrolments,
    conversations,
    messages,
  };
}

/**
 * Parses a JSON collection without including record contents in validation errors.
 */
async function readJsonCollection<T extends { id: string }>(
  jsonDirectory: string,
  name: (typeof JSON_COLLECTIONS)[number],
  schema: z.ZodType<T>,
): Promise<T[]> {
  let serialized: string;
  try {
    serialized = await readFile(join(jsonDirectory, `${name}.json`), "utf8");
  } catch (error) {
    if (isMissingPathError(error)) {
      throw new Error(`Missing JSON migration collection: ${name}.json`);
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error(`Invalid JSON migration collection: ${name}.json`);
  }
  if (!Array.isArray(parsed)) {
    throw new Error(`Invalid JSON migration collection: ${name}.json`);
  }

  const ids = new Set<string>();
  return parsed.map((rawRecord: unknown, index: number) => {
    const result = schema.safeParse(rawRecord);
    if (!result.success) {
      throw new Error(
        `Invalid record in ${name}.json (${identifyRecord(rawRecord, index)})`,
      );
    }
    if (ids.has(result.data.id)) {
      throw new Error(
        `Duplicate record in ${name}.json (id ${result.data.id})`,
      );
    }
    ids.add(result.data.id);
    return result.data;
  });
}

/**
 * Reads SQLite chat history in read-only mode and validates all migrated columns.
 */
async function readSqliteConversations(
  dataDirectory: string,
): Promise<{ conversations: ConversationSource[]; messages: MessageSource[] }> {
  const databasePath = join(dataDirectory, "sqlite", "conversations.db");
  try {
    await stat(databasePath);
  } catch (error) {
    if (isMissingPathError(error)) return { conversations: [], messages: [] };
    throw error;
  }

  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const conversationColumns = getSqliteColumns(database, "conversations");
    const messageColumns = getSqliteColumns(database, "messages");
    const requiredConversationColumns = [
      "id",
      "user_id",
      "course_id",
      "title",
      "created_at",
      "updated_at",
    ];
    const requiredMessageColumns = [
      "id",
      "conversation_id",
      "role",
      "content",
      "created_at",
    ];
    assertSqliteColumns("conversations", conversationColumns, requiredConversationColumns);
    assertSqliteColumns("messages", messageColumns, requiredMessageColumns);

    const conversationRows = database
      .prepare(
        `SELECT ${requiredConversationColumns.join(", ")}
         FROM conversations ORDER BY rowid`,
      )
      .all();
    const optionalMessageColumns = [
      "execution_id",
      "intent",
      "grounding_status",
      "cited_chunk_ids",
      "cited_document_ids",
      "retrieval_score_top",
      "question_embedding_ref",
      "citations",
    ];
    const selectedMessageColumns = [
      ...requiredMessageColumns,
      ...optionalMessageColumns.map((column) =>
        messageColumns.has(column) ? column : `NULL AS ${column}`,
      ),
    ];
    const messageRows = database
      .prepare(
        `SELECT ${selectedMessageColumns.join(", ")}
         FROM messages ORDER BY rowid`,
      )
      .all();

    return {
      conversations: conversationRows.map((row, index) => {
        const result = conversationSchema.safeParse(row);
        if (!result.success) {
          throw new Error(
            `Invalid SQLite conversations record (${identifyRecord(row, index)})`,
          );
        }
        return {
          id: result.data.id,
          userId: result.data.user_id,
          courseId: result.data.course_id,
          title: result.data.title,
          createdAt: result.data.created_at,
          updatedAt: result.data.updated_at,
        };
      }),
      messages: messageRows.map((row, index) => {
        const result = messageSchema.safeParse(row);
        if (!result.success) {
          throw new Error(
            `Invalid SQLite messages record (${identifyRecord(row, index)})`,
          );
        }
        const citations = parseSqliteJsonArray(
          result.data.citations,
          citationsSchema,
          "citations",
          result.data.id,
        );
        return {
          id: result.data.id,
          conversationId: result.data.conversation_id,
          role: result.data.role,
          content: result.data.content,
          createdAt: result.data.created_at,
          executionId: result.data.execution_id,
          intent: result.data.intent,
          groundingStatus: result.data.grounding_status,
          citedChunkIds: parseSqliteJsonArray(
            result.data.cited_chunk_ids,
            z.array(z.string()),
            "cited_chunk_ids",
            result.data.id,
          ),
          citedDocumentIds: parseSqliteJsonArray(
            result.data.cited_document_ids,
            z.array(z.string()),
            "cited_document_ids",
            result.data.id,
          ),
          retrievalScoreTop: result.data.retrieval_score_top,
          questionEmbeddingRef: result.data.question_embedding_ref,
          citations,
        };
      }),
    };
  } finally {
    database.close();
  }
}

/**
 * Converts validated sources to parameter values in foreign-key dependency order.
 */
function buildTableMigrations(source: MigrationSource): TableMigration[] {
  const orderedRefreshTokens = orderRefreshTokens(source.refreshTokens);
  return [
    {
      table: "roles",
      columns: ["id", "name", "description", "created_at"],
      ids: source.roles.map((row) => row.id),
      rows: source.roles.map((row) => [
        row.id,
        row.name,
        row.description ?? null,
        row.createdAt,
      ]),
    },
    {
      table: "permissions",
      columns: ["id", "key", "area", "description"],
      ids: source.permissions.map((row) => row.id),
      rows: source.permissions.map((row) => [
        row.id,
        row.key,
        row.area,
        row.description ?? null,
      ]),
    },
    {
      table: "role_permissions",
      columns: ["id", "role_id", "permission_id"],
      ids: source.rolePermissions.map((row) => row.id),
      rows: source.rolePermissions.map((row) => [
        row.id,
        row.roleId,
        row.permissionId,
      ]),
    },
    {
      table: "users",
      columns: [
        "id",
        "email",
        "password_hash",
        "display_name",
        "role_id",
        "perms_version",
        "status",
        "must_change_password",
        "failed_login_count",
        "locked_until",
        "reset_token_hash",
        "reset_token_expires_at",
        "password_changed_at",
        "last_login_at",
        "erased_at",
        "pseudonym_id",
        "created_at",
        "updated_at",
      ],
      ids: source.users.map((row) => row.id),
      rows: source.users.map((row) => [
        row.id,
        row.email,
        row.passwordHash,
        row.displayName,
        row.roleId,
        row.permsVersion ?? 1,
        row.status,
        row.mustChangePassword,
        row.failedLoginCount,
        row.lockedUntil ?? null,
        row.resetTokenHash ?? null,
        row.resetTokenExpiresAt ?? null,
        row.passwordChangedAt ?? null,
        row.lastLoginAt ?? null,
        row.erasedAt ?? null,
        row.pseudonymId ?? null,
        row.createdAt,
        row.updatedAt,
      ]),
    },
    {
      table: "user_permission_overrides",
      columns: [
        "id",
        "user_id",
        "permission_id",
        "effect",
        "changed_by",
        "created_at",
      ],
      ids: source.userPermissionOverrides.map((row) => row.id),
      rows: source.userPermissionOverrides.map((row) => [
        row.id,
        row.userId,
        row.permissionId,
        row.effect,
        row.changedBy,
        row.createdAt,
      ]),
    },
    {
      table: "coach_requests",
      columns: [
        "id",
        "user_id",
        "status",
        "message",
        "requested_at",
        "decided_by",
        "decided_at",
        "decision_note",
      ],
      ids: source.coachRequests.map((row) => row.id),
      rows: source.coachRequests.map((row) => [
        row.id,
        row.userId,
        row.status,
        row.message ?? null,
        row.requestedAt,
        row.decidedBy ?? null,
        row.decidedAt ?? null,
        row.decisionNote ?? null,
      ]),
    },
    {
      table: "refresh_tokens",
      columns: [
        "id",
        "user_id",
        "family_id",
        "token_hash",
        "created_at",
        "expires_at",
        "used_at",
        "revoked_at",
        "replaced_by_token_id",
      ],
      ids: orderedRefreshTokens.map((row) => row.id),
      rows: orderedRefreshTokens.map((row) => [
        row.id,
        row.userId,
        row.familyId,
        row.tokenHash,
        row.createdAt,
        row.expiresAt,
        row.usedAt ?? null,
        row.revokedAt ?? null,
        row.replacedByTokenId ?? null,
      ]),
    },
    {
      table: "courses",
      columns: [
        "id",
        "owner_id",
        "title",
        "description",
        "lessons",
        "status",
        "approval_status",
        "approval_note",
        "approval_requested_at",
        "reviewed_by",
        "reviewed_at",
        "archived_at",
        "archived_by",
        "version",
        "created_at",
        "updated_at",
      ],
      ids: source.courses.map((row) => row.id),
      rows: source.courses.map((row) => [
        row.id,
        row.ownerId,
        row.name,
        row.description ?? null,
        JSON.stringify(row.lessons ?? []),
        row.status,
        row.approvalStatus ?? "approved",
        row.approvalNote ?? null,
        row.approvalRequestedAt ?? null,
        row.reviewedBy ?? null,
        row.reviewedAt ?? null,
        row.archivedAt ?? null,
        row.archivedBy ?? null,
        row.version,
        row.createdAt,
        row.updatedAt,
      ]),
    },
    {
      table: "enrolments",
      columns: [
        "id",
        "course_id",
        "user_id",
        "status",
        "requested_at",
        "decided_by",
        "decided_at",
        "decision_note",
        "created_at",
        "updated_at",
      ],
      ids: source.enrolments.map((row) => row.id),
      rows: source.enrolments.map((row) => [
        row.id,
        row.courseId,
        row.userId,
        row.status,
        row.requestedAt,
        row.decidedBy ?? null,
        row.decidedAt ?? null,
        row.decisionNote ?? null,
        row.createdAt,
        row.updatedAt,
      ]),
    },
    {
      table: "audit_logs",
      columns: [
        "id",
        "actor_id",
        "actor_role",
        "action",
        "target_type",
        "target_id",
        "before",
        "after",
        "request_id",
        "created_at",
      ],
      ids: source.auditLogs.map((row) => row.id),
      rows: source.auditLogs.map((row) => [
        row.id,
        row.actorId,
        row.actorRole,
        row.action,
        row.targetType,
        row.targetId,
        row.before ?? null,
        row.after ?? null,
        row.requestId ?? null,
        row.createdAt,
      ]),
    },
    {
      table: "conversations",
      columns: [
        "id",
        "user_id",
        "course_id",
        "title",
        "created_at",
        "updated_at",
      ],
      ids: source.conversations.map((row) => row.id),
      rows: source.conversations.map((row) => [
        row.id,
        row.userId,
        row.courseId,
        row.title,
        row.createdAt,
        row.updatedAt,
      ]),
    },
    {
      table: "messages",
      columns: [
        "id",
        "conversation_id",
        "role",
        "content",
        "created_at",
        "execution_id",
        "intent",
        "grounding_status",
        "cited_chunk_ids",
        "cited_document_ids",
        "retrieval_score_top",
        "question_embedding_ref",
        "citations",
      ],
      ids: source.messages.map((row) => row.id),
      rows: source.messages.map((row) => [
        row.id,
        row.conversationId,
        row.role,
        row.content,
        row.createdAt,
        row.executionId,
        row.intent,
        row.groundingStatus,
        row.citedChunkIds,
        row.citedDocumentIds,
        row.retrievalScoreTop,
        row.questionEmbeddingRef,
        JSON.stringify(row.citations),
      ]),
    },
  ];
}

/**
 * Verifies that every existing PostgreSQL row belongs to this source before writing.
 */
async function assertTargetIsCompatible(
  pool: Pool,
  migrations: TableMigration[],
): Promise<void> {
  for (const migration of migrations) {
    const result = await pool.query<{ id: string }>(
      `SELECT id FROM ${migration.table}`,
    );
    const sourceIds = new Set(migration.ids);
    if (result.rows.some((row) => !sourceIds.has(row.id))) {
      throw new Error(
        `PostgreSQL ${migration.table} contains records not present in the source; use a schema-only target or resolve the conflict before retrying`,
      );
    }
  }
}

/**
 * Inserts one table in bounded batches within a single transaction.
 */
async function migrateTable(
  pool: Pool,
  migration: TableMigration,
): Promise<number> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      let insertedCount = 0;
      for (let offset = 0; offset < migration.rows.length; offset += BATCH_SIZE) {
        const batch = migration.rows.slice(offset, offset + BATCH_SIZE);
        const values = batch.flat();
        const placeholders = batch.map((_, rowIndex) => {
          const parameterOffset = rowIndex * migration.columns.length;
          return `(${migration.columns
            .map((column, columnIndex) => {
              const placeholder = `$${parameterOffset + columnIndex + 1}`;
              return JSONB_COLUMNS.has(column)
                ? `${placeholder}::jsonb`
                : placeholder;
            })
            .join(", ")})`;
        });
        const result = await client.query(
          `INSERT INTO ${migration.table} (${migration.columns.join(", ")})
           VALUES ${placeholders.join(", ")}
           ON CONFLICT (id) DO NOTHING`,
          values,
        );
        insertedCount += result.rowCount ?? 0;
      }
      await client.query("COMMIT");
      return insertedCount;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        throw new Error(
          `PostgreSQL migration failed for ${migration.table} and could not be rolled back`,
        );
      }
      throw new Error(`PostgreSQL migration failed for ${migration.table}`, {
        cause: error,
      });
    }
  } finally {
    client.release();
  }
}

/**
 * Orders refresh-token chains so each replacement exists before its predecessor.
 */
function orderRefreshTokens(
  tokens: MigrationSource["refreshTokens"],
): MigrationSource["refreshTokens"] {
  const tokensById = new Map(tokens.map((token) => [token.id, token]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const ordered: MigrationSource["refreshTokens"] = [];

  const visit = (id: string): void => {
    if (visited.has(id)) return;
    if (visiting.has(id)) {
      throw new Error(`Refresh-token replacement cycle at id ${id}`);
    }
    visiting.add(id);
    const token = tokensById.get(id);
    if (!token) throw new Error(`Missing refresh-token id ${id}`);
    if (token.replacedByTokenId) visit(token.replacedByTokenId);
    visiting.delete(id);
    visited.add(id);
    ordered.push(token);
  };

  for (const token of tokens) visit(token.id);
  return ordered;
}

/**
 * Returns a PostgreSQL table count without loading user records.
 */
async function getTableCount(pool: Pool, table: string): Promise<number> {
  const result = await pool.query<{ count: number }>(
    `SELECT count(*)::integer AS count FROM ${table}`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

/**
 * Reads SQLite column names, returning an empty set for a missing table.
 */
function getSqliteColumns(database: DatabaseSync, table: string): Set<string> {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all();
  return new Set(
    rows.flatMap((row) => (typeof row.name === "string" ? [row.name] : [])),
  );
}

function assertSqliteColumns(
  table: string,
  available: Set<string>,
  required: string[],
): void {
  const missing = required.filter((column) => !available.has(column));
  if (missing.length) {
    throw new Error(
      `SQLite ${table} is missing required columns: ${missing.join(", ")}`,
    );
  }
}

/**
 * Decodes JSON-backed SQLite arrays without exposing their values in failures.
 */
function parseSqliteJsonArray<T>(
  value: string | null,
  schema: z.ZodType<T>,
  column: string,
  messageId: string,
): T {
  if (value === null) {
    const result = schema.safeParse([]);
    if (!result.success) {
      throw new Error(`Invalid SQLite messages ${column} for id ${messageId}`);
    }
    return result.data;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`Invalid SQLite messages ${column} for id ${messageId}`);
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid SQLite messages ${column} for id ${messageId}`);
  }
  return result.data;
}

function identifyRecord(record: unknown, index: number): string {
  if (
    typeof record === "object" &&
    record !== null &&
    "id" in record &&
    typeof record.id === "string" &&
    z.string().uuid().safeParse(record.id).success
  ) {
    return `id ${record.id}`;
  }
  return `row ${index + 1}`;
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function requireDatabaseUrl(databaseUrl: string | undefined): string {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for a real JSON migration");
  }
  return databaseUrl;
}

async function main(): Promise<void> {
  const flags = new Set(process.argv.slice(2));
  for (const flag of flags) {
    if (flag !== "--dry-run") throw new Error(`Unknown option: ${flag}`);
  }
  const config = loadConfig({
    requireJwtSecrets: false,
    requireMongoConfiguration: false,
  });
  const result = await migrateJsonToNeon({
    dataDirectory: config.dataDir,
    databaseUrl: config.databaseUrl,
    dryRun: flags.has("--dry-run"),
  });
  process.stdout.write(
    `${JSON.stringify({
      backupDirectory: result.backupDirectory,
      dryRun: result.dryRun,
      tables: result.tables,
    })}\n`,
  );
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Migration failed";
    process.stderr.write(`JSON-to-Neon migration failed: ${message}\n`);
    process.exitCode = 1;
  });
}
