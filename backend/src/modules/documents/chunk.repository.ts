import { z } from "zod";
import type { Collection, Document as MongoDocument } from "mongodb";
import type { DocumentRecord } from "../../infra/jsonstore/system-collections";
import type { PrivateFileStorage } from "../../infra/storage/private-file-storage";

export type LegacyChunkStorage = Pick<
  PrivateFileStorage,
  "readChunks" | "writeChunks" | "removeChunks"
>;

const legacyChunkFileSchema = z
  .object({
    header: z
      .object({
        documentId: z.string().uuid(),
        courseId: z.string().uuid(),
        ownerId: z.string().uuid(),
        scope: z.enum(["course", "personal"]),
        embeddingModel: z.string().min(1),
        dimension: z.number().int().positive(),
        chunkCount: z.number().int().nonnegative(),
        createdAt: z.string().datetime(),
      })
      .strict(),
    chunks: z.array(
      z
        .object({
          id: z.string().min(1),
          chunkIndex: z.number().int().nonnegative(),
          tokenEstimate: z.number().int().nonnegative(),
          pageStart: z.number().int().positive(),
          pageEnd: z.number().int().positive(),
          section: z.string().nullable(),
          text: z.string().min(1),
          embedding: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

export type LegacyChunkFile = z.infer<typeof legacyChunkFileSchema>;

export interface ChunkRecord {
  id: string;
  documentId: string;
  courseId: string;
  scope: DocumentRecord["scope"];
  ownerId: string;
  text: string;
  embedding: number[];
  embeddingModel: string;
  chunkIndex: number;
  tokenEstimate: number;
  pageStart: number;
  pageEnd: number;
  section: string | null;
  normalizedSection: string | null;
  createdAt: string;
}

export const chunkRecordSchema = z
  .object({
    id: z.string().min(1).max(100),
    documentId: z.string().uuid(),
    courseId: z.string().uuid(),
    scope: z.enum(["course", "personal"]),
    ownerId: z.string().uuid(),
    text: z.string().min(1),
    embedding: z.array(z.number().finite()).min(1),
    embeddingModel: z.string().min(1).max(100),
    chunkIndex: z.number().int().nonnegative(),
    tokenEstimate: z.number().int().nonnegative(),
    pageStart: z.number().int().positive(),
    pageEnd: z.number().int().positive(),
    section: z.string().nullable(),
    normalizedSection: z.string().nullable(),
    createdAt: z.string().datetime(),
  })
  .strict()
  .superRefine((chunk, context) => {
    if (chunk.pageEnd < chunk.pageStart) {
      context.addIssue({
        code: "custom",
        path: ["pageEnd"],
        message: "Must not precede pageStart",
      });
    }
    if (chunk.id !== `${chunk.documentId}:${chunk.chunkIndex}`) {
      context.addIssue({
        code: "custom",
        path: ["id"],
        message: "Must be derived from its document and chunk index",
      });
    }
  });

export interface ChunkSearchFilter {
  courseId: string;
  embeddingModel: string;
  ownerId: string;
  documentIds: string[];
  sections?: string[];
}

export interface ScoredChunk extends ChunkRecord {
  score: number;
}

export class ChunkDataError extends Error {
  public constructor(public readonly documentId: string) {
    super("Stored document chunks are invalid");
    this.name = "ChunkDataError";
  }
}

export interface ChunkRepository {
  replaceForDocument(documentId: string, chunks: ChunkRecord[]): Promise<void>;
  deleteForDocument(documentId: string): Promise<void>;
  findByDocumentIds(documentIds: string[]): Promise<ChunkRecord[]>;
  vectorSearch(
    queryEmbedding: number[],
    filter: ChunkSearchFilter,
    limit: number,
  ): Promise<ScoredChunk[]>;
}

/**
 * Keeps the legacy private-file format available for tests and pre-cutover tooling.
 */
export class JsonChunkRepository implements ChunkRepository {
  public constructor(private readonly storage: LegacyChunkStorage) {}

  public async replaceForDocument(
    documentId: string,
    chunks: ChunkRecord[],
  ): Promise<void> {
    chunks.forEach((chunk) => chunkRecordSchema.parse(chunk));
    const first = chunks[0];
    if (!first) {
      await this.deleteForDocument(documentId);
      return;
    }
    const legacyChunks = chunks.map((chunk) => ({
      id: chunk.id,
      chunkIndex: chunk.chunkIndex,
      tokenEstimate: chunk.tokenEstimate,
      pageStart: chunk.pageStart,
      pageEnd: chunk.pageEnd,
      section: chunk.section,
      text: chunk.text,
      embedding: encodeEmbedding(chunk.embedding),
    }));
    await this.storage.writeChunks(documentId, {
      header: {
        documentId,
        courseId: first.courseId,
        ownerId: first.ownerId,
        scope: first.scope,
        embeddingModel: first.embeddingModel,
        dimension: first.embedding.length,
        chunkCount: chunks.length,
        createdAt: first.createdAt,
      },
      chunks: legacyChunks,
    });
  }

  public deleteForDocument(documentId: string): Promise<void> {
    return this.storage.removeChunks(documentId);
  }

  public async findByDocumentIds(
    documentIds: string[],
  ): Promise<ChunkRecord[]> {
    const records: ChunkRecord[] = [];
    for (const documentId of documentIds) {
      try {
        const file = parseLegacyChunkFile(
          await this.storage.readChunks(documentId),
        );
        records.push(...legacyChunksToRecords(file));
      } catch (error) {
        if (
          error instanceof z.ZodError ||
          error instanceof SyntaxError ||
          error instanceof ChunkDataError ||
          isMissingFileError(error)
        ) {
          throw new ChunkDataError(documentId);
        }
        throw error;
      }
    }
    return records.sort((left, right) =>
      left.documentId.localeCompare(right.documentId) ||
      left.chunkIndex - right.chunkIndex,
    );
  }

  public async vectorSearch(
    queryEmbedding: number[],
    filter: ChunkSearchFilter,
    limit: number,
  ): Promise<ScoredChunk[]> {
    const chunks = await this.findByDocumentIds(filter.documentIds);
    const queryNorm = vectorNorm(queryEmbedding);
    return chunks
      .filter(
        (chunk) =>
          chunk.courseId === filter.courseId &&
          chunk.embeddingModel === filter.embeddingModel &&
          (chunk.scope === "course" ||
            (chunk.scope === "personal" && chunk.ownerId === filter.ownerId)) &&
          (!filter.sections ||
            (chunk.normalizedSection !== null &&
              filter.sections.includes(chunk.normalizedSection))),
      )
      .map((chunk) => ({
        ...chunk,
        score: cosineSimilarity(
          queryEmbedding,
          queryNorm,
          chunk.embedding,
          vectorNorm(chunk.embedding),
        ),
      }))
      .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
      .slice(0, limit);
  }
}

/**
 * Persists vectors and chunk text in MongoDB and runs filtered Atlas Vector Search.
 */
export class MongoChunkRepository implements ChunkRepository {
  public constructor(private readonly collection: Collection<ChunkRecordDocument>) {}

  public async replaceForDocument(
    documentId: string,
    chunks: ChunkRecord[],
  ): Promise<void> {
    await this.collection.deleteMany({ documentId });
    if (chunks.length > 0) {
      await this.collection.insertMany(
        chunks.map(({ id, ...chunk }) => ({ ...chunk, _id: id })),
      );
    }
    const storedCount = await this.collection.countDocuments({ documentId });
    if (storedCount !== chunks.length) {
      throw new Error("MongoDB chunk count does not match the requested document chunks");
    }
  }

  public async deleteForDocument(documentId: string): Promise<void> {
    await this.collection.deleteMany({ documentId });
  }

  public async findByDocumentIds(
    documentIds: string[],
  ): Promise<ChunkRecord[]> {
    if (documentIds.length === 0) return [];
    return this.collection
      .find({ documentId: { $in: documentIds } })
      .sort({ documentId: 1, chunkIndex: 1 })
      .toArray()
      .then((records) =>
        records.map((record) => {
          try {
            return toChunkRecord(record);
          } catch (error) {
            if (error instanceof z.ZodError) {
              throw new ChunkDataError(record.documentId);
            }
            throw error;
          }
        }),
      );
  }

  public async vectorSearch(
    queryEmbedding: number[],
    filter: ChunkSearchFilter,
    limit: number,
  ): Promise<ScoredChunk[]> {
    if (filter.documentIds.length === 0) return [];
    const vectorFilter: MongoDocument = {
      $and: [
        { courseId: filter.courseId },
        { embeddingModel: filter.embeddingModel },
        { documentId: { $in: filter.documentIds } },
        {
          $or: [
            { scope: "course" },
            { scope: "personal", ownerId: filter.ownerId },
          ],
        },
      ],
    };
    if (filter.sections) {
      vectorFilter.$and.push({
        normalizedSection: { $in: filter.sections },
      });
    }
    const results = await this.collection
      .aggregate<ChunkSearchResult>([
        {
          $vectorSearch: {
            index: "document_chunks_vector",
            path: "embedding",
            queryVector: queryEmbedding,
            numCandidates: Math.min(10_000, Math.max(100, limit * 10)),
            limit,
            filter: vectorFilter,
          },
        },
        { $addFields: { score: { $meta: "vectorSearchScore" } } },
      ])
      .toArray();
    return results.map((result) => {
      try {
        return { ...toChunkRecord(result), score: result.score };
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new ChunkDataError(result.documentId);
        }
        throw error;
      }
    });
  }
}

export interface ChunkSearchResult extends ChunkRecordDocument {
  score: number;
}

export interface ChunkRecordDocument
  extends MongoDocument,
    Omit<ChunkRecord, "id"> {
  _id: string;
}

/**
 * Validates the old chunk file before converting it for migration or retrieval.
 */
export function parseLegacyChunkFile(value: unknown): LegacyChunkFile {
  return legacyChunkFileSchema.parse(value);
}

/**
 * Converts an old chunk file into Mongo-ready records without losing metadata.
 */
export function legacyChunksToRecords(file: LegacyChunkFile): ChunkRecord[] {
  const { header, chunks } = file;
  if (header.chunkCount !== chunks.length) {
    throw new ChunkDataError(header.documentId);
  }
  return chunks.map((chunk, index) => {
    if (
      chunk.id !== `${header.documentId}:${index}` ||
      chunk.chunkIndex !== index ||
      chunk.pageEnd < chunk.pageStart
    ) {
      throw new ChunkDataError(header.documentId);
    }
    try {
      const embedding = decodeEmbedding(
        chunk.embedding,
        header.dimension,
        header.documentId,
      );
      return chunkRecordSchema.parse({
        id: chunk.id,
        documentId: header.documentId,
        courseId: header.courseId,
        scope: header.scope,
        ownerId: header.ownerId,
        text: chunk.text,
        embedding,
        embeddingModel: header.embeddingModel,
        chunkIndex: chunk.chunkIndex,
        tokenEstimate: chunk.tokenEstimate,
        pageStart: chunk.pageStart,
        pageEnd: chunk.pageEnd,
        section: chunk.section,
        normalizedSection: normalizeSection(chunk.section),
        createdAt: header.createdAt,
      });
    } catch (error) {
      if (error instanceof z.ZodError) {
        throw new ChunkDataError(header.documentId);
      }
      throw error;
    }
  });
}

/**
 * Maps Mongo's `_id` to the stable application chunk identifier.
 */
function toChunkRecord(
  record: ChunkRecordDocument & { score?: number },
): ChunkRecord {
  const { _id, score: _score, ...chunk } = record;
  return chunkRecordSchema.parse({ ...chunk, id: _id });
}

/**
 * Converts the legacy base64 vector to finite little-endian float values.
 */
function decodeEmbedding(
  encoded: string,
  dimension: number,
  documentId: string,
): number[] {
  const bytes = Buffer.from(encoded, "base64");
  if (
    bytes.length !== dimension * Float32Array.BYTES_PER_ELEMENT ||
    bytes.toString("base64") !== encoded
  ) {
    throw new ChunkDataError(documentId);
  }
  const vector = Array.from({ length: dimension }, (_value, index) =>
    bytes.readFloatLE(index * Float32Array.BYTES_PER_ELEMENT),
  );
  if (vector.some((value) => !Number.isFinite(value))) {
    throw new ChunkDataError(documentId);
  }
  return vector;
}

/**
 * Encodes a vector using the legacy little-endian float format.
 */
function encodeEmbedding(vector: number[]): string {
  const bytes = Buffer.alloc(vector.length * Float32Array.BYTES_PER_ELEMENT);
  vector.forEach((value, index) =>
    bytes.writeFloatLE(value, index * Float32Array.BYTES_PER_ELEMENT),
  );
  return bytes.toString("base64");
}

/**
 * Normalizes section labels for consistent exact matching and Atlas filtering.
 */
function normalizeSection(section: string | null): string | null {
  return section?.trim().replace(/\s+/g, " ").toLocaleLowerCase() ?? null;
}

/**
 * Computes a vector magnitude for the JSON-backed repository.
 */
function vectorNorm(vector: number[]): number {
  return Math.hypot(...vector);
}

/**
 * Computes cosine similarity for the JSON-backed repository.
 */
function cosineSimilarity(
  left: number[],
  leftNorm: number,
  right: number[],
  rightNorm: number,
): number {
  return left.reduce(
    (sum, value, index) =>
      sum + (value / leftNorm) * ((right[index] ?? 0) / rightNorm),
    0,
  );
}

/**
 * Identifies an absent legacy chunk file without suppressing other storage errors.
 */
function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
