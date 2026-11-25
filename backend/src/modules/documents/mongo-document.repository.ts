import { randomUUID } from "node:crypto";
import type { Collection, Document as MongoDocument } from "mongodb";
import { ConflictError, NotFoundError } from "../../common/errors/app-error";
import type { CourseRepository } from "../courses/course.types";
import {
  documentSchema,
  type DocumentRecord,
} from "../../infra/jsonstore/system-collections";
import type { DocumentPage } from "./document.types";
import { AsyncMutex } from "../../infra/jsonstore/async-mutex";

export interface MongoDocumentRecord extends MongoDocument {
  _id: string;
  _version: number;
}

/**
 * Persists document metadata in MongoDB while keeping course access in Postgres.
 */
export class MongoDocumentRepository {
  private readonly mutationMutex = new AsyncMutex();
  private readonly documentMutexes = new Map<string, AsyncMutex>();

  public constructor(
    private readonly documents: Collection<MongoDocumentRecord>,
    private readonly courses: CourseRepository,
  ) {}

  public withCourseContentMutationLock<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.courses.withCourseContentMutationLock(operation);
  }

  public withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    return this.mutationMutex.runExclusive(operation);
  }

  public withDocumentLock<T>(
    documentId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    let mutex = this.documentMutexes.get(documentId);
    if (!mutex) {
      mutex = new AsyncMutex();
      this.documentMutexes.set(documentId, mutex);
    }
    return mutex.runExclusive(operation);
  }

  public findCourse(id: string) {
    return this.courses.findCourseById(id);
  }

  public findEnrolment(courseId: string, userId: string) {
    return this.courses.findEnrolment(courseId, userId);
  }

  public async findDocument(id: string): Promise<DocumentRecord | null> {
    const record = await this.documents.findOne({ _id: id });
    return record ? toDocumentRecord(record) : null;
  }

  public async isCourseLessonMediaReferenced(
    documentId: string,
  ): Promise<boolean> {
    const document = await this.findDocument(documentId);
    if (!document) return false;
    const course = await this.courses.findCourseById(document.courseId);
    return Boolean(
      course?.lessons?.some(
        (lesson) =>
          lesson.pdfDocumentId === documentId ||
          lesson.videoDocumentId === documentId,
      ),
    );
  }

  public async findDuplicate(
    courseId: string,
    scope: DocumentRecord["scope"],
    ownerId: string,
    contentHash: string,
  ): Promise<DocumentRecord | null> {
    const record = await this.documents.findOne({
      courseId,
      scope,
      ownerId,
      contentHash,
      status: { $ne: "deleting" },
    });
    return record ? toDocumentRecord(record) : null;
  }

  public async createDocument(
    input: Omit<DocumentRecord, "id">,
  ): Promise<DocumentRecord> {
    const record = documentSchema.parse({ ...input, id: randomUUID() });
    try {
      await this.documents.insertOne({
        ...record,
        _id: record.id,
        _version: 1,
      });
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new ConflictError("This file has already been uploaded");
      }
      throw error;
    }
    return record;
  }

  public async updateDocument(
    id: string,
    update: (document: DocumentRecord) => DocumentRecord,
  ): Promise<DocumentRecord> {
    for (;;) {
      const current = await this.documents.findOne({ _id: id });
      if (!current) throw new NotFoundError("Document not found");
      const updated = documentSchema.parse(update(toDocumentRecord(current)));
      const { id: _id, ...fields } = updated;
      const result = await this.documents.findOneAndUpdate(
        { _id: id, _version: current._version },
        { $set: fields, $inc: { _version: 1 } },
        { returnDocument: "after" },
      );
      if (result) return toDocumentRecord(result);
    }
  }

  public async removeDocument(id: string): Promise<void> {
    await this.documents.deleteOne({ _id: id });
  }

  public async listDocumentsByCourse(
    courseId: string,
  ): Promise<DocumentRecord[]> {
    const records = await this.documents
      .find({ courseId })
      .sort({ _id: 1 })
      .toArray();
    return records.map(toDocumentRecord);
  }

  public async listPersonalDocumentsByOwner(
    ownerId: string,
  ): Promise<DocumentRecord[]> {
    const records = await this.documents
      .find({ scope: "personal", ownerId })
      .sort({ _id: 1 })
      .toArray();
    return records.map(toDocumentRecord);
  }

  public listPage(
    records: DocumentRecord[],
    limit: number,
    cursor?: string,
  ): DocumentPage {
    const ordered = records
      .filter((document) => !cursor || document.id > cursor)
      .sort((left, right) => left.id.localeCompare(right.id))
      .slice(0, limit + 1);
    const hasMore = ordered.length > limit;
    const items = hasMore ? ordered.slice(0, limit) : ordered;
    return {
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
    };
  }
}

/**
 * Converts Mongo metadata to its validated domain representation.
 */
function toDocumentRecord(record: MongoDocumentRecord): DocumentRecord {
  const { _id, _version: _version, ...fields } = record;
  return documentSchema.parse({ ...fields, id: _id });
}

/**
 * Identifies duplicate-key failures without hiding unrelated database errors.
 */
function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}
