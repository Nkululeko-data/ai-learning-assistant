import { AsyncMutex } from "../../infra/jsonstore/async-mutex";
import { withCourseContentMutationLock } from "../../infra/jsonstore/course-content-mutex";
import type {
  CourseRecord,
  DocumentRecord,
  EnrolmentRecord,
  RoleRecord,
  SystemCollections,
  UserRecord,
} from "../../infra/jsonstore/system-collections";
import type { AuditInput } from "../auth/auth.types";

export type CourseUserRecord = Pick<
  UserRecord,
  "id" | "email" | "displayName" | "roleId" | "status"
>;
export type CourseRoleRecord = Pick<RoleRecord, "id" | "name">;

export interface EnrolmentRepository {
  findEnrolment(courseId: string, userId: string): Promise<EnrolmentRecord | null>;
  findEnrolmentById(id: string): Promise<EnrolmentRecord | null>;
  listEnrolmentsByCourse(courseId: string): Promise<EnrolmentRecord[]>;
  listEnrolmentsByUser(userId: string): Promise<EnrolmentRecord[]>;
  createEnrolment(input: Omit<EnrolmentRecord, "id">): Promise<EnrolmentRecord>;
  updateEnrolment(
    id: string,
    update: (enrolment: EnrolmentRecord) => EnrolmentRecord,
  ): Promise<EnrolmentRecord>;
}

export interface CourseRepository extends EnrolmentRepository {
  withMutationLock<T>(operation: () => Promise<T>): Promise<T>;
  withCourseContentMutationLock<T>(operation: () => Promise<T>): Promise<T>;
  findCourseById(id: string): Promise<CourseRecord | null>;
  listCourses(): Promise<CourseRecord[]>;
  countEnrolmentsByStatus(status: EnrolmentRecord["status"]): Promise<number>;
  findDocumentById(id: string): Promise<DocumentRecord | null>;
  createCourse(input: Omit<CourseRecord, "id">): Promise<CourseRecord>;
  updateCourse(
    id: string,
    update: (course: CourseRecord) => CourseRecord,
    expectedVersion: number,
  ): Promise<CourseRecord>;
  findUserById(id: string): Promise<CourseUserRecord | null>;
  findRoleById(id: string): Promise<CourseRoleRecord | null>;
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
   * Coordinates lesson edits with document deletion across course repositories.
   */
  public withCourseContentMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    return withCourseContentMutationLock(this.collections, operation);
  }

  /**
   * Finds a course by its ID.
   */
  public async findCourseById(id: string): Promise<CourseRecord | null> {
    return this.collections.courses.getById(id);
  }

  /**
   * Lists all courses for service-layer visibility filtering.
   */
  public async listCourses(): Promise<CourseRecord[]> {
    return this.collections.courses.list();
  }

  public async countEnrolmentsByStatus(
    status: EnrolmentRecord["status"],
  ): Promise<number> {
    return this.collections.enrolments.list(
      (enrolment) => enrolment.status === status,
    ).length;
  }

  /**
   * Finds a document for course-lesson attachment validation.
   */
  public async findDocumentById(id: string): Promise<DocumentRecord | null> {
    return this.collections.documents.getById(id);
  }

  /**
   * Inserts a validated course.
   */
  public createCourse(input: Omit<CourseRecord, "id">): Promise<CourseRecord> {
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
  public async findEnrolment(courseId: string, userId: string): Promise<EnrolmentRecord | null> {
    return this.collections.enrolments.findUnique("courseUser", `${courseId}:${userId}`);
  }

  /**
   * Finds an enrolment by ID.
   */
  public async findEnrolmentById(id: string): Promise<EnrolmentRecord | null> {
    return this.collections.enrolments.getById(id);
  }

  /**
   * Lists enrolments associated with a course.
   */
  public async listEnrolmentsByCourse(courseId: string): Promise<EnrolmentRecord[]> {
    return this.collections.enrolments.findByIndex("courseId", courseId);
  }

  /**
   * Lists enrolments associated with a learner.
   */
  public async listEnrolmentsByUser(userId: string): Promise<EnrolmentRecord[]> {
    return this.collections.enrolments.findByIndex("userId", userId);
  }

  /**
   * Inserts a validated enrolment.
   */
  public createEnrolment(input: Omit<EnrolmentRecord, "id">): Promise<EnrolmentRecord> {
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
  public async findUserById(id: string): Promise<CourseUserRecord | null> {
    const user = this.collections.users.getById(id);
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      roleId: user.roleId,
      status: user.status,
    };
  }

  /**
   * Finds the role attached to a user record.
   */
  public async findRoleById(id: string): Promise<CourseRoleRecord | null> {
    const role = this.collections.roles.getById(id);
    if (!role) return null;
    return { id: role.id, name: role.name };
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
