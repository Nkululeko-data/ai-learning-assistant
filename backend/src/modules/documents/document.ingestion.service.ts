import { z } from "zod";
import { JobExecutionError } from "../jobs/job.service";
import type { JobRecord } from "../../infra/jsonstore/system-collections";
import type { DocumentRepository } from "./document.types";
import { PrivateFileStorage } from "../../infra/storage/private-file-storage";
import type { UploadStorage } from "../../infra/storage/upload-storage";
import { chunkDocumentPages } from "./document.chunker";
import { extractDocumentText, type ExtractionResult } from "./document.extractors";
import {
  EmbeddingProviderError,
  type DocumentEmbeddingProvider,
} from "./mistral-embedding.provider";
import {
  JsonChunkRepository,
  type ChunkRepository,
} from "./chunk.repository";

const documentIdPayloadSchema = z.object({
  documentId: z.string().uuid(),
});

const maximumChunksPerDocument = 10_000;
const minimumPdfTextCharacters = 50;

/**
 * Runs extraction, chunking, embedding and idempotent document cleanup jobs.
 */
export class DocumentIngestionService {
  private readonly chunks: ChunkRepository;

  public constructor(
    private readonly repository: DocumentRepository,
    private readonly storage: UploadStorage,
    private readonly embeddings: DocumentEmbeddingProvider,
    private readonly chunkSizeTokens: number,
    private readonly chunkOverlapTokens: number,
    private readonly maxExtractedTextBytes: number,
    chunks?: ChunkRepository,
  ) {
    if (chunks) {
      this.chunks = chunks;
    } else if (storage instanceof PrivateFileStorage) {
      this.chunks = new JsonChunkRepository(storage);
    } else {
      throw new Error("A chunk repository is required with remote upload storage");
    }
  }

  /**
   * Processes a document and persists ready metadata only after atomic chunk storage.
   */
  public async ingest(
    job: JobRecord,
    signal: AbortSignal,
  ): Promise<JobRecord["result"]> {
    const documentId = parseDocumentId(job);
    const initialDocument = await this.repository.withDocumentLock(
      documentId,
      async () => {
        const document = await this.repository.findDocument(documentId);
        if (
          !document ||
          document.status === "ready" ||
          document.status === "deleting"
        ) {
          return null;
        }
        await this.repository.updateDocument(document.id, (current) => ({
          ...current,
          status: "processing",
          errorCode: null,
          errorDetail: null,
          updatedAt: new Date().toISOString(),
        }));
        return document;
      },
    );
    if (!initialDocument) return { skipped: "document_not_processable" };

    let extraction: ExtractionResult | null = null;
    let stage: "read" | "extract" | "embed" | "store" = "read";
    try {
      signal.throwIfAborted();
      const source = await this.storage.readUpload(initialDocument.storageKey);
      stage = "extract";
      extraction = await extractDocumentText(
        initialDocument.mimeType,
        source,
        signal,
        this.maxExtractedTextBytes,
      );
      if (extraction.diagnostics.charCount === 0) {
        throw new DocumentProcessingFailure(
          "DOCUMENT_TEXT_EMPTY",
          "No readable text was found. Check the file and upload it again.",
        );
      }
      if (
        extraction.parser === "pdfjs-dist" &&
        extraction.diagnostics.charCount < minimumPdfTextCharacters
      ) {
        throw new DocumentProcessingFailure(
          "EXTRACTION_LOW_TEXT",
          "This PDF contains little extractable text and may be scanned. OCR is not supported.",
        );
      }

      const chunks = chunkDocumentPages(
        extraction.pages,
        this.chunkSizeTokens,
        this.chunkOverlapTokens,
      );
      if (chunks.length === 0) {
        throw new DocumentProcessingFailure(
          "DOCUMENT_TEXT_EMPTY",
          "No readable text was found. Check the file and upload it again.",
        );
      }
      if (chunks.length > maximumChunksPerDocument) {
        throw new DocumentProcessingFailure(
          "DOCUMENT_CHUNK_LIMIT_EXCEEDED",
          "The extracted document has too many chunks to process. Split it into smaller files.",
        );
      }

      stage = "embed";
      const vectors = await this.embeddings.embed(
        chunks.map((chunk) => chunk.text),
        signal,
      );
      if (
        vectors.length !== chunks.length ||
        vectors.some((vector) => vector.length !== this.embeddings.dimension)
      ) {
        throw new DocumentProcessingFailure(
          "EMBEDDING_PROVIDER_RESPONSE_INVALID",
          "The embedding provider returned an invalid response. Retry processing.",
        );
      }

      const createdAt = new Date().toISOString();
      const chunkRecords = chunks.map((chunk, index) => {
        const embedding = vectors[index];
        if (!embedding) {
          throw new DocumentProcessingFailure(
            "EMBEDDING_PROVIDER_RESPONSE_INVALID",
            "The embedding provider returned an invalid response. Retry processing.",
          );
        }
        return {
          id: `${initialDocument.id}:${chunk.chunkIndex}`,
          documentId: initialDocument.id,
          courseId: initialDocument.courseId,
          ownerId: initialDocument.ownerId,
          scope: initialDocument.scope,
          embeddingModel: this.embeddings.model,
          createdAt,
          chunkIndex: chunk.chunkIndex,
          tokenEstimate: Math.ceil(chunk.text.length / 4),
          pageStart: chunk.pageStart,
          pageEnd: chunk.pageEnd,
          section: chunk.section,
          normalizedSection: normalizeSection(chunk.section),
          text: chunk.text,
          embedding,
        };
      });

      stage = "store";
      const committed = await this.repository.withDocumentLock(
        documentId,
        async () => {
          const current = await this.repository.findDocument(documentId);
          if (!current || current.status !== "processing") return false;
          await this.chunks.replaceForDocument(documentId, chunkRecords);
          await this.repository.updateDocument(documentId, (document) => ({
            ...document,
            status: "ready",
            errorCode: null,
            errorDetail: null,
            extractionDiagnostics: extraction?.diagnostics ?? null,
            chunkCount: chunks.length,
            embeddingModel: this.embeddings.model,
            readyAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          }));
          return true;
        },
      );
      return committed
        ? { chunkCount: chunks.length }
        : { skipped: "document_no_longer_processable" };
    } catch (error) {
      if (signal.aborted) throw error;
      const failure = mapProcessingFailure(error, stage);
      await this.repository.withDocumentLock(documentId, async () => {
        const current = await this.repository.findDocument(documentId);
        if (!current || current.status !== "processing") return;
        await this.repository.updateDocument(documentId, (document) => ({
          ...document,
          status: "failed",
          errorCode: failure.code,
          errorDetail: failure.detail,
          extractionDiagnostics:
            extraction?.diagnostics ?? document.extractionDiagnostics ?? null,
          updatedAt: new Date().toISOString(),
        }));
      });
      throw new JobExecutionError(failure.code, failure.retryable);
    }
  }

