import argon2 from "argon2";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { bootstrapSystem } from "../../scripts/bootstrap";

const password = "B2-safe-test-passphrase-2026";
const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithTestDatabase = testDatabaseUrl ? describe : describe.skip;

describe("Bootstrap safety gates", () => {
  const options = {
    environment: "test" as const,
    adminEmail: "ADMIN@example.test",
    adminPassword: password,
    passwordMinLength: 12,
    reset: false,
    yes: false,
    demo: false,
  };

  test("rejects unsafe resets, incomplete demo seeding, and weak passwords before connecting", async () => {
    await expect(
      bootstrapSystem({
        ...options,
        reset: true,
        environment: "production",
        yes: true,
      }),
    ).rejects.toThrow("Refusing to reset data in production");
    await expect(
      bootstrapSystem({ ...options, reset: true }),
    ).rejects.toThrow("requires the explicit --yes flag");
    await expect(
      bootstrapSystem({ ...options, demo: true }),
    ).rejects.toThrow("Demo seeding is deferred");
    await expect(
      bootstrapSystem({ ...options, adminPassword: "123456789012" }),
    ).rejects.toThrow("weak-password deny-list");
  });
});

describeWithTestDatabase("PostgreSQL bootstrap", () => {
  let adminPool: Pool;
  let bootstrapPool: Pool;
  let schemaName: string;
  let schemaCreated = false;

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error("TEST_DATABASE_URL is required for PostgreSQL bootstrap tests");
    }
    adminPool = new Pool({ connectionString: testDatabaseUrl });
    schemaName = `bootstrap_test_${randomUUID().replace(/-/g, "")}`;
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    schemaCreated = true;
    bootstrapPool = new Pool({
      connectionString: testDatabaseUrl,
      options: `-c search_path=${schemaName}`,
    });
  });

  afterAll(async () => {
    if (bootstrapPool) await bootstrapPool.end();
    if (adminPool) {
      if (schemaCreated) {
        await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
      }
      await adminPool.end();
    }
  });

  test("seeds idempotently, preserves the first admin, and resets only app data", async () => {
    const options = {
      databaseUrl: testDatabaseUrl,
      pool: bootstrapPool,
      environment: "test" as const,
      adminEmail: "ADMIN@example.test",
      adminPassword: password,
      passwordMinLength: 12,
      reset: false,
      yes: false,
      demo: false,
    };

    expect(await bootstrapSystem(options)).toMatchObject({
      rolesAdded: 3,
      permissionsAdded: 16,
      adminCreated: true,
      adminAlreadyExists: false,
    });
    expect(await bootstrapSystem({
      ...options,
      adminPassword: "A-different-valid-password-2026",
      adminEmail: "another-admin@example.test",
    })).toMatchObject({
      rolesAdded: 0,
      permissionsAdded: 0,
      rolePermissionsAdded: 0,
      adminCreated: false,
      adminAlreadyExists: true,
    });

    const admin = await bootstrapPool.query<{
      email: string;
      password_hash: string;
      must_change_password: boolean;
    }>(
      "SELECT email, password_hash, must_change_password FROM users",
    );
    expect(admin.rows).toHaveLength(1);
    expect(admin.rows[0]).toMatchObject({
      email: "admin@example.test",
      must_change_password: true,
    });
    expect(admin.rows[0]?.password_hash).not.toBe(password);
    expect(await argon2.verify(admin.rows[0]!.password_hash, password)).toBe(true);
    expect(
      await bootstrapPool.query("SELECT id FROM audit_logs WHERE action = $1", [
        "bootstrap.admin_created",
      ]),
    ).toMatchObject({ rowCount: 1 });
    expect(
      await bootstrapPool.query(
        "SELECT version FROM schema_migrations ORDER BY version",
      ),
    ).toMatchObject({
      rows: [{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }],
    });

    expect(await bootstrapSystem({
      ...options,
      reset: true,
      yes: true,
    })).toMatchObject({
      rolesAdded: 3,
      permissionsAdded: 16,
      adminCreated: true,
      adminAlreadyExists: false,
    });
    expect(
      await bootstrapPool.query(
        "SELECT version FROM schema_migrations ORDER BY version",
      ),
    ).toMatchObject({
      rows: [{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }],
    });
    expect(
      await bootstrapPool.query("SELECT count(*)::integer AS count FROM users"),
    ).toMatchObject({ rows: [{ count: 1 }] });
  });
});
