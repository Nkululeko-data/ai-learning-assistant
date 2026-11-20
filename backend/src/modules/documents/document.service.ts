import { AppError, ConflictError, NotFoundError } from "../../common/errors/app-error";
import type { AppConfig } from "../../config/config";
import type { DocumentRecord } from "../../infra/jsonstore/system-collections";
import type { AuthenticatedUser } from "../auth/auth.types";
import type { JobService } from "../jobs/job.service";
import type { DocumentListQuery } from "./document.schemas";
import { JsonDocumentRepository } from "./document.types";
import { PrivateFileStorage } from "../../infra/storage/private-file-storage";
import {
  validateDocumentUpload,
  validateLessonVideoUpload,
} from "./document.validation";

export interface DocumentView {
  id: string;
  courseId: string;
  scope: DocumentRecord["scope"];
  filename: string;
  mimeType: DocumentRecord["mimeType"];
  sizeBytes: number;
  status: DocumentRecord["status"];
  errorCode: string | null;
  errorDetail: string | null;
  extractionDiagnostics: DocumentRecord["extractionDiagnostics"];
  chunkCount: number | null;
  embeddingModel: string | null;
  ingestJobId: string | null;
  createdAt: string;
  updatedAt: string;
  readyAt: string | null;
}

/**
 * Enforces document ownership and lifecycle rules around private storage and jobs.
 */
export class DocumentService {
  public constructor(
    private readonly repository: JsonDocumentRepository,
    private readonly storage: PrivateFileStorage,
    private readonly jobs: JobService,
    private readonly config: AppConfig,
  ) {}

  /**
   * Validates, stores and queues a document without returning content or storage paths.
   */
  public async upload(
    actor: AuthenticatedUser,
    input: { courseId: string; scope: DocumentRecord["scope"] },
    file: Express.Multer.File,
    requestId: string,
  ): Promise<DocumentView> {
    const course = this.requireCourse(input.courseId);
    this.assertCanUpload(actor, course, input.scope);
    const validated = await validateDocumentUpload(file, this.config.maxDocxExpandedSizeBytes);
    if (this.repository.findDuplicate(input.courseId, input.scope, actor.id, validated.contentHash)) {
      throw new ConflictError("This file has already been uploaded");
    }

    const storageKey = await this.storage.storeUpload(file.buffer);
    let document: DocumentRecord | null = null;
    try {
      const timestamp = new Date().toISOString();
      document = await this.repository.createDocument({
        courseId: input.courseId,
        ownerId: actor.id,
        scope: input.scope,
        filename: validated.filename,
        storageKey,
        mimeType: validated.mimeType,
        sizeBytes: validated.sizeBytes,
        contentHash: validated.contentHash,
        status: "uploaded",
        errorCode: null,
        errorDetail: null,
        extractionDiagnostics: null,
        chunkCount: null,
        embeddingModel: null,
        ingestJobId: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        readyAt: null,
      });

      const job = await this.jobs.enqueue({
        type: "ingest",
        payload: { documentId: document.id },
        createdBy: actor.id,
        requestId,
      });
      document = await this.repository.updateDocument(document.id, (current) => ({
        ...current,
        ingestJobId: job.id,
        updatedAt: new Date().toISOString(),
      }));
      return toDocumentView(document);
    } catch (error) {
      const cleanupErrors: unknown[] = [];
      if (document) {
        try {
          await this.repository.removeDocument(document.id);
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
      }
      try {
        await this.storage.removeUpload(storageKey);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [error, ...cleanupErrors],
          "Document upload failed and its temporary state could not be fully removed",
        );
      }
      throw error;
    }
  }

  /**
   * Stores a course-owner MP4 as ready lesson media without sending it to ingestion.
   */
  public async uploadCourseLessonVideo(
    actor: AuthenticatedUser,
    courseId: string,
    file: Express.Multer.File,
  ): Promise<DocumentView> {
    const course = this.requireCourse(courseId);
    this.assertCanUpload(actor, course, "course");
    if (!actor.permissions.includes("course:edit")) {
      throw new AppError("FORBIDDEN", 403, "The required permission is not granted");
    }
    const validated = await validateLessonVideoUpload(file);

    return this.repository.withMutationLock(async () => {
      if (
        this.repository.findDuplicate(
          courseId,
          "course",
          actor.id,
          validated.contentHash,
        )
      ) {
        throw new ConflictError(
          "This video has already been uploaded; select it from the course files",
        );
      }

      const storageKey = await this.storage.storeUpload(file.buffer);
      try {
        const timestamp = new Date().toISOString();
        const document = await this.repository.createDocument({
          courseId,
          ownerId: actor.id,
          scope: "course",
          filename: validated.filename,
          storageKey,
          mimeType: validated.mimeType,
          sizeBytes: validated.sizeBytes,
          contentHash: validated.contentHash,
          status: "ready",
          errorCode: null,
          errorDetail: null,
          extractionDiagnostics: null,
          chunkCount: null,
          embeddingModel: null,
          ingestJobId: null,
          createdAt: timestamp,
          updatedAt: timestamp,
          readyAt: timestamp,
        });
        return toDocumentView(document);
      } catch (error) {
        try {
          await this.storage.removeUpload(storageKey);
        } catch (cleanupError) {
          throw new AggregateError(
            [error, cleanupError],
            "Lesson video upload failed and its temporary file could not be removed",
          );
        }
        throw error;
      }
    });
  }

