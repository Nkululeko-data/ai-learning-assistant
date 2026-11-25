import { randomUUID } from "node:crypto";
import { AsyncMutex } from "../../infra/jsonstore/async-mutex";
import { withCourseContentMutationLock } from "../../infra/jsonstore/course-content-mutex";
import {
  courseSchema,
  enrolmentSchema,
  roleSchema,
  userSchema,
  type CourseRecord,
  type DocumentRecord,
  type EnrolmentRecord,
  type SystemCollections,
} from "../../infra/jsonstore/system-collections";
import { ConflictError, NotFoundError } from "../../common/errors/app-error";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import type { AuditInput } from "../auth/auth.types";
import type {
  CourseRepository,
  CourseRoleRecord,
  CourseUserRecord,
} from "./course.types";

type TimestampValue = Date | string;

interface CourseRow extends QueryResultRow {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  lessons: unknown;
  status: CourseRecord["status"];
  approval_status: NonNullable<CourseRecord["approvalStatus"]>;
  approval_note: string | null;
  approval_requested_at: TimestampValue | null;
  reviewed_by: string | null;
  reviewed_at: TimestampValue | null;
  archived_at: TimestampValue | null;
  archived_by: string | null;
  version: number;
  created_at: TimestampValue;
  updated_at: TimestampValue;
}

interface EnrolmentRow extends QueryResultRow {
  id: string;
  course_id: string;
  user_id: string;
  status: EnrolmentRecord["status"];
  requested_at: TimestampValue;
  decided_by: string | null;
  decided_at: TimestampValue | null;
  decision_note: string | null;
  created_at: TimestampValue;
  updated_at: TimestampValue;
}

interface UserRow extends QueryResultRow {
  id: string;
  email: string;
  display_name: string;
  role_id: string;
  status: CourseUserRecord["status"];
}

interface RoleRow extends QueryResultRow {
  id: string;
  name: CourseRoleRecord["name"];
}

/**
 * Implements course and enrolment persistence on PostgreSQL.
 */
export class PgCourseRepository implements CourseRepository {
  private readonly mutationMutex = new AsyncMutex();

  public constructor(
    private readonly pool: Pool,
    private readonly collections: SystemCollections,
    private readonly findDocument: (
      id: string,
    ) => Promise<DocumentRecord | null> = async (id) =>
      collections.documents.getById(id),
  ) {}

