import cors from "cors";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import swaggerUi from "swagger-ui-express";
import express, { type Request, type RequestHandler } from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import type { Logger } from "pino";
import { AppError } from "./common/errors/app-error";
import { createErrorHandler } from "./common/middleware/error-handler";
import { requestIdMiddleware } from "./common/middleware/request-id";
import {
  createAuthRouter,
  type AuthRouteDependencies,
} from "./modules/auth/auth.routes";
import {
  createCourseRouter,
  type CourseRouteDependencies,
} from "./modules/courses/course.routes";
import {
  createJobRouter,
  type JobRouteDependencies,
} from "./modules/jobs/job.routes";
import {
  createDocumentRouter,
  type DocumentRouteDependencies,
} from "./modules/documents/document.routes";
import {
  createChatRouter,
  type ChatRouteDependencies,
} from "./modules/chat/chat.routes";
import {
  createLearningRouter,
  type LearningRouteDependencies,
} from "./modules/learning/learning.routes";
import {
  createFeedbackRouter,
  type FeedbackRouteDependencies,
} from "./modules/feedback/feedback.routes";
import {
  createInsightsRouter,
  type InsightsRouteDependencies,
} from "./modules/insights/insights.routes";
import {
  createAdminRouter,
  type AdminRouteDependencies,
} from "./modules/admin/admin.routes";

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
  auth?: AuthRouteDependencies;
  courses?: CourseRouteDependencies;
  jobs?: JobRouteDependencies;
  documents?: DocumentRouteDependencies;
  chat?: ChatRouteDependencies;
  learning?: LearningRouteDependencies;
  feedback?: FeedbackRouteDependencies;
  insights?: InsightsRouteDependencies;
  admin?: AdminRouteDependencies;
}

/**
 * Builds the Express application and installs the phase-B2 health endpoints.
 */
export function createApp(dependencies: AppDependencies): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("etag", false);
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
  app.use("/api/v1", (_request, response, next) => {
    response.setHeader("Cache-Control", "private, no-store");
    next();
  });

  app.get("/health", healthHandler);
  app.get("/ready", createReadinessHandler(dependencies.getReadiness));
  app.get("/openapi.json", openApiHandler);
  app.use(
    "/api/docs",
    swaggerUi.serve,
    swaggerUi.setup(undefined, { swaggerUrl: "/openapi.json" }),
  );
  if (dependencies.auth) {
    app.use("/api/v1", createAuthRouter(dependencies.auth));
  }
  if (dependencies.courses) {
    app.use("/api/v1", createCourseRouter(dependencies.courses));
  }
  if (dependencies.jobs) {
    app.use("/api/v1", createJobRouter(dependencies.jobs));
  }
  if (dependencies.documents) {
    app.use("/api/v1", createDocumentRouter(dependencies.documents));
  }
  if (dependencies.chat) {
    app.use("/api/v1", createChatRouter(dependencies.chat));
  }
  if (dependencies.learning) {
    app.use("/api/v1", createLearningRouter(dependencies.learning));
  }
  if (dependencies.feedback) {
    app.use("/api/v1", createFeedbackRouter(dependencies.feedback));
  }
  if (dependencies.insights) {
    app.use("/api/v1", createInsightsRouter(dependencies.insights));
  }
  if (dependencies.admin) {
    app.use("/api/v1", createAdminRouter(dependencies.admin));
  }
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

const openApiHandler: RequestHandler = (_request, response, next) => {
  try {
    const openApiPath = resolve(process.cwd(), "docs", "api", "openapi-draft.json");
    response.type("application/json").send(readFileSync(openApiPath, "utf8"));
  } catch (error) {
    next(error);
  }
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

