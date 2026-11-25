import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Pool } from "pg";
import type { Db, Document } from "mongodb";
import { z } from "zod";
import {
  activityEventSchema,
  agentExecutionSchema,
  auditLogSchema,
  coachRequestSchema,
  configVersionSchema,
  courseSchema,
  documentSchema,
  enrolmentSchema,
  feedbackSchema,
  flashcardSchema,
  gapReportSchema,
  jobSchema,
  learningSummarySchema,
  permissionSchema,
  quizAttemptSchema,
  quizSchema,
  refreshTokenSchema,
  rolePermissionSchema,
  roleSchema,
  schedulerStateSchema,
  userPermissionOverrideSchema,
  userSchema,
  type ActivityEventRecord,
  type AgentExecutionRecord,
  type AuditLogRecord,
  type CoachRequestRecord,
  type ConfigVersionRecord,
  type CourseRecord,
  type DocumentRecord,
  type EnrolmentRecord,
  type FeedbackRecord,
  type FlashcardRecord,
  type GapReportRecord,
  type JobRecord,
  type LearningSummaryRecord,
  type PermissionRecord,
  type QuizAttemptRecord,
  type QuizRecord,
  type RefreshTokenRecord,
  type RolePermissionRecord,
  type RoleRecord,
  type SchedulerStateRecord,
  type UserPermissionOverrideRecord,
  type UserRecord,
} from "../src/infra/jsonstore/system-collections";
import {
  parseLegacyConversationCitations,
  parseLegacyConversationIntent,
} from "../src/infra/mongodb/conversation.repository";
import type {
  ConversationMessageRecord,
  ConversationRecord,
} from "../src/infra/sqlite/conversation.repository";
import type { PostgresStore } from "../src/infra/postgres/postgres-store";

type LegacyRecord = Record<string, unknown> & { id: string };
type LegacyCollections = Map<string, LegacyRecord[]>;
type Counts = Record<string, { inserted: number; alreadyPresent: number }>;

const recordSchema = z.record(z.string(), z.unknown());
const collectionValidators: Record<string, (value: unknown) => unknown[]> = {
  users: (value) => z.array(userSchema).parse(value),
  roles: (value) => z.array(roleSchema).parse(value),
  permissions: (value) => z.array(permissionSchema).parse(value),
  role_permissions: (value) => z.array(rolePermissionSchema).parse(value),
  user_permission_overrides: (value) =>
    z.array(userPermissionOverrideSchema).parse(value),
  refresh_tokens: (value) => z.array(refreshTokenSchema).parse(value),
  coach_requests: (value) => z.array(coachRequestSchema).parse(value),
  courses: (value) => z.array(courseSchema).parse(value),
  enrolments: (value) => z.array(enrolmentSchema).parse(value),
  documents: (value) => z.array(documentSchema).parse(value),
  learning_summaries: (value) => z.array(learningSummarySchema).parse(value),
  flashcards: (value) => z.array(flashcardSchema).parse(value),
  quizzes: (value) => z.array(quizSchema).parse(value),
  quiz_attempts: (value) => z.array(quizAttemptSchema).parse(value),
  audit_logs: (value) => z.array(auditLogSchema).parse(value),
  feedback: (value) => z.array(feedbackSchema).parse(value),
  activity_events: (value) => z.array(activityEventSchema).parse(value),
  gap_reports: (value) => z.array(gapReportSchema).parse(value),
  config_versions: (value) => z.array(configVersionSchema).parse(value),
  agent_executions: (value) => z.array(agentExecutionSchema).parse(value),
  jobs: (value) => z.array(jobSchema).parse(value),
  scheduler_state: (value) => z.array(schedulerStateSchema).parse(value),
};

