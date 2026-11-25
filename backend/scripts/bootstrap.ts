import argon2 from "argon2";
import { loadConfig } from "../src/config/config";
import { createLogger } from "../src/common/logging/logger";
import { createSystemStore } from "../src/infra/jsonstore/create-system-store";
import type { SystemCollections } from "../src/infra/jsonstore/system-collections";
import { createPostgresPool } from "../src/infra/postgres/connection";
import {
  CURRENT_DATABASE_SCHEMA_VERSION,
  getDatabaseSchemaVersion,
} from "../src/infra/postgres/migrations/006-runtime-storage";

const roleDefinitions = [
  { name: "learner" as const, description: "Learner account" },
  { name: "coach" as const, description: "Coach account" },
  { name: "admin" as const, description: "Administrator account" },
];

const permissionDefinitions = [
  "course:create",
  "course:edit",
  "course:archive",
  "document:upload",
  "document:delete",
  "enrolment:approve",
  "insights:view",
  "feedback:review",
  "content:generate",
  "quiz:create",
  "user:manage",
  "role:manage",
  "config:manage",
  "config:view",
  "audit:view",
  "executions:view",
];

const baselinePermissions: Record<string, string[]> = {
  learner: [
    "document:upload",
    "document:delete",
    "content:generate",
    "quiz:create",
  ],
  coach: [
    "course:create",
    "course:edit",
    "course:archive",
    "document:upload",
    "document:delete",
    "enrolment:approve",
    "insights:view",
    "feedback:review",
    "content:generate",
    "quiz:create",
  ],
  admin: [
    "user:manage",
    "role:manage",
    "config:manage",
    "config:view",
    "audit:view",
    "executions:view",
  ],
};

const weakPasswords = new Set([
  "password",
  "password123",
  "password123!",
  "changeme",
  "admin",
  "admin123",
  "123456789012",
]);

export interface BootstrapOptions {
  dataDirectory?: string;
  databaseUrl?: string | undefined;
  environment: "development" | "test" | "production";
  adminEmail: string | undefined;
  adminPassword: string | undefined;
  passwordMinLength: number;
  reset: boolean;
  yes: boolean;
  demo: boolean;
}

export interface BootstrapResult {
  rolesAdded: number;
  permissionsAdded: number;
  rolePermissionsAdded: number;
  adminCreated: boolean;
  adminAlreadyExists: boolean;
}

/**
 * Initializes storage, seeds baseline access data, and creates the first admin once.
 */
export async function bootstrapSystem(
  options: BootstrapOptions,
): Promise<BootstrapResult> {
  if (options.environment === "production" && options.reset) {
    throw new Error("Refusing to reset data in production");
  }
  if (options.reset && !options.yes) {
    throw new Error("The --reset option requires the explicit --yes flag");
  }
  if (options.reset) {
    throw new Error(
      "Database reset is not supported by bootstrap; use a reviewed database maintenance procedure",
    );
  }
  if (options.demo) {
    throw new Error(
      "Demo seeding is deferred until the normal document-ingestion pipeline is available",
    );
  }

  const credentials = validateAdminCredentials(options);
  if (!options.databaseUrl) {
    throw new Error("DATABASE_URL is required for database bootstrap");
  }
  const pool = createPostgresPool(options.databaseUrl);
  try {
    const schemaVersion = await getDatabaseSchemaVersion(pool);
    if (schemaVersion !== CURRENT_DATABASE_SCHEMA_VERSION) {
      throw new Error(
        `Neon schema version ${schemaVersion} is not ready; run npm run db:migrate first`,
      );
    }
    const { store, collections } = createSystemStore(pool);
    await store.initialize();
    return await seedSystemCollections(collections, credentials);
  } finally {
    await pool.end();
  }
}

/**
 * Seeds roles, permissions, baseline grants, and the initial administrator.
 */
