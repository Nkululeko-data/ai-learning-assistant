import { Router, type Request } from "express";
import { z } from "zod";
import { AppError } from "../../common/errors/app-error";
import {
  requireAuthentication,
  requirePasswordChangeComplete,
  requirePermission,
} from "../auth/auth.middleware";
import type { AuthService } from "../auth/auth.service";
import { adminConfigPatchSchema, adminListQuerySchema } from "./admin.schemas";
import { AdminService } from "./admin.service";

export interface AdminRouteDependencies {
  authService: AuthService;
  adminService: AdminService;
}

export function createAdminRouter(dependencies: AdminRouteDependencies): Router {
  const router = Router();
  const authenticate = requireAuthentication(dependencies.authService);

  router.get(
    "/admin/summary",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("user:manage"),
    async (_request, response) => {
      response
        .status(200)
        .json({ data: await dependencies.adminService.getSummary() });
    },
  );

  router.get(
    "/admin/audit-logs",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("audit:view"),
    async (request, response) => {
      const query = adminListQuerySchema.parse(request.query);
      const page = await dependencies.adminService.listAuditLogs(
        query.limit,
        query.cursor ? decodeCursor(query.cursor) : undefined,
      );
      response.status(200).json({
        data: page.items,
        ...(page.nextCursor ? { meta: { nextCursor: page.nextCursor } } : {}),
      });
    },
  );

  router.get(
    "/admin/executions",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("executions:view"),
    async (request, response) => {
      const query = adminListQuerySchema.parse(request.query);
      const page = await dependencies.adminService.listExecutions(
        query.limit,
        query.cursor ? decodeCursor(query.cursor) : undefined,
      );
      response.status(200).json({
        data: page.items,
        ...(page.nextCursor ? { meta: { nextCursor: page.nextCursor } } : {}),
      });
    },
  );

  router.get(
    "/admin/config",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("config:view"),
    (_request, response) => {
      response.status(200).json({ data: dependencies.adminService.getConfig() });
    },
  );

  router.patch(
    "/admin/config",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("config:manage"),
    async (request, response) => {
      const update = adminConfigPatchSchema.parse(request.body);
      const config = await dependencies.adminService.updateConfig(
        requireAuthContext(request),
        update,
        request.requestId,
      );
      response.status(200).json({ data: config });
    },
  );

  router.post(
    "/admin/users/:userId/erase",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("user:manage"),
    async (request, response) => {
      const job = await dependencies.adminService.enqueueErasure(
        requireAuthContext(request),
        requireUuidParam(request, "userId"),
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

function decodeCursor(cursor: string): string {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  if (!z.string().uuid().safeParse(decoded).success) {
    throw new AppError("VALIDATION_FAILED", 422, "The cursor is invalid");
  }
  return decoded;
}
