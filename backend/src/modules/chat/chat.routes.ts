import { Router, type Request } from "express";
import { z } from "zod";
import { AppError } from "../../common/errors/app-error";
import { createRateLimiter } from "../../common/middleware/rate-limit";
import {
  requireAuthentication,
  requirePasswordChangeComplete,
} from "../auth/auth.middleware";
import type { AuthService } from "../auth/auth.service";
import { ChatService } from "./chat.service";
import {
  askChatRequestSchema,
  chatResponseSchema,
  conversationListQuerySchema,
  updateConversationRequestSchema,
} from "./chat.schemas";

export interface ChatRouteDependencies {
  authService: AuthService;
  chatService: ChatService;
  rateLimitWindowMs: number;
  rateLimitMax: number;
}

export function createChatRouter(dependencies: ChatRouteDependencies): Router {
  const router = Router();
  const authenticate = requireAuthentication(dependencies.authService);
  const rateLimitByUser = createRateLimiter({
    windowMs: dependencies.rateLimitWindowMs,
    max: dependencies.rateLimitMax,
    key: (request) => request.auth?.id ?? request.ip ?? "unknown",
    message: "Too many chat requests; try again later",
  });

  router.post(
    "/chat/ask",
    authenticate,
    requirePasswordChangeComplete,
    rateLimitByUser,
    async (request, response) => {
      const input = askChatRequestSchema.parse(request.body);
      const controller = new AbortController();
      response.once("close", () => {
        if (!response.writableEnded) controller.abort();
      });
      const result = await dependencies.chatService.ask(
        requireAuthContext(request),
        input,
        request.requestId,
        controller.signal,
      );
      const validatedResult = chatResponseSchema.parse(result);
      if (acceptsEventStream(request)) {
        response.status(200);
        response.set({
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "private, no-store, no-transform",
          connection: "keep-alive",
        });
        response.flushHeaders();
        response.write(
          `event: response\ndata: ${JSON.stringify({ data: validatedResult })}\n\n`,
        );
        response.write("event: done\ndata: {}\n\n");
        response.end();
        return;
      }
      response.status(200).json({ data: validatedResult });
    },
  );

  router.get(
    "/conversations",
    authenticate,
    requirePasswordChangeComplete,
    (request, response) => {
      const query = conversationListQuerySchema.parse(request.query);
      const conversations = dependencies.chatService.listConversations(
        requireAuthContext(request),
        query.courseId,
        query.limit,
        query.cursor,
      );
      response.status(200).json({
        data: conversations.items,
        ...(conversations.nextCursor
          ? { meta: { nextCursor: conversations.nextCursor } }
          : {}),
      });
    },
  );

  router.get(
    "/conversations/:conversationId",
    authenticate,
    requirePasswordChangeComplete,
    (request, response) => {
      const conversation = dependencies.chatService.getConversation(
        requireAuthContext(request),
        requireUuidParam(request, "conversationId"),
      );
      response.status(200).json({ data: conversation });
    },
  );

  router.patch(
    "/conversations/:conversationId",
    authenticate,
    requirePasswordChangeComplete,
    (request, response) => {
      const input = updateConversationRequestSchema.parse(request.body);
      const conversation = dependencies.chatService.updateConversationTitle(
        requireAuthContext(request),
        requireUuidParam(request, "conversationId"),
        input.title,
      );
      response.status(200).json({ data: conversation });
    },
  );

  router.delete(
    "/conversations/:conversationId",
    authenticate,
    requirePasswordChangeComplete,
    (request, response) => {
      dependencies.chatService.deleteConversation(
        requireAuthContext(request),
        requireUuidParam(request, "conversationId"),
      );
      response.status(204).end();
    },
  );

  return router;
}

function acceptsEventStream(request: Request): boolean {
  return (request.get("accept") ?? "")
    .split(",")
    .some((type) => type.trim().split(";")[0]?.trim() === "text/event-stream");
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
