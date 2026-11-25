import { Router, type Request, type RequestHandler } from "express";
import multer from "multer";
import { z } from "zod";
import { AppError } from "../../common/errors/app-error";
import { requireAuthentication, requirePasswordChangeComplete, requirePermission } from "../auth/auth.middleware";
import type { AuthService } from "../auth/auth.service";
import { documentListQuerySchema, documentUploadFieldsSchema } from "./document.schemas";
import { DocumentService } from "./document.service";
import { MAX_LESSON_VIDEO_SIZE_BYTES } from "./document.validation";

export interface DocumentRouteDependencies {
  authService: AuthService;
  documentService: DocumentService;
  maxUploadSizeBytes: number;
}

/**
 * Creates authenticated document upload, status, retry, listing and deletion routes.
 */
export function createDocumentRouter(dependencies: DocumentRouteDependencies): Router {
  const router = Router();
  const authenticate = requireAuthentication(dependencies.authService);
  const parseUpload = createUploadMiddleware(dependencies.maxUploadSizeBytes);
  const parseLessonVideoUpload = createUploadMiddleware(MAX_LESSON_VIDEO_SIZE_BYTES);

  router.post(
    "/documents/upload",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("document:upload"),
    parseUpload,
    async (request, response) => {
      const fields = documentUploadFieldsSchema.parse(request.body);
      if (!request.file) {
        throw new AppError("VALIDATION_FAILED", 422, "A document file is required");
      }
      const document = await dependencies.documentService.upload(
        requireAuthContext(request),
        fields,
        request.file,
        request.requestId,
      );
      response.status(202).json({ data: document });
    },
  );

  router.post(
    "/courses/:courseId/lesson-videos",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("course:edit"),
    requirePermission("document:upload"),
    parseLessonVideoUpload,
    async (request, response) => {
      if (!request.file) {
        throw new AppError("VALIDATION_FAILED", 422, "An MP4 video file is required");
      }
      const video = await dependencies.documentService.uploadCourseLessonVideo(
        requireAuthContext(request),
        requireUuidParam(request, "courseId"),
        request.file,
      );
      response.status(201).json({ data: video });
    },
  );

  router.get("/documents/:documentId/file", authenticate, async (request, response) => {
    const file = await dependencies.documentService.getCourseFile(
      requireAuthContext(request),
      requireUuidParam(request, "documentId"),
    );
    response
      .set("Content-Type", file.mimeType)
      .set("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`)
      .set("Cache-Control", "private, no-store")
      .set("X-Content-Type-Options", "nosniff")
      .send(file.bytes);
  });

  router.get(
    "/documents/:documentId/status",
    authenticate,
    async (request, response) => {
      const document = await dependencies.documentService.getStatus(
        requireAuthContext(request),
        requireUuidParam(request, "documentId"),
      );
      response.status(200).json({ data: document });
    },
  );

  router.get(
    "/courses/:courseId/documents",
    authenticate,
    async (request, response) => {
      const query = documentListQuerySchema.parse(request.query);
      const page = await dependencies.documentService.listForCourse(
        requireAuthContext(request),
        requireUuidParam(request, "courseId"),
        query,
      );
      response.status(200).json({
        data: page.items,
        ...(page.nextCursor ? { meta: { nextCursor: page.nextCursor } } : {}),
      });
    },
  );

  router.post(
    "/documents/:documentId/retry",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("document:upload"),
    async (request, response) => {
      const document = await dependencies.documentService.retry(
        requireAuthContext(request),
        requireUuidParam(request, "documentId"),
        request.requestId,
      );
      response.status(202).json({ data: document });
    },
  );

  router.delete(
    "/documents/:documentId",
    authenticate,
    requirePasswordChangeComplete,
    requirePermission("document:delete"),
    async (request, response) => {
      const deletion = await dependencies.documentService.delete(
        requireAuthContext(request),
        requireUuidParam(request, "documentId"),
        request.requestId,
      );
      response.status(202).json({ data: deletion });
    },
  );

  return router;
}

/**
 * Enforces multipart memory limits and converts upload errors to safe API responses.
 */
function createUploadMiddleware(maxUploadSizeBytes: number): RequestHandler {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxUploadSizeBytes,
      files: 1,
      fields: 2,
      fieldSize: 2048,
      parts: 3,
    },
  }).single("file");

  return (request, response, next) => {
    upload(request, response, (error: unknown) => {
      if (error instanceof multer.MulterError) {
        if (error.code === "LIMIT_FILE_SIZE") {
          next(new AppError("FILE_TOO_LARGE", 413, "The uploaded file exceeds the configured size limit"));
          return;
        }
        next(new AppError("VALIDATION_FAILED", 422, "The multipart upload contains invalid fields"));
        return;
      }
      next(error);
    });
  };
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
function requireUuidParam(request: Request, name: string): string {
  const value = request.params[name];
  if (typeof value !== "string" || !z.string().uuid().safeParse(value).success) {
    throw new AppError("VALIDATION_FAILED", 422, `Invalid route parameter: ${name}`);
  }
  return value;
}
