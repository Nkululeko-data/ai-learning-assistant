import type { ZodType } from "zod";
import type { JsonIndexDefinition } from "../jsonstore/json-store";
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
} from "../jsonstore/system-collections";
import type {
  ActivityEventRecord,
  AgentExecutionRecord,
  AuditLogRecord,
  CoachRequestRecord,
  ConfigVersionRecord,
  CourseRecord,
  DocumentRecord,
  EnrolmentRecord,
  FeedbackRecord,
  FlashcardRecord,
  GapReportRecord,
  LearningSummaryRecord,
  PermissionRecord,
  QuizAttemptRecord,
  QuizRecord,
  RefreshTokenRecord,
  RolePermissionRecord,
  RoleRecord,
  SchedulerStateRecord,
  SystemCollections,
  UserPermissionOverrideRecord,
  UserRecord,
  JobRecord,
} from "../jsonstore/system-collections";
import { PostgresStore, type PostgresField } from "./postgres-store";
import type { MongoBackedSystemCollections } from "../mongo/mongo-system-collections";

type Entity = { id: string };
type Indexes<T extends Entity> = JsonIndexDefinition<T>[];

function field<T extends Entity>(
  property: keyof T & string,
  column: string,
  options: Pick<PostgresField<T>, "encode" | "decode"> = {},
): PostgresField<T> {
  return { property, column, ...options };
}

function timestamp<T extends Entity>(
  property: keyof T & string,
  column: string,
): PostgresField<T> {
  return field<T>(property, column, {
    decode: (value) => (value instanceof Date ? value.toISOString() : value),
  });
}

function optionalField<T extends Entity>(
  property: keyof T & string,
  column: string,
): PostgresField<T> {
  return field<T>(property, column, {
    decode: (value) => (value === null ? undefined : value),
  });
}

function optionalTimestamp<T extends Entity>(
  property: keyof T & string,
  column: string,
): PostgresField<T> {
  return field<T>(property, column, {
    decode: (value) =>
      value === null
        ? undefined
        : value instanceof Date
          ? value.toISOString()
          : value,
  });
}

function payload<T extends Entity>(
  store: PostgresStore,
  table: string,
  schema: ZodType<T>,
  indexes: Indexes<T>,
) {
  return store.register({
    table,
    schema,
    payloadColumn: true,
    indexes,
  });
}

