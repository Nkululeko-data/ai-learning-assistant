import { z } from "zod";
import { AppError, NotFoundError } from "../../common/errors/app-error";
import type {
  CourseRecord,
  DocumentRecord,
  EnrolmentRecord,
} from "../../infra/jsonstore/system-collections";
import type { AuthenticatedUser } from "../auth/auth.types";

const chunkFileSchema = z
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

const defaultResultLimit = 8;
const maximumResultLimit = 50;

export interface RetrievedChunk {
  id: string;
  documentId: string;
  courseId: string;
  filename: string;
  scope: DocumentRecord["scope"];
  text: string;
  pageStart: number;
  pageEnd: number;
  section: string | null;
  score: number;
}

export interface RetrievalOptions {
  limit?: number;
}

export interface RetrievalRepository {
  findCourse(id: string): CourseRecord | null;
  findEnrolment(courseId: string, userId: string): EnrolmentRecord | null;
  listDocumentsByCourse(courseId: string): DocumentRecord[];
}

export interface ChunkReader {
  readChunks(documentId: string): Promise<unknown>;
}

/**
 * Authorizes course access and filters document visibility before cosine scoring.
 */
export class RetrievalService {
  public constructor(
    private readonly repository: RetrievalRepository,
    private readonly storage: ChunkReader,
    private readonly embeddingModel: string,
    private readonly embeddingDimension: number,
  ) {}

  /**
   * Searches ready course documents and the caller's own personal notes.
   */
  public async search(
    actor: AuthenticatedUser,
    courseId: string,
    queryEmbedding: number[],
    options: RetrievalOptions = {},
  ): Promise<RetrievedChunk[]> {
    const course = this.requireCourseAccess(actor, courseId);
    if (course.status !== "active") return [];

    const limit = options.limit ?? defaultResultLimit;
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > maximumResultLimit
    ) {
      throw new AppError(
        "INVALID_RETRIEVAL_LIMIT",
        400,
        `Retrieval limit must be an integer from 1 to ${maximumResultLimit}`,
      );
    }

    const queryVector = validateQueryEmbedding(
      queryEmbedding,
      this.embeddingDimension,
    );
    const queryNorm = vectorNorm(queryVector);
    if (queryNorm === 0) {
      throw new AppError(
        "INVALID_QUERY_EMBEDDING",
        400,
        "The query embedding must have a non-zero magnitude",
      );
    }

    const candidates = this.repository
      .listDocumentsByCourse(courseId)
      .filter(
        (document) =>
          document.courseId === courseId &&
          document.status === "ready" &&
          document.embeddingModel === this.embeddingModel &&
          (document.scope === "course" ||
            (document.scope === "personal" &&
              document.ownerId === actor.id)),
      );
    const scored: RetrievedChunk[] = [];

    for (const document of candidates) {
      const chunkFile = await this.readValidatedChunkFile(document);
      for (const chunk of chunkFile.chunks) {
        const vector = decodeEmbedding(
          chunk.embedding,
          this.embeddingDimension,
          document.id,
        );
        const vectorMagnitude = vectorNorm(vector);
        if (vectorMagnitude === 0) {
          throw invalidChunkData(document.id);
        }
        scored.push({
          id: chunk.id,
          documentId: document.id,
          courseId: document.courseId,
          filename: document.filename,
          scope: document.scope,
          text: chunk.text,
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,
          section: chunk.section,
          score:
            cosineSimilarity(queryVector, queryNorm, vector, vectorMagnitude),
        });
      }
    }

    return scored
      .sort(
        (left, right) =>
          right.score - left.score || left.id.localeCompare(right.id),
      )
      .slice(0, limit);
  }

  private requireCourseAccess(
    actor: AuthenticatedUser,
    courseId: string,
  ): CourseRecord {
    const course = this.repository.findCourse(courseId);
    if (!course || actor.status !== "active" || actor.role === "admin") {
      throw new NotFoundError("Course not found");
    }
    if (actor.role === "coach" && course.ownerId === actor.id) return course;
    if (
      actor.role === "learner" &&
      this.repository.findEnrolment(course.id, actor.id)?.status === "approved"
    ) {
      return course;
    }
    throw new NotFoundError("Course not found");
  }

  private async readValidatedChunkFile(
    document: DocumentRecord,
  ): Promise<z.infer<typeof chunkFileSchema>> {
    let rawChunkFile: unknown;
    try {
      rawChunkFile = await this.storage.readChunks(document.id);
    } catch (error) {
      if (error instanceof SyntaxError || isMissingFileError(error)) {
        throw invalidChunkData(document.id);
      }
      throw error;
    }
    const parsed = chunkFileSchema.safeParse(rawChunkFile);
    if (!parsed.success) throw invalidChunkData(document.id);

    const { header, chunks } = parsed.data;
    if (
      header.documentId !== document.id ||
      header.courseId !== document.courseId ||
      header.ownerId !== document.ownerId ||
      header.scope !== document.scope ||
      header.embeddingModel !== this.embeddingModel ||
      header.dimension !== this.embeddingDimension ||
      header.chunkCount !== chunks.length ||
      (document.chunkCount !== null &&
        document.chunkCount !== undefined &&
        document.chunkCount !== chunks.length)
    ) {
      throw invalidChunkData(document.id);
    }
    chunks.forEach((chunk, index) => {
      if (
        chunk.id !== `${document.id}:${index}` ||
        chunk.chunkIndex !== index ||
        chunk.pageEnd < chunk.pageStart
      ) {
        throw invalidChunkData(document.id);
      }
    });
    return parsed.data;
  }
}

function validateQueryEmbedding(
  embedding: number[],
  dimension: number,
): number[] {
  if (
    embedding.length !== dimension ||
    embedding.some((value) => !Number.isFinite(value))
  ) {
    throw new AppError(
      "INVALID_QUERY_EMBEDDING",
      400,
      "The query embedding does not match the configured model",
    );
  }
  return embedding;
}

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
    throw invalidChunkData(documentId);
  }
  const values = Array.from({ length: dimension }, (_value, index) =>
    bytes.readFloatLE(index * Float32Array.BYTES_PER_ELEMENT),
  );
  if (values.some((value) => !Number.isFinite(value))) {
    throw invalidChunkData(documentId);
  }
  return values;
}

function vectorNorm(vector: number[]): number {
  return Math.hypot(...vector);
}

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

function invalidChunkData(documentId: string): AppError {
  return new AppError(
    "DOCUMENT_CHUNK_DATA_INVALID",
    500,
    "A processed document is unavailable for retrieval",
    { documentId },
  );
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
