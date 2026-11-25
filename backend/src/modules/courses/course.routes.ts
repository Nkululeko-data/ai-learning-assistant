import { Router, type Request } from "express";
import { z } from "zod";
import { AppError } from "../../common/errors/app-error";
import { requireAuthentication, requirePasswordChangeComplete, requirePermission } from "../auth/auth.middleware";
import type { AuthService } from "../auth/auth.service";
import {
  adminCourseStatusRequestSchema,
  createCourseRequestSchema,
  courseApprovalDecisionRequestSchema,
  enrolmentDecisionRequestSchema,
  enrolmentListQuerySchema,
  paginationQuerySchema,
  removeEnrolledLearnerRequestSchema,
  reassignCourseOwnerRequestSchema,
  submitCourseForApprovalRequestSchema,
  updateCourseLessonsRequestSchema,
  updateCourseRequestSchema,
} from "./course.schemas";
import { CourseService } from "./course.service";

export interface CourseRouteDependencies {
  authService: AuthService;
  courseService: CourseService;
}

/**
 * Creates course and enrolment routes under the /api/v1 prefix.
 */
export function createCourseRouter(dependencies: CourseRouteDependencies): Router {
  const router = Router();
  const authenticate = requireAuthentication(dependencies.authService);

  router.get(
    "/admin/courses/approval-queue",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("user:manage"),
    async (request, response) => {
      const query = paginationQuerySchema.parse(request.query);
      const page = await dependencies.courseService.listCourseApprovalQueue(
        requireAuthContext(request),
        query,
      );
      response.status(200).json({
        data: page.items,
        ...(page.nextCursor ? { meta: { nextCursor: page.nextCursor } } : {}),
      });
    },
  );

  router.patch(
    "/admin/courses/:courseId/approval",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("user:manage"),
    async (request, response) => {
      const body = courseApprovalDecisionRequestSchema.parse(request.body);
      const course = await dependencies.courseService.decideCourseApproval(
        requireAuthContext(request),
        requireRouteParam(request, "courseId"),
        body,
        request.requestId,
      );
      response.status(200).json({ data: course });
    },
  );

  router.get("/courses", authenticate, async (request, response) => {
    const query = paginationQuerySchema.parse(request.query);
    const page = await dependencies.courseService.listCourses(requireAuthContext(request), query);
    response.status(200).json({
      data: page.items,
      ...(page.nextCursor ? { meta: { nextCursor: page.nextCursor } } : {}),
    });
  });

  router.get("/me/courses", authenticate, async (request, response) => {
    const query = paginationQuerySchema.parse(request.query);
    const page = await dependencies.courseService.listMyCourses(
      requireAuthContext(request),
      query,
    );
    response.status(200).json({
      data: page.items,
      ...(page.nextCursor ? { meta: { nextCursor: page.nextCursor } } : {}),
    });
  });

  router.post(
    "/courses",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("course:create"),
    async (request, response) => {
      const body = createCourseRequestSchema.parse(request.body);
      const course = await dependencies.courseService.createCourse(
        requireAuthContext(request),
        body,
        request.requestId,
      );
      response.status(201).json({ data: course });
    },
  );

  router.get("/courses/:courseId", authenticate, async (request, response) => {
    const course = await dependencies.courseService.getCourse(
      requireAuthContext(request),
      requireRouteParam(request, "courseId"),
    );
    response.status(200).json({ data: course });
  });

  router.get("/courses/:courseId/preview", authenticate, async (request, response) => {
    const preview = await dependencies.courseService.getCoursePreview(
      requireAuthContext(request),
      requireRouteParam(request, "courseId"),
    );
    response.status(200).json({ data: preview });
  });

  router.get("/courses/:courseId/lessons", authenticate, async (request, response) => {
    const lessons = await dependencies.courseService.getCourseLessons(
      requireAuthContext(request),
      requireRouteParam(request, "courseId"),
    );
    response.status(200).json({ data: lessons });
  });

  router.put(
    "/courses/:courseId/lessons",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("course:edit"),
    async (request, response) => {
      const body = updateCourseLessonsRequestSchema.parse(request.body);
      const lessons = await dependencies.courseService.updateCourseLessons(
        requireAuthContext(request),
        requireRouteParam(request, "courseId"),
        body,
        request.requestId,
      );
      response.status(200).json({ data: lessons });
    },
  );

  router.patch("/courses/:courseId", authenticate, requirePasswordChangeComplete, async (request, response) => {
    const body = updateCourseRequestSchema.parse(request.body);
    const course = await dependencies.courseService.updateCourse(
      requireAuthContext(request),
      requireRouteParam(request, "courseId"),
      body,
      request.requestId,
    );
    response.status(200).json({ data: course });
  });

  router.post(
    "/courses/:courseId/submit-for-approval",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("course:edit"),
    async (request, response) => {
      const body = submitCourseForApprovalRequestSchema.parse(request.body);
      const course = await dependencies.courseService.submitCourseForApproval(
        requireAuthContext(request),
        requireRouteParam(request, "courseId"),
        body.version,
        request.requestId,
      );
      response.status(200).json({ data: course });
    },
  );

  router.post("/courses/:courseId/join", authenticate, async (request, response) => {
    const result = await dependencies.courseService.requestJoin(
      requireAuthContext(request),
      requireRouteParam(request, "courseId"),
      request.requestId,
    );
    response.status(result.created ? 201 : 200).json({
      data: result.enrolment,
    });
  });

  router.get("/me/enrolments", authenticate, async (request, response) => {
    const query = paginationQuerySchema.parse(request.query);
    const page = await dependencies.courseService.listMyEnrolments(requireAuthContext(request), query);
    response.status(200).json({
      data: page.items,
      ...(page.nextCursor ? { meta: { nextCursor: page.nextCursor } } : {}),
    });
  });

  router.get(
    "/courses/:courseId/join-requests",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("enrolment:approve"),
    async (request, response) => {
      const query = enrolmentListQuerySchema.parse(request.query);
      const page = await dependencies.courseService.listJoinRequests(
        requireAuthContext(request),
        requireRouteParam(request, "courseId"),
        query.status,
        query,
      );
      response.status(200).json({
        data: page.items,
        ...(page.nextCursor ? { meta: { nextCursor: page.nextCursor } } : {}),
      });
    },
  );

  router.get(
    "/courses/:courseId/learners",
    authenticate,
    requirePasswordChangeComplete,
    async (request, response) => {
      const query = paginationQuerySchema.parse(request.query);
      const page = await dependencies.courseService.listCourseLearners(
        requireAuthContext(request),
        requireRouteParam(request, "courseId"),
        query,
      );
      response.status(200).json({
        data: page.items,
        ...(page.nextCursor ? { meta: { nextCursor: page.nextCursor } } : {}),
      });
    },
  );

  router.patch(
    "/enrolments/:enrolmentId",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("enrolment:approve"),
    async (request, response) => {
      const body = enrolmentDecisionRequestSchema.parse(request.body);
      const enrolment = await dependencies.courseService.decideEnrolment(
        requireAuthContext(request),
        requireRouteParam(request, "enrolmentId"),
        body,
        request.requestId,
      );
      response.status(200).json({ data: enrolment });
    },
  );

  router.post(
    "/enrolments/:enrolmentId/remove",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("enrolment:approve"),
    async (request, response) => {
      const body = removeEnrolledLearnerRequestSchema.parse(request.body);
      const enrolment = await dependencies.courseService.removeEnrolledLearner(
        requireAuthContext(request),
        requireRouteParam(request, "enrolmentId"),
        body,
        request.requestId,
      );
      response.status(200).json({ data: enrolment });
    },
  );

  router.delete("/courses/:courseId/enrolment", authenticate, async (request, response) => {
    await dependencies.courseService.removeMyEnrolment(
      requireAuthContext(request),
      requireRouteParam(request, "courseId"),
      request.requestId,
    );
    response.status(204).end();
  });

  router.patch(
    "/admin/courses/:courseId/owner",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("user:manage"),
    async (request, response) => {
      const body = reassignCourseOwnerRequestSchema.parse(request.body);
      const course = await dependencies.courseService.reassignCourseOwner(
        requireAuthContext(request),
        requireRouteParam(request, "courseId"),
        body.ownerId,
        body.version,
        request.requestId,
      );
      response.status(200).json({ data: course });
    },
  );

  router.patch(
    "/admin/courses/:courseId",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("user:manage"),
    async (request, response) => {
      const body = adminCourseStatusRequestSchema.parse(request.body);
      const course = await dependencies.courseService.setCourseStatusAsAdmin(
        requireAuthContext(request),
        requireRouteParam(request, "courseId"),
        body.status,
        body.version,
        request.requestId,
      );
      response.status(200).json({ data: course });
    },
  );

  return router;
}

/**
 * Requires authentication middleware to have populated the request context.
 */
function requireAuthContext(request: Request) {
  if (!request.auth) {
    throw new AppError("AUTH_TOKEN_INVALID", 401, "Authentication is required");
  }
  return request.auth;
}

/**
 * Requires a route parameter to resolve to one path segment.
 */
function requireRouteParam(request: Request, name: string): string {
  const value = request.params[name];
  if (typeof value !== "string") {
    throw new AppError("VALIDATION_FAILED", 422, `Missing route parameter: ${name}`);
  }
  const parsed = z.string().uuid().safeParse(value);
  if (!parsed.success) {
    throw new AppError("VALIDATION_FAILED", 422, `Invalid route parameter: ${name}`);
  }
  return parsed.data;
}