export async function migrateLegacyData(
  dataDirectory: string,
  postgres: Pool,
  store: PostgresStore,
  mongo: Db,
): Promise<Counts> {
  const legacy = await readLegacyCollections(join(dataDirectory, "json"));
  const counts: Counts = {};
  const userIds = new Map<string, string>();
  const roleIds = new Map<string, string>();
  const sourceRoleNames = new Map<string, string>();
  const permissionIds = new Map<string, string>();
  const sourcePermissionKeys = new Map<string, string>();

  await importRoles(legacy, postgres, store, roleIds, sourceRoleNames, counts);
  await importPermissions(
    legacy,
    postgres,
    store,
    permissionIds,
    sourcePermissionKeys,
    counts,
  );
  await importUsers(
    legacy,
    postgres,
    store,
    roleIds,
    sourceRoleNames,
    userIds,
    counts,
  );
  await importRolePermissions(
    legacy,
    postgres,
    store,
    roleIds,
    sourceRoleNames,
    permissionIds,
    sourcePermissionKeys,
    counts,
  );
  await importUserPermissionOverrides(
    legacy,
    postgres,
    store,
    userIds,
    permissionIds,
    sourcePermissionKeys,
    counts,
  );
  await importRefreshTokens(legacy, store, userIds, counts);
  await importCoachRequests(legacy, postgres, store, userIds, counts);
  await importCourses(legacy, store, userIds, counts);
  await importEnrolments(legacy, postgres, store, userIds, counts);
  await importJobs(legacy, store, userIds, counts);
  await importDocuments(legacy, postgres, store, userIds, counts);
  await importPayloadCollections(legacy, store, userIds, counts);
  await importAuditLogs(legacy, store, userIds, counts);

  const mongoCounts = await importSqliteConversations(
    dataDirectory,
    postgres,
    mongo,
    userIds,
  );
  counts.conversations = mongoCounts.conversations;
  counts.messages = mongoCounts.messages;
  counts.chat_daily_usage = mongoCounts.chat_daily_usage;
  return counts;
}

async function readLegacyCollections(directory: string): Promise<LegacyCollections> {
  const collections: LegacyCollections = new Map();
  for (const [name, validate] of Object.entries(collectionValidators)) {
    const path = join(directory, `${name}.json`);
    let contents: string;
    try {
      contents = await readFile(path, "utf8");
    } catch (error) {
      if (isMissingFile(error)) {
        collections.set(name, []);
        continue;
      }
      throw error;
    }

    let source: unknown;
    try {
      source = JSON.parse(contents);
    } catch {
      throw new Error(`Legacy JSON collection ${name} is not valid JSON`);
    }
    const validated = validate(source);
    const records = validated.map((value) => {
      const object = recordSchema.parse(value);
      return { ...object, id: z.string().uuid().parse(object.id) };
    });
    collections.set(name, records);
  }
  return collections;
}

async function importRoles(
  legacy: LegacyCollections,
  postgres: Pool,
  store: PostgresStore,
  ids: Map<string, string>,
  sourceNames: Map<string, string>,
  counts: Counts,
): Promise<void> {
  for (const raw of rows(legacy, "roles")) {
    const source = roleSchema.parse(raw);
    sourceNames.set(source.id, source.name);
    const existing = await postgres.query<{ id: string }>(
      "SELECT id::text FROM roles WHERE name = $1",
      [source.name],
    );
    const id = existing.rows[0]?.id ?? source.id;
    if (!existing.rows[0]) {
      const inserted = await store
        .getCollection<RoleRecord>("roles")
        .insertImportedRecord({ ...source, id });
      recordCount(counts, "roles", inserted);
    } else {
      recordCount(counts, "roles", false);
    }
    ids.set(source.name, id);
  }
}

async function importPermissions(
  legacy: LegacyCollections,
  postgres: Pool,
  store: PostgresStore,
  ids: Map<string, string>,
  sourceKeys: Map<string, string>,
  counts: Counts,
): Promise<void> {
  for (const raw of rows(legacy, "permissions")) {
    const source = permissionSchema.parse(raw);
    sourceKeys.set(source.id, source.key);
    const existing = await postgres.query<{ id: string }>(
      'SELECT id::text FROM permissions WHERE "key" = $1',
      [source.key],
    );
    const id = existing.rows[0]?.id ?? source.id;
    if (!existing.rows[0]) {
      const inserted = await store
        .getCollection<PermissionRecord>("permissions")
        .insertImportedRecord({ ...source, id });
      recordCount(counts, "permissions", inserted);
    } else {
      recordCount(counts, "permissions", false);
    }
    ids.set(source.key, id);
  }
}

