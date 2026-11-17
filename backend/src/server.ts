import type { Server } from "node:http";
import { createApp } from "./app";
import { loadConfig, hasProviderConfiguration } from "./config/config";
import { createLogger } from "./common/logging/logger";
import {
  isConversationDatabaseReady,
  openConversationDatabase,
} from "./infra/sqlite/database";
import { JsonStore } from "./infra/jsonstore/json-store";
import { registerSystemCollections } from "./infra/jsonstore/system-collections";
import { JsonAuthRepository } from "./modules/auth/auth.types";
import { AuthService } from "./modules/auth/auth.service";
import { JsonCourseRepository } from "./modules/courses/course.types";
import { CourseService } from "./modules/courses/course.service";
import { JobRunner } from "./modules/jobs/job.runner";
import { JobScheduler } from "./modules/jobs/job.scheduler";
import { JobService } from "./modules/jobs/job.service";
import { JsonJobRepository } from "./modules/jobs/job.types";
import { JsonDocumentRepository } from "./modules/documents/document.types";
import { DocumentService } from "./modules/documents/document.service";
import { DocumentIngestionService } from "./modules/documents/document.ingestion.service";
import { MistralEmbeddingProvider } from "./modules/documents/mistral-embedding.provider";
import { PrivateFileStorage } from "./infra/storage/private-file-storage";
import {
  CURRENT_SCHEMA_VERSION,
  initializeSchemaMetadata,
} from "./infra/jsonstore/schema-metadata";

/**
 * Initializes storage, builds the API, and starts listening on the configured port.
 */
export async function startServer(): Promise<Server> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const store = new JsonStore(config.dataDir);
  const collections = registerSystemCollections(store);
  await store.initialize();
  const metadata = await initializeSchemaMetadata(store.jsonDirectory);
  const database = openConversationDatabase(config.dataDir);
  const authRepository = new JsonAuthRepository(collections);
  const authService = new AuthService(authRepository, config, {
    allowRefreshTokenInBody: config.allowRefreshTokenInBody,
  });
  const courseRepository = new JsonCourseRepository(collections);
  const courseService = new CourseService(
    courseRepository,
    config.enrolmentReRequestCooldownHours,
  );
  const jobRepository = new JsonJobRepository(
    collections.jobs,
    collections.schedulerState,
  );
  const jobService = new JobService(jobRepository);
  const documentRepository = new JsonDocumentRepository(collections);
  const privateFileStorage = new PrivateFileStorage(config.dataDir);
  await privateFileStorage.initialize();
  const embeddingProvider = new MistralEmbeddingProvider(
    config.mistralApiKey,
    config.mistralEmbeddingModel,
    config.mistralEmbeddingDimension,
  );
  const documentService = new DocumentService(
    documentRepository,
    privateFileStorage,
    jobService,
    config,
  );
  const documentIngestionService = new DocumentIngestionService(
    documentRepository,
    privateFileStorage,
    embeddingProvider,
    config.chunkSizeTokens,
    config.chunkOverlapTokens,
    config.maxDocxExpandedSizeBytes,
  );
  const jobRunner = new JobRunner(
    jobService,
    {
      ingest: (job, signal) => documentIngestionService.ingest(job, signal),
      cleanup: (job, signal) => documentIngestionService.cleanup(job, signal),
    },
    logger,
  );
  const jobScheduler = new JobScheduler(
    jobRepository,
    jobService,
    logger,
    [],
  );

  const app = createApp({
    logger,
    corsOrigins: config.corsOrigins,
    auth: { authService, config },
    courses: { authService, courseService },
    jobs: { authService, jobService },
    documents: {
      authService,
      documentService,
      maxUploadSizeBytes: config.maxUploadSizeBytes,
    },
    getReadiness: () => ({
      jsonStoreOpen: true,
      sqliteOpen: isConversationDatabaseReady(database),
      schemaVersion: metadata.schemaVersion,
      expectedSchemaVersion: CURRENT_SCHEMA_VERSION,
      providerConfigurationPresent: hasProviderConfiguration(config),
    }),
  });

  const server = await new Promise<Server>((resolve, reject) => {
    const listeningServer = app.listen(config.port, () => resolve(listeningServer));
    listeningServer.once("error", reject);
  });

  logger.info(
    { port: config.port, dataDirectory: config.dataDir },
    "AI Learning Assistant backend started",
  );
  jobRunner.start();
  jobScheduler.start();
  registerShutdownHandlers(server, database, jobRunner, jobScheduler, logger);
  return server;
}

/**
 * Stops accepting requests, closes SQLite, and reports shutdown failures.
 */
function registerShutdownHandlers(
  server: Server,
  database: ReturnType<typeof openConversationDatabase>,
  jobRunner: JobRunner,
  jobScheduler: JobScheduler,
  logger: ReturnType<typeof createLogger>,
): void {
  let shuttingDown = false;
  const shutdown = (signal: NodeJS.Signals): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Backend shutdown requested");

    void (async () => {
      await jobScheduler.stop();
      await jobRunner.stop();
      await new Promise<void>((resolve) => {
        server.close((serverError) => {
          if (serverError) {
            logger.error({ signal }, "HTTP server shutdown failed");
            process.exitCode = 1;
          }
          resolve();
        });
      });
      try {
        database.close();
      } catch (error) {
        const errorName = error instanceof Error ? error.name : "UnknownError";
        logger.error({ signal, errorName }, "SQLite shutdown failed");
        process.exitCode = 1;
      }
    })().catch((error: unknown) => {
      const errorName = error instanceof Error ? error.name : "UnknownError";
      logger.error(
        { signal, errorName },
        "Backend shutdown encountered an unexpected failure",
      );
      process.exitCode = 1;
    });
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

/**
 * Starts the server when this module is the process entry point.
 */
async function main(): Promise<void> {
  await startServer();
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    const message = error instanceof Error ? error.message : "Unknown failure";
    process.stderr.write(`Backend startup failed (${errorName}): ${message}\n`);
    process.exitCode = 1;
  });
}
