import { AppError, ConflictError, NotFoundError } from "../../common/errors/app-error";
import { z } from "zod";
import type { AuthenticatedUser } from "../auth/auth.types";
import type { CourseRecord, EnrolmentRecord } from "../../infra/jsonstore/system-collections";
import type {
  CourseApprovalDecisionRequest,
  CreateCourseRequest,
  EnrolmentDecisionRequest,
  RemoveEnrolledLearnerRequest,
  UpdateCourseLessonsRequest,
  UpdateCourseRequest,
} from "./course.schemas";
import type { CourseRepository } from "./course.types";

export interface CourseCard {
  id: string;
  name: string;
  description?: string;
}

export interface CourseView extends CourseCard {
  ownerId: string;
  status: CourseRecord["status"];
  approvalStatus: NonNullable<CourseRecord["approvalStatus"]>;
  approvalNote: string | null;
  approvalRequestedAt: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  version: number;
  archivedAt?: string | null;
  archivedBy?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CourseApprovalView extends CourseView {
  owner: {
    id: string;
    displayName: string;
    email: string;
  };
}

export interface CoursePreviewView {
  courseId: string;
  lessons: Array<{
    id: string;
    title: string;
  }>;
}

export interface CourseLessonView {
  id: string;
  title: string;
  introduction: string;
  pdfDocumentId: string | null;
  pdfFilename: string | null;
  videoDocumentId: string | null;
  videoFilename: string | null;
  videoSizeBytes: number | null;
  videoUrl: string | null;
}

export interface CourseLessonsView {
  courseId: string;
  version: number;
  lessons: CourseLessonView[];
}

export interface EnrolmentView extends EnrolmentRecord {
  course: CourseCard & { status: CourseRecord["status"] };
}

export interface JoinRequestView extends EnrolmentRecord {
  applicant: {
    id: string;
    displayName: string;
    email: string;
  };
}

export interface CourseLearnerView {
  id: string;
  learnerId: string;
  displayName: string;
  enrolledAt: string;
}

export interface PageOptions {
  limit: number;
  cursor?: string | undefined;
}

export interface PageResult<T> {
  items: T[];
  nextCursor?: string;
}

/**
 * Applies course ownership, discovery and enrolment policies over repositories.
 */
export class CourseService {
  /**
   * Creates the course service with the repository and re-request policy.
   */
  public constructor(
    private readonly repository: CourseRepository,
    private readonly enrolmentReRequestCooldownHours: number,
  ) {}

  /**
   * Creates a course for an active coach and queues it for administrator review.
   */
  public async createCourse(
    actor: AuthenticatedUser,
    input: CreateCourseRequest,
    requestId: string,
  ): Promise<CourseView> {
    assertCoach(actor);
    requirePermission(actor, "course:create");
    const now = new Date().toISOString();
    const course = await this.repository.withMutationLock(async () => {
      const created = await this.repository.createCourse({
        ownerId: actor.id,
        name: input.name,
        ...(input.description === undefined ? {} : { description: input.description }),
        lessons: [],
        status: "active",
        approvalStatus: "pending",
        approvalNote: null,
        approvalRequestedAt: now,
        reviewedBy: null,
        reviewedAt: null,
        archivedAt: null,
        archivedBy: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      });
      await this.audit(
        actor,
        "course.created",
        created.id,
        null,
        {
          ownerId: created.ownerId,
          status: created.status,
          version: created.version,
        },
        requestId,
      );
      return created;
    });
    return toCourseView(course);
  }

  /**
   * Lists active course cards and archived courses accessible to the caller.
   */
  public async listCourses(
    actor: AuthenticatedUser,
    pageOptions: PageOptions,
  ): Promise<PageResult<CourseCard | CourseView>> {
    const courses = await this.repository.listCourses();
    if (actor.role === "admin" && actor.permissions.includes("user:manage")) {
      const page = paginate(courses, pageOptions);
      return {
        items: page.items.map(toCourseView),
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      };
    }

    const enrolments = await Promise.all(
      courses.map((course) => this.repository.findEnrolment(course.id, actor.id)),
    );
    const enrolmentByCourseId = new Map(
      courses.map((course, index) => [course.id, enrolments[index]] as const),
    );
    const accessible = courses.filter((course, index) => {
      if (course.ownerId === actor.id) return true;
      if (courseApprovalStatus(course) !== "approved") return false;
      if (course.status === "active") return true;
      return enrolments[index]?.status === "approved";
    });
    const page = paginate(accessible, pageOptions);
    return {
      items: page.items.map((course) => {
        const enrolment = enrolmentByCourseId.get(course.id);
        return course.ownerId === actor.id || enrolment?.status === "approved"
          ? toCourseView(course)
          : toCourseCard(course);
      }),
      ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
    };
  }