async function importUsers(
  legacy: LegacyCollections,
  postgres: Pool,
  store: PostgresStore,
  roleIds: Map<string, string>,
  sourceRoleNames: Map<string, string>,
  userIds: Map<string, string>,
  counts: Counts,
): Promise<void> {
  for (const raw of rows(legacy, "users")) {
    const source = userSchema.parse(raw);
    const roleName = sourceRoleNames.get(source.roleId);
    const roleId = roleName ? roleIds.get(roleName) : undefined;
    if (!roleId) throw new Error(`Cannot map role for user "${source.id}"`);

    const existing = await postgres.query<{ id: string }>(
      "SELECT id::text FROM users WHERE lower(email) = lower($1)",
      [source.email],
    );
    const targetId = existing.rows[0]?.id ?? source.id;
    if (!existing.rows[0]) {
      const imported = userSchema.parse({ ...source, roleId });
      const inserted = await store
        .getCollection<UserRecord>("users")
        .insertImportedRecord(imported);
      recordCount(counts, "users", inserted);
    } else {
      recordCount(counts, "users", false);
    }
    userIds.set(source.id, targetId);
    if (source.id !== targetId) {
      await ensureUserAlias(postgres, source.id, targetId);
    }
  }
}

async function ensureUserAlias(
  postgres: Pool,
  legacyId: string,
  userId: string,
): Promise<void> {
  const primaryId = await postgres.query<{ id: string }>(
    "SELECT id::text FROM users WHERE id = $1",
    [legacyId],
  );
  if (primaryId.rows[0] && primaryId.rows[0].id !== userId) {
    throw new Error(
      `Legacy user ID "${legacyId}" belongs to a different existing user`,
    );
  }
  await postgres.query(
    `INSERT INTO user_id_aliases (legacy_id, user_id)
     VALUES ($1, $2) ON CONFLICT (legacy_id) DO NOTHING`,
    [legacyId, userId],
  );
  const result = await postgres.query<{ user_id: string }>(
    "SELECT user_id::text FROM user_id_aliases WHERE legacy_id = $1",
    [legacyId],
  );
  if (result.rows[0]?.user_id !== userId) {
    throw new Error(`Legacy user ID "${legacyId}" is already mapped elsewhere`);
  }
}

async function importRolePermissions(
  legacy: LegacyCollections,
  postgres: Pool,
  store: PostgresStore,
  roleIds: Map<string, string>,
  sourceRoleNames: Map<string, string>,
  permissionIds: Map<string, string>,
  sourcePermissionKeys: Map<string, string>,
  counts: Counts,
): Promise<void> {
  for (const raw of rows(legacy, "role_permissions")) {
    const source = rolePermissionSchema.parse(raw);
    const roleName = sourceRoleNames.get(source.roleId);
    const permissionKey = sourcePermissionKeys.get(source.permissionId);
    const roleId = roleName ? roleIds.get(roleName) : undefined;
    const permissionId = permissionKey
      ? permissionIds.get(permissionKey)
      : undefined;
    if (!roleId || !permissionId) {
      throw new Error(`Cannot map role permission "${source.id}"`);
    }
    const existing = await postgres.query(
      "SELECT 1 FROM role_permissions WHERE role_id = $1 AND permission_id = $2",
      [roleId, permissionId],
    );
    if (existing.rowCount) {
      recordCount(counts, "role_permissions", false);
      continue;
    }
    const inserted = await store
      .getCollection<RolePermissionRecord>("role_permissions")
      .insertImportedRecord({ ...source, roleId, permissionId });
    recordCount(counts, "role_permissions", inserted);
  }
}

