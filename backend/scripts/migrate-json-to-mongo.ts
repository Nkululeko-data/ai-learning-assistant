import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { createReadStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { GridFSBucket, type Db, type Document as MongoDocument } from "mongodb";
import { z } from "zod";
import { loadConfig } from "../src/config/config";
import {
  createMongoClient,
} from "../src/infra/mongo/client";
import { ensureMongoIndexes } from "../src/infra/mongo/ensure-indexes";
import {
  documentSchema,
  jobSchema,
  schedulerStateSchema,
  type DocumentRecord,
  type JobRecord,
  type SchedulerStateRecord,
} from "../src/infra/jsonstore/system-collections";
import {
  chunkRecordSchema,
  legacyChunksToRecords,
  parseLegacyChunkFile,
  type ChunkRecord,
} from "../src/modules/documents/chunk.repository";

const sourceDirectories = ["json", "uploads"] as const;

export interface MongoMigrationOptions {
  dataDirectory: string;
  dryRun: boolean;
  embeddingModel: string;
  embeddingDimension: number;
  database?: Db;
}

export interface MongoMigrationResult {
  backupDirectory: string;
  dryRun: boolean;
  counts: {
    documents: number;
    documentChunks: number;
    jobs: number;
    schedulerState: number;
    uploads: number;
  };
}

interface MongoMigrationSource {
  documents: DocumentRecord[];
  uploads: PrivateUploadSource[];
  chunks: ChunkRecord[];
  jobs: JobRecord[];
  schedulerState: SchedulerStateRecord[];
}

interface PrivateUploadSource {
  storageKey: string;
  filename: string;
  filePath: string;
  sizeBytes: number;
}

interface RawMongoRecord extends MongoDocument {
  _id: string;
}

/**
 * Backs up and validates legacy document/job data before idempotent Mongo import.
 */
export async function migrateJsonToMongo(
  options: MongoMigrationOptions,
): Promise<MongoMigrationResult> {
  const dataDirectory = resolve(options.dataDirectory);
  const backupDirectory = await createSourceBackup(dataDirectory);
  const source = await readMigrationSource(
    dataDirectory,
    options.embeddingModel,
    options.embeddingDimension,
  );
  const counts = {
    documents: source.documents.length,
    documentChunks: source.chunks.length,
    jobs: source.jobs.length,
    schedulerState: source.schedulerState.length,
    uploads: source.uploads.length,
  };
  if (options.dryRun) {
    return { backupDirectory, dryRun: true, counts };
  }

  const config = options.database
    ? null
    : loadConfig({ requireMongoConfiguration: true });
  const client = config?.mongodbUri
    ? createMongoClient(config.mongodbUri)
    : undefined;
  if (!client && !options.database) {
    throw new Error("MongoDB configuration is required for a real migration");
  }
  let shouldCloseClient = false;
  let database = options.database;
  if (!database && client) {
    await client.connect();
    shouldCloseClient = true;
    if (!config?.mongodbDbName) {
      if (shouldCloseClient) await client.close();
      throw new Error("MONGODB_DB_NAME is required for a real migration");
    }
    database = client.db(config.mongodbDbName);
  }
  try {
    if (!database) throw new Error("MongoDB database is unavailable");
    await ensureMongoIndexes(database);
    await preflightTarget(database, source);
    await preflightUploads(database, source.uploads);
    await migrateDocuments(database, source.documents);
    await migrateUploads(database, source.uploads);
    await migrateChunks(database, source.chunks);
    await migrateJobs(database, source.jobs);
    await migrateSchedulerState(database, source.schedulerState);
    await assertTargetIds(
      database,
      "documents",
      source.documents.map((record) => record.id),
    );
    await assertTargetIds(
      database,
      "document_chunks",
      source.chunks.map((record) => record.id),
    );
    await assertTargetIds(
      database,
      "jobs",
      source.jobs.map((record) => record.id),
    );
    await assertTargetIds(
      database,
      "scheduler_state",
      source.schedulerState.map((record) => record.id),
    );
    await assertUploads(database, source.uploads);
  } finally {
    if (shouldCloseClient && client) await client.close();
  }
  return { backupDirectory, dryRun: false, counts };
}

/**
 * Confirms every existing target ID and record is compatible before any import write.
 */
async function preflightTarget(
  database: Db,
  source: MongoMigrationSource,
): Promise<void> {
  const collections = [
    ["documents", source.documents.map((record) => record.id)],
    ["document_chunks", source.chunks.map((record) => record.id)],
    ["jobs", source.jobs.map((record) => record.id)],
    ["scheduler_state", source.schedulerState.map((record) => record.id)],
  ] as const;
  for (const [collectionName, sourceIds] of collections) {
    const targetIds = await database
      .collection<RawMongoRecord>(collectionName)
      .find({}, { projection: { _id: 1 } })
      .toArray()
      .then((records) => records.map((record) => record._id));
    const sourceSet = new Set(sourceIds);
    if (targetIds.some((id) => !sourceSet.has(id))) {
      throw new Error(
        `MongoDB ${collectionName} contains records outside the source; no target data was changed`,
      );
    }
  }

  await Promise.all([
    ...source.documents.map(async (record) => {
      const current = await database
        .collection<RawMongoRecord>("documents")
        .findOne({ _id: record.id });
      if (current && !isDeepStrictEqual(documentFromMongo(current), record)) {
        throw new Error(`MongoDB document ${record.id} conflicts with its source`);
      }
    }),
    ...source.chunks.map(async (record) => {
      const current = await database
        .collection<RawMongoRecord>("document_chunks")
        .findOne({ _id: record.id });
      if (current && !isDeepStrictEqual(chunkFromMongo(current), record)) {
        throw new Error(`MongoDB chunk ${record.id} conflicts with its source`);
      }
    }),
    ...source.jobs.map(async (record) => {
      const current = await database
        .collection<RawMongoRecord>("jobs")
        .findOne({ _id: record.id });
      if (current && !isDeepStrictEqual(jobFromMongo(current), record)) {
        throw new Error(`MongoDB job ${record.id} conflicts with its source`);
      }
    }),
    ...source.schedulerState.map(async (record) => {
      const current = await database
        .collection<RawMongoRecord>("scheduler_state")
        .findOne({ _id: record.id });
      if (
        current &&
        !isDeepStrictEqual(schedulerStateFromMongo(current), record)
      ) {
        throw new Error(
          `MongoDB scheduler state ${record.id} conflicts with its source`,
        );
      }
    }),
  ]);
}

/**
 * Confirms GridFS contains exactly the source upload keys and matching file bytes.
 */
async function preflightUploads(
  database: Db,
  uploads: PrivateUploadSource[],
): Promise<void> {
  const bucket = new GridFSBucket(database, { bucketName: "uploads" });
  const targetFiles = await bucket.find({}).toArray();
  const uploadsByKey = new Map(uploads.map((upload) => [upload.storageKey, upload]));
  for (const file of targetFiles) {
    const storageKey = file.metadata?.storageKey;
    if (typeof storageKey !== "string" || !uploadsByKey.has(storageKey)) {
      throw new Error(
        "MongoDB uploads contains files outside the source; no target data was changed",
      );
    }
    const source = uploadsByKey.get(storageKey);
    if (!source || file.length !== source.sizeBytes) {
      throw new Error(`MongoDB upload ${storageKey} conflicts with its source`);
    }
    const [sourceHash, targetHash] = await Promise.all([
      hashStream(createReadStream(source.filePath)),
      hashStream(bucket.openDownloadStream(file._id)),
    ]);
    if (sourceHash !== targetHash) {
      throw new Error(`MongoDB upload ${storageKey} conflicts with its source`);
    }
  }
}

/**
 * Copies private file bytes to GridFS while preserving application storage keys.
 */
async function migrateUploads(
  database: Db,
  uploads: PrivateUploadSource[],
): Promise<void> {
  const bucket = new GridFSBucket(database, { bucketName: "uploads" });
  for (const source of uploads) {
    const existing = await bucket
      .find({ "metadata.storageKey": source.storageKey })
      .limit(1)
      .next();
    if (existing) continue;
    await pipeline(
      createReadStream(source.filePath),
      bucket.openUploadStream(source.filename, {
        metadata: { storageKey: source.storageKey },
      }),
    );
  }
}

/**
 * Verifies all migrated upload keys and their bytes after import.
 */
async function assertUploads(
  database: Db,
  uploads: PrivateUploadSource[],
): Promise<void> {
  const bucket = new GridFSBucket(database, { bucketName: "uploads" });
  const targetFiles = await bucket.find({}).toArray();
  if (targetFiles.length !== uploads.length) {
    throw new Error(
      "MongoDB uploads do not exactly match the source; no target data was deleted",
    );
  }
  for (const source of uploads) {
    const file = await bucket
      .find({ "metadata.storageKey": source.storageKey })
      .limit(1)
      .next();
    if (!file || file.length !== source.sizeBytes) {
      throw new Error(`MongoDB upload ${source.storageKey} failed verification`);
    }
    const [sourceHash, targetHash] = await Promise.all([
      hashStream(createReadStream(source.filePath)),
      hashStream(bucket.openDownloadStream(file._id)),
    ]);
    if (sourceHash !== targetHash) {
      throw new Error(`MongoDB upload ${source.storageKey} failed verification`);
    }
  }
}

async function hashStream(stream: AsyncIterable<Uint8Array>): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest("hex");
}

