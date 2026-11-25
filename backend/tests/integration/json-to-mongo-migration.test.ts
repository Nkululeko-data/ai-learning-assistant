import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MongoClient } from "mongodb";
import type { Document as MongoDocument } from "mongodb";
import {
  migrateJsonToMongo,
} from "../../scripts/migrate-json-to-mongo";
import {
  MongoJobRepository,
  type MongoJobDocument,
  type MongoSchedulerStateDocument,
} from "../../src/modules/jobs/mongo-job.repository";
import { MongoUploadStorage } from "../../src/infra/storage/mongo-upload-storage";

const testMongoUri = process.env.TEST_MONGODB_URI;
const describeWithMongo = testMongoUri ? describe : describe.skip;
let temporaryRoot: string | undefined;

interface TestRawMongoDocument extends MongoDocument {
  _id: string;
  unrelated?: boolean;
}

async function createSourceData(): Promise<{
  dataDirectory: string;
  documentId: string;
  jobId: string;
  storageKey: string;
}> {
  temporaryRoot = await mkdtemp(join(tmpdir(), "ai-learning-mongo-migration-"));
  const dataDirectory = join(temporaryRoot, "data");
  const jsonDirectory = join(dataDirectory, "json");
  const chunkDirectory = join(jsonDirectory, "chunks");
  const uploadDirectory = join(dataDirectory, "uploads");
  await Promise.all([
    mkdir(chunkDirectory, { recursive: true }),
    mkdir(uploadDirectory, { recursive: true }),
  ]);
  const documentId = randomUUID();
  const courseId = randomUUID();
  const ownerId = randomUUID();
  const storageKey = randomUUID();
  const now = new Date().toISOString();
  const upload = Buffer.from("private");
  await writeFile(join(uploadDirectory, storageKey), upload);
  const document = {
    id: documentId,
    courseId,
    ownerId,
    scope: "course",
    filename: "source.txt",
    storageKey,
    mimeType: "text/plain",
    sizeBytes: upload.length,
    contentHash: "a".repeat(64),
    status: "ready",
    errorCode: null,
    errorDetail: null,
    extractionDiagnostics: null,
    chunkCount: 1,
    embeddingModel: "mistral-embed",
    ingestJobId: null,
    createdAt: now,
    updatedAt: now,
    readyAt: now,
  };
  await writeFile(
    join(chunkDirectory, `${documentId}.json`),
    JSON.stringify({
      header: {
        documentId,
        courseId,
        ownerId,
        scope: "course",
        embeddingModel: "mistral-embed",
        dimension: 2,
        chunkCount: 1,
        createdAt: now,
      },
      chunks: [
        {
          id: `${documentId}:0`,
          chunkIndex: 0,
          tokenEstimate: 2,
          pageStart: 1,
          pageEnd: 1,
          section: "Introduction",
          text: "Private learning text",
          embedding: Buffer.from([0, 0, 128, 63, 0, 0, 0, 0]).toString(
            "base64",
          ),
        },
      ],
    }),
    "utf8",
  );
  const jobId = randomUUID();
  await Promise.all([
    writeFile(
      join(jsonDirectory, "documents.json"),
      JSON.stringify([document]),
      "utf8",
    ),
    writeFile(
      join(jsonDirectory, "jobs.json"),
      JSON.stringify([
        {
          id: jobId,
          type: "cluster",
          status: "queued",
          attempts: 0,
          maxAttempts: 3,
          runAfter: now,
          lockedUntil: null,
          leaseToken: null,
          payload: { courseId },
          result: null,
          error: null,
          createdBy: "system",
          requestId: null,
          createdAt: now,
          updatedAt: now,
          finishedAt: null,
        },
      ]),
      "utf8",
    ),
    writeFile(
      join(jsonDirectory, "scheduler_state.json"),
      JSON.stringify([
        {
          id: randomUUID(),
          taskName: "daily-maintenance",
          lastRunAt: null,
          nextRunAt: now,
          lastStatus: "skipped",
        },
      ]),
      "utf8",
    ),
  ]);
  return { dataDirectory, documentId, jobId, storageKey };
}

afterEach(async () => {
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
  temporaryRoot = undefined;
});