async function importUserPermissionOverrides(
  legacy: LegacyCollections,
  postgres: Pool,
  store: PostgresStore,
  userIds: Map<string, string>,
  permissionIds: Map<string, string>,
  sourcePermissionKeys: Map<string, string>,
  counts: Counts,
): Promise<void> {
  for (const raw of rows(legacy, "user_permission_overrides")) {
    const source = userPermissionOverrideSchema.parse(raw);
    const userId = mapUserId(userIds, source.userId);
    const changedBy = mapUserId(userIds, source.changedBy);
    const permissionKey = sourcePermissionKeys.get(source.permissionId);
    const permissionId = permissionKey
      ? permissionIds.get(permissionKey)
      : undefined;
    if (!permissionId) {
      throw new Error(`Cannot map permission override "${source.id}"`);
    }
    const existing = await postgres.query(
      "SELECT 1 FROM user_permission_overrides WHERE user_id = $1 AND permission_id = $2",
      [userId, permissionId],
    );
    if (existing.rowCount) {
      recordCount(counts, "user_permission_overrides", false);
      continue;
    }
    const imported = userPermissionOverrideSchema.parse({
      ...source,
      userId,
      permissionId,
      changedBy,
    });
    const inserted = await store
      .getCollection<UserPermissionOverrideRecord>("user_permission_overrides")
      .insertImportedRecord(imported);
    recordCount(counts, "user_permission_overrides", inserted);
  }
}

async function importRefreshTokens(
  legacy: LegacyCollections,
  store: PostgresStore,
  userIds: Map<string, string>,
  counts: Counts,
): Promise<void> {
  for (const raw of rows(legacy, "refresh_tokens")) {
    const source = refreshTokenSchema.parse(raw);
    const imported = refreshTokenSchema.parse({
      ...source,
      userId: mapUserId(userIds, source.userId),
    });
    const inserted = await store
      .getCollection<RefreshTokenRecord>("refresh_tokens")
      .insertImportedRecord(imported);
    recordCount(counts, "refresh_tokens", inserted);
  }
}

async function importCoachRequests(
  legacy: LegacyCollections,
  postgres: Pool,
  store: PostgresStore,
  userIds: Map<string, string>,
  counts: Counts,
): Promise<void> {
  for (const raw of rows(legacy, "coach_requests")) {
    const source = coachRequestSchema.parse(raw);
    const userId = mapUserId(userIds, source.userId);
    const decidedBy =
      source.decidedBy == null ? source.decidedBy : mapUserId(userIds, source.decidedBy);
    if (source.status === "pending") {
      const existing = await postgres.query(
        "SELECT 1 FROM coach_requests WHERE user_id = $1 AND status = 'pending'",
        [userId],
      );
      if (existing.rowCount) {
        recordCount(counts, "coach_requests", false);
        continue;
      }
    }
    const imported = coachRequestSchema.parse({ ...source, userId, decidedBy });
    const inserted = await store
      .getCollection<CoachRequestRecord>("coach_requests")
      .insertImportedRecord(imported);
    recordCount(counts, "coach_requests", inserted);
  }
}

async function importCourses(
  legacy: LegacyCollections,
  store: PostgresStore,
  userIds: Map<string, string>,
  counts: Counts,
): Promise<void> {
  for (const raw of rows(legacy, "courses")) {
    const source = courseSchema.parse(raw);
    const imported = courseSchema.parse({
      ...source,
      ownerId: mapUserId(userIds, source.ownerId),
      reviewedBy:
        source.reviewedBy == null
          ? source.reviewedBy
          : mapUserId(userIds, source.reviewedBy),
      archivedBy:
        source.archivedBy == null
          ? source.archivedBy
          : mapUserId(userIds, source.archivedBy),
    });
    const inserted = await store
      .getCollection<CourseRecord>("courses")
      .insertImportedRecord(imported);
    recordCount(counts, "courses", inserted);
  }
}

async function importEnrolments(
  legacy: LegacyCollections,
  postgres: Pool,
  store: PostgresStore,
  userIds: Map<string, string>,
  counts: Counts,
): Promise<void> {
  for (const raw of rows(legacy, "enrolments")) {
    const source = enrolmentSchema.parse(raw);
    const userId = mapUserId(userIds, source.userId);
    const existing = await postgres.query(
      "SELECT 1 FROM enrolments WHERE course_id = $1 AND user_id = $2",
      [source.courseId, userId],
    );
    if (existing.rowCount) {
      recordCount(counts, "enrolments", false);
      continue;
    }
    const imported = enrolmentSchema.parse({
      ...source,
      userId,
      decidedBy:
        source.decidedBy == null
          ? source.decidedBy
          : mapUserId(userIds, source.decidedBy),
    });
    const inserted = await store
      .getCollection<EnrolmentRecord>("enrolments")
      .insertImportedRecord(imported);
    recordCount(counts, "enrolments", inserted);
  }
}

