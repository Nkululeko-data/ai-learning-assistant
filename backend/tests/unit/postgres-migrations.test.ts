import type { Pool } from "pg";
import {
  CURRENT_DATABASE_SCHEMA_VERSION,
  runDatabaseMigrations,
} from "../../src/infra/postgres/migrations/006-runtime-storage";

function createPool(currentVersion: number) {
  const appliedVersions = new Set(
    Array.from({ length: currentVersion }, (_, index) => index + 1),
  );
  const query = jest.fn(
    async (
      sql: string,
      values: unknown[] = [],
    ): Promise<{ rows: Record<string, unknown>[]; rowCount: number }> => {
      if (sql.startsWith("SELECT COALESCE(MAX(version)")) {
        return { rows: [{ version: currentVersion }], rowCount: 1 };
      }
      if (sql.startsWith("SELECT version FROM schema_migrations WHERE version IN")) {
        const rows = [...appliedVersions]
          .filter((version) => [5, 6, 7].includes(version))
          .map((version) => ({ version }));
        return { rows, rowCount: rows.length };
      }
      if (sql.startsWith("INSERT INTO schema_migrations")) {
        appliedVersions.add(Number(values[0]));
        return { rows: [], rowCount: 1 };
      }
      if (
        ["BEGIN", "COMMIT", "ROLLBACK"].includes(sql) ||
        sql.startsWith("SELECT pg_advisory_xact_lock")
      ) {
        return { rows: [], rowCount: 0 };
      }
      if (
        sql.includes("CREATE TABLE IF NOT EXISTS user_id_aliases") ||
        sql.includes("CREATE TABLE IF NOT EXISTS application_records")
      ) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected PostgreSQL query: ${sql}`);
    },
  );
  const release = jest.fn();
  const pool = {
    connect: async () => ({ query, release }),
  } as unknown as Pool;

  return { pool, query, appliedVersions };
}

describe("PostgreSQL schema migrations", () => {
  test("accepts version 7 without reapplying migrations", async () => {
    const { pool, query } = createPool(7);

    await expect(runDatabaseMigrations(pool)).resolves.toBe(7);

    expect(CURRENT_DATABASE_SCHEMA_VERSION).toBe(7);
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes("CREATE TABLE IF NOT EXISTS application_records"),
      ),
    ).toBe(false);
  });

  test("applies the version-7 repair after version 6", async () => {
    const { pool, query, appliedVersions } = createPool(6);

    await expect(runDatabaseMigrations(pool)).resolves.toBe(7);

    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes("CREATE TABLE IF NOT EXISTS application_records"),
      ),
    ).toBe(true);
    expect(appliedVersions.has(7)).toBe(true);
  });

  test("applies versions 6 and 7 in order from version 5", async () => {
    const { pool, query, appliedVersions } = createPool(5);

    await expect(runDatabaseMigrations(pool)).resolves.toBe(7);

    const runtimeStorageCall = query.mock.calls.findIndex(([sql]) =>
      sql.includes("CREATE TABLE IF NOT EXISTS user_id_aliases"),
    );
    const repairCall = query.mock.calls.findIndex(([sql]) =>
      sql.includes("CREATE TABLE IF NOT EXISTS application_records"),
    );
    expect(runtimeStorageCall).toBeGreaterThan(-1);
    expect(repairCall).toBeGreaterThan(runtimeStorageCall);
    expect(appliedVersions.has(6)).toBe(true);
    expect(appliedVersions.has(7)).toBe(true);
  });

  test("rejects a database schema newer than version 7", async () => {
    const { pool, query } = createPool(8);

    await expect(runDatabaseMigrations(pool)).rejects.toThrow(
      "Neon schema version 8 is newer than supported version 7",
    );
    expect(query).toHaveBeenCalledWith("ROLLBACK");
  });
});
