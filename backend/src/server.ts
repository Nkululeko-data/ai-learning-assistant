import type { Server } from "node:http";
import { createApp } from "./app";
import {
  loadConfig,
  hasProviderConfiguration,
  type AppConfig,
} from "./config/config";
import { createLogger } from "./common/logging/logger";
import {
  isConversationDatabaseReady,
  openConversationDatabase,
} from "./infra/sqlite/database";
import { createPostgresPool, isPostgresReady } from "./infra/postgres/pool";
import {
  EXPECTED_SCHEMA_VERSION,
  getSchemaVersion,
} from "./infra/postgres/migrate";
import { createMongoClient, isMongoReady } from "./infra/mongo/client";
import {
  assertAtlasVectorIndexReady,
  ensureMongoIndexes,
} from "./infra/mongo/ensure-indexes";
import type { Pool } from "pg";
import type { Db, MongoClient } from "mongodb";
import { createSystemStore } from "./infra/jsonstore/create-system-store";
import type { SystemCollections } from "./infra/jsonstore/system-collections";
import { ConversationRepository } from "./infra/sqlite/conversation.repository";
import { JsonAuthRepository } from "./modules/auth/auth.types";
import { AuthService } from "./modules/auth/auth.service";
import { PgCourseRepository } from "./modules/courses/pg-course.repository";
import { CourseService } from "./modules/courses/course.service";
import { JobRunner } from "./modules/jobs/job.runner";
import { JobScheduler } from "./modules/jobs/job.scheduler";
import { JobService } from "./modules/jobs/job.service";
import {
  MongoJobRepository,
  type MongoJobDocument,
  type MongoSchedulerStateDocument,
} from "./modules/jobs/mongo-job.repository";
import {
  MongoDocumentRepository,
  type MongoDocumentRecord,
} from "./modules/documents/mongo-document.repository";
import {
  MongoChunkRepository,
  type ChunkRecordDocument,
} from "./modules/documents/chunk.repository";
import { DocumentService } from "./modules/documents/document.service";
import { DocumentIngestionService } from "./modules/documents/document.ingestion.service";
import { MistralEmbeddingProvider } from "./modules/documents/mistral-embedding.provider";
import { PrivateFileStorage } from "./infra/storage/private-file-storage";
import { ChatService } from "./modules/chat/chat.service";
import { RetrievalService } from "./modules/retrieval/retrieval.service";
import { InceptionProvider } from "./ai/providers/inception.provider";
import { GroqProvider } from "./ai/providers/groq.provider";
import { StructuredOutputService } from "./ai/providers/structured-output.service";
import { loadChatPrompts } from "./ai/prompts/load-chat-prompts";
import { LangGraphChatRunner } from "./ai/graphs/chat.graph";
import { JsonAgentExecutionRepository } from "./modules/chat/chat-execution.repository";
import { LearningRepository } from "./modules/learning/learning.repository";
import { LearningService } from "./modules/learning/learning.service";
import { JsonLearningExecutionRepository } from "./modules/learning/learning-execution.repository";
import { loadLearningPrompt } from "./ai/prompts/load-learning-prompt";
import { FeedbackRepository } from "./modules/feedback/feedback.repository";
import { FeedbackService } from "./modules/feedback/feedback.service";
import { InsightsRepository } from "./modules/insights/insights.repository";
import { InsightsService } from "./modules/insights/insights.service";
import { AdminService } from "./modules/admin/admin.service";

/**
 * Initializes storage, builds the API, and starts listening on the configured port.
 */
