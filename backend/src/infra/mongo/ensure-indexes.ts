import type { Db } from "mongodb";

/**
 * Creates the operational MongoDB indexes used by documents, chunks, jobs, and scheduling.
 */
export async function ensureMongoIndexes(database: Db): Promise<void> {
  await Promise.all([
    database.collection("documents").createIndex(
      { courseId: 1, scope: 1 },
      { name: "documents_course_scope" },
    ),
    database.collection("documents").createIndex(
      { ownerId: 1, courseId: 1 },
      { name: "documents_owner_course" },
    ),
    database.collection("documents").createIndex(
      { courseId: 1, scope: 1, ownerId: 1, contentHash: 1 },
      {
        name: "documents_duplicate_upload",
        unique: true,
        partialFilterExpression: {
          status: { $in: ["uploaded", "processing", "ready", "failed"] },
        },
      },
    ),
    database.collection("documents").createIndex(
      { status: 1 },
      { name: "documents_status" },
    ),
    database.collection("document_chunks").createIndex(
      { documentId: 1, chunkIndex: 1 },
      { name: "chunks_document_order", unique: true },
    ),
    database.collection("jobs").createIndex(
      { status: 1, runAfter: 1, createdAt: 1 },
      { name: "jobs_status_run_after" },
    ),
    database.collection("jobs").createIndex(
      { scheduleKey: 1 },
      {
        name: "jobs_schedule_key",
        unique: true,
        partialFilterExpression: { scheduleKey: { $exists: true } },
      },
    ),
    database.collection("scheduler_state").createIndex(
      { taskName: 1 },
      { name: "scheduler_task_name", unique: true },
    ),
  ]);
}

/**
 * Prevents startup until the required Atlas Vector Search index is queryable.
 */
export async function assertAtlasVectorIndexReady(
  database: Db,
  embeddingModel: string,
  embeddingDimension: number,
): Promise<void> {
  if (embeddingModel !== "mistral-embed" || embeddingDimension !== 1024) {
    throw new Error(
      "Atlas Vector Search requires mistral-embed with 1024 dimensions",
    );
  }
  const indexes = await database
    .collection("document_chunks")
    .listSearchIndexes("document_chunks_vector")
    .toArray();
  const index = indexes[0];
  if (!isReadyAtlasIndex(index)) {
    throw new Error(
      "Atlas Vector Search index document_chunks_vector is missing or not ready",
    );
  }
}

/**
 * Narrows Atlas index metadata to the fields required for readiness.
 */
function isReadyAtlasIndex(
  value: unknown,
): value is { status: string; queryable: boolean } {
  return (
    typeof value === "object" &&
    value !== null &&
    "status" in value &&
    value.status === "READY" &&
    "queryable" in value &&
    value.queryable === true
  );
}