export async function seedSystemCollections(
  collections: SystemCollections,
  credentials: { email: string; password: string },
): Promise<BootstrapResult> {
  const roleIds = new Map<string, string>();
  let rolesAdded = 0;
  for (const roleDefinition of roleDefinitions) {
    const existing = collections.roles.findUnique("name", roleDefinition.name);
    const role =
      existing ??
      (await collections.roles.insert({
        name: roleDefinition.name,
        description: roleDefinition.description,
        createdAt: new Date().toISOString(),
      }));
    roleIds.set(role.name, role.id);
    if (!existing) rolesAdded += 1;
  }

  const permissionIds = new Map<string, string>();
  let permissionsAdded = 0;
  for (const permissionKey of permissionDefinitions) {
    const existing = collections.permissions.findUnique("key", permissionKey);
    const permission =
      existing ??
      (await collections.permissions.insert({
        key: permissionKey,
        area: permissionKey.split(":")[0] ?? "system",
      }));
    permissionIds.set(permission.key, permission.id);
    if (!existing) permissionsAdded += 1;
  }

  let rolePermissionsAdded = 0;
  for (const [roleName, permissionKeys] of Object.entries(baselinePermissions)) {
    const roleId = roleIds.get(roleName);
    if (!roleId) throw new Error(`Missing seeded role "${roleName}"`);
    for (const permissionKey of permissionKeys) {
      const permissionId = permissionIds.get(permissionKey);
      if (!permissionId) {
        throw new Error(`Missing seeded permission "${permissionKey}"`);
      }
      if (
        collections.rolePermissions.findUnique(
          "role_permission",
          `${roleId}:${permissionId}`,
        )
      ) {
        continue;
      }
      await collections.rolePermissions.insert({ roleId, permissionId });
      rolePermissionsAdded += 1;
    }
  }

  const adminRoleId = roleIds.get("admin");
  if (!adminRoleId) throw new Error("Admin role was not seeded");
  const adminExists = collections.users
    .findByIndex("roleId", adminRoleId)
    .length > 0;
  let adminCreated = false;

  if (!adminExists) {
    const now = new Date().toISOString();
    const passwordHash = await argon2.hash(credentials.password, {
      type: argon2.argon2id,
    });
    const admin = await collections.users.insert({
      email: credentials.email,
      passwordHash,
      displayName: "Administrator",
      roleId: adminRoleId,
      status: "active",
      mustChangePassword: true,
      failedLoginCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    await collections.auditLogs.insert({
      actorId: "system",
      actorRole: "system",
      action: "bootstrap.admin_created",
      targetType: "user",
      targetId: admin.id,
      before: null,
      after: { role: "admin", status: "active" },
      requestId: null,
      createdAt: now,
    });
    adminCreated = true;
  }

  return {
    rolesAdded,
    permissionsAdded,
    rolePermissionsAdded,
    adminCreated,
    adminAlreadyExists: adminExists,
  };
}

/**
 * Validates bootstrap credentials without including password content in errors.
 */
function validateAdminCredentials(
  options: BootstrapOptions,
): { email: string; password: string } {
  if (!options.adminEmail || !options.adminPassword) {
    throw new Error(
      "BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD are required",
    );
  }
  const email = options.adminEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("BOOTSTRAP_ADMIN_EMAIL must be a valid email address");
  }
  if (options.adminPassword.length < options.passwordMinLength) {
    throw new Error(
      `BOOTSTRAP_ADMIN_PASSWORD must be at least ${options.passwordMinLength} characters`,
    );
  }
  if (weakPasswords.has(options.adminPassword.toLowerCase())) {
    throw new Error("BOOTSTRAP_ADMIN_PASSWORD is on the weak-password deny-list");
  }
  return { email, password: options.adminPassword };
}

/**
 * Runs the bootstrap command and prints a summary without exposing credentials.
 */
async function main(): Promise<void> {
  const config = loadConfig({
    requireJwtSecrets: false,
    requireDatabases: true,
  });
  const logger = createLogger(config.logLevel);
  const flags = new Set(process.argv.slice(2));
  const result = await bootstrapSystem({
    databaseUrl: config.databaseUrl,
    environment: config.environment,
    adminEmail: config.bootstrapAdminEmail,
    adminPassword: config.bootstrapAdminPassword,
    passwordMinLength: config.passwordMinLength,
    reset: flags.has("--reset"),
    yes: flags.has("--yes"),
    demo: flags.has("--demo"),
  });
  if (result.adminAlreadyExists) {
    logger.info("Admin already exists; bootstrap did not replace it");
  }
  logger.info(
    {
      rolesAdded: result.rolesAdded,
      permissionsAdded: result.permissionsAdded,
      rolePermissionsAdded: result.rolePermissionsAdded,
      adminCreated: result.adminCreated,
    },
    "Bootstrap completed",
  );
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown failure";
    process.stderr.write(`Bootstrap failed: ${message}\n`);
    process.exitCode = 1;
  });
}
