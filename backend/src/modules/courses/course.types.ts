import { AsyncMutex } from "../../infra/jsonstore/async-mutex";
import type {
  CourseRecord,
  EnrolmentRecord,
  RoleRecord,
  SystemCollections,
  UserRecord,
} from "../../infra/jsonstore/system-collections";
import type { AuditInput } from "../auth/auth.types";

export interface CourseRepository {
  withMutationLock<T>(operation: () => Promise<T>): Promise<T>;
  findCourseById(id: string): CourseRecord | null;
  listCourses(): CourseRecord[];
  createCourse(input: Omit<CourseRecord, "id">): Promise<CourseRecord>;
  updateCourse(
    id: string,
    update: (course: CourseRecord) => CourseRecord,
    expectedVersion: number,
  ): Promise<CourseRecord>;
  findEnrolment(courseId: string, userId: string): EnrolmentRecord | null;
  findEnrolmentById(id: string): EnrolmentRecord | null;
  listEnrolmentsByCourse(courseId: string): EnrolmentRecord[];
  listEnrolmentsByUser(userId: string): EnrolmentRecord[];
  createEnrolment(input: Omit<EnrolmentRecord, "id">): Promise<EnrolmentRecord>;
  updateEnrolment(
    id: string,
    update: (enrolment: EnrolmentRecord) => EnrolmentRecord,
  ): Promise<EnrolmentRecord>;
  findUserById(id: string): UserRecord | null;
  findRoleById(id: string): RoleRecord | null;
  createAudit(input: AuditInput): Promise<void>;
}

/**
 * Adapts the course, enrolment and audit JSON collections to the domain port.
 */
export class JsonCourseRepository implements CourseRepository {
  private readonly mutationMutex = new AsyncMutex();

  /**
   * Creates the JSON-backed repository for courses and enrolments.
   */
  public constructor(private readonly collections: SystemCollections) {}

  /**
   * Serializes workflows that update course and enrolment state together.
   */
  public withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    return this.mutationMutex.runExclusive(operation);
  }

  /**
   * Finds a course by its ID.
   */
  public findCourseById(id: string): CourseRecord | null {
    return this.collections.courses.getById(id);
  }

  /**
   * Lists all courses for service-layer visibility filtering.
   */
  public listCourses(): CourseRecord[] {
    return this.collections.courses.list();
  }

  /**
   * Inserts a validated course.
   */
  public createCourse(
    input: Omit<CourseRecord, "id">,
  ): Promise<CourseRecord> {
    return this.collections.courses.insert(input);
  }

  /**
   * Updates a course only when its optimistic version matches.
   */
  public updateCourse(
    id: string,
    update: (course: CourseRecord) => CourseRecord,
    expectedVersion: number,
  ): Promise<CourseRecord> {
    return this.collections.courses.update(id, update, expectedVersion);
  }

  /**
   * Finds the unique enrolment for a user and course.
   */
  public findEnrolment(
    courseId: string,
    userId: string,
  ): EnrolmentRecord | null {
    return this.collections.enrolments.findUnique(
      "courseUser",
      `${courseId}:${userId}`,
    );
  }

  /**
   * Finds an enrolment by ID.
   */
  public findEnrolmentById(id: string): EnrolmentRecord | null {
    return this.collections.enrolments.getById(id);
  }

  /**
   * Lists enrolments associated with a course.
   */
  public listEnrolmentsByCourse(courseId: string): EnrolmentRecord[] {
    return this.collections.enrolments.findByIndex("courseId", courseId);
  }

  /**
   * Lists enrolments associated with a learner.
   */
  public listEnrolmentsByUser(userId: string): EnrolmentRecord[] {
    return this.collections.enrolments.findByIndex("userId", userId);
  }

  /**
   * Inserts a validated enrolment.
   */
  public createEnrolment(
    input: Omit<EnrolmentRecord, "id">,
  ): Promise<EnrolmentRecord> {
    return this.collections.enrolments.insert(input);
  }

  /**
   * Updates enrolment state under the collection write queue.
   */
  public updateEnrolment(
    id: string,
    update: (enrolment: EnrolmentRecord) => EnrolmentRecord,
  ): Promise<EnrolmentRecord> {
    return this.collections.enrolments.update(id, update);
  }

  /**
   * Finds a user record for owner, applicant and administrator policies.
   */
  public findUserById(id: string): UserRecord | null {
    return this.collections.users.getById(id);
  }

  /**
   * Finds the role attached to a user record.
   */
  public findRoleById(id: string): RoleRecord | null {
    return this.collections.roles.getById(id);
  }

  /**
   * Appends an audit record containing only supplied safe metadata.
   */
  public async createAudit(input: AuditInput): Promise<void> {
    await this.collections.auditLogs.insert({
      actorId: input.actorId,
      actorRole: input.actorRole,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      before: input.before ?? null,
      after: input.after ?? null,
      requestId: input.requestId,
      createdAt: new Date().toISOString(),
    });
  }
}
