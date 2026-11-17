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
  tokenEstimate: number;
  pageStart: number;
  pageEnd: number;
  section: string | null;
  score: number;
}

export interface RetrievalOptions {
  limit?: number;
  documentIds?: string[];
  sections?: string[];
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

    const courseDocuments = this.repository.listDocumentsByCourse(courseId);
    const accessibleDocuments = courseDocuments.filter(
      (document) =>
        document.courseId === courseId &&
        (document.scope === "course" ||
          (document.scope === "personal" && document.ownerId === actor.id)),
    );
    if (options.documentIds) {
      const selectedIds = new Set(options.documentIds);
      if (selectedIds.size !== options.documentIds.length) {
        throw new AppError(
          "VALIDATION_FAILED",
          422,
          "Selected document IDs must be unique",
        );
      }
      if (
        options.documentIds.some(
          (documentId) =>
            !accessibleDocuments.some((document) => document.id === documentId),
        )
      ) {
        throw new NotFoundError("Selected source document not found");
      }
    }

    const candidates = accessibleDocuments
      .filter(
        (document) =>
          document.status === "ready" &&
          document.embeddingModel === this.embeddingModel &&
          (!options.documentIds ||
            options.documentIds.includes(document.id)),
      );
    if (
      options.documentIds &&
      candidates.length !== options.documentIds.length
    ) {
      throw insufficientMaterialError(
        "All selected documents must be ready for learning-content generation",
      );
    }
    const scored: RetrievedChunk[] = [];
    const matchedSections = new Set<string>();
    const requestedSections = new Set(
      (options.sections ?? []).map(normalizeSection),
    );

    for (const document of candidates) {
      const chunkFile = await this.readValidatedChunkFile(document);
      for (const chunk of chunkFile.chunks) {
        const normalizedSection = chunk.section
          ? normalizeSection(chunk.section)
          : null;
        if (normalizedSection && requestedSections.has(normalizedSection)) {
          matchedSections.add(normalizedSection);
        }
        if (
          requestedSections.size > 0 &&
          (!normalizedSection || !requestedSections.has(normalizedSection))
        ) {
          continue;
        }
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
          tokenEstimate: chunk.tokenEstimate,
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,
          section: chunk.section,
          score:
            cosineSimilarity(queryVector, queryNorm, vector, vectorMagnitude),
        });
      }
    }

    if (
      [...requestedSections].some((section) => !matchedSections.has(section))
    ) {
      throw insufficientMaterialError(
        "One or more selected sections are not available in the selected documents",
      );
    }
    if (requestedSections.size > 0 && scored.length === 0) {
      throw insufficientMaterialError(
        "The selected sections do not contain searchable material",
      );
    }

    return scored
      .sort(
        (left, right) =>
          right.score - left.score || left.id.localeCompare(right.id),
      )
      .slice(0, limit);
  }

  public assertCourseAccess(actor: AuthenticatedUser, courseId: string): void {
    const course = this.requireCourseAccess(actor, courseId);
    if (course.status !== "active") {
      throw new NotFoundError("Course not found");
    }
  }

  public async getSelectedChunks(
    actor: AuthenticatedUser,
    courseId: string,
    documentIds: string[],
  ): Promise<RetrievedChunk[]> {
    const course = this.requireCourseAccess(actor, courseId);
    if (course.status !== "active") throw new NotFoundError("Course not found");
    if (new Set(documentIds).size !== documentIds.length) {
      throw new AppError(
        "VALIDATION_FAILED",
        422,
        "Selected document IDs must be unique",
      );
    }

    const visibleDocuments = this.repository
      .listDocumentsByCourse(courseId)
      .filter(
        (document) =>
          document.courseId === courseId &&
          (document.scope === "course" ||
            (document.scope === "personal" && document.ownerId === actor.id)),
      );
    const selectedDocuments = documentIds.map((documentId) => {
      const document = visibleDocuments.find(
        (candidate) => candidate.id === documentId,
      );
      if (!document) throw new NotFoundError("Selected source document not found");
      if (
        document.status !== "ready" ||
        document.embeddingModel !== this.embeddingModel
      ) {
        throw insufficientMaterialError(
          "All selected documents must be ready for learning-content generation",
        );
      }
      return document;
    });

    const selectedChunks: RetrievedChunk[] = [];
    for (const document of selectedDocuments) {
      const chunkFile = await this.readValidatedChunkFile(document);
      for (const chunk of chunkFile.chunks) {
        selectedChunks.push({
          id: chunk.id,
          documentId: document.id,
          courseId: document.courseId,
          filename: document.filename,
          scope: document.scope,
          text: chunk.text,
          tokenEstimate: chunk.tokenEstimate,
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,
          section: chunk.section,
          score: 0,
        });
      }
    }
    if (selectedChunks.length === 0) {
      throw insufficientMaterialError(
        "The selected documents do not contain searchable material",
      );
    }
    return selectedChunks;
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

function normalizeSection(section: string): string {
  return section.trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

function insufficientMaterialError(message: string): AppError {
  return new AppError("INSUFFICIENT_MATERIAL", 422, message);
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