test("dry run backs up and validates documents, chunks, jobs, and uploads", async () => {
  const { dataDirectory, documentId } = await createSourceData();
  const result = await migrateJsonToMongo({
    dataDirectory,
    dryRun: true,
    embeddingModel: "mistral-embed",
    embeddingDimension: 2,
  });

  expect(result).toMatchObject({
    dryRun: true,
    counts: {
      documents: 1,
      documentChunks: 1,
      jobs: 1,
      schedulerState: 1,
      uploads: 1,
    },
  });
  await expect(
    readFile(
      join(result.backupDirectory, "json", "chunks", `${documentId}.json`),
      "utf8",
    ),
  ).resolves.toContain("Private learning text");
});

test("dry run rejects mismatched chunk metadata without exposing source text", async () => {
  const { dataDirectory, documentId } = await createSourceData();
  const chunkPath = join(
    dataDirectory,
    "json",
    "chunks",
    `${documentId}.json`,
  );
  const chunkFile = JSON.parse(await readFile(chunkPath, "utf8")) as {
    header: { embeddingModel: string };
  };
  chunkFile.header.embeddingModel = "unexpected-model";
  await writeFile(chunkPath, JSON.stringify(chunkFile), "utf8");

  await expect(
    migrateJsonToMongo({
      dataDirectory,
      dryRun: true,
      embeddingModel: "mistral-embed",
      embeddingDimension: 2,
    }),
  ).rejects.toThrow(`Invalid legacy chunk data for document ${documentId}`);
});

describeWithMongo("JSON-to-Mongo migration and job leases", () => {
  let client: MongoClient | undefined;
  let databaseName: string;

  beforeAll(async () => {
    if (!testMongoUri) {
      throw new Error("TEST_MONGODB_URI is required for Mongo integration tests");
    }
    client = new MongoClient(testMongoUri);
    await client.connect();
  });

  afterAll(async () => {
    if (client) await client.close();
  });

  test("imports idempotently and claims each due job atomically", async () => {
    const source = await createSourceData();
    if (!client) throw new Error("Mongo test client is unavailable");
    databaseName = `ai_learning_test_${randomUUID().replace(/-/g, "")}`;
    const database = client.db(databaseName);
    const options = {
      ...source,
      database,
      dryRun: false,
      embeddingModel: "mistral-embed",
      embeddingDimension: 2,
    };

    const first = await migrateJsonToMongo(options);
    const second = await migrateJsonToMongo(options);
    expect(first.counts).toEqual(second.counts);
    expect(
      await database
        .collection("document_chunks")
        .countDocuments({ documentId: source.documentId }),
    ).toBe(1);
    const uploadStorage = new MongoUploadStorage(database);
    await expect(uploadStorage.readUpload(source.storageKey)).resolves.toEqual(
      Buffer.from("private"),
    );

    const repository = new MongoJobRepository(
      database.collection<MongoJobDocument>("jobs"),
      database.collection<MongoSchedulerStateDocument>("scheduler_state"),
    );
    const now = new Date(Date.now() + 1_000);
    const claims = await Promise.all([
      repository.claimNext(now, 10_000),
      repository.claimNext(now, 10_000),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const claim = claims.find((value) => value !== null);
    if (!claim) throw new Error("Expected one job claim");
    expect(await repository.complete(claim, { completed: true }, now)).toBe(true);
    expect(await repository.complete(claim, { completed: true }, now)).toBe(false);
  });

  test("rejects extra target records before importing any source records", async () => {
    const source = await createSourceData();
    if (!client) throw new Error("Mongo test client is unavailable");
    databaseName = `ai_learning_test_${randomUUID().replace(/-/g, "")}`;
    const database = client.db(databaseName);
    await database.collection<TestRawMongoDocument>("documents").insertOne({
      _id: randomUUID(),
      unrelated: true,
    });

    await expect(
      migrateJsonToMongo({
        ...source,
        database,
        dryRun: false,
        embeddingModel: "mistral-embed",
        embeddingDimension: 2,
      }),
    ).rejects.toThrow(
      "MongoDB documents contains records outside the source; no target data was changed",
    );
    expect(await database.collection("documents").countDocuments()).toBe(1);
    expect(await database.collection("jobs").countDocuments()).toBe(0);
  });

  afterEach(async () => {
    if (databaseName && client) await client.db(databaseName).dropDatabase();
    databaseName = "";
  });
});