async function importJobs(
  legacy: LegacyCollections,
  store: PostgresStore,
  userIds: Map<string, string>,
  counts: Counts,
): Promise<void> {
  for (const raw of rows(legacy, "jobs")) {
    const source = jobSchema.parse(raw);
    const payload = { ...source.payload };
    for (const key of ["userId", "ownerId", "createdBy"]) {
      const value = payload[key];
      if (typeof value === "string") payload[key] = mapUserId(userIds, value);
    }
    const imported = jobSchema.parse({
      ...source,
      createdBy: mapUserId(userIds, source.createdBy),
      payload,
    });
    const inserted = await store
      .getCollection<JobRecord>("jobs")
      .insertImportedRecord(imported);
    recordCount(counts, "jobs", inserted);
  }
  for (const raw of rows(legacy, "scheduler_state")) {
    const imported = schedulerStateSchema.parse(raw);
    const inserted = await store
      .getCollection<SchedulerStateRecord>("scheduler_state")
      .insertImportedRecord(imported);
    recordCount(counts, "scheduler_state", inserted);
  }
}

async function importDocuments(
  legacy: LegacyCollections,
  postgres: Pool,
  store: PostgresStore,
  userIds: Map<string, string>,
  counts: Counts,
): Promise<void> {
  for (const raw of rows(legacy, "documents")) {
    const source = documentSchema.parse(raw);
    const imported = documentSchema.parse({
      ...source,
      ownerId: mapUserId(userIds, source.ownerId),
    });
    if (imported.status !== "deleting") {
      const duplicate = await postgres.query(
        `SELECT 1 FROM documents
         WHERE course_id = $1 AND scope = $2 AND owner_id = $3
           AND content_hash = $4 AND status <> 'deleting'`,
        [
          imported.courseId,
          imported.scope,
          imported.ownerId,
          imported.contentHash,
        ],
      );
      if (duplicate.rowCount) {
        recordCount(counts, "documents", false);
        continue;
      }
    }
    const inserted = await store
      .getCollection<DocumentRecord>("documents")
      .insertImportedRecord(imported);
    recordCount(counts, "documents", inserted);
  }
}

async function importPayloadCollections(
  legacy: LegacyCollections,
  store: PostgresStore,
  userIds: Map<string, string>,
  counts: Counts,
): Promise<void> {
  const payloads: Array<{
    name: string;
    parse: (value: unknown) => { id: string } & Record<string, unknown>;
  }> = [
    { name: "learning_summaries", parse: (value) => asRecord(learningSummarySchema.parse(value)) },
    { name: "flashcards", parse: (value) => asRecord(flashcardSchema.parse(value)) },
    { name: "quizzes", parse: (value) => asRecord(quizSchema.parse(value)) },
    { name: "quiz_attempts", parse: (value) => asRecord(quizAttemptSchema.parse(value)) },
    { name: "feedback", parse: (value) => asRecord(feedbackSchema.parse(value)) },
    { name: "activity_events", parse: (value) => asRecord(activityEventSchema.parse(value)) },
    { name: "gap_reports", parse: (value) => asRecord(gapReportSchema.parse(value)) },
    { name: "config_versions", parse: (value) => asRecord(configVersionSchema.parse(value)) },
    { name: "agent_executions", parse: (value) => asRecord(agentExecutionSchema.parse(value)) },
  ];

  for (const payloadCollection of payloads) {
    for (const raw of rows(legacy, payloadCollection.name)) {
      const source = payloadCollection.parse(raw);
      const imported = remapPayloadUserIds(source, userIds);
      const inserted = await store
        .getCollection<LegacyRecord>(payloadCollection.name)
        .insertImportedRecord(imported);
      recordCount(counts, payloadCollection.name, inserted);
    }
  }
}