export async function startServer(): Promise<Server> {
  const config = loadConfig();
  configureTracing(config.environment);
  const logger = createLogger(
    config.logLevel,
    config.environment === "development",
  );
  const { databaseUrl, mongodbUri, mongodbDbName } =
    requireDatabaseConfiguration(config);
  const postgresPool = createPostgresPool(databaseUrl);
  const mongoClient = createMongoClient(mongodbUri);
  let mongoDatabase: Db;
  let collections: SystemCollections;
  try {
    await mongoClient.connect();
    mongoDatabase = mongoClient.db(mongodbDbName);
    await ensureMongoIndexes(mongoDatabase);
    await assertAtlasVectorIndexReady(
      mongoDatabase,
      config.mistralEmbeddingModel,
      config.mistralEmbeddingDimension,
    );
    const schemaVersion = await getSchemaVersion(postgresPool);
    if (schemaVersion !== EXPECTED_SCHEMA_VERSION) {
      throw new Error(
        `PostgreSQL schema version ${schemaVersion} is not ready; run npm run db:migrate first`,
      );
    }
    const systemStore = createSystemStore(postgresPool, mongoDatabase);
    await systemStore.store.initialize();
    await systemStore.mongoStore.initialize();
    collections = systemStore.collections;
  } catch (error) {
    const cleanupErrors: unknown[] = [];
    try {
      await mongoClient.close();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    try {
      await postgresPool.end();
    } catch (cleanupError) {
      cleanupErrors.push(cleanupError);
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [error, ...cleanupErrors],
        "MongoDB initialization failed and database clients could not be fully closed",
      );
    }
    throw error;
  }
  const database = openConversationDatabase(config.dataDir);
  const authRepository = new JsonAuthRepository(collections);
  const authService = new AuthService(authRepository, config, {
    allowRefreshTokenInBody: config.allowRefreshTokenInBody,
  });
  let documentRepository!: MongoDocumentRepository;
  const courseRepository = new PgCourseRepository(
    postgresPool,
    collections,
    (id) => documentRepository.findDocument(id),
  );
  const courseService = new CourseService(
    courseRepository,
    config.enrolmentReRequestCooldownHours,
  );
  const jobRepository = new MongoJobRepository(
    mongoDatabase.collection<MongoJobDocument>("jobs"),
    mongoDatabase.collection<MongoSchedulerStateDocument>("scheduler_state"),
  );
  const jobService = new JobService(jobRepository);
  documentRepository = new MongoDocumentRepository(
    mongoDatabase.collection<MongoDocumentRecord>("documents"),
    courseRepository,
  );
  const chunkRepository = new MongoChunkRepository(
    mongoDatabase.collection<ChunkRecordDocument>("document_chunks"),
  );
  const privateFileStorage = new PrivateFileStorage(
    config.dataDir,
    config.chunkCacheMaxDocuments,
  );
  await privateFileStorage.initialize();
  const retrievalService = new RetrievalService(
    documentRepository,
    chunkRepository,
    config.mistralEmbeddingModel,
    config.mistralEmbeddingDimension,
  );
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
    chunkRepository,
  );
  const structuredOutput = new StructuredOutputService(
    new InceptionProvider(config.inceptionApiKey, config.inceptionModel),
    new GroqProvider(config.groqApiKey, config.groqModel),
    config.chatMaxCompletionTokens,
  );
  const conversationRepository = new ConversationRepository(database);
  const feedbackService = new FeedbackService(
    new FeedbackRepository(collections),
    conversationRepository,
  );
  const insightsService = new InsightsService(
    new InsightsRepository(collections),
    jobService,
    config,
  );
  const adminService = new AdminService(
    collections,
    conversationRepository,
    privateFileStorage,
    jobService,
    config,
    documentRepository,
    chunkRepository,
    courseRepository,
  );
  const executionRepository = new JsonAgentExecutionRepository(
    collections.agentExecutions,
    conversationRepository,
  );
  const chatService = new ChatService(
    conversationRepository,
    executionRepository,
    retrievalService,
    embeddingProvider,
    new LangGraphChatRunner(),
    structuredOutput,
    await loadChatPrompts(config.chatPromptVersion),
    config,
    insightsService,
  );
  const learningRepository = new LearningRepository(collections);
  const learningService = new LearningService(
    learningRepository,
    retrievalService,
    embeddingProvider,
    structuredOutput,
    new JsonLearningExecutionRepository(
      collections.agentExecutions,
      conversationRepository,
    ),
    conversationRepository,
    config,
    await loadLearningPrompt(config.learningPromptVersion),
  );
  const jobRunner = new JobRunner(
    jobService,
    {
      ingest: (job, signal) => documentIngestionService.ingest(job, signal),
      cleanup: (job, signal) => documentIngestionService.cleanup(job, signal),
      cluster: async (job) => {
        const courseId = job.payload.courseId;
        if (typeof courseId !== "string") {
          throw new Error("Gap-report job payload is missing courseId");
        }
        const report = await insightsService.generateGapReport(courseId);
        return { gapReportId: report.id };
      },
      erase: async (job) => {
        const userId = job.payload.userId;
        if (typeof userId !== "string") {
          throw new Error("Erasure job payload is missing userId");
        }
        return adminService.eraseUser(userId);
      },
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
    chat: {
      authService,
      chatService,
      rateLimitWindowMs: config.chatRateLimitWindowMs,
      rateLimitMax: config.chatRateLimitMax,
    },
    learning: {
      authService,
      learningService,
      rateLimitWindowMs: config.chatRateLimitWindowMs,
      rateLimitMax: config.chatRateLimitMax,
    },
    feedback: { authService, feedbackService },
    insights: { authService, insightsService },
    admin: { authService, adminService },
    getReadiness: async () => {
      const [schemaVersion, mongoReady] = await Promise.all([
        checkDatabaseReadiness(
          "PostgreSQL",
          async () => {
            await isPostgresReady(postgresPool);
            return getSchemaVersion(postgresPool);
          },
          logger,
        ),
        checkDatabaseReadiness(
          "MongoDB",
          () => isMongoReady(mongoClient, mongodbDbName),
          logger,
        ),
      ]);
      const postgresReady = schemaVersion !== undefined;
      return {
        systemStoreReady: true,
        sqliteOpen: isConversationDatabaseReady(database),
        postgresReady,
        mongoReady: mongoReady ?? false,
        schemaVersion: schemaVersion ?? 0,
        expectedSchemaVersion: EXPECTED_SCHEMA_VERSION,
        providerConfigurationPresent: hasProviderConfiguration(config),
      };
    },
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
  registerShutdownHandlers(
    server,
    database,
    postgresPool,
    mongoClient,
    jobRunner,
    jobScheduler,
    logger,
  );
  return server;
}

/**
 * Requires database settings before creating clients while keeping test config validation optional.
 */
function requireDatabaseConfiguration(config: AppConfig): {
  databaseUrl: string;
  mongodbUri: string;
  mongodbDbName: string;
} {
  if (!config.databaseUrl || !config.mongodbUri || !config.mongodbDbName) {
    throw new Error(
      "DATABASE_URL, MONGODB_URI, and MONGODB_DB_NAME are required to start the server",
    );
  }
  return {
    databaseUrl: config.databaseUrl,
    mongodbUri: config.mongodbUri,
    mongodbDbName: config.mongodbDbName,
  };
}

/**
 * Converts database probe failures into safely logged not-ready results.
 */
async function checkDatabaseReadiness<T>(
  dependency: "PostgreSQL" | "MongoDB",
  check: () => Promise<T>,
  logger: ReturnType<typeof createLogger>,
): Promise<T | undefined> {
  try {
    return await check();
  } catch (error) {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    logger.warn(
      { dependency, errorName },
      "Database readiness check failed",
    );
    return undefined;
  }
}

function configureTracing(environment: AppConfig["environment"]): void {
  const tracingKeys = [
    "LANGCHAIN_TRACING",
    "LANGCHAIN_TRACING_V2",
    "LANGSMITH_TRACING",
  ];
  const enabledKeys = tracingKeys.filter(
    (key) => process.env[key]?.trim().toLowerCase() === "true",
  );
  if (environment === "production" && enabledKeys.length > 0) {
    throw new Error(
      `Tracing must be disabled in production: ${enabledKeys.join(", ")}`,
    );
  }
  process.env.LANGCHAIN_TRACING = "false";
  process.env.LANGCHAIN_TRACING_V2 = "false";
  process.env.LANGSMITH_TRACING = "false";
}

/**
 * Stops background work, closes the HTTP server, and then closes all database clients.
 */
function registerShutdownHandlers(
  server: Server,
  database: ReturnType<typeof openConversationDatabase>,
  postgresPool: Pool,
  mongoClient: MongoClient,
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
        await postgresPool.end();
      } catch (error) {
        const errorName = error instanceof Error ? error.name : "UnknownError";
        logger.error({ signal, errorName }, "PostgreSQL shutdown failed");
        process.exitCode = 1;
      }
      try {
        await mongoClient.close();
      } catch (error) {
        const errorName = error instanceof Error ? error.name : "UnknownError";
        logger.error({ signal, errorName }, "MongoDB shutdown failed");
        process.exitCode = 1;
      }
      try {
        database.close();
      } catch (error) {
        const errorName = error instanceof Error ? error.name : "UnknownError";
        logger.error({ signal, errorName }, "MongoDB shutdown failed");
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
