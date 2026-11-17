import { Router, type Request } from "express";
import { z } from "zod";
import { AppError } from "../../common/errors/app-error";
import {
  requireAuthentication,
  requirePasswordChangeComplete,
  requirePermission,
} from "../auth/auth.middleware";
import type { AuthService } from "../auth/auth.service";
import { JobService } from "./job.service";
import { jobListQuerySchema } from "./job.schemas";

export interface JobRouteDependencies {
  authService: AuthService;
  jobService: JobService;
}

/**
 * Creates caller-authorized job status and restricted admin job routes.
 */
export function createJobRouter(dependencies: JobRouteDependencies): Router {
  const router = Router();
  const authenticate = requireAuthentication(dependencies.authService);

  router.get(
    "/jobs/:jobId",
    authenticate,
    requirePasswordChangeComplete,
    (request, response) => {
      const actor = requireAuthContext(request);
      const job = dependencies.jobService.getAuthorizedJob(
        requireRouteParam(request, "jobId"),
        actor.id,
        actor.permissions,
      );
      response.status(200).json({ data: job });
    },
  );

  router.get(
    "/admin/jobs",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("executions:view"),
    (request, response) => {
      const query = jobListQuerySchema.parse(request.query);
      const page = dependencies.jobService.listAdminJobs(
        query.limit,
        query.cursor,
        query.status,
      );
      response.status(200).json({
        data: page.items,
        ...(page.nextCursor ? { meta: { nextCursor: page.nextCursor } } : {}),
      });
    },
  );

  router.post(
    "/admin/jobs/:jobId/retry",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("user:manage"),
    async (request, response) => {
      const job = await dependencies.jobService.retryJob(
        requireRouteParam(request, "jobId"),
      );
      response.status(200).json({ data: job });
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
 * Requires a route parameter to resolve to a UUID path segment.
 */
function requireRouteParam(request: Request, name: string): string {
  const value = request.params[name];
  if (typeof value !== "string" || !z.string().uuid().safeParse(value).success) {
    throw new AppError("VALIDATION_FAILED", 422, `Invalid route parameter: ${name}`);
  }
  return value;
}
