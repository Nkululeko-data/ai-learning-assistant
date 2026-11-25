import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { Pool } from "pg";
import type { RefreshTokenRecord, UserRecord } from "../../src/infra/jsonstore/system-collections";
import { PgAuthRepository } from "../../src/modules/auth/pg-auth.repository";
import { runMigrations } from "../../src/infra/postgres/migrate";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithTestDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithTestDatabase("PostgreSQL authentication repository", () => {
  let adminPool: Pool;
  let repositoryPool: Pool;
  let schemaName: string;
  let schemaCreated = false;
  let roleId: string;
  let repository: PgAuthRepository;

  /**
   * Creates a disposable database schema, applies migrations, and seeds the learner role.
   */
  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error("TEST_DATABASE_URL is required for PostgreSQL auth tests");
    }
    adminPool = new Pool({ connectionString: testDatabaseUrl });
    schemaName = `auth_test_${randomUUID().replace(/-/g, "")}`;
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    schemaCreated = true;
    repositoryPool = new Pool({
      connectionString: testDatabaseUrl,
      options: `-c search_path=${schemaName}`,
    });
    await runMigrations(repositoryPool, resolve(__dirname, "../../migrations"));
    repository = new PgAuthRepository(repositoryPool);
    roleId = randomUUID();
    await repositoryPool.query(
      "INSERT INTO roles(id, name) VALUES ($1, 'learner')",
      [roleId],
    );
  });

  /**
   * Drops the disposable schema and closes the dedicated test pools.
   */
  afterAll(async () => {
    if (repositoryPool) await repositoryPool.end();
    if (adminPool) {
      if (schemaCreated) {
        await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
      }
      await adminPool.end();
    }
  });

  /**
   * Creates a valid user record for repository persistence tests.
   */
  function userRecord(email: string): Omit<UserRecord, "id"> {
    const now = new Date().toISOString();
    return {
      email,
      passwordHash: "test-password-hash",
      displayName: "Repository Test User",
      roleId,
      status: "active",
      mustChangePassword: false,
      failedLoginCount: 0,
      permsVersion: 1,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Creates a valid hashed refresh-token record for repository rotation tests.
   */
  function refreshTokenRecord(
    userId: string,
    familyId: string,
    tokenHash: string,
  ): Omit<RefreshTokenRecord, "id"> {
    const now = new Date();
    return {
      userId,
      familyId,
      tokenHash,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
      usedAt: null,
      revokedAt: null,
      replacedByTokenId: null,
    };
  }

  test("creates registration records atomically and maps unique email conflicts", async () => {
    const email = `${randomUUID()}@example.test`;
    const user = await repository.createUserAndCoachRequest(
      userRecord(email),
      { message: "I teach a class.", requestedAt: new Date().toISOString() },
    );
    expect(await repository.findUserById(user.id)).toMatchObject({ email });
    expect(await repository.findPendingCoachRequestByUser(user.id)).toMatchObject({
      userId: user.id,
      status: "pending",
    });
    await expect(repository.createUser(userRecord(email))).rejects.toMatchObject({
      code: "CONFLICT",
    });

    const before = await repositoryPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM users",
    );
    await expect(
      repository.createUserAndCoachRequest(userRecord(`${randomUUID()}@example.test`), {
        message: "x".repeat(501),
        requestedAt: new Date().toISOString(),
      }),
    ).rejects.toMatchObject({ name: "ZodError" });
    const after = await repositoryPool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM users",
    );
    expect(after.rows[0]?.count).toBe(before.rows[0]?.count);
  });

  test("allows only one concurrent refresh-token rotation", async () => {
    const user = await repository.createUser(
      userRecord(`${randomUUID()}@example.test`),
    );
    const familyId = randomUUID();
    const currentToken = await repository.createRefreshToken(
      refreshTokenRecord(user.id, familyId, randomUUID().replace(/-/g, "").padEnd(64, "a")),
    );
    const replacements = [
      refreshTokenRecord(
        user.id,
        familyId,
        randomUUID().replace(/-/g, "").padEnd(64, "b"),
      ),
      refreshTokenRecord(
        user.id,
        familyId,
        randomUUID().replace(/-/g, "").padEnd(64, "c"),
      ),
    ];

    const rotations = await Promise.all(
      replacements.map((replacement) =>
        repository.rotateRefreshToken(currentToken.id, replacement),
      ),
    );
    expect(rotations.filter((rotation) => rotation !== null)).toHaveLength(1);
    const tokens = await repository.findRefreshTokensByFamily(familyId);
    expect(tokens).toHaveLength(2);
    expect(
      tokens.filter((token) => !token.usedAt && !token.revokedAt),
    ).toHaveLength(1);
  });
});