  /**
   * Lists only courses owned by the authenticated coach.
   */
  public listMyCourses(
    actor: AuthenticatedUser,
    pageOptions: PageOptions,
  ): Promise<PageResult<CourseView>> {
    assertCoach(actor);
    return this.repository.listCourses().then((courses) => {
      const page = paginate(
        courses.filter((course) => course.ownerId === actor.id),
        pageOptions,
      );
      return {
        items: page.items.map(toCourseView),
        ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}),
      };
    });
  }

  public async listCourseApprovalQueue(
    actor: AuthenticatedUser,
    pageOptions: PageOptions,
  ): Promise<PageResult<CourseApprovalView>> {
    assertAdmin(actor);
    requirePermission(actor, "user:manage");
    const pendingCourses = (await this.repository.listCourses()).filter(
      (course) => courseApprovalStatus(course) === "pending",
    );
    const pending = await Promise.all(
      pendingCourses.map(async (course) => {
        const owner = await this.repository.findUserById(course.ownerId);
        if (!owner) {
          throw new Error(`Course "${course.id}" references a missing owner`);
        }
        return {
          ...toCourseView(course),
          owner: {
            id: owner.id,
            displayName: owner.displayName,
            email: owner.email,
          },
        };
      }),
    );
    return paginate(pending, pageOptions);
  }

  /**
   * Returns full details only to the owner or an approved learner.
   */
  public async getCourse(
    actor: AuthenticatedUser,
    courseId: string,
  ): Promise<CourseCard | CourseView> {
    const course = await this.requireCourse(courseId);
    const enrolment = await this.repository.findEnrolment(course.id, actor.id);
    const hasCourseAccess = course.ownerId === actor.id || enrolment?.status === "approved";
    if (
      (course.status === "archived" ||
        courseApprovalStatus(course) !== "approved") &&
      !hasCourseAccess
    ) {
      throw new NotFoundError();
    }
    return hasCourseAccess ? toCourseView(course) : toCourseCard(course);
  }

  /**
   * Returns only lesson titles for active courses to support course discovery.
   */
  public async getCoursePreview(
    actor: AuthenticatedUser,
    courseId: string,
  ): Promise<CoursePreviewView> {
    const course = await this.requireCourse(courseId);
    const enrolment = await this.repository.findEnrolment(course.id, actor.id);
    const hasCourseAccess = course.ownerId === actor.id || enrolment?.status === "approved";
    if (
      (course.status === "archived" ||
        courseApprovalStatus(course) !== "approved") &&
      !hasCourseAccess
    ) {
      throw new NotFoundError();
    }
    return {
      courseId: course.id,
      lessons: (course.lessons ?? []).map(({ id, title }) => ({ id, title })),
    };
  }

  /**
   * Lists ordered lessons only for the course owner and approved learners.
   */
  public async getCourseLessons(
    actor: AuthenticatedUser,
    courseId: string,
  ): Promise<CourseLessonsView> {
    const course = await this.requireCourseAccess(actor, courseId);
    return toCourseLessonsView(course, this.repository);
  }

  /**
   * Replaces the ordered lesson list for an active, owned course.
   */
  public async updateCourseLessons(
    actor: AuthenticatedUser,
    courseId: string,
    input: UpdateCourseLessonsRequest,
    requestId: string,
  ): Promise<CourseLessonsView> {
    assertCoach(actor);
    requirePermission(actor, "course:edit");
    return this.repository.withCourseContentMutationLock(async () => {
      const current = await this.requireOwnedCourse(actor, courseId);
      if (current.status !== "active") {
        throw new AppError("COURSE_ARCHIVED", 409, "Archived courses are read-only until reactivated");
      }
      assertExpectedVersion(current, input.version);
      for (const lesson of input.lessons) {
        if (lesson.pdfDocumentId === null) continue;
        const document = await this.repository.findDocumentById(lesson.pdfDocumentId);
        if (
          !document ||
          document.courseId !== courseId ||
          document.scope !== "course" ||
          document.mimeType !== "application/pdf" ||
          document.status !== "ready"
        ) {
          throw new AppError("VALIDATION_FAILED", 422, "Lesson PDFs must be ready PDF documents from this course");
        }
      }
      for (const lesson of input.lessons) {
        const existingLesson = current.lessons?.find(
          (currentLesson) => currentLesson.id === lesson.id,
        );
        if (
          lesson.videoUrl !== null &&
          lesson.videoUrl !== existingLesson?.videoUrl
        ) {
          throw new AppError(
            "VALIDATION_FAILED",
            422,
            "New external lesson video links are not supported; upload an MP4 video",
          );
        }
        if (lesson.videoDocumentId === null) continue;
        const video = await this.repository.findDocumentById(lesson.videoDocumentId);
        if (
          !video ||
          video.courseId !== courseId ||
          video.scope !== "course" ||
          video.mimeType !== "video/mp4" ||
          video.status !== "ready"
        ) {
          throw new AppError(
            "VALIDATION_FAILED",
            422,
            "Lesson videos must be ready MP4 files uploaded to this course",
          );
        }
      }

      const updated = await this.repository.updateCourse(
        courseId,
        (course) => ({
          ...course,
          lessons: input.lessons,
          updatedAt: new Date().toISOString(),
        }),
        input.version,
      );
      await this.audit(
        actor,
        "course.lessons_updated",
        updated.id,
        { lessonCount: current.lessons?.length ?? 0 },
        { lessonCount: input.lessons.length },
        requestId,
      );
      return toCourseLessonsView(updated, this.repository);
    });
  }

  /**
   * Updates or archives an owned course with optimistic version checking.
   */
  public async updateCourse(
    actor: AuthenticatedUser,
    courseId: string,
    input: UpdateCourseRequest,
    requestId: string,
  ): Promise<CourseView> {
    assertCoach(actor);
    const changesDetails = input.name !== undefined || input.description !== undefined;
    if (changesDetails) requirePermission(actor, "course:edit");
    if (input.status !== undefined) requirePermission(actor, "course:archive");

    return this.repository.withMutationLock(async () => {
      const current = await this.requireOwnedCourse(actor, courseId);
      assertExpectedVersion(current, input.version);
      if (current.status === "archived" && changesDetails && input.status !== "active") {
        throw new AppError("COURSE_ARCHIVED", 409, "Archived courses are read-only until reactivated");
      }
      if (!changesDetails && input.status === current.status) {
        return toCourseView(current);
      }

      const now = new Date().toISOString();
      const updated = await this.repository.updateCourse(
        courseId,
        (course) => ({
          ...course,
          ...(input.name === undefined ? {} : { name: input.name }),
          ...(input.description === undefined ? {} : { description: input.description }),
          ...(input.status === undefined
            ? {}
            : {
                status: input.status,
                archivedAt: input.status === "archived" ? now : null,
                archivedBy: input.status === "archived" ? actor.id : null,
              }),
          updatedAt: now,
        }),
        input.version,
      );
      await this.audit(
        actor,
        "course.updated",
        updated.id,
        courseAuditState(current),
        courseAuditState(updated),
        requestId,
      );
      return toCourseView(updated);
    });
  }

  /**
   * Reassigns a course to an active coach through the administrator boundary.
   */
  public async reassignCourseOwner(
    actor: AuthenticatedUser,
    courseId: string,
    ownerId: string,
    version: number,
    requestId: string,
  ): Promise<CourseView> {
    assertAdmin(actor);
    requirePermission(actor, "user:manage");
    return this.repository.withMutationLock(async () => {
      const current = await this.requireCourse(courseId);
      assertExpectedVersion(current, version);
      const target = await this.repository.findUserById(ownerId);
      const role = target
        ? await this.repository.findRoleById(target.roleId)
        : null;
      if (!target || target.status !== "active" || role?.name !== "coach") {
        throw new AppError("VALIDATION_FAILED", 422, "The new course owner must be an active coach");
      }
      if (current.ownerId === ownerId) return toCourseView(current);
      const updated = await this.repository.updateCourse(
        courseId,
        (course) => ({
          ...course,
          ownerId,
          updatedAt: new Date().toISOString(),
        }),
        version,
      );
      await this.audit(
        actor,
        "course.owner_reassigned",
        updated.id,
        {
          ownerId: current.ownerId,
          status: current.status,
          version: current.version,
        },
        {
          ownerId: updated.ownerId,
          status: updated.status,
          version: updated.version,
        },
        requestId,
      );
      return toCourseView(updated);
    });
  }

  /**
   * Archives or reactivates a course through the administrator boundary.
   */
  public async setCourseStatusAsAdmin(
    actor: AuthenticatedUser,
    courseId: string,
    status: CourseRecord["status"],
    version: number,
    requestId: string,
  ): Promise<CourseView> {
    assertAdmin(actor);
    requirePermission(actor, "user:manage");

    return this.repository.withMutationLock(async () => {
      const current = await this.requireCourse(courseId);
      assertExpectedVersion(current, version);
      if (current.status === status) return toCourseView(current);
      if (status === "active") {
        const owner = await this.repository.findUserById(current.ownerId);
        const role = owner
          ? await this.repository.findRoleById(owner.roleId)
          : null;
        if (!owner || owner.status !== "active" || role?.name !== "coach") {
          throw new ConflictError("Reassign the course to an active coach before reactivating it");
        }
      }
      const now = new Date().toISOString();
      const updated = await this.repository.updateCourse(
        courseId,
        (course) => ({
          ...course,
          status,
          archivedAt: status === "archived" ? now : null,
          archivedBy: status === "archived" ? actor.id : null,
          updatedAt: now,
        }),
        version,
      );
      await this.audit(
        actor,
        status === "archived" ? "course.archived" : "course.reactivated",
        updated.id,
        courseAuditState(current),
        courseAuditState(updated),
        requestId,
      );
      return toCourseView(updated);
    });
  }

  public async decideCourseApproval(
    actor: AuthenticatedUser,
    courseId: string,
    input: CourseApprovalDecisionRequest,
    requestId: string,
  ): Promise<CourseView> {
    assertAdmin(actor);
    requirePermission(actor, "user:manage");
    return this.repository.withMutationLock(async () => {
      const current = await this.requireCourse(courseId);
      assertExpectedVersion(current, input.version);
      if (courseApprovalStatus(current) !== "pending") {
        throw new ConflictError("Only courses awaiting review can be decided");
      }
      if (input.decision === "approved") {
        const owner = await this.repository.findUserById(current.ownerId);
        const role = owner
          ? await this.repository.findRoleById(owner.roleId)
          : null;
        if (!owner || owner.status !== "active" || role?.name !== "coach") {
          throw new ConflictError(
            "The course owner must be an active coach before approval",
          );
        }
      }

      const now = new Date().toISOString();
      const updated = await this.repository.updateCourse(
        courseId,
        (course) => ({
          ...course,
          approvalStatus: input.decision,
          approvalNote:
            input.decision === "changes_requested"
              ? input.note?.trim() || null
              : null,
          reviewedBy: actor.id,
          reviewedAt: now,
          updatedAt: now,
        }),
        input.version,
      );
      await this.audit(
        actor,
        input.decision === "approved"
          ? "course.approval_granted"
          : "course.changes_requested",
        updated.id,
        courseAuditState(current),
        courseAuditState(updated),
        requestId,
      );
      return toCourseView(updated);
    });
  }

  public async submitCourseForApproval(
    actor: AuthenticatedUser,
    courseId: string,
    version: number,
    requestId: string,
  ): Promise<CourseView> {
    assertCoach(actor);
    requirePermission(actor, "course:edit");
    return this.repository.withMutationLock(async () => {
      const current = await this.requireOwnedCourse(actor, courseId);
      assertExpectedVersion(current, version);
      if (courseApprovalStatus(current) !== "changes_requested") {
        throw new ConflictError(
          "Only courses returned for changes can be resubmitted",
        );
      }
      const now = new Date().toISOString();
      const updated = await this.repository.updateCourse(
        courseId,
        (course) => ({
          ...course,
          approvalStatus: "pending",
          approvalNote: null,
          approvalRequestedAt: now,
          reviewedBy: null,
          reviewedAt: null,
          updatedAt: now,
        }),
        version,
      );
      await this.audit(
        actor,
        "course.resubmitted",
        updated.id,
        courseAuditState(current),
        courseAuditState(updated),
        requestId,
      );
      return toCourseView(updated);
    });
  }

  /**
   * Creates or reopens the caller's single enrolment request for an active course.
   */
  public async requestJoin(
    actor: AuthenticatedUser,
    courseId: string,
    requestId: string,
  ): Promise<{ enrolment: EnrolmentRecord; created: boolean }> {
    assertLearner(actor);
    return this.repository.withMutationLock(async () => {
      const course = await this.requireCourse(courseId);
      if (course.status !== "active") {
        throw new AppError("COURSE_ARCHIVED", 409, "Archived courses do not accept new enrolment requests");
      }
      if (courseApprovalStatus(course) !== "approved") {
        throw new AppError(
          "COURSE_NOT_AVAILABLE",
          409,
          "This course is not available for enrolment",
        );
      }
      if (course.ownerId === actor.id) {
        throw new ConflictError("Course owners cannot request enrolment in their course");
      }

      const existing = await this.repository.findEnrolment(courseId, actor.id);
      if (existing?.status === "pending") {
        return { enrolment: existing, created: false };
      }
      if (existing?.status === "approved") {
        throw new ConflictError("The learner is already enrolled in this course");
      }

      const now = new Date().toISOString();
      let enrolment: EnrolmentRecord;
      if (existing) {
        this.assertReRequestAllowed(existing);
        enrolment = await this.repository.updateEnrolment(existing.id, (current) => ({
          ...current,
          status: "pending",
          requestedAt: now,
          decidedBy: null,
          decidedAt: null,
          decisionNote: null,
          updatedAt: now,
        }));
      } else {
        enrolment = await this.repository.createEnrolment({
          courseId,
          userId: actor.id,
          status: "pending",
          requestedAt: now,
          decidedBy: null,
          decidedAt: null,
          decisionNote: null,
          createdAt: now,
          updatedAt: now,
        });
      }
      await this.audit(
        actor,
        "enrolment.requested",
        enrolment.id,
        null,
        {
          courseId,
          status: enrolment.status,
        },
        requestId,
      );
      return { enrolment, created: true };
    });
  }

  /**
   * Lists the caller's enrolments with safe course-card metadata.
   */
  public async listMyEnrolments(
    actor: AuthenticatedUser,
    pageOptions: PageOptions,
  ): Promise<PageResult<EnrolmentView>> {
    const storedEnrolments = await this.repository.listEnrolmentsByUser(actor.id);
    const enrolments = await Promise.all(
      storedEnrolments.map(async (enrolment) => {
        const course = await this.requireCourse(enrolment.courseId);
        return {
          ...enrolment,
          course: {
            ...toCourseCard(course),
            status: course.status,
          },
        };
      }),
    );
    return paginate(enrolments, pageOptions);
  }

  /**
   * Lists enrolment requests for a course owned by the caller.
   */
  public async listJoinRequests(
    actor: AuthenticatedUser,
    courseId: string,
    status?: EnrolmentRecord["status"],
    pageOptions: PageOptions = { limit: 20 },
  ): Promise<PageResult<JoinRequestView>> {
    requirePermission(actor, "enrolment:approve");
    const course = await this.requireOwnedCourse(actor, courseId);
    const storedEnrolments = await this.repository.listEnrolmentsByCourse(course.id);
    const requests = await Promise.all(
      storedEnrolments
      .filter((enrolment) => status === undefined || enrolment.status === status)
      .map(async (enrolment) => {
        const applicant = await this.repository.findUserById(enrolment.userId);
        if (!applicant) {
          throw new Error(`Enrolment "${enrolment.id}" references a missing user`);
        }
        return {
          ...enrolment,
          applicant: {
            id: applicant.id,
            displayName: applicant.displayName,
            email: applicant.email,
          },
        };
      }),
    );
    return paginate(requests, pageOptions);
  }

  /**
   * Lists active learners who can access a course to its owner and members.
   */
  public async listCourseLearners(
    actor: AuthenticatedUser,
    courseId: string,
    pageOptions: PageOptions,
  ): Promise<PageResult<CourseLearnerView>> {
    const course = await this.requireCourseAccess(actor, courseId);
    const approvedEnrolments = (
      await this.repository.listEnrolmentsByCourse(course.id)
    ).filter((enrolment) => enrolment.status === "approved");
    const learnerRecords = await Promise.all(
      approvedEnrolments.map(async (enrolment) => {
        const learner = await this.repository.findUserById(enrolment.userId);
        if (!learner) {
          throw new Error(`Enrolment "${enrolment.id}" references a missing user`);
        }
        const role = await this.repository.findRoleById(learner.roleId);
        if (!role) {
          throw new Error(`User "${learner.id}" references a missing role`);
        }
        if (learner.status !== "active" || role.name !== "learner") return null;
        return {
            id: enrolment.id,
            learnerId: learner.id,
            displayName: learner.displayName,
            enrolledAt: enrolment.decidedAt ?? enrolment.requestedAt,
        };
      }),
    );
    const learners = learnerRecords.filter(
      (learner): learner is CourseLearnerView => learner !== null,
    );
    return paginate(learners, pageOptions);
  }

  /**
   * Removes an approved learner from a course and records the reason for them.
   */
  public async removeEnrolledLearner(
    actor: AuthenticatedUser,
    enrolmentId: string,
    input: RemoveEnrolledLearnerRequest,
    requestId: string,
  ): Promise<EnrolmentRecord> {
    assertCoach(actor);
    requirePermission(actor, "enrolment:approve");
    return this.repository.withMutationLock(async () => {
      const current = await this.repository.findEnrolmentById(enrolmentId);
      if (!current) throw new NotFoundError();
      const course = await this.requireOwnedCourse(actor, current.courseId);
      if (current.status === "removed") return current;
      if (current.status !== "approved") {
        throw new ConflictError("Only an approved learner can be removed");
      }

      const now = new Date().toISOString();
      const updated = await this.repository.updateEnrolment(current.id, (enrolment) => ({
        ...enrolment,
        status: "removed",
        decidedBy: actor.id,
        decidedAt: now,
        decisionNote: input.reason,
        updatedAt: now,
      }));
      await this.audit(
        actor,
        "enrolment.removed_by_coach",
        updated.id,
        { courseId: course.id, status: current.status },
        { courseId: course.id, status: updated.status },
        requestId,
      );
      return updated;
    });
  }

  /**
   * Approves or rejects a pending request, idempotently for repeated decisions.
   */
  public async decideEnrolment(
    actor: AuthenticatedUser,
    enrolmentId: string,
    input: EnrolmentDecisionRequest,
    requestId: string,
  ): Promise<EnrolmentRecord> {
    assertCoach(actor);
    requirePermission(actor, "enrolment:approve");
    return this.repository.withMutationLock(async () => {
      const current = await this.repository.findEnrolmentById(enrolmentId);
      if (!current) throw new NotFoundError();
      const course = await this.requireOwnedCourse(actor, current.courseId);
      if (current.status === input.status) return current;
      if (current.status !== "pending") {
        throw new ConflictError("Only pending enrolment requests can be decided");
      }
      if (input.status === "approved" && course.status !== "active") {
        throw new AppError("COURSE_ARCHIVED", 409, "Archived courses cannot approve new enrolments");
      }
      if (input.status === "approved") {
        const applicant = await this.repository.findUserById(current.userId);
        if (!applicant) {
          throw new Error(`Enrolment "${current.id}" references a missing user`);
        }
        if (applicant.status !== "active") {
          throw new ConflictError("Inactive learners cannot be approved");
        }
      }

      const now = new Date().toISOString();
      const updated = await this.repository.updateEnrolment(current.id, (enrolment) => ({
        ...enrolment,
        status: input.status,
        decidedBy: actor.id,
        decidedAt: now,
        decisionNote: input.decisionNote?.trim() || null,
        updatedAt: now,
      }));
      await this.audit(
        actor,
        "enrolment.decided",
        updated.id,
        {
          courseId: updated.courseId,
          status: current.status,
        },
        {
          courseId: updated.courseId,
          status: updated.status,
        },
        requestId,
      );
      return updated;
    });
  }

  /**
   * Removes the caller's approved enrolment without deleting its record.
   */
  public async removeMyEnrolment(actor: AuthenticatedUser, courseId: string, requestId: string): Promise<void> {
    assertLearner(actor);
    await this.repository.withMutationLock(async () => {
      await this.requireCourse(courseId);
      const current = await this.repository.findEnrolment(courseId, actor.id);
      if (!current) throw new NotFoundError();
      if (current.status === "removed") return;
      if (current.status !== "approved") {
        throw new ConflictError("Only an approved enrolment can be removed");
      }
      const now = new Date().toISOString();
      const updated = await this.repository.updateEnrolment(current.id, (enrolment) => ({
        ...enrolment,
        status: "removed",
        decidedBy: actor.id,
        decidedAt: now,
        decisionNote: null,
        updatedAt: now,
      }));
      await this.audit(
        actor,
        "enrolment.removed",
        updated.id,
        {
          courseId,
          status: current.status,
        },
        {
          courseId,
          status: updated.status,
        },
        requestId,
      );
    });
  }

  /**
   * Finds a course or returns the shared not-found error.
   */
  private async requireCourse(courseId: string): Promise<CourseRecord> {
    const course = await this.repository.findCourseById(courseId);
    if (!course) throw new NotFoundError();
    return course;
  }

  /**
   * Finds a course owned by an active coach and hides other owners' resources.
   */
  private async requireOwnedCourse(
    actor: AuthenticatedUser,
    courseId: string,
  ): Promise<CourseRecord> {
    assertCoach(actor);
    const course = await this.requireCourse(courseId);
    if (course.ownerId !== actor.id) throw new NotFoundError();
    return course;
  }

  /**
   * Finds a course the owner or an approved learner may study.
   */
  private async requireCourseAccess(
    actor: AuthenticatedUser,
    courseId: string,
  ): Promise<CourseRecord> {
    const course = await this.requireCourse(courseId);
    const isOwner = actor.role === "coach" && course.ownerId === actor.id;
    const isApprovedLearner =
      actor.role === "learner" &&
      courseApprovalStatus(course) === "approved" &&
      (await this.repository.findEnrolment(course.id, actor.id))?.status ===
        "approved";
    if (actor.status !== "active" || (!isOwner && !isApprovedLearner)) {
      throw new NotFoundError();
    }
    return course;
  }

  /**
   * Enforces the configured wait after a rejected or removed request.
   */
  private assertReRequestAllowed(enrolment: EnrolmentRecord): void {
    if (enrolment.status !== "rejected" && enrolment.status !== "removed") {
      throw new ConflictError("The enrolment request cannot be reopened");
    }
    if (this.enrolmentReRequestCooldownHours === 0) return;
    const lastDecisionAt = enrolment.decidedAt ?? enrolment.updatedAt;
    const availableAt = Date.parse(lastDecisionAt) + this.enrolmentReRequestCooldownHours * 60 * 60 * 1000;
    if (Date.now() < availableAt) {
      throw new ConflictError("The enrolment request is still in its re-request cool-down", {
        availableAt: new Date(availableAt).toISOString(),
      });
    }
  }

  /**
   * Appends an audit record without course descriptions or user content.
   */
  private audit(
    actor: AuthenticatedUser,
    action: string,
    targetId: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
    requestId: string,
  ): Promise<void> {
    return this.repository.createAudit({
      actorId: actor.id,
      actorRole: actor.role,
      action,
      targetType: action.startsWith("enrolment.") ? "enrolment" : "course",
      targetId,
      before,
      after,
      requestId,
    });
  }
}