export function registerPostgresSystemCollections(
  store: PostgresStore,
  mongoCollections?: MongoBackedSystemCollections,
): SystemCollections {
  return {
    users: store.register({
      table: "users",
      schema: userSchema,
      fields: [
        field<UserRecord>("id", "id"),
        field<UserRecord>("email", "email"),
        field<UserRecord>("passwordHash", "password_hash"),
        field<UserRecord>("displayName", "display_name"),
        field<UserRecord>("roleId", "role_id"),
        field<UserRecord>("permsVersion", "perms_version", {
          encode: (value) => value ?? 1,
        }),
        field<UserRecord>("status", "status"),
        field<UserRecord>("mustChangePassword", "must_change_password"),
        field<UserRecord>("failedLoginCount", "failed_login_count"),
        timestamp<UserRecord>("lockedUntil", "locked_until"),
        field<UserRecord>("resetTokenHash", "reset_token_hash"),
        timestamp<UserRecord>("resetTokenExpiresAt", "reset_token_expires_at"),
        timestamp<UserRecord>("passwordChangedAt", "password_changed_at"),
        timestamp<UserRecord>("lastLoginAt", "last_login_at"),
        timestamp<UserRecord>("erasedAt", "erased_at"),
        field<UserRecord>("pseudonymId", "pseudonym_id"),
        timestamp<UserRecord>("createdAt", "created_at"),
        timestamp<UserRecord>("updatedAt", "updated_at"),
      ],
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        { name: "email", key: (record) => record.email, unique: true },
        { name: "roleId", key: (record) => record.roleId },
        { name: "status", key: (record) => record.status },
      ],
    }),
    roles: store.register({
      table: "roles",
      schema: roleSchema,
      fields: [
        field<RoleRecord>("id", "id"),
        field<RoleRecord>("name", "name"),
        optionalField<RoleRecord>("description", "description"),
        timestamp<RoleRecord>("createdAt", "created_at"),
      ],
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        { name: "name", key: (record) => record.name, unique: true },
      ],
    }),
    permissions: store.register({
      table: "permissions",
      schema: permissionSchema,
      fields: [
        field<PermissionRecord>("id", "id"),
        field<PermissionRecord>("key", "key"),
        field<PermissionRecord>("area", "area"),
        optionalField<PermissionRecord>("description", "description"),
      ],
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        { name: "key", key: (record) => record.key, unique: true },
      ],
    }),
    rolePermissions: store.register({
      table: "role_permissions",
      schema: rolePermissionSchema,
      fields: [
        field<RolePermissionRecord>("id", "id"),
        field<RolePermissionRecord>("roleId", "role_id"),
        field<RolePermissionRecord>("permissionId", "permission_id"),
      ],
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        {
          name: "role_permission",
          key: (record) => `${record.roleId}:${record.permissionId}`,
          unique: true,
        },
        { name: "roleId", key: (record) => record.roleId },
      ],
    }),
    userPermissionOverrides: store.register({
      table: "user_permission_overrides",
      schema: userPermissionOverrideSchema,
      fields: [
        field<UserPermissionOverrideRecord>("id", "id"),
        field<UserPermissionOverrideRecord>("userId", "user_id"),
        field<UserPermissionOverrideRecord>("permissionId", "permission_id"),
        field<UserPermissionOverrideRecord>("effect", "effect"),
        field<UserPermissionOverrideRecord>("changedBy", "changed_by"),
        timestamp<UserPermissionOverrideRecord>("createdAt", "created_at"),
      ],
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        {
          name: "user_permission",
          key: (record) => `${record.userId}:${record.permissionId}`,
          unique: true,
        },
        { name: "userId", key: (record) => record.userId },
      ],
    }),
    refreshTokens: store.register({
      table: "refresh_tokens",
      schema: refreshTokenSchema,
      fields: [
        field<RefreshTokenRecord>("id", "id"),
        field<RefreshTokenRecord>("userId", "user_id"),
        field<RefreshTokenRecord>("familyId", "family_id"),
        field<RefreshTokenRecord>("tokenHash", "token_hash"),
        timestamp<RefreshTokenRecord>("createdAt", "created_at"),
        timestamp<RefreshTokenRecord>("expiresAt", "expires_at"),
        timestamp<RefreshTokenRecord>("usedAt", "used_at"),
        timestamp<RefreshTokenRecord>("revokedAt", "revoked_at"),
        field<RefreshTokenRecord>("replacedByTokenId", "replaced_by_token_id"),
      ],
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        { name: "tokenHash", key: (record) => record.tokenHash, unique: true },
        { name: "familyId", key: (record) => record.familyId },
        { name: "userId", key: (record) => record.userId },
      ],
    }),
    coachRequests: store.register({
      table: "coach_requests",
      schema: coachRequestSchema,
      fields: [
        field<CoachRequestRecord>("id", "id"),
        field<CoachRequestRecord>("userId", "user_id"),
        field<CoachRequestRecord>("status", "status"),
        optionalField<CoachRequestRecord>("message", "message"),
        timestamp<CoachRequestRecord>("requestedAt", "requested_at"),
        field<CoachRequestRecord>("decidedBy", "decided_by"),
        timestamp<CoachRequestRecord>("decidedAt", "decided_at"),
        field<CoachRequestRecord>("decisionNote", "decision_note"),
      ],
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        { name: "userId", key: (record) => record.userId },
        { name: "status", key: (record) => record.status },
        {
          name: "pendingUserId",
          key: (record) => (record.status === "pending" ? record.userId : undefined),
          unique: true,
        },
      ],
    }),
    courses: store.register({
      table: "courses",
      schema: courseSchema,
      fields: [
        field<CourseRecord>("id", "id"),
        field<CourseRecord>("ownerId", "owner_id"),
        field<CourseRecord>("name", "title"),
        optionalField<CourseRecord>("description", "description"),
        field<CourseRecord>("lessons", "lessons", {
          encode: (value) => value ?? [],
        }),
        field<CourseRecord>("status", "status"),
        field<CourseRecord>("approvalStatus", "approval_status", {
          encode: (value) => value ?? "approved",
        }),
        field<CourseRecord>("approvalNote", "approval_note"),
        optionalTimestamp<CourseRecord>(
          "approvalRequestedAt",
          "approval_requested_at",
        ),
        field<CourseRecord>("reviewedBy", "reviewed_by"),
        timestamp<CourseRecord>("reviewedAt", "reviewed_at"),
        timestamp<CourseRecord>("archivedAt", "archived_at"),
        field<CourseRecord>("archivedBy", "archived_by"),
        field<CourseRecord>("version", "version"),
        timestamp<CourseRecord>("createdAt", "created_at"),
        timestamp<CourseRecord>("updatedAt", "updated_at"),
      ],
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        { name: "ownerId", key: (record) => record.ownerId },
        {
          name: "ownerStatus",
          key: (record) => `${record.ownerId}:${record.status}`,
        },
        { name: "status", key: (record) => record.status },
      ],
    }),
    enrolments: store.register({
      table: "enrolments",
      schema: enrolmentSchema,
      fields: [
        field<EnrolmentRecord>("id", "id"),
        field<EnrolmentRecord>("courseId", "course_id"),
        field<EnrolmentRecord>("userId", "user_id"),
        field<EnrolmentRecord>("status", "status"),
        timestamp<EnrolmentRecord>("requestedAt", "requested_at"),
        field<EnrolmentRecord>("decidedBy", "decided_by"),
        timestamp<EnrolmentRecord>("decidedAt", "decided_at"),
        field<EnrolmentRecord>("decisionNote", "decision_note"),
        timestamp<EnrolmentRecord>("createdAt", "created_at"),
        timestamp<EnrolmentRecord>("updatedAt", "updated_at"),
      ],
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        {
          name: "courseUser",
          key: (record) => `${record.courseId}:${record.userId}`,
          unique: true,
        },
        {
          name: "courseStatus",
          key: (record) => `${record.courseId}:${record.status}`,
        },
        {
          name: "userStatus",
          key: (record) => `${record.userId}:${record.status}`,
        },
        { name: "courseId", key: (record) => record.courseId },
        { name: "userId", key: (record) => record.userId },
      ],
    }),
    documents: payload(store, "documents", documentSchema, [
      { name: "id", key: (record) => record.id, unique: true },
      { name: "courseId", key: (record) => record.courseId },
      {
        name: "courseScopeOwnerHash",
        key: (record) =>
          record.status === "deleting"
            ? undefined
            : `${record.courseId}:${record.scope}:${record.ownerId}:${record.contentHash}`,
        unique: true,
      },
    ]),
    learningSummaries: mongoCollections?.learningSummaries ?? payload(store, "learning_summaries", learningSummarySchema, [
      { name: "id", key: (record) => record.id, unique: true },
      { name: "sourceHash", key: (record) => record.sourceHash },
      {
        name: "sourceHashVersion",
        key: (record) => `${record.courseId}:${record.ownerId ?? "course"}:${record.sourceHash}:${record.version}`,
        unique: true,
      },
      { name: "courseId", key: (record) => record.courseId },
      { name: "ownerId", key: (record) => record.ownerId ?? undefined },
    ]),
    flashcards: mongoCollections?.flashcards ?? payload(store, "flashcards", flashcardSchema, [
      { name: "id", key: (record) => record.id, unique: true },
      { name: "sourceHash", key: (record) => record.sourceHash },
      {
        name: "sourceHashVersion",
        key: (record) => `${record.courseId}:${record.ownerId ?? "course"}:${record.sourceHash}:${record.version}`,
        unique: true,
      },
      { name: "courseId", key: (record) => record.courseId },
      { name: "ownerId", key: (record) => record.ownerId ?? undefined },
    ]),
    quizzes: mongoCollections?.quizzes ?? payload(store, "quizzes", quizSchema, [
      { name: "id", key: (record) => record.id, unique: true },
      {
        name: "lineageVersion",
        key: (record) => `${record.lineageId}:${record.version}`,
        unique: true,
      },
      { name: "courseId", key: (record) => record.courseId },
      { name: "ownerId", key: (record) => record.ownerId ?? undefined },
    ]),
    quizAttempts: payload(store, "quiz_attempts", quizAttemptSchema, [
      { name: "id", key: (record) => record.id, unique: true },
      { name: "userId", key: (record) => record.userId },
      { name: "quizId", key: (record) => record.quizId },
      {
        name: "courseLineage",
        key: (record) => `${record.courseId}:${record.lineageId}`,
      },
    ]),
    auditLogs: store.register({
      table: "audit_logs",
      schema: auditLogSchema,
      fields: [
        field<AuditLogRecord>("id", "id"),
        field<AuditLogRecord>("actorId", "actor_id"),
        field<AuditLogRecord>("actorRole", "actor_role"),
        field<AuditLogRecord>("action", "action"),
        field<AuditLogRecord>("targetType", "target_type"),
        field<AuditLogRecord>("targetId", "target_id"),
        field<AuditLogRecord>("before", "before"),
        field<AuditLogRecord>("after", "after"),
        field<AuditLogRecord>("requestId", "request_id"),
        timestamp<AuditLogRecord>("createdAt", "created_at"),
      ],
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        { name: "actorId", key: (record) => record.actorId },
        { name: "createdAt", key: (record) => record.createdAt },
      ],
    }),
    feedback: payload(store, "feedback", feedbackSchema, [
      { name: "id", key: (record) => record.id, unique: true },
      {
        name: "messageUser",
        key: (record) => `${record.messageId}:${record.userId}`,
        unique: true,
      },
      { name: "courseId", key: (record) => record.courseId },
      { name: "userId", key: (record) => record.userId },
    ]),
    activityEvents: payload(store, "activity_events", activityEventSchema, [
      { name: "id", key: (record) => record.id, unique: true },
      { name: "dedupeKey", key: (record) => record.dedupeKey, unique: true },
      { name: "courseId", key: (record) => record.courseId },
      { name: "userId", key: (record) => record.userId },
      { name: "createdAt", key: (record) => record.createdAt },
    ]),
    gapReports: payload(store, "gap_reports", gapReportSchema, [
      { name: "id", key: (record) => record.id, unique: true },
      { name: "courseId", key: (record) => record.courseId },
      { name: "createdAt", key: (record) => record.createdAt },
    ]),
    configVersions: payload(store, "config_versions", configVersionSchema, [
      { name: "id", key: (record) => record.id, unique: true },
      { name: "version", key: (record) => String(record.version), unique: true },
      { name: "changedBy", key: (record) => record.changedBy },
      { name: "createdAt", key: (record) => record.createdAt },
    ]),
    agentExecutions: mongoCollections?.agentExecutions ?? payload(store, "agent_executions", agentExecutionSchema, [
      { name: "id", key: (record) => record.id, unique: true },
      { name: "executionId", key: (record) => record.executionId },
      { name: "createdAt", key: (record) => record.createdAt },
      {
        name: "graphNodeCreatedAt",
        key: (record) => `${record.graph}:${record.node}:${record.createdAt}`,
      },
      {
        name: "userUsageDate",
        key: (record) => `${record.userId}:${record.usageDate}`,
      },
    ]),
    jobs: payload(store, "jobs", jobSchema, [
      { name: "id", key: (record) => record.id, unique: true },
      {
        name: "statusRunAfter",
        key: (record) => `${record.status}:${record.runAfter}`,
      },
      { name: "scheduleKey", key: (record) => record.scheduleKey, unique: true },
    ]),
    schedulerState: payload(store, "scheduler_state", schedulerStateSchema, [
      { name: "id", key: (record) => record.id, unique: true },
      { name: "taskName", key: (record) => record.taskName, unique: true },
    ]),
  };
}

