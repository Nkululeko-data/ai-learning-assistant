import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { AppError } from "../../common/errors/app-error";
import { createRateLimiter } from "../../common/middleware/rate-limit";
import {
  requireAuthentication,
  requirePasswordChangeComplete,
  requirePermission,
} from "../auth/auth.middleware";
import type { AuthService } from "../auth/auth.service";
import {
  createQuizRequestSchema,
  createManualQuizRequestSchema,
  generateFlashcardsRequestSchema,
  generateQuizRequestSchema,
  generateSummaryRequestSchema,
  learningListQuerySchema,
  publishContentRequestSchema,
  quizAttemptRequestSchema,
  updateQuizRequestSchema,
} from "./learning.schemas";
import { LearningService } from "./learning.service";

export interface LearningRouteDependencies {
  authService: AuthService;
  learningService: LearningService;
  rateLimitWindowMs: number;
  rateLimitMax: number;
}

export function createLearningRouter(
  dependencies: LearningRouteDependencies,
): Router {
  const router = Router();
  const authenticate = requireAuthentication(dependencies.authService);
  const rateLimitByUser = createRateLimiter({
    windowMs: dependencies.rateLimitWindowMs,
    max: dependencies.rateLimitMax,
    key: (request) => request.auth?.id ?? request.ip ?? "unknown",
    message: "Too many learning-content requests; try again later",
  });

  router.post(
    "/summaries/generate",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("content:generate"),
    rateLimitByUser,
    async (request, response) => {
      const input = generateSummaryRequestSchema.parse(request.body);
      const result = await dependencies.learningService.generateSummary(
        requireAuthContext(request),
        input,
        request.requestId,
        createRequestSignal(response),
      );
      response.status(201).json({ data: result });
    },
  );

  router.post(
    "/flashcards/generate",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("content:generate"),
    rateLimitByUser,
    async (request, response) => {
      const input = generateFlashcardsRequestSchema.parse(request.body);
      const result = await dependencies.learningService.generateFlashcards(
        requireAuthContext(request),
        input,
        request.requestId,
        createRequestSignal(response),
      );
      response.status(201).json({ data: result });
    },
  );

  router.post(
    "/quizzes/generate",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("content:generate"),
    rateLimitByUser,
    async (request, response) => {
      const input = generateQuizRequestSchema.parse(request.body);
      const result = await dependencies.learningService.generateQuiz(
        requireAuthContext(request),
        input,
        request.requestId,
        createRequestSignal(response),
      );
      response.status(201).json({ data: result });
    },
  );

  router.get(
    "/courses/:courseId/summaries",
    authenticate,
    requirePasswordChangeComplete,
    (request, response) => {
      const query = learningListQuerySchema.parse(request.query);
      const page = dependencies.learningService.listSummaries(
        requireAuthContext(request),
        requireUuidParam(request, "courseId"),
        query.limit,
        query.cursor,
      );
      response.status(200).json({
        data: page.items,
        ...(page.nextCursor ? { meta: { nextCursor: page.nextCursor } } : {}),
      });
    },
  );

  router.get(
    "/summaries/:summaryId",
    authenticate,
    requirePasswordChangeComplete,
    (request, response) => {
      const summary = dependencies.learningService.getSummary(
        requireAuthContext(request),
        requireUuidParam(request, "summaryId"),
      );
      response.status(200).json({ data: summary });
    },
  );

  router.post(
    "/summaries/:summaryId/publish",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("content:generate"),
    async (request, response) => {
      const input = publishContentRequestSchema.parse(request.body);
      const summary = await dependencies.learningService.publishSummary(
        requireAuthContext(request),
        requireUuidParam(request, "summaryId"),
        input.version,
        request.requestId,
      );
      response.status(200).json({ data: summary });
    },
  );

  router.get(
    "/courses/:courseId/flashcards",
    authenticate,
    requirePasswordChangeComplete,
    (request, response) => {
      const query = learningListQuerySchema.parse(request.query);
      const page = dependencies.learningService.listFlashcards(
        requireAuthContext(request),
        requireUuidParam(request, "courseId"),
        query.limit,
        query.cursor,
      );
      response.status(200).json({
        data: page.items,
        ...(page.nextCursor ? { meta: { nextCursor: page.nextCursor } } : {}),
      });
    },
  );

  router.get(
    "/flashcards/:flashcardId",
    authenticate,
    requirePasswordChangeComplete,
    (request, response) => {
      const flashcards = dependencies.learningService.getFlashcards(
        requireAuthContext(request),
        requireUuidParam(request, "flashcardId"),
      );
      response.status(200).json({ data: flashcards });
    },
  );

  router.post(
    "/flashcards/:flashcardId/publish",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("content:generate"),
    async (request, response) => {
      const input = publishContentRequestSchema.parse(request.body);
      const flashcards = await dependencies.learningService.publishFlashcards(
        requireAuthContext(request),
        requireUuidParam(request, "flashcardId"),
        input.version,
        request.requestId,
      );
      response.status(200).json({ data: flashcards });
    },
  );

  router.post(
    "/quizzes",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("quiz:create"),
    async (request, response) => {
      const input = createQuizRequestSchema.parse(request.body);
      const quiz = await dependencies.learningService.createCoachQuiz(
        requireAuthContext(request),
        input,
        request.requestId,
      );
      response.status(201).json({ data: quiz });
    },
  );

  router.post(
    "/quizzes/manual",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("quiz:create"),
    async (request, response) => {
      const input = createManualQuizRequestSchema.parse(request.body);
      const quiz = await dependencies.learningService.createManualCoachQuiz(
        requireAuthContext(request),
        input,
        request.requestId,
      );
      response.status(201).json({ data: quiz });
    },
  );

  router.get(
    "/courses/:courseId/quizzes",
    authenticate,
    requirePasswordChangeComplete,
    (request, response) => {
      const query = learningListQuerySchema.parse(request.query);
      const page = dependencies.learningService.listQuizzes(
        requireAuthContext(request),
        requireUuidParam(request, "courseId"),
        query.limit,
        query.cursor,
      );
      response.status(200).json({
        data: page.items,
        ...(page.nextCursor ? { meta: { nextCursor: page.nextCursor } } : {}),
      });
    },
  );

  router.get(
    "/quizzes/:quizId",
    authenticate,
    requirePasswordChangeComplete,
    (request, response) => {
      const quiz = dependencies.learningService.getQuiz(
        requireAuthContext(request),
        requireUuidParam(request, "quizId"),
      );
      response.status(200).json({ data: quiz });
    },
  );

  router.patch(
    "/quizzes/:quizId",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("quiz:create"),
    async (request, response) => {
      const input = updateQuizRequestSchema.parse(request.body);
      const update = {
        version: input.version,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined
          ? { description: input.description }
          : {}),
        ...(input.questions !== undefined
          ? { questions: input.questions }
          : {}),
      };
      const quiz = await dependencies.learningService.updateQuiz(
        requireAuthContext(request),
        requireUuidParam(request, "quizId"),
        update,
        request.requestId,
      );
      response.status(200).json({ data: quiz });
    },
  );

  router.post(
    "/quizzes/:quizId/publish",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("quiz:create"),
    async (request, response) => {
      const input = publishContentRequestSchema.parse(request.body);
      const quiz = await dependencies.learningService.publishQuiz(
        requireAuthContext(request),
        requireUuidParam(request, "quizId"),
        input.version,
        request.requestId,
      );
      response.status(200).json({ data: quiz });
    },
  );

  router.post(
    "/quizzes/:quizId/attempts",
    authenticate,
    requirePasswordChangeComplete,
    async (request, response) => {
      const input = quizAttemptRequestSchema.parse(request.body);
      const result = await dependencies.learningService.submitQuizAttempt(
        requireAuthContext(request),
        requireUuidParam(request, "quizId"),
        input.answers,
      );
      response.status(201).json({ data: result });
    },
  );

  router.get(
    "/me/quiz-attempts",
    authenticate,
    requirePasswordChangeComplete,
    (request, response) => {
      const query = learningListQuerySchema.parse(request.query);
      const page = dependencies.learningService.listMyQuizAttempts(
        requireAuthContext(request),
        query.limit,
        query.cursor,
      );
      response.status(200).json({
        data: page.items,
        ...(page.nextCursor ? { meta: { nextCursor: page.nextCursor } } : {}),
      });
    },
  );

  return router;
}

function createRequestSignal(response: Response): AbortSignal {
  const controller = new AbortController();
  response.once("close", () => {
    if (!response.writableEnded) controller.abort();
  });
  return controller.signal;
}

function requireAuthContext(request: Request) {
  if (!request.auth) {
    throw new AppError("AUTH_TOKEN_INVALID", 401, "Authentication is required");
  }
  return request.auth;
}

function requireUuidParam(request: Request, name: string): string {
  const value = request.params[name];
  if (
    typeof value !== "string" ||
    !z.string().uuid().safeParse(value).success
  ) {
    throw new AppError(
      "VALIDATION_FAILED",
      422,
      `Invalid route parameter: ${name}`,
    );
  }
  return value;
}