/**
 * Requires an active authenticated coach.
 */
function assertCoach(actor: AuthenticatedUser): void {
  if (actor.status !== "active" || actor.role !== "coach") {
    throw new AppError("FORBIDDEN", 403, "An active coach account is required");
  }
}

/**
 * Requires an active authenticated learner.
 */
function assertLearner(actor: AuthenticatedUser): void {
  if (actor.status !== "active" || actor.role !== "learner") {
    throw new AppError("FORBIDDEN", 403, "An active learner account is required");
  }
}

/**
 * Requires the administrator role.
 */
function assertAdmin(actor: AuthenticatedUser): void {
  if (actor.status !== "active" || actor.role !== "admin") {
    throw new AppError("FORBIDDEN", 403, "An administrator account is required");
  }
}

/**
 * Requires a permission resolved for the current authenticated user.
 */
function requirePermission(actor: AuthenticatedUser, permission: string): void {
  if (!actor.permissions.includes(permission)) {
    throw new AppError("FORBIDDEN", 403, "The required permission is not granted");
  }
}

/**
 * Rejects stale course versions before applying an update.
 */
function assertExpectedVersion(course: CourseRecord, expectedVersion: number): void {
  if (course.version !== expectedVersion) {
    throw new ConflictError("Record version is stale");
  }
}

