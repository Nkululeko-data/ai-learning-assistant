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

export type UserRecord = z.infer<typeof userSchema>;
export type RoleRecord = z.infer<typeof roleSchema>;
export type PermissionRecord = z.infer<typeof permissionSchema>;
export type RolePermissionRecord = z.infer<typeof rolePermissionSchema>;
export type UserPermissionOverrideRecord = z.infer<
  typeof userPermissionOverrideSchema
>;
export type RefreshTokenRecord = z.infer<typeof refreshTokenSchema>;
export type CoachRequestRecord = z.infer<typeof coachRequestSchema>;
export type AuditLogRecord = z.infer<typeof auditLogSchema>;

export interface SystemCollections {
  users: JsonCollection<UserRecord>;
  roles: JsonCollection<RoleRecord>;
  permissions: JsonCollection<PermissionRecord>;
  rolePermissions: JsonCollection<RolePermissionRecord>;
  userPermissionOverrides: JsonCollection<UserPermissionOverrideRecord>;
  refreshTokens: JsonCollection<RefreshTokenRecord>;
  coachRequests: JsonCollection<CoachRequestRecord>;
  auditLogs: JsonCollection<AuditLogRecord>;
}

/**
 * Registers the identity and audit collections required by bootstrap and auth.
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
    auditLogs: store.register({
      name: "audit_logs",
      schema: auditLogSchema,
      indexes: [
        { name: "id", key: (record) => record.id, unique: true },
        { name: "actorId", key: (record) => record.actorId },
        { name: "createdAt", key: (record) => record.createdAt },
      ],
    }),
  };
}
