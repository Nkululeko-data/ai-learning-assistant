import cors from "cors";
import express, { type Request, type RequestHandler } from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import type { Logger } from "pino";
import { AppError } from "./common/errors/app-error";
import { createErrorHandler } from "./common/middleware/error-handler";
import { requestIdMiddleware } from "./common/middleware/request-id";

export interface ReadinessStatus {
  jsonStoreOpen: boolean;
  sqliteOpen: boolean;
  schemaVersion: number;
  expectedSchemaVersion: number;
  providerConfigurationPresent: boolean;
}

export interface AppDependencies {
  logger: Logger;
  corsOrigins: string[];
  getReadiness: () => ReadinessStatus;
}

/**
 * Builds the Express application and installs the phase-B2 health endpoints.
 */
export function createApp(dependencies: AppDependencies): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(helmet());
  app.use(requestIdMiddleware);
  app.use(
    pinoHttp({
      logger: dependencies.logger,
      customProps: requestLogProperties,
      serializers: {
        req: (request) => ({
          id: request.id,
          method: request.method,
          url: request.url?.split("?")[0],
        }),
      },
    }),
  );
  app.use(
    cors({
      credentials: true,
      origin: createCorsOriginValidator(dependencies.corsOrigins),
    }),
  );
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", healthHandler);
  app.get("/ready", createReadinessHandler(dependencies.getReadiness));
  app.use(notFoundHandler);
  app.use(createErrorHandler(dependencies.logger));
  return app;
}

/**
 * Adds the request ID to structured HTTP log properties.
 */
function requestLogProperties(request: Request): { requestId: string } {
  return { requestId: request.requestId };
}

/**
 * Creates a CORS origin callback that accepts only configured browser origins.
 */
function createCorsOriginValidator(
  origins: string[],
): (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => void {
  return (origin, callback) => {
    if (!origin || origins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new AppError("FORBIDDEN", 403, "Origin is not allowed"));
  };
}

/**
 * Returns a liveness response without checking downstream dependencies.
 */
const healthHandler: RequestHandler = (_request, response) => {
  response.status(200).json({ data: { status: "ok" } });
};

/**
 * Creates a readiness handler that reports failed checks without exposing secrets.
 */
function createReadinessHandler(
  getReadiness: () => ReadinessStatus,
): RequestHandler {
  return (request, response, next) => {
    try {
      const readiness = getReadiness();
      const ready =
        readiness.jsonStoreOpen &&
        readiness.sqliteOpen &&
        readiness.schemaVersion === readiness.expectedSchemaVersion &&
        readiness.providerConfigurationPresent;
      if (!ready) {
        next(
          new AppError(
            "SERVICE_NOT_READY",
            503,
            "One or more service dependencies are not ready",
            {
              jsonStoreOpen: readiness.jsonStoreOpen,
              sqliteOpen: readiness.sqliteOpen,
              schemaVersionMatches:
                readiness.schemaVersion === readiness.expectedSchemaVersion,
              providerConfigurationPresent:
                readiness.providerConfigurationPresent,
            },
          ),
        );
        return;
      }
      response.status(200).json({ data: { status: "ready" } });
    } catch (error) {
      next(error);
    }
  };
}

/**
 * Converts unmatched requests into the shared not-found error response.
 */
const notFoundHandler: RequestHandler = (request, _response, next) => {
  next(new AppError("NOT_FOUND", 404, `Route ${request.method} was not found`));
};

