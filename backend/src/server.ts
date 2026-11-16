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
  registerSystemCollections(store);
  await store.initialize();
  const metadata = await initializeSchemaMetadata(store.jsonDirectory);
  const database = openConversationDatabase(config.dataDir);

  const app = createApp({
    logger,
    corsOrigins: config.corsOrigins,
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
  registerShutdownHandlers(server, database, logger);
  return server;
}

/**
 * Stops accepting requests, closes SQLite, and reports shutdown failures.
 */
function registerShutdownHandlers(
  server: Server,
  database: ReturnType<typeof openConversationDatabase>,
  logger: ReturnType<typeof createLogger>,
): void {
  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, "Backend shutdown requested");
    server.close((serverError) => {
      if (serverError) {
        logger.error({ signal }, "HTTP server shutdown failed");
        process.exitCode = 1;
      }
      try {
        database.close();
      } catch (error) {
        const errorName =
          error instanceof Error ? error.name : "UnknownError";
        logger.error({ signal, errorName }, "SQLite shutdown failed");
        process.exitCode = 1;
      }
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