  public withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    return this.mutationMutex.runExclusive(operation);
  }

  public withCourseContentMutationLock<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    return withCourseContentMutationLock(this.collections, operation);
  }

  public async findCourseById(id: string): Promise<CourseRecord | null> {
    const result = await this.pool.query<CourseRow>(
      "SELECT * FROM courses WHERE id = $1",
      [id],
    );
    return result.rows[0] ? mapCourse(result.rows[0]) : null;
  }

  public async listCourses(): Promise<CourseRecord[]> {
    const result = await this.pool.query<CourseRow>(
      "SELECT * FROM courses ORDER BY id",
    );
    return result.rows.map(mapCourse);
  }

  public async countEnrolmentsByStatus(
    status: EnrolmentRecord["status"],
  ): Promise<number> {
    const result = await this.pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM enrolments WHERE status = $1",
      [status],
    );
    const count = Number(result.rows[0]?.count);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error("PostgreSQL returned an invalid enrolment count");
    }
    return count;
  }

  public async findDocumentById(id: string): Promise<DocumentRecord | null> {
    return this.findDocument(id);
  }

  public async createCourse(
    input: Omit<CourseRecord, "id">,
  ): Promise<CourseRecord> {
    const course = courseSchema.parse({ ...input, id: randomUUID() });
    const result = await this.pool.query<CourseRow>(
      `INSERT INTO courses(
        id, owner_id, title, description, lessons, status, approval_status,
        approval_note, approval_requested_at, reviewed_by, reviewed_at,
        archived_at, archived_by, version, created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
      ) RETURNING *`,
      courseValues(course),
    );
    const created = result.rows[0];
    if (!created) throw new Error("PostgreSQL did not return the created course");
    return mapCourse(created);
  }

  public async updateCourse(
    id: string,
    update: (course: CourseRecord) => CourseRecord,
    expectedVersion: number,
  ): Promise<CourseRecord> {
    return this.withTransaction(async (client) => {
      const currentResult = await client.query<CourseRow>(
        "SELECT * FROM courses WHERE id = $1 FOR UPDATE",
        [id],
      );
      const currentRow = currentResult.rows[0];
      if (!currentRow) throw new NotFoundError();
      const current = mapCourse(currentRow);
      if (current.version !== expectedVersion) {
        throw new ConflictError("Record version is stale");
      }

      const updated = courseSchema.parse({
        ...update(current),
        version: expectedVersion + 1,
      });
      if (updated.id !== current.id) {
        throw new Error("A course update cannot change its ID");
      }
      const result = await client.query<CourseRow>(
        `UPDATE courses SET
          owner_id = $2, title = $3, description = $4, lessons = $5::jsonb,
          status = $6, approval_status = $7, approval_note = $8,
          approval_requested_at = $9, reviewed_by = $10, reviewed_at = $11,
          archived_at = $12, archived_by = $13, version = $14,
          created_at = $15, updated_at = $16
         WHERE id = $1 RETURNING *`,
        [id, ...courseValues(updated).slice(1)],
      );
      const stored = result.rows[0];
      if (!stored) throw new NotFoundError();
      return mapCourse(stored);
    });
  }

  public async findEnrolment(
    courseId: string,
    userId: string,
  ): Promise<EnrolmentRecord | null> {
    const result = await this.pool.query<EnrolmentRow>(
      "SELECT * FROM enrolments WHERE course_id = $1 AND user_id = $2",
      [courseId, userId],
    );
    return result.rows[0] ? mapEnrolment(result.rows[0]) : null;
  }

  public async findEnrolmentById(
    id: string,
  ): Promise<EnrolmentRecord | null> {
    const result = await this.pool.query<EnrolmentRow>(
      "SELECT * FROM enrolments WHERE id = $1",
      [id],
    );
    return result.rows[0] ? mapEnrolment(result.rows[0]) : null;
  }

  public async listEnrolmentsByCourse(
    courseId: string,
  ): Promise<EnrolmentRecord[]> {
    const result = await this.pool.query<EnrolmentRow>(
      "SELECT * FROM enrolments WHERE course_id = $1 ORDER BY id",
      [courseId],
    );
    return result.rows.map(mapEnrolment);
  }

  public async listEnrolmentsByUser(
    userId: string,
  ): Promise<EnrolmentRecord[]> {
    const result = await this.pool.query<EnrolmentRow>(
      "SELECT * FROM enrolments WHERE user_id = $1 ORDER BY id",
      [userId],
    );
    return result.rows.map(mapEnrolment);
  }

  public async createEnrolment(
    input: Omit<EnrolmentRecord, "id">,
  ): Promise<EnrolmentRecord> {
    const enrolment = enrolmentSchema.parse({ ...input, id: randomUUID() });
    try {
      const result = await this.pool.query<EnrolmentRow>(
        `INSERT INTO enrolments(
          id, course_id, user_id, status, requested_at, decided_by,
          decided_at, decision_note, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *`,
        enrolmentValues(enrolment),
      );
      const created = result.rows[0];
      if (!created) {
        throw new Error("PostgreSQL did not return the created enrolment");
      }
      return mapEnrolment(created);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictError("An enrolment already exists for this course and user");
      }
      throw error;
    }
  }

  public async updateEnrolment(
    id: string,
    update: (enrolment: EnrolmentRecord) => EnrolmentRecord,
  ): Promise<EnrolmentRecord> {
    return this.withTransaction(async (client) => {
      const currentResult = await client.query<EnrolmentRow>(
        "SELECT * FROM enrolments WHERE id = $1 FOR UPDATE",
        [id],
      );
      const currentRow = currentResult.rows[0];
      if (!currentRow) throw new NotFoundError();
      const updated = enrolmentSchema.parse(
        update(mapEnrolment(currentRow)),
      );
      if (updated.id !== id) {
        throw new Error("An enrolment update cannot change its ID");
      }
      const result = await client.query<EnrolmentRow>(
        `UPDATE enrolments SET
          course_id = $2, user_id = $3, status = $4, requested_at = $5,
          decided_by = $6, decided_at = $7, decision_note = $8,
          created_at = $9, updated_at = $10
         WHERE id = $1 RETURNING *`,
        [id, ...enrolmentValues(updated).slice(1)],
      );
      const stored = result.rows[0];
      if (!stored) throw new NotFoundError();
      return mapEnrolment(stored);
    });
  }

  public async findUserById(id: string): Promise<CourseUserRecord | null> {
    const result = await this.pool.query<UserRow>(
      "SELECT id, email, display_name, role_id, status FROM users WHERE id = $1",
      [id],
    );
    const row = result.rows[0];
    if (!row) return null;
    return userSchema
      .pick({
        id: true,
        email: true,
        displayName: true,
        roleId: true,
        status: true,
      })
      .parse({
        id: row.id,
        email: row.email,
        displayName: row.display_name,
        roleId: row.role_id,
        status: row.status,
      });
  }

  public async findRoleById(id: string): Promise<CourseRoleRecord | null> {
    const result = await this.pool.query<RoleRow>(
      "SELECT id, name FROM roles WHERE id = $1",
      [id],
    );
    const row = result.rows[0];
    if (!row) return null;
    return roleSchema.pick({ id: true, name: true }).parse(row);
  }

  public async createAudit(input: AuditInput): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_logs(
        id, actor_id, actor_role, action, target_type, target_id,
        before, after, request_id, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)`,
      [
        randomUUID(),
        input.actorId,
        input.actorRole,
        input.action,
        input.targetType,
        input.targetId,
        input.before === undefined ? null : JSON.stringify(input.before),
        input.after === undefined ? null : JSON.stringify(input.after),
        input.requestId,
        new Date().toISOString(),
      ],
    );
  }

  private async withTransaction<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      try {
        const result = await operation(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            "Course repository transaction failed and could not be rolled back",
          );
        }
        throw error;
      }
    } finally {
      client.release();
    }
  }
}

function courseValues(course: CourseRecord): unknown[] {
  return [
    course.id,
    course.ownerId,
    course.name,
    course.description ?? null,
    JSON.stringify(course.lessons ?? []),
    course.status,
    course.approvalStatus ?? "approved",
    course.approvalNote ?? null,
    course.approvalRequestedAt ?? null,
    course.reviewedBy ?? null,
    course.reviewedAt ?? null,
    course.archivedAt ?? null,
    course.archivedBy ?? null,
    course.version,
    course.createdAt,
    course.updatedAt,
  ];
}

function enrolmentValues(enrolment: EnrolmentRecord): unknown[] {
  return [
    enrolment.id,
    enrolment.courseId,
    enrolment.userId,
    enrolment.status,
    enrolment.requestedAt,
    enrolment.decidedBy ?? null,
    enrolment.decidedAt ?? null,
    enrolment.decisionNote ?? null,
    enrolment.createdAt,
    enrolment.updatedAt,
  ];
}

function mapCourse(row: CourseRow): CourseRecord {
  const parsed = courseSchema.safeParse({
    id: row.id,
    ownerId: row.owner_id,
    name: row.title,
    ...(row.description === null ? {} : { description: row.description }),
    lessons: row.lessons,
    status: row.status,
    approvalStatus: row.approval_status,
    approvalNote: row.approval_note,
    approvalRequestedAt: optionalTimestamp(row.approval_requested_at),
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at
      ? timestampToIso(row.reviewed_at)
      : null,
    archivedAt: row.archived_at
      ? timestampToIso(row.archived_at)
      : null,
    archivedBy: row.archived_by,
    version: row.version,
    createdAt: timestampToIso(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  });
  if (!parsed.success) throw new Error("Stored PostgreSQL course record is invalid");
  return parsed.data;
}

function mapEnrolment(row: EnrolmentRow): EnrolmentRecord {
  const parsed = enrolmentSchema.safeParse({
    id: row.id,
    courseId: row.course_id,
    userId: row.user_id,
    status: row.status,
    requestedAt: timestampToIso(row.requested_at),
    decidedBy: row.decided_by,
    decidedAt: row.decided_at
      ? timestampToIso(row.decided_at)
      : null,
    decisionNote: row.decision_note,
    createdAt: timestampToIso(row.created_at),
    updatedAt: timestampToIso(row.updated_at),
  });
  if (!parsed.success) {
    throw new Error("Stored PostgreSQL enrolment record is invalid");
  }
  return parsed.data;
}

function optionalTimestamp(value: TimestampValue | null): string | undefined {
  return value === null ? undefined : timestampToIso(value);
}

function timestampToIso(value: TimestampValue): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error("Stored PostgreSQL timestamp is invalid");
  }
  return date.toISOString();
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}
