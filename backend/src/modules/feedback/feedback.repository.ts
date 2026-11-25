import type {
  FeedbackRecord,
  SystemCollections,
} from "../../infra/jsonstore/system-collections";

export interface FeedbackRepositoryPort {
  findByMessageAndUser(
    messageId: string,
    userId: string,
  ): FeedbackRecord | null | Promise<FeedbackRecord | null>;
  listByCourse(courseId: string): FeedbackRecord[] | Promise<FeedbackRecord[]>;
  create(
    input: Omit<FeedbackRecord, "id" | "createdAt" | "updatedAt">,
  ): Promise<FeedbackRecord>;
  update(
    id: string,
    update: (current: FeedbackRecord) => FeedbackRecord,
  ): Promise<FeedbackRecord>;
}

export class FeedbackRepository implements FeedbackRepositoryPort {
  public constructor(private readonly collections: SystemCollections) {}

  public findByMessageAndUser(
    messageId: string,
    userId: string,
  ): FeedbackRecord | null {
    return (
      this.collections.feedback.findUnique(
        "messageUser",
        `${messageId}:${userId}`,
      ) ?? null
    );
  }

  public listByCourse(courseId: string): FeedbackRecord[] {
    return this.collections.feedback
      .list((record) => record.courseId === courseId)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  public create(input: Omit<FeedbackRecord, "id" | "createdAt" | "updatedAt">): Promise<FeedbackRecord> {
    const now = new Date().toISOString();
    return this.collections.feedback.insert({
      ...input,
      createdAt: now,
      updatedAt: now,
    });
  }

  public update(id: string, update: (current: FeedbackRecord) => FeedbackRecord): Promise<FeedbackRecord> {
    return this.collections.feedback.update(id, update);
  }
}
