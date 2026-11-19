import cookieParser from "cookie-parser";
import { Router, type Request, type RequestHandler } from "express";
import type { AppConfig } from "../../config/config";
import { createRateLimiter, emailRateLimitKey } from "../../common/middleware/rate-limit";
import { AppError } from "../../common/errors/app-error";
import { AuthService } from "./auth.service";
import {
  requireAuthentication,
  requirePasswordChangeComplete,
  requirePermission,
} from "./auth.middleware";
import {
  changePasswordRequestSchema,
  coachRequestDecisionSchema,
  coachRequestListQuerySchema,
  loginRequestSchema,
  permissionOverrideSchema,
  refreshRequestSchema,
  registerRequestSchema,
  userRoleUpdateSchema,
  adminUserListQuerySchema,
  userStatusUpdateSchema,
} from "./auth.schemas";

const refreshCookieName = "refreshToken";
const refreshCookiePath = "/api/v1/auth";

export interface AuthRouteDependencies {
  authService: AuthService;
  config: AppConfig;
}

/**
 * Creates the authentication, current-user, and coach-review routes for B3.
 */
export function createAuthRouter(
  dependencies: AuthRouteDependencies,
): Router {
  const router = Router();
  router.use(cookieParser());

  const rateLimitByIp = createRateLimiter({
    windowMs: dependencies.config.authRateLimitWindowMs,
    max: dependencies.config.authRateLimitMax,
    key: (request) => `ip:${request.ip ?? "unknown"}`,
  });
  const rateLimitByEmail = createRateLimiter({
    windowMs: dependencies.config.authRateLimitWindowMs,
    max: dependencies.config.authRateLimitMax,
    key: (request) => {
      const body = isObject(request.body) ? request.body : {};
      return `email:${emailRateLimitKey(body.email)}`;
    },
  });
  const authenticate = requireAuthentication(dependencies.authService);

  router.post(
    "/auth/register",
    rateLimitByIp,
    rateLimitByEmail,
    async (request, response) => {
      const body = registerRequestSchema.parse(request.body);
      const result = await dependencies.authService.register({
        ...body,
        ...(body.coachMessage === undefined
          ? {}
          : { coachMessage: body.coachMessage }),
      });
      response.status(201).json({
        data: {
          user: result.user,
          coachRequestCreated: result.coachRequestCreated,
        },
      });
    },
  );

  router.post(
    "/auth/login",
    rateLimitByIp,
    rateLimitByEmail,
    async (request, response) => {
      const body = loginRequestSchema.parse(request.body);
      const result = await dependencies.authService.login(
        body.email,
        body.password,
      );
      setRefreshCookie(response, result.tokens, dependencies.config);
      response.status(200).json({
        data: {
          user: result.user,
          accessToken: result.tokens.accessToken,
          accessTokenExpiresIn: result.tokens.accessTokenExpiresIn,
          ...(dependencies.authService.allowRefreshTokenInBody
            ? { refreshToken: result.tokens.refreshToken }
            : {}),
        },
      });
    },
  );

  router.post("/auth/refresh", async (request, response) => {
    const body = refreshRequestSchema.parse(request.body ?? {});
    const bodyToken = body.refreshToken;
    if (bodyToken && !dependencies.authService.allowRefreshTokenInBody) {
      throw new AppError(
        "VALIDATION_FAILED",
        422,
        "Refresh tokens in the request body are disabled",
      );
    }
    const token = bodyToken ?? readRefreshCookie(request);
    if (!token) {
      throw new AppError(
        "AUTH_TOKEN_INVALID",
        401,
        "A refresh token is required",
      );
    }
    const result = await dependencies.authService.refresh(token);
    setRefreshCookie(response, result.tokens, dependencies.config);
    response.status(200).json({
      data: {
        user: result.user,
        accessToken: result.tokens.accessToken,
        accessTokenExpiresIn: result.tokens.accessTokenExpiresIn,
        ...(dependencies.authService.allowRefreshTokenInBody
          ? { refreshToken: result.tokens.refreshToken }
          : {}),
      },
    });
  });

  router.post("/auth/logout", async (request, response) => {
    const body = refreshRequestSchema.parse(request.body ?? {});
    const bodyToken = body.refreshToken;
    if (bodyToken && !dependencies.authService.allowRefreshTokenInBody) {
      throw new AppError(
        "VALIDATION_FAILED",
        422,
        "Refresh tokens in the request body are disabled",
      );
    }
    await dependencies.authService.logout(
      bodyToken ?? readRefreshCookie(request),
    );
    clearRefreshCookie(response);
    response.status(204).end();
  });

  router.post(
    "/auth/change-password",
    authenticate,
    async (request, response) => {
      const body = changePasswordRequestSchema.parse(request.body);
      const user = requireAuthContext(request);
      const updated = await dependencies.authService.changePassword(
        user,
        body.currentPassword,
        body.newPassword,
        request.requestId,
      );
      clearRefreshCookie(response);
      response.status(200).json({ data: { user: updated } });
    },
  );

  router.get("/me", authenticate, (request, response) => {
    const currentUser = dependencies.authService.getCurrentUser(
      requireAuthContext(request),
    );
    response.status(200).json({ data: currentUser });
  });

  router.get(
    "/admin/coach-requests",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("user:manage"),
    (request, response) => {
      const query = coachRequestListQuerySchema.parse(request.query);
      const requests = dependencies.authService.listCoachRequests(query.status);
      response.status(200).json({ data: requests });
    },
  );

  router.patch(
    "/admin/coach-requests/:id",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("user:manage"),
    async (request, response) => {
      const body = coachRequestDecisionSchema.parse(request.body);
      const result = await dependencies.authService.decideCoachRequest(
        requireRouteParam(request, "id"),
        body.status,
        body.decisionNote,
        requireAuthContext(request),
        request.requestId,
      );
      response.status(200).json({ data: result });
    },
  );

  router.patch(
    "/admin/users/:id/role",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("role:manage"),
    async (request, response) => {
      const body = userRoleUpdateSchema.parse(request.body);
      const user = await dependencies.authService.changeUserRole(
        requireRouteParam(request, "id"),
        body.role,
        requireAuthContext(request),
        request.requestId,
      );
      response.status(200).json({ data: { user } });
    },
  );

  router.patch(
    "/admin/users/:id/permissions",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("role:manage"),
    async (request, response) => {
      const body = permissionOverrideSchema.parse(request.body);
      const user = await dependencies.authService.setPermissionOverride(
        requireRouteParam(request, "id"),
        body.permission,
        body.effect,
        requireAuthContext(request),
        request.requestId,
      );
      response.status(200).json({ data: { user } });
    },
  );

  router.get(
    "/admin/users",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("role:manage"),
    (request, response) => {
      const query = adminUserListQuerySchema.parse(request.query);
      const cursor = query.cursor
        ? decodeBase64UuidCursor(query.cursor)
        : undefined;
      const page = dependencies.authService.listUsers(query.limit, cursor);
      response.status(200).json({
        data: page.items,
        ...(page.nextCursor
          ? { meta: { nextCursor: page.nextCursor } }
          : {}),
      });
    },
  );

  router.patch(
    "/admin/users/:id/status",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("user:manage"),
    async (request, response) => {
      const body = userStatusUpdateSchema.parse(request.body);
      const user = await dependencies.authService.changeUserStatus(
        requireRouteParam(request, "id"),
        body.status,
        requireAuthContext(request),
        request.requestId,
      );
      response.status(200).json({ data: { user } });
    },
  );

  router.post(
    "/admin/users/:id/reset-password",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("user:manage"),
    async (request, response) => {
      const result = await dependencies.authService.resetUserPassword(
        requireRouteParam(request, "id"),
        requireAuthContext(request),
        request.requestId,
      );
      response.status(200).json({ data: result });
    },
  );

  return router;
}

/**
 * Attaches an httpOnly, Secure, SameSite=Strict refresh cookie.
 */
function setRefreshCookie(
  response: Parameters<RequestHandler>[1],
  tokens: { refreshToken: string },
  config: AppConfig,
): void {
  response.cookie(refreshCookieName, tokens.refreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: refreshCookiePath,
    maxAge: config.refreshTokenTtlDays * 86_400_000,
  });
}

/**
 * Clears the refresh cookie using the same scope as token issuance.
 */
function clearRefreshCookie(
  response: Parameters<RequestHandler>[1],
): void {
  response.clearCookie(refreshCookieName, {
    httpOnly: true,
    secure: true,
    sameSite: "strict",
    path: refreshCookiePath,
  });
}

/**
 * Reads a refresh token from the configured httpOnly cookie.
 */
function readRefreshCookie(request: Request): string | undefined {
  const value = request.cookies?.[refreshCookieName];
  return typeof value === "string" ? value : undefined;
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
  return value;
}

function decodeBase64UuidCursor(cursor: string): string {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      decoded,
    )
  ) {
    throw new AppError("VALIDATION_FAILED", 422, "The cursor is invalid");
  }
  return decoded;
}

/**
 * Checks that an arbitrary parsed request body is a non-null object.
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
