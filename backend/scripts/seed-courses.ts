import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { z } from "zod";
import { loadConfig } from "../src/config/config";
import { runMigrations } from "../src/infra/postgres/migrate";
import { createPostgresPool } from "../src/infra/postgres/pool";

const seedCourseSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    description: z.string().max(2000).optional(),
  })
  .strict();
const seedCoursesSchema = z.array(seedCourseSchema).min(1);
const placeholderCourses = [
  {
    title: "Foundations of Learning",
    description: "A starter course for building effective learning habits.",
  },
  {
    title: "Study Skills Fundamentals",
    description: "A starter course covering practical study strategies.",
  },
];

export interface SeedCoursesResult {
  added: number;
  alreadyPresent: number;
}

/**
 * Seeds configured courses, falling back to two placeholders when no file exists.
 */
export async function seedCourses(
  pool: Pool,
  seedFile = resolve(__dirname, "../seed/courses.json"),
): Promise<SeedCoursesResult> {
  const seedInput = await readSeedCourses(seedFile);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
        1_094_853_441,
        4,
      ]);
      const ownerResult = await client.query<{ id: string }>(
        `SELECT u.id
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE r.name = 'coach' AND u.status = 'active'
         ORDER BY u.created_at, u.id
         LIMIT 1`,
      );
      const ownerId = ownerResult.rows[0]?.id;
      if (!ownerId) {
        throw new Error(
          "Cannot seed courses: no active coach user exists in PostgreSQL",
        );
      }

      let added = 0;
      let alreadyPresent = 0;
      if (seedInput.usePlaceholders) {
        const existingCount = await client.query<{ count: number }>(
          "SELECT count(*)::integer AS count FROM courses",
        );
        if ((existingCount.rows[0]?.count ?? 0) > 0) {
          for (const placeholder of placeholderCourses) {
            const existing = await client.query(
              "SELECT 1 FROM courses WHERE owner_id = $1 AND title = $2",
              [ownerId, placeholder.title],
            );
            if (existing.rowCount) alreadyPresent += 1;
          }
          await client.query("COMMIT");
          return { added, alreadyPresent };
        }
      }

      const courses = seedInput.usePlaceholders
        ? placeholderCourses
        : seedInput.courses;
      for (const course of courses) {
        const existing = await client.query<{ id: string }>(
          "SELECT id FROM courses WHERE owner_id = $1 AND title = $2",
          [ownerId, course.title],
        );
        if (existing.rows[0]) {
          alreadyPresent += 1;
          continue;
        }

        const now = new Date().toISOString();
        await client.query(
          `INSERT INTO courses(
            id, owner_id, title, description, lessons, status, approval_status,
            approval_requested_at, version, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, '[]'::jsonb, 'active', 'pending', $5, 1, $5, $5)`,
          [
            randomUUID(),
            ownerId,
            course.title,
            course.description ?? null,
            now,
          ],
        );
        added += 1;
      }

      await client.query("COMMIT");
      return { added, alreadyPresent };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Course seeding failed and could not be rolled back",
        );
      }
      throw error;
    }
  } finally {
    client.release();
  }
}

async function readSeedCourses(
  seedFile: string,
): Promise<{
  courses: z.infer<typeof seedCoursesSchema>;
  usePlaceholders: boolean;
}> {
  let serialized: string;
  try {
    serialized = await readFile(seedFile, "utf8");
  } catch (error) {
    if (isMissingPathError(error)) {
      return { courses: [], usePlaceholders: true };
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    throw new Error("Course seed file contains invalid JSON");
  }
  const result = seedCoursesSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error("Course seed file contains invalid course records");
  }
  const titles = new Set<string>();
  for (const course of result.data) {
    const normalizedTitle = course.title.toLowerCase();
    if (titles.has(normalizedTitle)) {
      throw new Error("Course seed file contains duplicate course titles");
    }
    titles.add(normalizedTitle);
  }
  return { courses: result.data, usePlaceholders: false };
}

function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function main(): Promise<void> {
  const config = loadConfig({
    requireJwtSecrets: false,
    requireMongoConfiguration: false,
  });
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required to seed courses");
  }
  const pool = createPostgresPool(config.databaseUrl);
  try {
    await runMigrations(pool, resolve(__dirname, "../migrations"));
    const result = await seedCourses(pool);
    process.stdout.write(
      `${JSON.stringify({
        added: result.added,
        alreadyPresent: result.alreadyPresent,
      })}\n`,
    );
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Course seeding failed";
    process.stderr.write(`Course seeding failed: ${message}\n`);
    process.exitCode = 1;
  });
}
