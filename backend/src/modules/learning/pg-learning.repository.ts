import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { AsyncMutex } from "../../infra/jsonstore/async-mutex";
import {
  auditLogSchema,
  flashcardSchema,
  learningSummarySchema,
  quizAttemptSchema,
  quizSchema,
  type AuditLogRecord,
  type FlashcardRecord,
  type LearningSummaryRecord,
  type QuizAttemptRecord,
  type QuizRecord,
} from "../../infra/jsonstore/system-collections";
import { PgJsonRecordCollection } from "../../infra/postgres/json-record.repository";
import type { LearningRepositoryPort } from "./learning.repository";

/**
 * Persists generated learning content and attempts in shared PostgreSQL tables.
 */
export class PgLearningRepository implements LearningRepositoryPort {
  private readonly mutationMutex = new AsyncMutex();
  private readonly summaries: PgJsonRecordCollection<LearningSummaryRecord>;
  private readonly flashcards: PgJsonRecordCollection<FlashcardRecord>;
  private readonly quizzes: PgJsonRecordCollection<QuizRecord>;
  private readonly attempts: PgJsonRecordCollection<QuizAttemptRecord>;

  public constructor(private readonly pool: Pool) {
    this.summaries = new PgJsonRecordCollection(
      pool,
      "learningSummaries",
      learningSummarySchema,
    );
    this.flashcards = new PgJsonRecordCollection(
      pool,
      "flashcards",
      flashcardSchema,
    );
    this.quizzes = new PgJsonRecordCollection(pool, "quizzes", quizSchema);
    this.attempts = new PgJsonRecordCollection(
      pool,
      "quizAttempts",
      quizAttemptSchema,
    );
  }

  public withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
    return this.mutationMutex.runExclusive(operation);
  }

  public getSummary(id: string) {
    return this.summaries.getById(id);
  }

  public listSummaries(courseId: string) {
    return this.summaries.listByField("courseId", courseId);
  }

  public createSummary(input: Omit<LearningSummaryRecord, "id">) {
    return this.summaries.insert({ ...input, id: randomUUID() });
  }

  public updateSummary(
    id: string,
    update: (summary: LearningSummaryRecord) => LearningSummaryRecord,
    expectedVersion?: number,
  ) {
    return this.summaries.update(id, update, expectedVersion);
  }

  public getFlashcardSet(id: string) {
    return this.flashcards.getById(id);
  }

  public listFlashcardSets(courseId: string) {
    return this.flashcards.listByField("courseId", courseId);
  }

  public createFlashcardSet(input: Omit<FlashcardRecord, "id">) {
    return this.flashcards.insert({ ...input, id: randomUUID() });
  }

  public updateFlashcardSet(
    id: string,
    update: (flashcards: FlashcardRecord) => FlashcardRecord,
    expectedVersion?: number,
  ) {
    return this.flashcards.update(id, update, expectedVersion);
  }

  public getQuiz(id: string) {
    return this.quizzes.getById(id);
  }

  public listQuizzes(courseId: string) {
    return this.quizzes.listByField("courseId", courseId);
  }

  public createQuiz(input: Omit<QuizRecord, "id">) {
    return this.quizzes.insert({ ...input, id: randomUUID() });
  }

  public updateQuiz(
    id: string,
    update: (quiz: QuizRecord) => QuizRecord,
    expectedVersion?: number,
  ) {
    return this.quizzes.update(id, update, expectedVersion);
  }

  public removeQuiz(id: string) {
    return this.quizzes.remove(id);
  }

  public listAttemptsByQuiz(quizId: string) {
    return this.attempts.listByField("quizId", quizId);
  }

  public listAttemptsByUser(userId: string) {
    return this.attempts.listByField("userId", userId);
  }

  public createAttempt(input: Omit<QuizAttemptRecord, "id">) {
    return this.attempts.insert({ ...input, id: randomUUID() });
  }

  public async createAudit(
    input: Omit<AuditLogRecord, "id" | "createdAt">,
  ): Promise<AuditLogRecord> {
    const record = auditLogSchema.parse({
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    });
    await this.pool.query(
      `INSERT INTO audit_logs
       (id, actor_id, actor_role, action, target_type, target_id,
        before, after, request_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10)`,
      [
        record.id,
        record.actorId,
        record.actorRole,
        record.action,
        record.targetType,
        record.targetId,
        record.before ? JSON.stringify(record.before) : null,
        record.after ? JSON.stringify(record.after) : null,
        record.requestId ?? null,
        record.createdAt,
      ],
    );
    return record;
  }
}
