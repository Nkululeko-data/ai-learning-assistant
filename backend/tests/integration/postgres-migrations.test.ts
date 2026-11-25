import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import {
  getSchemaVersion,
  runMigrations,
} from "../../src/infra/postgres/migrate";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithTestDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithTestDatabase("PostgreSQL migrations", () => {
  let adminPool: Pool;
  let migrationPool: Pool;
  let schemaName: string;
  let schemaCreated = false;

  /**
   * Creates a disposable schema in the explicitly configured test database.
   */
  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error("TEST_DATABASE_URL is required for PostgreSQL migration tests");
    }
    adminPool = new Pool({ connectionString: testDatabaseUrl });
    schemaName = `migration_test_${randomUUID().replace(/-/g, "")}`;
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    schemaCreated = true;
    migrationPool = new Pool({
      connectionString: testDatabaseUrl,
      options: `-c search_path=${schemaName}`,
    });
  });

  /**
   * Drops the disposable schema and closes test database pools.
   */
  afterAll(async () => {
    if (migrationPool) await migrationPool.end();
    if (adminPool) {
      if (schemaCreated) {
        await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
      }
      await adminPool.end();
    }
  });

  /**
   * Verifies ordered migration application, no-op reruns, and the pending-request constraint.
   */
  test("applies migrations idempotently and rejects duplicate pending coach requests", async () => {
    const migrationsDirectory = resolve(__dirname, "../../migrations");
    expect(await runMigrations(migrationPool, migrationsDirectory)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(await getSchemaVersion(migrationPool)).toBe(4);
    expect(await runMigrations(migrationPool, migrationsDirectory)).toEqual([]);

    const roleId = randomUUID();
    const userId = randomUUID();
    await migrationPool.query(
      "INSERT INTO roles(id, name) VALUES ($1, 'learner')",
      [roleId],
    );
    await migrationPool.query(
      `INSERT INTO users(
        id, email, password_hash, display_name, role_id, status,
        must_change_password, failed_login_count
      ) VALUES ($1, $2, 'not-a-real-hash', 'Migration Test', $3, 'active', false, 0)`,
      [userId, `${userId}@example.test`, roleId],
    );
    const courseId = randomUUID();
    await migrationPool.query(
      `INSERT INTO courses(id, owner_id, title, status)
       VALUES ($1, $2, 'Migration Test Course', 'active')`,
      [courseId, userId],
    );
    await migrationPool.query(
      `INSERT INTO enrolments(id, course_id, user_id, status)
       VALUES ($1, $2, $3, 'pending')`,
      [randomUUID(), courseId, userId],
    );
    await expect(
      migrationPool.query(
        `INSERT INTO enrolments(id, course_id, user_id, status)
         VALUES ($1, $2, $3, 'pending')`,
        [randomUUID(), courseId, userId],
      ),
    ).rejects.toMatchObject({ code: "23505" });

    await migrationPool.query(
      "INSERT INTO coach_requests(id, user_id, status) VALUES ($1, $2, 'pending')",
      [randomUUID(), userId],
    );

    await expect(
      migrationPool.query(
        "INSERT INTO coach_requests(id, user_id, status) VALUES ($1, $2, 'pending')",
        [randomUUID(), userId],
      ),
    ).rejects.toMatchObject({ code: "23505" });
  });
});
