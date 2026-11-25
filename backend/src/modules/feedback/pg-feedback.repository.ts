import { randomUUID } from "node:crypto";
import {
  feedbackSchema,
  type FeedbackRecord,
} from "../../infra/jsonstore/system-collections";
import { PgJsonRecordCollection } from "../../infra/postgres/json-record.repository";
import type { Pool } from "pg";
import type { FeedbackRepositoryPort } from "./feedback.repository";

/**
 * Stores feedback in PostgreSQL so all backend instances see the same records.
 */
export class PgFeedbackRepository implements FeedbackRepositoryPort {
  private readonly records: PgJsonRecordCollection<FeedbackRecord>;

  public constructor(pool: Pool) {
    this.records = new PgJsonRecordCollection(pool, "feedback", feedbackSchema);
  }

  public findByMessageAndUser(messageId: string, userId: string) {
    return this.records.findByFields({ messageId, userId });
  }

  public listByCourse(courseId: string) {
    return this.records.listByField("courseId", courseId);
  }

  public create(
    input: Omit<FeedbackRecord, "id" | "createdAt" | "updatedAt">,
  ) {
    const now = new Date().toISOString();
    return this.records.insert({ ...input, id: randomUUID(), createdAt: now, updatedAt: now });
  }

  public update(
    id: string,
    update: (current: FeedbackRecord) => FeedbackRecord,
  ) {
    return this.records.update(id, update);
  }
}
