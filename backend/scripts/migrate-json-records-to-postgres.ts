import { randomUUID } from "node:crypto";
import { cp, mkdir, readdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { Pool } from "pg";
import { loadConfig } from "../src/config/config";
import { createLogger } from "../src/common/logging/logger";
import { JsonStore } from "../src/infra/jsonstore/json-store";
import { registerSystemCollections } from "../src/infra/jsonstore/system-collections";
import { createPostgresPool } from "../src/infra/postgres/pool";
import { runMigrations } from "../src/infra/postgres/migrate";

const MIGRATION_LOCK = [1_094_853_441, 3] as const;
const BATCH_SIZE = 250;
const POSTGRES_RECORD_COLLECTIONS = new Set([
  "learning_summaries",
  "flashcards",
  "quizzes",
  "quiz_attempts",
  "feedback",
  "activity_events",
  "gap_reports",
  "config_versions",
  "agent_executions",
]);

export interface JsonRecordMigrationOptions {
  dataDirectory: string;
  databaseUrl?: string;
  pool?: Pool;
  dryRun: boolean;
}

export interface JsonRecordMigrationCount {
  collection: string;
  sourceCount: number;
  insertedCount: number;
  targetCount: number | null;
}

export interface JsonRecordMigrationResult {
  backupDirectory: string;
  dryRun: boolean;
  collections: JsonRecordMigrationCount[];
}

/**
 * Backs up and validates all JSON collections, then imports remaining PostgreSQL records.
 */
export async function migrateJsonRecordsToPostgres(
  options: JsonRecordMigrationOptions,
): Promise<JsonRecordMigrationResult> {
  if (!options.dryRun && !options.pool && !options.databaseUrl) {
    throw new Error("DATABASE_URL is required for a real JSON record migration");
  }

  const dataDirectory = resolve(options.dataDirectory);
  const backupDirectory = await backupJsonDirectory(dataDirectory);
  const collections = await readAndValidateCollections(dataDirectory);
  const counts: JsonRecordMigrationCount[] = collections.map(({ name, records }) => ({
    collection: name,
    sourceCount: records.length,
    insertedCount: 0,
    targetCount: null,
  }));
  if (options.dryRun) {
    return { backupDirectory, dryRun: true, collections: counts };
  }

  const pool =
    options.pool ??
    createPostgresPool(requireDatabaseUrl(options.databaseUrl));
  try {
    await runMigrations(pool, resolve(__dirname, "../migrations"));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      try {
        await client.query("SELECT pg_advisory_xact_lock($1, $2)", [
          ...MIGRATION_LOCK,
        ]);
        for (const [index, collection] of collections.entries()) {
          const targetResult = await client.query<{ id: string; payload: unknown }>(
            `SELECT id, payload FROM application_records
             WHERE collection_name = $1 ORDER BY id`,
            [collection.name],
          );
          const sourceById = new Map(
            collection.records.map((record) => [record.id, record]),
          );
          const existingById = new Map(
            targetResult.rows.map((row) => [row.id, row.payload]),
          );
          if (
            [...existingById.keys()].some((id) => !sourceById.has(id)) ||
            [...existingById].some(([id, payload]) =>
              !sameRecords(
                [payload],
                [sourceById.get(id)],
              ),
            )
          ) {
            throw new Error(
              `PostgreSQL collection ${collection.name} contains extra or conflicting records`,
            );
          }

          let insertedCount = 0;
          const missingRecords = collection.records.filter(
            (record) => !existingById.has(record.id),
          );
          if (missingRecords.length > 0) {
            for (
              let offset = 0;
              offset < missingRecords.length;
              offset += BATCH_SIZE
            ) {
              const batch = missingRecords.slice(offset, offset + BATCH_SIZE);
              const inserted = await client.query(
                `INSERT INTO application_records(collection_name, id, payload)
                 SELECT $1, source.record->>'id', source.record
                 FROM jsonb_array_elements($2::jsonb) AS source(record)
                 ON CONFLICT (collection_name, id) DO NOTHING`,
                [collection.name, JSON.stringify(batch)],
              );
              insertedCount += inserted.rowCount ?? 0;
            }
          }

          const verified = await client.query<{ count: string }>(
            `SELECT count(*)::text AS count FROM application_records
             WHERE collection_name = $1`,
            [collection.name],
          );
          const targetCount = Number(verified.rows[0]?.count);
          if (
            !Number.isSafeInteger(targetCount) ||
            targetCount !== collection.records.length
          ) {
            throw new Error(
              `PostgreSQL collection ${collection.name} count does not match the JSON source`,
            );
          }
          counts[index] = {
            collection: collection.name,
            sourceCount: collection.records.length,
            insertedCount,
            targetCount,
          };
        }
        await client.query("COMMIT");
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            "JSON record migration failed and could not be rolled back",
          );
        }
        throw error;
      }
    } finally {
      client.release();
    }
    return { backupDirectory, dryRun: false, collections: counts };
  } finally {
    if (!options.pool) await pool.end();
  }
}

