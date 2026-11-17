import { z } from "zod";
import type { JsonCollection, JsonStore } from "./json-store";

const idSchema = z.string().uuid();
const timestampSchema = z.string().datetime();

export const userSchema = z
  .object({
    id: idSchema,
    email: z.string().email(),
    passwordHash: z.string().min(1),
    displayName: z.string().min(1).max(80),
    roleId: idSchema,
    permsVersion: z.number().int().positive().optional(),
    status: z.enum(["active", "suspended", "archived"]),
    mustChangePassword: z.boolean(),
    failedLoginCount: z.number().int().nonnegative(),
    lockedUntil: timestampSchema.nullable().optional(),
    resetTokenHash: z.string().nullable().optional(),
    resetTokenExpiresAt: timestampSchema.nullable().optional(),
    passwordChangedAt: timestampSchema.nullable().optional(),
    lastLoginAt: timestampSchema.nullable().optional(),
    erasedAt: timestampSchema.nullable().optional(),
    pseudonymId: idSchema.nullable().optional(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const roleSchema = z
  .object({
    id: idSchema,
    name: z.enum(["learner", "coach", "admin"]),
    description: z.string().optional(),
    createdAt: timestampSchema,
  })
  .strict();

export const permissionSchema = z
  .object({
    id: idSchema,
    key: z.string().min(1),
    area: z.string().min(1),
    description: z.string().optional(),
  })
  .strict();

export const rolePermissionSchema = z
  .object({
    id: idSchema,
    roleId: idSchema,
    permissionId: idSchema,
  })
  .strict();

export const userPermissionOverrideSchema = z
  .object({
    id: idSchema,
    userId: idSchema,
    permissionId: idSchema,
    effect: z.enum(["grant", "revoke"]),
    changedBy: idSchema,
    createdAt: timestampSchema,
  })
  .strict();

export const refreshTokenSchema = z
  .object({
    id: idSchema,
    userId: idSchema,
    familyId: idSchema,
    tokenHash: z.string().length(64),
    createdAt: timestampSchema,
    expiresAt: timestampSchema,
    usedAt: timestampSchema.nullable().optional(),
    revokedAt: timestampSchema.nullable().optional(),
    replacedByTokenId: idSchema.nullable().optional(),
  })
  .strict();

export const coachRequestSchema = z
  .object({
    id: idSchema,
    userId: idSchema,
    status: z.enum(["pending", "approved", "rejected"]),
    message: z.string().max(500).optional(),
    requestedAt: timestampSchema,
    decidedBy: idSchema.nullable().optional(),
    decidedAt: timestampSchema.nullable().optional(),
    decisionNote: z.string().nullable().optional(),
  })
  .strict();

export const courseSchema = z
  .object({
    id: idSchema,
    ownerId: idSchema,
    name: z.string().min(1).max(120),
    description: z.string().max(2000).optional(),
    status: z.enum(["active", "archived"]),
    archivedAt: timestampSchema.nullable().optional(),
    archivedBy: idSchema.nullable().optional(),
    version: z.number().int().positive(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const enrolmentSchema = z
  .object({
    id: idSchema,
    courseId: idSchema,
    userId: idSchema,
    status: z.enum(["pending", "approved", "rejected", "removed"]),
    requestedAt: timestampSchema,
    decidedBy: idSchema.nullable().optional(),
    decidedAt: timestampSchema.nullable().optional(),
    decisionNote: z.string().max(1000).nullable().optional(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

export const documentSchema = z
  .object({
    id: idSchema,
    courseId: idSchema,
    ownerId: idSchema,
    scope: z.enum(["course", "personal"]),
    filename: z.string().min(1).max(255),
    storageKey: idSchema,
    mimeType: z.enum([
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
    ]),
    sizeBytes: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    status: z.enum([
      "uploaded",
      "processing",
      "ready",
      "failed",
      "deleting",
    ]),
    errorCode: z.string().regex(/^[A-Z0-9_]{1,80}$/).nullable().optional(),
    errorDetail: z.string().max(500).nullable().optional(),
    extractionDiagnostics: z
      .object({
        parser: z.enum(["pdfjs-dist", "mammoth", "utf8"]),
        pageCount: z.number().int().nonnegative(),
        charCount: z.number().int().nonnegative(),
        lowTextPages: z.array(z.number().int().positive()).max(1000),
        warnings: z.array(z.string().max(200)).max(100),
      })
      .strict()
      .nullable()
      .optional(),
    chunkCount: z.number().int().nonnegative().nullable().optional(),
    embeddingModel: z.string().min(1).max(100).nullable().optional(),
    ingestJobId: idSchema.nullable().optional(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    readyAt: timestampSchema.nullable().optional(),
  })
  .strict();

export const auditLogSchema = z
  .object({
    id: idSchema,
    actorId: z.string().min(1),
    actorRole: z.string().min(1),
    action: z.string().min(1),
    targetType: z.string().min(1),
    targetId: z.string().min(1),
    before: z.record(z.string(), z.unknown()).nullable().optional(),
    after: z.record(z.string(), z.unknown()).nullable().optional(),
    requestId: z.string().nullable().optional(),
    createdAt: timestampSchema,
  })
  .strict();

const jobDataSchema = z.record(
  z.string().min(1).max(100),
  z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null()]),
);

export const jobSchema = z
  .object({
    id: idSchema,
    type: z.enum([
      "ingest",
      "reembed",
      "generate",
      "cluster",
      "cleanup",
      "reconcile",
      "backup",
      "prune",
    ]),
    status: z.enum(["queued", "running", "done", "failed", "dead"]),
    attempts: z.number().int().nonnegative(),
    maxAttempts: z.number().int().min(1).max(10),
    runAfter: timestampSchema,
    lockedUntil: timestampSchema.nullable(),
    leaseToken: idSchema.nullable(),
    payload: jobDataSchema,
    result: jobDataSchema.nullable().optional(),
    error: z
      .object({
        code: z.string().regex(/^[A-Z0-9_]{1,80}$/),
        message: z.string().max(200),
      })
      .strict()
      .nullable()
      .optional(),
    createdBy: z.string().min(1).max(100),
    requestId: z.string().max(128).nullable().optional(),
    scheduleKey: z.string().min(1).max(256).optional(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    finishedAt: timestampSchema.nullable(),
  })
  .strict();

export const schedulerStateSchema = z
  .object({
    id: idSchema,
    taskName: z.string().min(1).max(100),
    lastRunAt: timestampSchema.nullable(),
    nextRunAt: timestampSchema,
    lastStatus: z.enum(["ok", "error", "skipped"]),
  })
  .strict();

export type UserRecord = z.infer<typeof userSchema>;
export type RoleRecord = z.infer<typeof roleSchema>;
export type PermissionRecord = z.infer<typeof permissionSchema>;
export type RolePermissionRecord = z.infer<typeof rolePermissionSchema>;
export type UserPermissionOverrideRecord = z.infer<
  typeof userPermissionOverrideSchema
>;
export type RefreshTokenRecord = z.infer<typeof refreshTokenSchema>;
export type CoachRequestRecord = z.infer<typeof coachRequestSchema>;
export type CourseRecord = z.infer<typeof courseSchema>;
export type EnrolmentRecord = z.infer<typeof enrolmentSchema>;
export type DocumentRecord = z.infer<typeof documentSchema>;
export type AuditLogRecord = z.infer<typeof auditLogSchema>;
export type JobRecord = z.infer<typeof jobSchema>;
export type SchedulerStateRecord = z.infer<typeof schedulerStateSchema>;

export interface SystemCollections {
  users: JsonCollection<UserRecord>;
  roles: JsonCollection<RoleRecord>;
  permissions: JsonCollection<PermissionRecord>;
  rolePermissions: JsonCollection<RolePermissionRecord>;
  userPermissionOverrides: JsonCollection<UserPermissionOverrideRecord>;
  refreshTokens: JsonCollection<RefreshTokenRecord>;
  coachRequests: JsonCollection<CoachRequestRecord>;
  courses: JsonCollection<CourseRecord>;
  enrolments: JsonCollection<EnrolmentRecord>;
  documents: JsonCollection<DocumentRecord>;
  auditLogs: JsonCollection<AuditLogRecord>;
  jobs: JsonCollection<JobRecord>;
  schedulerState: JsonCollection<SchedulerStateRecord>;
}

/**
 * Registers the identity, course, document, audit, and background-job collections.
 */
export function registerSystemCollections(store: JsonStore): SystemCollections {
  return {
    users: store.register({
      name: "users",
      schema: userSchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        { name: "email", key: (record) => record.email, unique: true },
        { name: "roleId", key: (record) => record.roleId },
        { name: "status", key: (record) => record.status },
      ],
    }),
    roles: store.register({
      name: "roles",
      schema: roleSchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        { name: "name", key: (record) => record.name, unique: true },
      ],
    }),
    permissions: store.register({
      name: "permissions",
      schema: permissionSchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        { name: "key", key: (record) => record.key, unique: true },
      ],
    }),
    rolePermissions: store.register({
      name: "role_permissions",
      schema: rolePermissionSchema,
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
      name: "user_permission_overrides",
      schema: userPermissionOverrideSchema,
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
      name: "refresh_tokens",
      schema: refreshTokenSchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        { name: "tokenHash", key: (record) => record.tokenHash, unique: true },
        { name: "familyId", key: (record) => record.familyId },
        { name: "userId", key: (record) => record.userId },
      ],
    }),
    coachRequests: store.register({
      name: "coach_requests",
      schema: coachRequestSchema,
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
      name: "courses",
      schema: courseSchema,
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
      name: "enrolments",
      schema: enrolmentSchema,
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
    documents: store.register({
      name: "documents",
      schema: documentSchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        { name: "courseId", key: (record) => record.courseId },
        {
          name: "courseScopeOwner",
          key: (record) =>
            `${record.courseId}:${record.scope}:${record.ownerId}`,
        },
        {
          name: "courseScopeOwnerHash",
          key: (record) =>
            record.status === "deleting"
              ? undefined
              : `${record.courseId}:${record.scope}:${record.ownerId}:${record.contentHash}`,
          unique: true,
        },
        { name: "status", key: (record) => record.status },
      ],
    }),
    auditLogs: store.register({
      name: "audit_logs",
      schema: auditLogSchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        { name: "actorId", key: (record) => record.actorId },
        { name: "createdAt", key: (record) => record.createdAt },
      ],
    }),
    jobs: store.register({
      name: "jobs",
      schema: jobSchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        {
          name: "statusRunAfter",
          key: (record) => `${record.status}:${record.runAfter}`,
        },
        {
          name: "typeStatus",
          key: (record) => `${record.type}:${record.status}`,
        },
        {
          name: "scheduleKey",
          key: (record) => record.scheduleKey,
          unique: true,
        },
      ],
    }),
    schedulerState: store.register({
      name: "scheduler_state",
      schema: schedulerStateSchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        { name: "taskName", key: (record) => record.taskName, unique: true },
      ],
    }),
  };
}
