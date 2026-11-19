import { Router, type Request } from "express";
import { AppError } from "../../common/errors/app-error";
import {
  requireAuthentication,
  requirePasswordChangeComplete,
} from "../auth/auth.middleware";
import type { AuthService } from "../auth/auth.service";
import { FeedbackService } from "./feedback.service";
import { submitFeedbackRequestSchema } from "./feedback.schemas";

export interface FeedbackRouteDependencies {
  authService: AuthService;
  feedbackService: FeedbackService;
}

export function createFeedbackRouter(dependencies: FeedbackRouteDependencies): Router {
  const router = Router();
  const authenticate = requireAuthentication(dependencies.authService);

  router.post(
    "/feedback",
    authenticate,
    requirePasswordChangeComplete,
    async (request, response) => {
      const input = submitFeedbackRequestSchema.parse(request.body);
      const feedback = await dependencies.feedbackService.submit(
        requireAuthContext(request),
        input,
      );
      response.status(201).json({ data: feedback });
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