/**
 * Copies legacy JSON and private uploads before reading migration sources.
 */
async function createSourceBackup(dataDirectory: string): Promise<string> {
  const backupsDirectory = join(dataDirectory, "backups");
  await mkdir(backupsDirectory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDirectory = join(
    backupsDirectory,
    `${timestamp}-${randomUUID()}`,
  );
  await mkdir(backupDirectory);
  const copied: string[] = [];
  for (const name of sourceDirectories) {
    const sourcePath = join(dataDirectory, name);
    try {
      const sourceStat = await stat(sourcePath);
      if (!sourceStat.isDirectory()) {
        throw new Error(`Migration source ${name} is not a directory`);
      }
      await cp(sourcePath, join(backupDirectory, name), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      copied.push(name);
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
    }
  }
  await writeFile(
    join(backupDirectory, "manifest.json"),
    JSON.stringify({ createdAt: new Date().toISOString(), contents: copied }, null, 2),
    { flag: "wx" },
  );
  return backupDirectory;
}

/**
 * Reads and validates all records and legacy chunk files without exposing payloads.
 */
async function readMigrationSource(
  dataDirectory: string,
  embeddingModel: string,
  embeddingDimension: number,
): Promise<MongoMigrationSource> {
  const jsonDirectory = join(dataDirectory, "json");
  const documents = await readJsonArray(
    join(jsonDirectory, "documents.json"),
    "documents",
    documentSchema,
  );
  const jobs = await readJsonArray(
    join(jsonDirectory, "jobs.json"),
    "jobs",
    jobSchema,
  );
  const schedulerState = await readJsonArray(
    join(jsonDirectory, "scheduler_state.json"),
    "scheduler_state",
    schedulerStateSchema,
  );
  assertUniqueIds("documents", documents);
  assertUniqueIds("jobs", jobs);
  assertUniqueIds("scheduler_state", schedulerState);
  assertUniqueScheduleKeys(jobs);
  const uploads = await readPrivateUploads(
    join(dataDirectory, "uploads"),
    documents,
  );

  const documentsById = new Map(documents.map((record) => [record.id, record]));
  const chunks = await readChunkFiles(
    join(jsonDirectory, "chunks"),
    documentsById,
    embeddingModel,
    embeddingDimension,
  );
  const filesByDocument = new Set(chunks.map((chunk) => chunk.documentId));
  for (const document of documents) {
    if (
      document.status === "ready" &&
      document.mimeType !== "video/mp4" &&
      !filesByDocument.has(document.id)
    ) {
      throw new Error(
        `Ready document ${document.id} is missing its legacy chunk file`,
      );
    }
  }
  return { documents, uploads, chunks, jobs, schedulerState };
}

/**
 * Confirms active documents still point to private uploads of the recorded size.
 */
async function readPrivateUploads(
  uploadDirectory: string,
  documents: DocumentRecord[],
): Promise<PrivateUploadSource[]> {
  const uploads: PrivateUploadSource[] = [];
  for (const document of documents) {
    try {
      const filePath = join(uploadDirectory, document.storageKey);
      const upload = await stat(filePath);
      if (!upload.isFile() || upload.size !== document.sizeBytes) {
        throw new Error(
          `Private upload does not match document ${document.id}`,
        );
      }
      uploads.push({
        storageKey: document.storageKey,
        filename: document.filename,
        filePath,
        sizeBytes: document.sizeBytes,
      });
    } catch (error) {
      if (document.status === "deleting" && isMissingPathError(error)) continue;
      if (isMissingPathError(error)) {
        throw new Error(`Private upload is missing for document ${document.id}`);
      }
      throw error;
    }
  }
  return uploads;
}

/**
 * Reads one JSON array and reports invalid rows by collection and record ID only.
 */
async function readJsonArray<T extends { id: string }>(
  path: string,
  collection: string,
  schema: z.ZodType<T>,
): Promise<T[]> {
  let contents: string;
  try {
    contents = await readFile(path, "utf8");
  } catch (error) {
    if (isMissingPathError(error)) return [];
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch {
    throw new Error(`Invalid JSON in ${collection}.json`);
  }
  if (!Array.isArray(value)) {
    throw new Error(`Expected an array in ${collection}.json`);
  }
  return value.map((record: unknown, index: number) => {
    const parsed = schema.safeParse(record);
    if (!parsed.success) {
      const id =
        typeof record === "object" &&
        record !== null &&
        "id" in record &&
        typeof record.id === "string"
          ? record.id
          : `row ${index + 1}`;
      throw new Error(`Invalid ${collection} record ${id}`);
    }
    return parsed.data;
  });
}

/**
 * Loads all chunk files, verifies their parent metadata, and converts vectors.
 */
async function readChunkFiles(
  directory: string,
  documents: Map<string, DocumentRecord>,
  embeddingModel: string,
  embeddingDimension: number,
): Promise<ChunkRecord[]> {
  let filenames: string[];
  try {
    filenames = await readdir(directory);
  } catch (error) {
    if (isMissingPathError(error)) return [];
    throw error;
  }
  const chunks: ChunkRecord[] = [];
  for (const filename of filenames.filter((file) => file.endsWith(".json"))) {
    const documentId = basename(filename, ".json");
    const document = documents.get(documentId);
    if (!document) {
      throw new Error(`Orphan legacy chunk file for document ${documentId}`);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(join(directory, filename), "utf8"));
    } catch {
      throw new Error(`Invalid legacy chunk file for document ${documentId}`);
    }
    let legacyFile;
    try {
      legacyFile = parseLegacyChunkFile(raw);
      if (
        legacyFile.header.documentId !== document.id ||
        legacyFile.header.courseId !== document.courseId ||
        legacyFile.header.ownerId !== document.ownerId ||
        legacyFile.header.scope !== document.scope ||
        legacyFile.header.embeddingModel !== document.embeddingModel ||
        (legacyFile.header.embeddingModel === embeddingModel &&
          legacyFile.header.dimension !== embeddingDimension)
      ) {
        throw new Error("Chunk metadata does not match the document");
      }
      const converted = legacyChunksToRecords(legacyFile);
      converted.forEach((chunk) => chunkRecordSchema.parse(chunk));
      chunks.push(...converted);
    } catch {
      throw new Error(`Invalid legacy chunk data for document ${documentId}`);
    }
  }
  return chunks;
}

/**
 * Imports document metadata idempotently and rejects conflicting pre-existing IDs.
 */
async function migrateDocuments(
  database: Db,
  documents: DocumentRecord[],
): Promise<void> {
  const collection = database.collection<RawMongoRecord>("documents");
  for (const document of documents) {
    const existing = await collection.findOne({ _id: document.id });
    if (existing) {
      if (!isDeepStrictEqual(documentFromMongo(existing), document)) {
        throw new Error(`MongoDB document ${document.id} conflicts with its source`);
      }
      continue;
    }
    const { id, ...fields } = document;
    await collection.insertOne({ ...fields, _id: id, _version: 1 });
  }
}

/**
 * Imports chunk records using their deterministic document/index IDs.
 */
async function migrateChunks(
  database: Db,
  chunks: ChunkRecord[],
): Promise<void> {
  const collection = database.collection<RawMongoRecord>("document_chunks");
  for (const chunk of chunks) {
    const existing = await collection.findOne({ _id: chunk.id });
    if (existing) {
      if (!isDeepStrictEqual(chunkFromMongo(existing), chunk)) {
        throw new Error(`MongoDB chunk ${chunk.id} conflicts with its source`);
      }
      continue;
    }
    const { id, ...fields } = chunk;
    await collection.insertOne({ ...fields, _id: id });
  }
}

/**
 * Imports jobs while mapping the legacy lease token to Mongo's lockedBy field.
 */
async function migrateJobs(database: Db, jobs: JobRecord[]): Promise<void> {
  const collection = database.collection<RawMongoRecord>("jobs");
  for (const job of jobs) {
    const existing = await collection.findOne({ _id: job.id });
    if (existing) {
      if (!isDeepStrictEqual(jobFromMongo(existing), job)) {
        throw new Error(`MongoDB job ${job.id} conflicts with its source`);
      }
      continue;
    }
    const { id, leaseToken, ...fields } = job;
    await collection.insertOne({
      ...fields,
      _id: id,
      lockedBy: leaseToken,
    });
  }
}

/**
 * Imports scheduler state while preserving task identity and next-run timing.
 */
async function migrateSchedulerState(
  database: Db,
  records: SchedulerStateRecord[],
): Promise<void> {
  const collection = database.collection<RawMongoRecord>("scheduler_state");
  for (const record of records) {
    const existing = await collection.findOne({ _id: record.id });
    if (existing) {
      if (!isDeepStrictEqual(schedulerStateFromMongo(existing), record)) {
        throw new Error(
          `MongoDB scheduler state ${record.id} conflicts with its source`,
        );
      }
      continue;
    }
    const { id, ...fields } = record;
    await collection.insertOne({ ...fields, _id: id });
  }
}

/**
 * Verifies the complete target identifier set without deleting extra records.
 */
async function assertTargetIds(
  database: Db,
  collectionName: string,
  sourceIds: string[],
): Promise<void> {
  const targetIds = await database
    .collection<RawMongoRecord>(collectionName)
    .find({}, { projection: { _id: 1 } })
    .toArray()
    .then((records) => records.map((record) => record._id))
    .then((ids) => ids.filter((id): id is string => typeof id === "string"));
  const sourceSet = new Set(sourceIds);
  const targetSet = new Set(targetIds);
  if (
    targetSet.size !== sourceSet.size ||
    [...sourceSet].some((id) => !targetSet.has(id))
  ) {
    throw new Error(
      `MongoDB ${collectionName} IDs do not exactly match the source; no target data was deleted`,
    );
  }
}

/**
 * Validates imported document metadata and removes Mongo-only fields.
 */
function documentFromMongo(record: MongoDocument): DocumentRecord {
  const { _id, _version: _version, ...fields } = record;
  return documentSchema.parse({ ...fields, id: _id });
}

/**
 * Validates imported chunks and maps their Mongo IDs to application IDs.
 */
function chunkFromMongo(record: MongoDocument): ChunkRecord {
  const { _id, ...fields } = record;
  return chunkRecordSchema.parse({ ...fields, id: _id });
}

/**
 * Validates imported jobs and maps Mongo lease owners to the legacy field.
 */
function jobFromMongo(record: MongoDocument): JobRecord {
  const { _id, lockedBy, ...fields } = record;
  return jobSchema.parse({ ...fields, id: _id, leaseToken: lockedBy });
}

/**
 * Validates imported scheduler state and maps its stable Mongo ID.
 */
function schedulerStateFromMongo(
  record: MongoDocument,
): SchedulerStateRecord {
  const { _id, ...fields } = record;
  return schedulerStateSchema.parse({ ...fields, id: _id });
}

/**
 * Rejects duplicate source IDs before any target writes occur.
 */
function assertUniqueIds<T extends { id: string }>(
  collection: string,
  records: T[],
): void {
  if (new Set(records.map((record) => record.id)).size !== records.length) {
    throw new Error(`Duplicate IDs in ${collection}.json`);
  }
}

/**
 * Rejects duplicate schedule keys that would violate the Mongo unique index.
 */
function assertUniqueScheduleKeys(jobs: JobRecord[]): void {
  const keys = jobs
    .map((job) => job.scheduleKey)
    .filter((key): key is string => key !== undefined);
  if (new Set(keys).size !== keys.length) {
    throw new Error("Duplicate schedule keys in jobs.json");
  }
}

/**
 * Identifies absent source paths without suppressing other filesystem errors.
 */
function isMissingPathError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

/**
 * Runs the offline validator or the explicitly requested Mongo data import.
 */
async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const unknownArguments = process.argv
    .slice(2)
    .filter((argument) => argument !== "--dry-run");
  if (unknownArguments.length > 0) {
    throw new Error(`Unknown migration option: ${unknownArguments[0]}`);
  }
  const config = loadConfig();
  const result = await migrateJsonToMongo({
    dataDirectory: config.dataDir,
    dryRun,
    embeddingModel: config.mistralEmbeddingModel,
    embeddingDimension: config.mistralEmbeddingDimension,
  });
  console.info(
    JSON.stringify({
      dryRun: result.dryRun,
      backupDirectory: result.backupDirectory,
      counts: result.counts,
    }),
  );
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : "Mongo migration failed",
    );
    process.exitCode = 1;
  });
}