  /**
   * Removes chunk data, source bytes and metadata in an idempotent order.
   */
  public async cleanup(
    job: JobRecord,
    signal: AbortSignal,
  ): Promise<JobRecord["result"]> {
    const documentId = parseDocumentId(job);
    signal.throwIfAborted();
    return this.repository.withDocumentLock(documentId, async () => {
      const document = await this.repository.findDocument(documentId);
      if (!document) {
        await this.chunks.deleteForDocument(documentId);
        return { deleted: false };
      }
      if (document.status !== "deleting") {
        return { skipped: "document_not_marked_for_deletion" };
      }
      try {
        await this.chunks.deleteForDocument(documentId);
        await this.storage.removeUpload(document.storageKey);
        await this.repository.removeDocument(documentId);
      } catch {
        throw new JobExecutionError("DOCUMENT_CLEANUP_FAILED", true);
      }
      return { deleted: true };
    });
  }
}

/**
 * Represents a safe, non-content processing failure.
 */
class DocumentProcessingFailure extends Error {
  public constructor(
    public readonly code: string,
    public readonly detail: string,
  ) {
    super("Document processing failed");
    this.name = "DocumentProcessingFailure";
  }
}

/**
 * Validates the identifier-only background job payload.
 */
function parseDocumentId(job: JobRecord): string {
  const parsed = documentIdPayloadSchema.safeParse(job.payload);
  if (!parsed.success) throw new JobExecutionError("JOB_PAYLOAD_INVALID", false);
  return parsed.data.documentId;
}

/**
 * Maps parser, provider and filesystem failures to safe status details.
 */
function mapProcessingFailure(
  error: unknown,
  stage: "read" | "extract" | "embed" | "store",
): { code: string; detail: string; retryable: boolean } {
  if (error instanceof DocumentProcessingFailure) {
    return { code: error.code, detail: error.detail, retryable: false };
  }
  if (error instanceof EmbeddingProviderError) {
    return {
      code: error.code,
      detail:
        error.code === "EMBEDDING_PROVIDER_NOT_CONFIGURED"
          ? "MISTRAL_API_KEY is not configured. Configure it and retry processing."
          : error.code === "EMBEDDING_PROVIDER_AUTH_FAILED"
            ? "The embedding provider rejected its credentials. Check MISTRAL_API_KEY."
            : "The embedding provider could not process this document. Retry later.",
      retryable: error.retryable,
    };
  }
  if (isMissingFileError(error) && stage === "read") {
    return {
      code: "ORIGINAL_FILE_MISSING",
      detail: "The original upload is unavailable. Upload the file again.",
      retryable: false,
    };
  }
  return {
    code:
      stage === "store"
        ? "DOCUMENT_STORAGE_FAILED"
        : "DOCUMENT_INGESTION_FAILED",
    detail:
      stage === "store"
        ? "Processed document data could not be saved. Retry later."
        : "The document could not be processed. Check the file and retry.",
    retryable: stage === "store",
  };
}

/**
 * Normalizes section labels for exact Atlas Vector Search filtering.
 */
function normalizeSection(section: string | null): string | null {
  return section?.trim().replace(/\s+/g, " ").toLocaleLowerCase() ?? null;
}

/**
 * Identifies an absent source file without exposing a filesystem path.
 */
function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