function remapPayloadUserIds(
  source: LegacyRecord,
  userIds: Map<string, string>,
): LegacyRecord {
  const mapped = { ...source };
  for (const key of [
    "userId",
    "ownerId",
    "createdBy",
    "changedBy",
    "decidedBy",
  ]) {
    const value = mapped[key];
    if (typeof value === "string") mapped[key] = mapUserId(userIds, value);
  }
  return mapped;
}

async function importAuditLogs(
  legacy: LegacyCollections,
  store: PostgresStore,
  userIds: Map<string, string>,
  counts: Counts,
): Promise<void> {
  for (const raw of rows(legacy, "audit_logs")) {
    const source = auditLogSchema.parse(raw);
    const imported = auditLogSchema.parse({
      ...source,
      actorId: mapUserId(userIds, source.actorId),
      targetId:
        source.targetType === "user"
          ? mapUserId(userIds, source.targetId)
          : source.targetId,
    });
    const inserted = await store
      .getCollection<AuditLogRecord>("audit_logs")
      .insertImportedRecord(imported);
    recordCount(counts, "audit_logs", inserted);
  }
}

async function importSqliteConversations(
  dataDirectory: string,
  postgres: Pool,
  mongo: Db,
  userIds: Map<string, string>,
): Promise<Pick<Counts, "conversations" | "messages" | "chat_daily_usage">> {
  const path = join(dataDirectory, "sqlite", "conversations.db");
  try {
    await access(path);
  } catch (error) {
    if (isMissingFile(error)) {
      return {
        conversations: emptyCount(),
        messages: emptyCount(),
        chat_daily_usage: emptyCount(),
      };
    }
    throw error;
  }

  const database = new DatabaseSync(path, { readOnly: true });
  const counts = {
    conversations: emptyCount(),
    messages: emptyCount(),
    chat_daily_usage: emptyCount(),
  };
  try {
    const conversations = database
      .prepare(
        `SELECT id, user_id, course_id, title, created_at, updated_at
         FROM conversations ORDER BY id`,
      )
      .all() as Array<Record<string, unknown>>;
    const conversationCollection = mongo.collection<Document>("conversations");
    const messageCollection = mongo.collection<Document>("messages");
    for (const row of conversations) {
      const conversation: ConversationRecord = {
        id: requiredString(row.id, "conversations.id"),
        userId: mapUserId(userIds, requiredString(row.user_id, "conversations.user_id")),
        courseId: requiredString(row.course_id, "conversations.course_id"),
        title: nullableString(row.title, "conversations.title"),
        createdAt: requiredString(row.created_at, "conversations.created_at"),
        updatedAt: requiredString(row.updated_at, "conversations.updated_at"),
      };
      const inserted = await insertMongoRecord(conversationCollection, conversation);
      recordCount(counts, "conversations", inserted);
    }

    const messageColumns = database
      .prepare("PRAGMA table_info(messages)")
      .all() as Array<{ name: string }>;
    const citationsColumn = messageColumns.some(
      (column) => column.name === "citations",
    )
      ? "citations"
      : "NULL AS citations";
    const messages = database
      .prepare(
        `SELECT id, conversation_id, role, content, created_at, execution_id, intent,
                grounding_status, ${citationsColumn}, retrieval_score_top
         FROM messages ORDER BY conversation_id, created_at, rowid`,
      )
      .all() as Array<Record<string, unknown>>;
    for (const row of messages) {
      const intentValue = nullableString(row.intent, "messages.intent");
      const message: ConversationMessageRecord = {
        id: requiredString(row.id, "messages.id"),
        conversationId: requiredString(row.conversation_id, "messages.conversation_id"),
        role: parseMessageRole(row.role),
        content: requiredString(row.content, "messages.content"),
        createdAt: requiredString(row.created_at, "messages.created_at"),
        executionId: nullableString(row.execution_id, "messages.execution_id"),
        intent: parseLegacyConversationIntent(intentValue),
        groundingStatus: parseGroundingStatus(row.grounding_status),
        citations: parseLegacyConversationCitations(
          nullableString(row.citations, "messages.citations"),
        ),
        retrievalScoreTop: nullableNumber(
          row.retrieval_score_top,
          "messages.retrieval_score_top",
        ),
      };
      const inserted = await insertMongoRecord(messageCollection, message);
      recordCount(counts, "messages", inserted);
    }

    const usageRows = database
      .prepare(
        `SELECT user_id, usage_date, request_count, token_count
         FROM chat_daily_usage ORDER BY user_id, usage_date`,
      )
      .all() as Array<Record<string, unknown>>;
    for (const row of usageRows) {
      const result = await postgres.query(
        `INSERT INTO chat_daily_usage (user_id, usage_date, request_count, token_count)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, usage_date) DO NOTHING`,
        [
          mapUserId(userIds, requiredString(row.user_id, "chat_daily_usage.user_id")),
          requiredString(row.usage_date, "chat_daily_usage.usage_date"),
          requiredInteger(row.request_count, "chat_daily_usage.request_count"),
          requiredInteger(row.token_count, "chat_daily_usage.token_count"),
        ],
      );
      recordCount(counts, "chat_daily_usage", result.rowCount === 1);
    }
    return counts;
  } finally {
    database.close();
  }
}