  /**
   * Returns safe document metadata only to the uploader or an approved course member.
   */
  public getStatus(actor: AuthenticatedUser, documentId: string): DocumentView {
    const document = this.requireVisibleDocument(actor, documentId);
    return toDocumentView(document);
  }

  /**
   * Reads a ready course PDF only for the owner or an approved course learner.
   */
  public async getCourseFile(
    actor: AuthenticatedUser,
    documentId: string,
  ): Promise<{
    bytes: Buffer;
    filename: string;
    mimeType: "application/pdf" | "video/mp4";
  }> {
    const document = this.requireVisibleDocument(actor, documentId);
    if (
      document.scope !== "course" ||
      (document.mimeType !== "application/pdf" && document.mimeType !== "video/mp4") ||
      document.status !== "ready"
    ) {
      throw new NotFoundError("Course file not found");
    }
    return {
      bytes: await this.storage.readUpload(document.storageKey),
      filename: document.filename,
      mimeType: document.mimeType,
    };
  }

  /**
   * Lists course documents and only the caller's own personal notes.
   */
  public listForCourse(
    actor: AuthenticatedUser,
    courseId: string,
    query: DocumentListQuery,
  ): { items: DocumentView[]; nextCursor: string | null } {
    const course = this.requireCourse(courseId);
    this.assertCanViewCourse(actor, course.id);
    const visible = this.repository
      .listDocumentsByCourse(courseId)
      .filter((document) => document.scope === "course" || document.ownerId === actor.id);
    const page = this.repository.listPage(visible, query.limit, query.cursor);
    return {
      items: page.items.map(toDocumentView),
      nextCursor: page.nextCursor,
    };
  }

  /**
   * Requeues a failed document using its existing terminal job when possible.
   */
  public async retry(actor: AuthenticatedUser, documentId: string, requestId: string): Promise<DocumentView> {
    return this.repository.withDocumentLock(documentId, async () => {
      const document = this.requireManageableDocument(actor, documentId, "document:upload");
      if (document.status !== "failed") {
        throw new ConflictError("Only failed documents can be retried");
      }
      const course = this.requireCourse(document.courseId);
      if (course.status !== "active") {
        throw new AppError("COURSE_ARCHIVED", 409, "Documents in archived courses cannot be retried");
      }

      const jobStatus = document.ingestJobId ? this.jobs.getJobStatus(document.ingestJobId) : null;
      if (jobStatus === "queued" || jobStatus === "running") {
        throw new ConflictError("Document ingestion is already queued");
      }

      const updated = await this.repository.updateDocument(document.id, (current) => ({
        ...current,
        status: "uploaded",
        errorCode: null,
        errorDetail: null,
        updatedAt: new Date().toISOString(),
      }));
      try {
        if (updated.ingestJobId && (jobStatus === "failed" || jobStatus === "dead")) {
          await this.jobs.retryJob(updated.ingestJobId);
        } else {
          const job = await this.jobs.enqueue({
            type: "ingest",
            payload: { documentId: document.id },
            createdBy: actor.id,
            requestId,
          });
          await this.repository.updateDocument(document.id, (current) => ({
            ...current,
            ingestJobId: job.id,
            updatedAt: new Date().toISOString(),
          }));
        }
      } catch (error) {
        await this.repository.updateDocument(document.id, (current) => ({
          ...current,
          status: document.status,
          errorCode: document.errorCode ?? null,
          errorDetail: document.errorDetail ?? null,
          updatedAt: new Date().toISOString(),
        }));
        throw error;
      }
      return toDocumentView(this.repository.findDocument(document.id) ?? updated);
    });
  }

