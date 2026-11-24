import argon2 from "argon2";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type { Pool, PoolClient } from "pg";
import { loadConfig } from "../src/config/config";
import { createLogger } from "../src/common/logging/logger";
import { createPostgresPool } from "../src/infra/postgres/pool";
import { runMigrations } from "../src/infra/postgres/migrate";
import {
  baselinePermissions,
  permissionDefinitions,
  roleDefinitions,
} from "../src/modules/auth/bootstrap-definitions";

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
  databaseUrl?: string | undefined;
  pool?: Pool;
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
  if (options.demo) {
    throw new Error(
      "Demo seeding is deferred until the normal document-ingestion pipeline is available",
    );
  }

  const credentials = validateAdminCredentials(options);
  const pool = options.pool ?? createPostgresPool(requireDatabaseUrl(options));
  try {
    await runMigrations(pool, resolve(__dirname, "../migrations"));
    return await seedSystemCollections(pool, credentials, options.reset);
  } finally {
    if (!options.pool) await pool.end();
  }
}

/**
 * Seeds roles, permissions, baseline grants, and the first administrator transactionally.
 */
async function seedSystemCollections(
  pool: Pool,
  credentials: { email: string; password: string },
  reset: boolean,
): Promise<BootstrapResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
        1_094_853_441,
        2,
      ]);
      if (reset) {
        await client.query(`
          TRUNCATE TABLE
            messages, conversations, enrolments, courses, audit_logs,
            coach_requests, refresh_tokens,
            user_permission_overrides, role_permissions, users, permissions, roles
          RESTART IDENTITY
        `);
      }

      const now = new Date().toISOString();
      let rolesAdded = 0;
      const roleIds = new Map<string, string>();
      for (const roleDefinition of roleDefinitions) {
        const inserted = await client.query(
          `INSERT INTO roles(id, name, description, created_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (name) DO NOTHING`,
          [
            randomUUID(),
            roleDefinition.name,
            roleDefinition.description,
            now,
          ],
        );
        rolesAdded += inserted.rowCount ?? 0;
        const role = await client.query<{ id: string }>(
          "SELECT id FROM roles WHERE name = $1",
          [roleDefinition.name],
        );
        const roleId = role.rows[0]?.id;
        if (!roleId) {
          throw new Error(`Failed to initialize role "${roleDefinition.name}"`);
        }
        roleIds.set(roleDefinition.name, roleId);
      }

      let permissionsAdded = 0;
      const permissionIds = new Map<string, string>();
      for (const permissionKey of permissionDefinitions) {
        const permissionId = randomUUID();
        const inserted = await client.query(
          `INSERT INTO permissions(id, key, area)
           VALUES ($1, $2, $3)
           ON CONFLICT (key) DO NOTHING`,
          [
            permissionId,
            permissionKey,
            permissionKey.split(":")[0] ?? "system",
          ],
        );
        permissionsAdded += inserted.rowCount ?? 0;
        const permission = await client.query<{ id: string }>(
          "SELECT id FROM permissions WHERE key = $1",
          [permissionKey],
        );
        const storedPermissionId = permission.rows[0]?.id;
        if (!storedPermissionId) {
          throw new Error(`Failed to initialize permission "${permissionKey}"`);
        }
        permissionIds.set(permissionKey, storedPermissionId);
      }

      let rolePermissionsAdded = 0;
      for (const [roleName, permissionKeys] of Object.entries(
        baselinePermissions,
      )) {
        const roleId = roleIds.get(roleName);
        if (!roleId) throw new Error(`Missing seeded role "${roleName}"`);
        for (const permissionKey of permissionKeys) {
          const permissionId = permissionIds.get(permissionKey);
          if (!permissionId) {
            throw new Error(`Missing seeded permission "${permissionKey}"`);
          }
          const inserted = await client.query(
            `INSERT INTO role_permissions(id, role_id, permission_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (role_id, permission_id) DO NOTHING`,
            [randomUUID(), roleId, permissionId],
          );
          rolePermissionsAdded += inserted.rowCount ?? 0;
        }
      }

      const adminRoleId = roleIds.get("admin");
      if (!adminRoleId) throw new Error("Admin role was not seeded");
      const existingAdmin = await client.query<{ exists: boolean }>(
        "SELECT EXISTS(SELECT 1 FROM users WHERE role_id = $1) AS exists",
        [adminRoleId],
      );
      let adminAlreadyExists = existingAdmin.rows[0]?.exists === true;
      let adminCreated = false;
      if (!adminAlreadyExists) {
        const passwordHash = await argon2.hash(credentials.password, {
          type: argon2.argon2id,
        });
        const adminId = randomUUID();
        const insertedAdmin = await client.query<{ id: string }>(
          `INSERT INTO users(
            id, email, password_hash, display_name, role_id, perms_version,
            status, must_change_password, failed_login_count, created_at, updated_at
          ) VALUES ($1, $2, $3, 'Administrator', $4, 1, 'active', true, 0, $5, $5)
          ON CONFLICT (email) DO NOTHING
          RETURNING id`,
          [adminId, credentials.email, passwordHash, adminRoleId, now],
        );
        const createdAdminId = insertedAdmin.rows[0]?.id;
        if (createdAdminId) {
          await insertBootstrapAudit(client, createdAdminId, now);
          adminCreated = true;
        } else {
          const adminAfterConflict = await client.query<{ exists: boolean }>(
            "SELECT EXISTS(SELECT 1 FROM users WHERE role_id = $1) AS exists",
            [adminRoleId],
          );
          adminAlreadyExists = adminAfterConflict.rows[0]?.exists === true;
          if (!adminAlreadyExists) {
            throw new Error(
              "BOOTSTRAP_ADMIN_EMAIL is already used by a non-admin account",
            );
          }
        }
      }

      await client.query("COMMIT");
      return {
        rolesAdded,
        permissionsAdded,
        rolePermissionsAdded,
        adminCreated,
        adminAlreadyExists,
      };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Bootstrap transaction failed and could not be rolled back",
        );
      }
      throw error;
    }
  } finally {
    client.release();
  }
}

/**
 * Requires a PostgreSQL connection unless a pool was injected by a test.
 */
function requireDatabaseUrl(options: BootstrapOptions): string {
  if (!options.databaseUrl) {
    throw new Error("DATABASE_URL is required to bootstrap PostgreSQL");
  }
  return options.databaseUrl;
}

/**
 * Appends the first-admin audit record in the active bootstrap transaction.
 */
async function insertBootstrapAudit(
  client: PoolClient,
  adminId: string,
  createdAt: string,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_logs(
      id, actor_id, actor_role, action, target_type, target_id,
      before, after, request_id, created_at
    ) VALUES ($1, 'system', 'system', 'bootstrap.admin_created', 'user', $2,
      NULL, $3::jsonb, NULL, $4)`,
    [
      randomUUID(),
      adminId,
      JSON.stringify({ role: "admin", status: "active" }),
      createdAt,
    ],
  );
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
    requireMongoConfiguration: false,
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
