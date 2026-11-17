import { AsyncMutex } from "../../infra/jsonstore/async-mutex";
import type {
  CourseRecord,
  DocumentRecord,
  EnrolmentRecord,
  SystemCollections,
} from "../../infra/jsonstore/system-collections";

export interface DocumentPage {
  items: DocumentRecord[];
  nextCursor: string | null;
}

/**
 * Provides document, course and enrolment access through validated JSON collections.
 */
export class JsonDocumentRepository {
  private readonly mutationMutex = new AsyncMutex();
  private readonly documentMutexes = new Map<string, AsyncMutex>();

  public constructor(private readonly collections: SystemCollections) {}

  /**
   * Serializes document workflows that span metadata, jobs and private files.
   */
  public withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    return this.mutationMutex.runExclusive(operation);
  }

  /**
   * Serializes state transitions and filesystem operations for one document.
   */
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

  /**
   * Finds a course record for upload and visibility policies.
   */
  public findCourse(id: string): CourseRecord | null {
    return this.collections.courses.getById(id);
  }

  /**
   * Finds a learner's enrolment in a course.
   */
  public findEnrolment(courseId: string, userId: string): EnrolmentRecord | null {
    return this.collections.enrolments.findUnique(
      "courseUser",
      `${courseId}:${userId}`,
    );
  }

  /**
   * Finds a document by its public identifier.
   */
  public findDocument(id: string): DocumentRecord | null {
    return this.collections.documents.getById(id);
  }

  /**
   * Returns a duplicate record, excluding documents already being deleted.
   */
  public findDuplicate(
    courseId: string,
    scope: DocumentRecord["scope"],
    ownerId: string,
    contentHash: string,
  ): DocumentRecord | null {
    return this.collections.documents.findUnique(
      "courseScopeOwnerHash",
      `${courseId}:${scope}:${ownerId}:${contentHash}`,
    );
  }

  /**
   * Inserts a validated document record.
   */
  public createDocument(
    input: Omit<DocumentRecord, "id">,
  ): Promise<DocumentRecord> {
    return this.collections.documents.insert(input);
  }

  /**
   * Applies one validated document state transition.
   */
  public updateDocument(
    id: string,
    update: (document: DocumentRecord) => DocumentRecord,
  ): Promise<DocumentRecord> {
    return this.collections.documents.update(id, update);
  }

  /**
   * Permanently removes a document metadata record.
   */
  public removeDocument(id: string): Promise<void> {
    return this.collections.documents.remove(id);
  }

  /**
   * Lists documents associated with a course for service-level visibility filtering.
   */
  public listDocumentsByCourse(courseId: string): DocumentRecord[] {
    return this.collections.documents.findByIndex("courseId", courseId);
  }

  /**
   * Returns a stable page of accessible document records.
   */
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
      nextCursor: hasMore ? items[items.length - 1]?.id ?? null : null,
    };
  }
}