async function insertMongoRecord(
  collection: ReturnType<Db["collection"]>,
  record: ConversationRecord | ConversationMessageRecord,
): Promise<boolean> {
  const existing = await collection.findOne({ id: record.id });
  if (existing) {
    if (stableSerialize(stripMongoId(existing)) !== stableSerialize(record)) {
      throw new Error(
        `Legacy MongoDB record "${record.id}" conflicts with existing data`,
      );
    }
    return false;
  }
  const result = await collection.updateOne(
    { id: record.id },
    { $setOnInsert: record },
    { upsert: true },
  );
  if (result.upsertedCount === 1) return true;
  const concurrent = await collection.findOne({ id: record.id });
  if (
    !concurrent ||
    stableSerialize(stripMongoId(concurrent)) !== stableSerialize(record)
  ) {
    throw new Error(`Legacy MongoDB record "${record.id}" conflicted during import`);
  }
  return false;
}

function stripMongoId(record: Document): Record<string, unknown> {
  const { _id: _ignoredId, ...document } = record;
  return document;
}

function asRecord(value: unknown): LegacyRecord {
  const object = recordSchema.parse(value);
  return {
    ...object,
    id: z.string().uuid().parse(object.id),
  };
}

function rows(collections: LegacyCollections, name: string): LegacyRecord[] {
  const result = collections.get(name);
  if (!result) throw new Error(`Legacy collection "${name}" was not loaded`);
  return result;
}

function mapUserId(userIds: Map<string, string>, id: string): string {
  return userIds.get(id) ?? id;
}

function recordCount(counts: Counts, name: string, inserted: boolean): void {
  const count = counts[name] ?? emptyCount();
  if (inserted) count.inserted += 1;
  else count.alreadyPresent += 1;
  counts[name] = count;
}

function emptyCount(): { inserted: number; alreadyPresent: number } {
  return { inserted: 0, alreadyPresent: 0 };
}

function requiredString(value: unknown, column: string): string {
  if (typeof value !== "string") throw new Error(`Invalid legacy field ${column}`);
  return value;
}

function nullableString(value: unknown, column: string): string | null {
  return value === null || value === undefined
    ? null
    : requiredString(value, column);
}

function requiredInteger(value: unknown, column: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error(`Invalid legacy field ${column}`);
  }
  return value;
}

function nullableNumber(value: unknown, column: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid legacy field ${column}`);
  }
  return value;
}

function parseMessageRole(value: unknown): "user" | "assistant" {
  if (value !== "user" && value !== "assistant") {
    throw new Error("Stored conversation message role is invalid");
  }
  return value;
}

function parseGroundingStatus(value: unknown) {
  if (
    value === null ||
    value === undefined ||
    value === "grounded" ||
    value === "insufficient" ||
    value === "unverified"
  ) {
    return value ?? null;
  }
  throw new Error("Stored conversation grounding status is invalid");
}

function stableSerialize(value: unknown): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableSerialize(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