  /**
   * Marks a document deleting and durably queues its private-file cleanup.
   */
  public async delete(
    actor: AuthenticatedUser,
    documentId: string,
    requestId: string,
  ): Promise<{ id: string; status: "deleting"; cleanupJobId: string }> {
    return this.repository.withCourseContentMutationLock(() =>
      this.repository.withDocumentLock(documentId, async () => {
        const document = this.requireManageableDocument(actor, documentId, "document:delete");
        if (this.repository.isCourseLessonMediaReferenced(document.id)) {
          throw new ConflictError("Remove this file from its course lesson before deleting it");
        }
        const updated = await this.repository.updateDocument(document.id, (current) => ({
          ...current,
          status: "deleting",
          updatedAt: new Date().toISOString(),
        }));
        try {
          const cleanupJob = await this.jobs.enqueue({
            type: "cleanup",
            payload: { documentId: document.id },
            createdBy: actor.id,
            requestId,
          });
          return {
            id: document.id,
            status: "deleting",
            cleanupJobId: cleanupJob.id,
          };
        } catch (error) {
          await this.repository.updateDocument(document.id, (current) => ({
            ...current,
            status: updated.status,
            updatedAt: new Date().toISOString(),
          }));
          throw error;
        }
      }),
    );
  }

  /**
   * Finds a document visible to the caller while hiding protected resource existence.
   */
  private requireVisibleDocument(actor: AuthenticatedUser, documentId: string): DocumentRecord {
    const document = this.repository.findDocument(documentId);
    if (!document || actor.status !== "active" || actor.role === "admin") {
      throw new NotFoundError("Document not found");
    }
    if (document.scope === "personal") {
      if (document.ownerId !== actor.id) throw new NotFoundError("Document not found");
      return document;
    }
    this.assertCanViewCourse(actor, document.courseId);
    return document;
  }

  /**
   * Finds a document the caller may manage for retry or deletion.
   */
  private requireManageableDocument(
    actor: AuthenticatedUser,
    documentId: string,
    requiredPermission: "document:upload" | "document:delete",
  ): DocumentRecord {
    const document = this.repository.findDocument(documentId);
    if (!document || actor.status !== "active" || actor.role === "admin") {
      throw new NotFoundError("Document not found");
    }
    if (!actor.permissions.includes(requiredPermission)) {
      throw new AppError("FORBIDDEN", 403, "The required permission is not granted");
    }
    if (document.scope === "personal") {
      if (document.ownerId !== actor.id || actor.role !== "learner") {
        throw new NotFoundError("Document not found");
      }
      return document;
    }
    const course = this.requireCourse(document.courseId);
    if (actor.role !== "coach" || course.ownerId !== actor.id) {
      throw new NotFoundError("Document not found");
    }
    return document;
  }

  /**
   * Validates role, permission, course ownership and enrolment for upload.
   */
  private assertCanUpload(
    actor: AuthenticatedUser,
    course: NonNullable<ReturnType<JsonDocumentRepository["findCourse"]>>,
    scope: DocumentRecord["scope"],
  ): void {
    if (actor.status !== "active") {
      throw new AppError("FORBIDDEN", 403, "An active account is required");
    }
    if (!actor.permissions.includes("document:upload")) {
      throw new AppError("FORBIDDEN", 403, "The required permission is not granted");
    }
    if (course.status !== "active") {
      throw new AppError("COURSE_ARCHIVED", 409, "Documents cannot be uploaded to archived courses");
    }
    if (scope === "course") {
      if (actor.role !== "coach" || course.ownerId !== actor.id) {
        throw new NotFoundError("Course not found");
      }
      return;
    }
    if (actor.role !== "learner" || this.repository.findEnrolment(course.id, actor.id)?.status !== "approved") {
      throw new NotFoundError("Course not found");
    }
  }

  /**
   * Allows course-owner coaches and active, approved learners while excluding admins.
   */
  private assertCanViewCourse(actor: AuthenticatedUser, courseId: string): void {
    if (actor.status !== "active" || actor.role === "admin") {
      throw new NotFoundError("Course not found");
    }
    const course = this.requireCourse(courseId);
    if (course.ownerId === actor.id && actor.role === "coach") return;
    if (actor.role === "learner" && this.repository.findEnrolment(course.id, actor.id)?.status === "approved") {
      return;
    }
    throw new NotFoundError("Course not found");
  }

  /**
   * Resolves a course without exposing missing-course details to document callers.
   */
  private requireCourse(courseId: string) {
    const course = this.repository.findCourse(courseId);
    if (!course) throw new NotFoundError("Course not found");
    return course;
  }
}

/**
 * Projects only safe document metadata; hashes, storage keys and extracted text stay private.
 */
export function toDocumentView(document: DocumentRecord): DocumentView {
  return {
    id: document.id,
    courseId: document.courseId,
    scope: document.scope,
    filename: document.filename,
    mimeType: document.mimeType,
    sizeBytes: document.sizeBytes,
    status: document.status,
    errorCode: document.errorCode ?? null,
    errorDetail: document.errorDetail ?? null,
    extractionDiagnostics: document.extractionDiagnostics ?? null,
    chunkCount: document.chunkCount ?? null,
    embeddingModel: document.embeddingModel ?? null,
    ingestJobId: document.ingestJobId ?? null,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    readyAt: document.readyAt ?? null,
  };
}
