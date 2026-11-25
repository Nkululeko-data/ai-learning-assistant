import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Pool } from "pg";
import { createJsonSystemStore as createSystemStore } from "../../src/infra/jsonstore/create-json-system-store";
import { PgCourseRepository } from "../../src/modules/courses/pg-course.repository";
import { seedCourses } from "../../scripts/seed-courses";
import { runMigrations } from "../../src/infra/postgres/migrate";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeWithTestDatabase = testDatabaseUrl ? describe : describe.skip;

describeWithTestDatabase("PostgreSQL course persistence", () => {
  let adminPool: Pool;
  let pool: Pool;
  let schemaName: string;
  let temporaryRoot: string;
  let collections: ReturnType<typeof createSystemStore>["collections"];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error("TEST_DATABASE_URL is required for PostgreSQL course tests");
    }
    temporaryRoot = await mkdtemp(join(tmpdir(), "ai-learning-assistant-pg-courses-"));
    await mkdir(temporaryRoot, { recursive: true });
    const systemStore = createSystemStore(temporaryRoot);
    collections = systemStore.collections;
    await systemStore.store.initialize();

    adminPool = new Pool({ connectionString: testDatabaseUrl });
    schemaName = `course_test_${randomUUID().replace(/-/g, "")}`;
    await adminPool.query(`CREATE SCHEMA "${schemaName}"`);
    pool = new Pool({
      connectionString: testDatabaseUrl,
      options: `-c search_path=${schemaName}`,
    });
    await runMigrations(pool, resolve(__dirname, "../../migrations"));
  });

  afterAll(async () => {
    if (pool) await pool.end();
    if (adminPool) {
      await adminPool.query(`DROP SCHEMA "${schemaName}" CASCADE`);
      await adminPool.end();
    }
    if (temporaryRoot) {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  test("requires an existing active coach and seeds courses idempotently", async () => {
    const seedFile = join(temporaryRoot, "missing-courses.json");
    await expect(seedCourses(pool, seedFile)).rejects.toThrow(
      "no active coach user exists",
    );

    const coachRoleId = randomUUID();
    const coachUserId = randomUUID();
    const learnerRoleId = randomUUID();
    const learnerUserId = randomUUID();
    const now = new Date().toISOString();
    await pool.query(
      "INSERT INTO roles(id, name, created_at) VALUES ($1, 'coach', $2)",
      [coachRoleId, now],
    );
    await pool.query(
      "INSERT INTO roles(id, name, created_at) VALUES ($1, 'learner', $2)",
      [learnerRoleId, now],
    );
    await insertUser(pool, coachUserId, coachRoleId, "coach@example.test", now);
    await insertUser(
      pool,
      learnerUserId,
      learnerRoleId,
      "learner@example.test",
      now,
    );

    expect(await seedCourses(pool, seedFile)).toEqual({
      added: 2,
      alreadyPresent: 0,
    });
    expect(await seedCourses(pool, seedFile)).toEqual({
      added: 0,
      alreadyPresent: 2,
    });
    const seeded = await pool.query<{
      title: string;
      approval_status: string;
      owner_id: string;
    }>("SELECT title, approval_status, owner_id FROM courses ORDER BY title");
    expect(seeded.rows).toHaveLength(2);
    expect(seeded.rows.every((row) => row.approval_status === "pending")).toBe(
      true,
    );
    expect(seeded.rows.every((row) => row.owner_id === coachUserId)).toBe(true);
  });

  test("persists courses/enrolments and enforces optimistic updates", async () => {
    const coach = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE email = 'coach@example.test'",
    );
    const learner = await pool.query<{ id: string }>(
      "SELECT id FROM users WHERE email = 'learner@example.test'",
    );
    const coachId = coach.rows[0]?.id;
    const learnerId = learner.rows[0]?.id;
    if (!coachId || !learnerId) throw new Error("Test users were not seeded");

    const repository = new PgCourseRepository(pool, collections);
    const now = new Date().toISOString();
    const course = await repository.createCourse({
      ownerId: coachId,
      name: "Repository Test Course",
      description: "A course stored in PostgreSQL",
      lessons: [],
      status: "active",
      approvalStatus: "approved",
      approvalNote: null,
      approvalRequestedAt: now,
      reviewedBy: coachId,
      reviewedAt: now,
      archivedAt: null,
      archivedBy: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    expect(await repository.findCourseById(course.id)).toMatchObject({
      id: course.id,
      name: course.name,
      version: 1,
    });

    const updated = await repository.updateCourse(
      course.id,
      (current) => ({ ...current, name: "Updated Test Course" }),
      1,
    );
    expect(updated).toMatchObject({ name: "Updated Test Course", version: 2 });
    await expect(
      repository.updateCourse(course.id, (current) => current, 1),
    ).rejects.toThrow("Record version is stale");

    const enrolment = await repository.createEnrolment({
      courseId: course.id,
      userId: learnerId,
      status: "pending",
      requestedAt: now,
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
      createdAt: now,
      updatedAt: now,
    });
    expect(await repository.findEnrolment(course.id, learnerId)).toMatchObject({
      id: enrolment.id,
      status: "pending",
    });
    await expect(
      repository.createEnrolment({
        courseId: course.id,
        userId: learnerId,
        status: "pending",
        requestedAt: now,
        createdAt: now,
        updatedAt: now,
      }),
    ).rejects.toThrow("An enrolment already exists");
    const storedLearner = await repository.findUserById(learnerId);
    if (!storedLearner) throw new Error("Test learner was not found");
    expect(await repository.findRoleById(storedLearner.roleId)).toMatchObject({
      name: "learner",
    });
  });
});

async function insertUser(
  pool: Pool,
  userId: string,
  roleId: string,
  email: string,
  now: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO users(
      id, email, password_hash, display_name, role_id, status,
      must_change_password, failed_login_count, created_at, updated_at
    ) VALUES ($1, $2, 'test-hash', $3, $4, 'active', false, 0, $5, $5)`,
    [userId, email, email.split("@")[0], roleId, now],
  );
}
