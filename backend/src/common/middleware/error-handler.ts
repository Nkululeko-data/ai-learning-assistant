import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";
import type { Logger } from "pino";
import { AppError } from "../errors/app-error";

/**
 * Maps application and validation failures to the documented error envelope.
 */
export function createErrorHandler(logger: Logger): ErrorRequestHandler {
  return (error: unknown, req, res, next) => {
    if (res.headersSent) {
      next(error);
      return;
    }

    if (error instanceof ZodError) {
      res.status(422).json({
        error: {
          code: "VALIDATION_FAILED",
          message: "Request validation failed",
          details: error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
          requestId: req.requestId,
        },
      });
      return;
    }

    if (error instanceof AppError) {
      logger.warn(
        { code: error.code, requestId: req.requestId },
        "Request rejected",
      );
      res.status(error.statusCode).json({
        error: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
          requestId: req.requestId,
        },
      });
      return;
    }

    const errorName = error instanceof Error ? error.name : "UnknownError";
    logger.error(
      { errorName, requestId: req.requestId },
      "Unhandled request failure",
    );
    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
        requestId: req.requestId,
      },
    });
  };
}
