import type { Pool } from "pg";
import {
  EXPECTED_SCHEMA_VERSION,
  getSchemaVersion,
  runMigrations,
} from "../migrate";

export const CURRENT_DATABASE_SCHEMA_VERSION = EXPECTED_SCHEMA_VERSION;

export async function runDatabaseMigrations(
  pool: Pool,
  migrationsDirectory?: string,
): Promise<number> {
  await runMigrations(pool, migrationsDirectory);
  return getSchemaVersion(pool);
}

export const getDatabaseSchemaVersion = getSchemaVersion;