/**
 * Copies the source JSON directory before reading any collection records.
 */
async function backupJsonDirectory(dataDirectory: string): Promise<string> {
  const jsonDirectory = join(dataDirectory, "json");
  const jsonStat = await stat(jsonDirectory);
  if (!jsonStat.isDirectory()) {
    throw new Error("DATA_DIR/json is not a directory");
  }

  const backupRoot = join(dataDirectory, "backups");
  await mkdir(backupRoot, { recursive: true });
  const backupDirectory = join(
    backupRoot,
    `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`,
  );
  await mkdir(backupDirectory);
  await cp(jsonDirectory, join(backupDirectory, "json"), {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
  await writeFile(
    join(backupDirectory, "manifest.json"),
    JSON.stringify(
      { createdAt: new Date().toISOString(), contents: ["json"] },
      null,
      2,
    ),
    "utf8",
  );
  return backupDirectory;
}

/**
 * Validates every registered collection and rejects unrecognized top-level JSON files.
 */
async function readAndValidateCollections(
  dataDirectory: string,
): Promise<Array<{ name: string; records: Array<{ id: string }> }>> {
  const jsonDirectory = join(dataDirectory, "json");
  const store = new JsonStore(dataDirectory);
  const registered = registerSystemCollections(store);
  const collectionList = Object.values(registered);
  const expectedFiles = new Set([
    ...collectionList.map((collection) => `${collection.name}.json`),
    "_meta.json",
  ]);
  const entries = await readdir(jsonDirectory, { withFileTypes: true });
  const unexpected = entries
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(".json") &&
        !expectedFiles.has(entry.name),
    )
    .map((entry) => entry.name);
  if (unexpected.length > 0) {
    throw new Error(
      `Unregistered JSON collection files: ${unexpected.sort().join(", ")}`,
    );
  }
  for (const collection of collectionList) {
    try {
      await stat(join(jsonDirectory, `${collection.name}.json`));
    } catch (error) {
      if (isMissingPathError(error)) {
        throw new Error(`Missing JSON collection: ${collection.name}.json`);
      }
      throw error;
    }
  }

  await store.initialize();
  return collectionList
    .filter((collection) => POSTGRES_RECORD_COLLECTIONS.has(collection.name))
    .map((collection) => ({
    name: collection.name,
    records: collection.list(),
    }));
}

/**
 * Compares records independent of JSON object property ordering.
 */
function sameRecords(left: unknown[], right: unknown[]): boolean {
  const canonicalize = (value: unknown): string =>
    JSON.stringify(value, (_key, nested: unknown) => {
      if (
        nested === null ||
        typeof nested !== "object" ||
        Array.isArray(nested)
      ) {
        return nested;
      }
      return Object.fromEntries(
        Object.entries(nested as Record<string, unknown>).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      );
    });
  const normalize = (records: unknown[]) =>
    records.map(canonicalize).sort((a, b) => a.localeCompare(b));
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

/**
 * Requires the configured PostgreSQL connection for non-dry-run imports.
 */
function requireDatabaseUrl(value: string | undefined): string {
  if (!value) throw new Error("DATABASE_URL is required for a real JSON record migration");
  return value;
}

/**
 * Distinguishes absent source files from filesystem failures.
 */
function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

async function main(): Promise<void> {
  const config = loadConfig({
    requireJwtSecrets: false,
    requireMongoConfiguration: false,
  });
  const dryRun = process.argv.includes("--dry-run");
  const result = await migrateJsonRecordsToPostgres({
    dataDirectory: config.dataDir,
    ...(config.databaseUrl ? { databaseUrl: config.databaseUrl } : {}),
    dryRun,
  });
  const logger = createLogger(config.logLevel);
  logger.info(
    {
      backupDirectory: result.backupDirectory,
      dryRun: result.dryRun,
      collections: result.collections,
    },
    "JSON record migration completed",
  );
}

if (require.main === module) {
  void main().catch((error: unknown) => {
    const errorName = error instanceof Error ? error.name : "UnknownError";
    const message = error instanceof Error ? error.message : "Unknown failure";
    process.stderr.write(
      `JSON record migration failed (${errorName}): ${message}\n`,
    );
    process.exitCode = 1;
  });
}
