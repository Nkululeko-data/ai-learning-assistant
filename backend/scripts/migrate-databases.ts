import { loadConfig } from "../src/config/config";
import { createPostgresPool } from "../src/infra/postgres/pool";
import {
  EXPECTED_SCHEMA_VERSION,
  getSchemaVersion,
} from "../src/infra/postgres/migrate";
import { createMongoClient } from "../src/infra/mongo/client";
import { ensureMongoIndexes } from "../src/infra/mongo/ensure-indexes";
import { createSystemStore } from "../src/infra/jsonstore/create-system-store";
import { loadUserIdAliases } from "../src/infra/postgres/user-id-aliases";
import { migrateLegacyData } from "./migrate-legacy-data";
import { migrateJsonToMongo } from "./migrate-json-to-mongo";

async function main(): Promise<void> {
  const config = loadConfig({
    requireJwtSecrets: false,
    requireDatabases: true,
  });
  if (!config.databaseUrl || !config.mongodbUri || !config.mongodbDbName) {
    throw new Error(
      "DATABASE_URL, MONGODB_URI, and MONGODB_DATABASE are required",
    );
  }

  const postgres = createPostgresPool(config.databaseUrl);
  const mongoClient = createMongoClient(config.mongodbUri);
  try {
    const schemaVersion = await getSchemaVersion(postgres);
    if (schemaVersion !== EXPECTED_SCHEMA_VERSION) {
      throw new Error(
        `Neon schema version ${schemaVersion} is not ready; run npm run db:migrate first`,
      );
    }
    await mongoClient.connect();
    const mongoDatabase = mongoClient.db(config.mongodbDbName);
    await ensureMongoIndexes(mongoDatabase);
    const { store, mongoStore } = createSystemStore(postgres, mongoDatabase);
    await store.initialize();
    await mongoStore.initialize();
    await migrateJsonToMongo({
      dataDirectory: config.dataDir,
      dryRun: true,
      embeddingModel: config.embeddingModel,
      embeddingDimension: config.embeddingDimension,
      database: mongoDatabase,
    });
    const collections = await migrateLegacyData(
      config.dataDir,
      postgres,
      store,
      mongoStore,
    );
    const mongoMigration = await migrateJsonToMongo({
      dataDirectory: config.dataDir,
      dryRun: false,
      embeddingModel: config.embeddingModel,
      embeddingDimension: config.embeddingDimension,
      database: mongoDatabase,
      userIdAliases: await loadUserIdAliases(postgres),
    });
    console.log(
      JSON.stringify(
        {
          postgresAndGenericMongoRecords: collections,
          mongoDocumentsAndJobs: mongoMigration.counts,
        },
        null,
        2,
      ),
    );
  } finally {
    try {
      await mongoClient.close();
    } finally {
      await postgres.end();
    }
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Legacy import failed";
  process.stderr.write(`Legacy data import failed: ${message}\n`);
  process.exitCode = 1;
});