/**
 * Projects a course into the fields visible on an active course card.
 */
function toCourseCard(course: CourseRecord): CourseCard {
  return {
    id: course.id,
    name: course.name,
    ...(course.description === undefined ? {} : { description: course.description }),
  };
}

/**
 * Projects a course into the owner/member detail view.
 */
function toCourseView(course: CourseRecord): CourseView {
  return {
    ...toCourseCard(course),
    ownerId: course.ownerId,
    status: course.status,
    approvalStatus: courseApprovalStatus(course),
    approvalNote: course.approvalNote ?? null,
    approvalRequestedAt: course.approvalRequestedAt ?? null,
    reviewedBy: course.reviewedBy ?? null,
    reviewedAt: course.reviewedAt ?? null,
    version: course.version,
    ...(course.archivedAt === undefined ? {} : { archivedAt: course.archivedAt }),
    ...(course.archivedBy === undefined ? {} : { archivedBy: course.archivedBy }),
    createdAt: course.createdAt,
    updatedAt: course.updatedAt,
  };
}

async function toCourseLessonsView(
  course: CourseRecord,
  repository: CourseRepository,
): Promise<CourseLessonsView> {
  return {
    courseId: course.id,
    version: course.version,
    lessons: await Promise.all(
      (course.lessons ?? []).map(async (lesson) => {
        const document = lesson.pdfDocumentId
          ? await repository.findDocumentById(lesson.pdfDocumentId)
          : null;
        const videoDocument = lesson.videoDocumentId
          ? await repository.findDocumentById(lesson.videoDocumentId)
          : null;
        const pdfIsAvailable =
          document?.courseId === course.id &&
          document.scope === "course" &&
          document.mimeType === "application/pdf" &&
          document.status === "ready";
        const videoIsAvailable =
          videoDocument?.courseId === course.id &&
          videoDocument.scope === "course" &&
          videoDocument.mimeType === "video/mp4" &&
          videoDocument.status === "ready";
        return {
          id: lesson.id,
          title: lesson.title,
          introduction: lesson.introduction,
          pdfDocumentId: pdfIsAvailable ? document.id : null,
          pdfFilename: pdfIsAvailable ? document.filename : null,
          videoDocumentId: videoIsAvailable ? videoDocument.id : null,
          videoFilename: videoIsAvailable ? videoDocument.filename : null,
          videoSizeBytes: videoIsAvailable ? videoDocument.sizeBytes : null,
          videoUrl: lesson.videoUrl,
        };
      }),
    ),
  };
}

