import { resolve } from "node:path";
import type { Pool } from "pg";
import {
  EXPECTED_SCHEMA_VERSION,
  getSchemaVersion,
} from "../../src/infra/postgres/migrate";
import {
  CURRENT_DATABASE_SCHEMA_VERSION,
  runDatabaseMigrations,
} from "../../src/infra/postgres/migrations/006-runtime-storage";

function createPool(initialVersions: number[] = []) {
  const appliedVersions = new Set(initialVersions);
  let migrationTableExists = initialVersions.length > 0;
  const query = jest.fn(
    async (
      sql: string,
      values: unknown[] = [],
    ): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> => {
      if (sql.startsWith("SELECT to_regclass")) {
        return {
          rows: [{ exists: migrationTableExists }],
          rowCount: 1,
        };
      }
      if (sql.startsWith("SELECT COALESCE(MAX(version)")) {
        return {
          rows: [{ version: Math.max(0, ...appliedVersions) }],
          rowCount: 1,
        };
      }
      if (sql.startsWith("SELECT version FROM schema_migrations ORDER BY version")) {
        const rows = [...appliedVersions]
          .sort((left, right) => left - right)
          .map((version) => ({ version }));
        return { rows, rowCount: rows.length };
      }
      if (sql.includes("CREATE TABLE IF NOT EXISTS schema_migrations")) {
        migrationTableExists = true;
        return { rows: [], rowCount: 0 };
      }
      if (sql.startsWith("INSERT INTO schema_migrations")) {
        appliedVersions.add(Number(values[0]));
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
  );
  const pool = {
    query,
    connect: async () => ({ query, release: jest.fn() }),
  } as unknown as Pool;
  return { pool, query, appliedVersions };
}

describe("PostgreSQL SQL migrations", () => {
  test("applies the latest migration and is idempotent", async () => {
    const { pool, query, appliedVersions } = createPool([1, 2, 3, 4, 5, 6, 7]);
    const migrationsDirectory = resolve(__dirname, "../../migrations");

    await expect(
      runDatabaseMigrations(pool, migrationsDirectory),
    ).resolves.toBe(9);
    await expect(
      runDatabaseMigrations(pool, migrationsDirectory),
    ).resolves.toBe(9);

    expect(EXPECTED_SCHEMA_VERSION).toBe(9);
    expect(CURRENT_DATABASE_SCHEMA_VERSION).toBe(EXPECTED_SCHEMA_VERSION);
    expect(appliedVersions.has(9)).toBe(true);
    expect(
      query.mock.calls.filter(([sql]) =>
        sql.includes("CREATE TABLE IF NOT EXISTS user_id_aliases"),
      ),
    ).toHaveLength(1);
    await expect(getSchemaVersion(pool)).resolves.toBe(9);
  });
});
