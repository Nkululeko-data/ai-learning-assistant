import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { loadConfig } from "../../config/config";
import { createPostgresPool } from "./pool";

export const EXPECTED_SCHEMA_VERSION = 8;

const MIGRATION_LOCK_KEY = [1_094_853_441, 1] as const;
const MIGRATION_FILE_PATTERN = /^(\d+)_([a-z0-9_-]+)\.sql$/i;

interface Migration {
  version: number;
  filename: string;
  sql: string;
}

/**
 * Applies ordered SQL migrations under transaction-scoped advisory locks.
 */
export async function runMigrations(
  pool: Pool,
  migrationsDirectory = resolve(process.cwd(), "migrations"),
): Promise<number[]> {
  const migrations = await readMigrations(migrationsDirectory);
  const newlyAppliedVersions: number[] = [];
  for (const migration of migrations) {
    if (await applyMigration(pool, migration, migrations)) {
      newlyAppliedVersions.push(migration.version);
    }
  }
  return newlyAppliedVersions;
}

/**
 * Reads the highest applied version, returning zero before the migration table exists.
 */
export async function getSchemaVersion(pool: Pool): Promise<number> {
  const tableResult = await pool.query<{ exists: boolean }>(
    "SELECT to_regclass('schema_migrations') IS NOT NULL AS exists",
  );
  if (tableResult.rows[0]?.exists !== true) return 0;

  const versionResult = await pool.query<{ version: number | null }>(
    "SELECT COALESCE(MAX(version), 0)::integer AS version FROM schema_migrations",
  );
  return Number(versionResult.rows[0]?.version ?? 0);
}

/**
 * Loads migration files and validates unique, increasing numeric versions.
 */
async function readMigrations(directory: string): Promise<Migration[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const sqlFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .sort((left, right) => left.name.localeCompare(right.name));
  const migrations: Migration[] = [];

  for (const file of sqlFiles) {
    const match = MIGRATION_FILE_PATTERN.exec(file.name);
    if (!match) {
      throw new Error(`Invalid PostgreSQL migration filename: ${file.name}`);
    }
    const version = Number(match[1]);
    if (!Number.isSafeInteger(version) || version < 1) {
      throw new Error(`Invalid PostgreSQL migration version: ${file.name}`);
    }
    if (migrations.some((migration) => migration.version === version)) {
      throw new Error(`Duplicate PostgreSQL migration version: ${version}`);
    }

    const sql = (await readFile(resolve(directory, file.name), "utf8")).trim();
    if (!sql) {
      throw new Error(`PostgreSQL migration is empty: ${file.name}`);
    }
    migrations.push({ version, filename: file.name, sql });
  }

  if (migrations.length === 0) {
    throw new Error(`No PostgreSQL migrations found in ${directory}`);
  }
  return migrations;
}

/**
 * Applies one migration under a transaction-scoped advisory lock.
 */
async function applyMigration(
  pool: Pool,
  migration: Migration,
  migrations: Migration[],
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
        ...MIGRATION_LOCK_KEY,
      ]);
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          version integer PRIMARY KEY,
          applied_at timestamptz NOT NULL DEFAULT now()
        )
      `);

      const appliedResult = await client.query<{ version: number }>(
        "SELECT version FROM schema_migrations ORDER BY version",
      );
      const appliedVersions = appliedResult.rows.map((row) =>
        Number(row.version),
      );
      if (
        appliedVersions.some(
          (version, index) => migrations[index]?.version !== version,
        )
      ) {
        throw new Error(
          "PostgreSQL migration history does not match the available migration files",
        );
      }

      if (appliedVersions.includes(migration.version)) {
        await client.query("COMMIT");
        return false;
      }
      if (migrations[appliedVersions.length]?.version !== migration.version) {
        throw new Error(
          "PostgreSQL migrations must be applied in filename order",
        );
      }

      await client.query(migration.sql);
      await client.query(
        "INSERT INTO schema_migrations(version) VALUES ($1)",
        [migration.version],
      );
      await client.query("COMMIT");
      return true;
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `Migration ${migration.filename} failed and its transaction could not be rolled back`,
        );
      }
      throw new Error(`Migration ${migration.filename} failed`, {
        cause: error,
      });
    }
  } finally {
    client.release();
  }
}

/**
 * Runs migrations from the backend package directory and closes the pool.
 */
async function main(): Promise<void> {
  const config = loadConfig({
    requireJwtSecrets: false,
    requireMongoConfiguration: false,
  });
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required to run PostgreSQL migrations");
  }

  const pool = createPostgresPool(config.databaseUrl);
  try {
    const appliedVersions = await runMigrations(pool);
    const currentVersion = await getSchemaVersion(pool);
    process.stdout.write(
      `PostgreSQL schema version ${currentVersion}; newly applied migrations: ${
        appliedVersions.length ? appliedVersions.join(", ") : "none"
      }\n`,
    );
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    const message = error instanceof Error ? error.message : "Unknown failure";
    process.stderr.write(
      `PostgreSQL migrations failed (${errorName}): ${message}\n`,
    );
    process.exitCode = 1;
  });
}
