import { Router, type Request } from "express";
import { z } from "zod";
import { AppError } from "../../common/errors/app-error";
import {
  requireAuthentication,
  requirePasswordChangeComplete,
  requirePermission,
} from "../auth/auth.middleware";
import type { AuthService } from "../auth/auth.service";
import { InsightsService } from "./insights.service";

export interface InsightsRouteDependencies {
  authService: AuthService;
  insightsService: InsightsService;
}

export function createInsightsRouter(dependencies: InsightsRouteDependencies): Router {
  const router = Router();
  const authenticate = requireAuthentication(dependencies.authService);

  router.get(
    "/courses/:courseId/insights",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("insights:view"),
    (request, response) => {
      response.status(200).json({
        data: dependencies.insightsService.getInsights(
          requireAuthContext(request),
          requireUuidParam(request, "courseId"),
        ),
      });
    },
  );

  router.get(
    "/courses/:courseId/gap-report",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("insights:view"),
    (request, response) => {
      response.status(200).json({
        data: dependencies.insightsService.getLatestGapReport(
          requireAuthContext(request),
          requireUuidParam(request, "courseId"),
        ),
      });
    },
  );

  router.post(
    "/courses/:courseId/gap-report/refresh",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("insights:view"),
    async (request, response) => {
      const job = await dependencies.insightsService.refreshGapReport(
        requireAuthContext(request),
        requireUuidParam(request, "courseId"),
        request.requestId,
      );
      response.status(202).json({ data: { jobId: job.id, status: job.status } });
    },
  );

  return router;
}

function requireAuthContext(request: Request) {
  if (!request.auth) {
    throw new AppError("AUTH_TOKEN_INVALID", 401, "Authentication is required");
  }
  return request.auth;
}

function requireUuidParam(request: Request, name: string): string {
  const value = request.params[name];
  if (typeof value !== "string" || !z.string().uuid().safeParse(value).success) {
    throw new AppError("VALIDATION_FAILED", 422, `Invalid route parameter: ${name}`);
  }
  return value;
}
