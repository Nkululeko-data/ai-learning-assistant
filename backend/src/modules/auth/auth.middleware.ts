import type { RequestHandler } from "express";
import { AppError } from "../../common/errors/app-error";
import type { AuthService } from "./auth.service";

/**
 * Validates bearer access tokens and attaches the current permission context.
 */
export function requireAuthentication(
  authService: AuthService,
): RequestHandler {
  return async (request, _response, next) => {
    const authorization = request.header("authorization");
    const match = authorization?.match(/^Bearer ([^\s]+)$/i);
    if (!match) {
      next(
        new AppError(
          "AUTH_TOKEN_INVALID",
          401,
          "A bearer access token is required",
        ),
      );
      return;
    }
    try {
      const token = match[1];
      if (!token) throw new AppError("AUTH_TOKEN_INVALID", 401, "Invalid access token");
      request.auth = await authService.authenticateAccessToken(token);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Requires the authenticated user to hold the requested effective permission.
 */
export function requirePermission(permission: string): RequestHandler {
  return (request, _response, next) => {
    if (!request.auth) {
      next(
        new AppError(
          "AUTH_TOKEN_INVALID",
          401,
          "A bearer access token is required",
        ),
      );
      return;
    }
    if (!request.auth.permissions.includes(permission)) {
      next(
        new AppError(
          "FORBIDDEN",
          403,
          "The required permission is not granted",
        ),
      );
      return;
    }
    next();
  };
}

/**
 * Prevents bootstrap/reset accounts from invoking privileged APIs before changing their password.
 */
export const requirePasswordChangeComplete: RequestHandler = (
  request,
  _response,
  next,
) => {
  if (request.auth?.mustChangePassword) {
    next(
      new AppError(
        "AUTH_PASSWORD_CHANGE_REQUIRED",
        403,
        "Change the initial password before continuing",
      ),
    );
    return;
  }
  next();
};
