import { loadConfig } from "../src/config/config";
import { createPostgresPool } from "../src/infra/postgres/connection";
import {
  CURRENT_DATABASE_SCHEMA_VERSION,
  getDatabaseSchemaVersion,
} from "../src/infra/postgres/migrations/006-runtime-storage";
import { openMongoConnection } from "../src/infra/mongodb/connection";
import { MongoConversationRepository } from "../src/infra/mongodb/conversation.repository";
import { createSystemStore } from "../src/infra/jsonstore/create-system-store";
import { migrateLegacyData } from "./migrate-legacy-data";

async function main(): Promise<void> {
  const config = loadConfig({
    requireJwtSecrets: false,
    requireDatabases: true,
  });
  if (!config.databaseUrl || !config.mongodbUri || !config.mongodbDatabase) {
    throw new Error(
      "DATABASE_URL, MONGODB_URI, and MONGODB_DATABASE are required",
    );
  }

  const postgres = createPostgresPool(config.databaseUrl);
  let mongo: Awaited<ReturnType<typeof openMongoConnection>> | undefined;
  try {
    const schemaVersion = await getDatabaseSchemaVersion(postgres);
    if (schemaVersion !== CURRENT_DATABASE_SCHEMA_VERSION) {
      throw new Error(
        `Neon schema version ${schemaVersion} is not ready; run npm run db:migrate first`,
      );
    }
    mongo = await openMongoConnection(
      config.mongodbUri,
      config.mongodbDatabase,
    );
    await new MongoConversationRepository(
      mongo.client,
      mongo.database,
      postgres,
    ).initialize();
    const { store } = createSystemStore(postgres);
    await store.initialize();
    const collections = await migrateLegacyData(
      config.dataDir,
      postgres,
      store,
      mongo.database,
    );
    console.log(JSON.stringify(collections, null, 2));
  } finally {
    if (mongo) await mongo.client.close();
    await postgres.end();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Legacy import failed";
  process.stderr.write(`Legacy data import failed: ${message}\n`);
  process.exitCode = 1;
});