/**
 * Returns only non-content course fields suitable for audit history.
 */
function courseAuditState(course: CourseRecord): Record<string, unknown> {
  return {
    ownerId: course.ownerId,
    status: course.status,
    approvalStatus: courseApprovalStatus(course),
    version: course.version,
  };
}

function courseApprovalStatus(
  course: CourseRecord,
): NonNullable<CourseRecord["approvalStatus"]> {
  return course.approvalStatus ?? "approved";
}

/**
 * Returns a bounded ID-ordered page and encodes the next ID as an opaque cursor.
 */
function paginate<T extends { id: string }>(records: T[], options: PageOptions): PageResult<T> {
  const sorted = [...records].sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
  const cursorId = options.cursor ? decodeCursor(options.cursor) : undefined;
  const remaining = cursorId ? sorted.filter((record) => record.id > cursorId) : sorted;
  const selected = remaining.slice(0, options.limit + 1);
  const hasMore = selected.length > options.limit;
  const items = selected.slice(0, options.limit);
  const lastItem = items.at(-1);
  if (!hasMore || !lastItem) return { items };
  return {
    items,
    nextCursor: Buffer.from(lastItem.id).toString("base64url"),
  };
}

/**
 * Validates and decodes a base64url cursor containing a record UUID.
 */
function decodeCursor(cursor: string): string {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  if (!z.string().uuid().safeParse(decoded).success) {
    throw new AppError("VALIDATION_FAILED", 422, "The cursor is invalid");
  }
  return decoded;
}
