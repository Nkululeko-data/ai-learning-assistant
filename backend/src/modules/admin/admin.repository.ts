import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  activityEventSchema,
  auditLogSchema,
  configVersionSchema,
  feedbackSchema,
  flashcardSchema,
  learningSummarySchema,
  quizAttemptSchema,
  quizSchema,
  agentExecutionSchema,
  type ActivityEventRecord,
  type AuditLogRecord,
  type ConfigVersionRecord,
  type FeedbackRecord,
  type FlashcardRecord,
  type LearningSummaryRecord,
  type QuizAttemptRecord,
  type QuizRecord,
  type SystemCollections,
  type AgentExecutionRecord,
} from "../../infra/jsonstore/system-collections";
import { PgJsonRecordCollection } from "../../infra/postgres/json-record.repository";

type MaybePromise<T> = T | Promise<T>;

export interface AdminRepository {
  listAuditLogs(limit: number, cursor?: string): MaybePromise<{ items: AuditLogRecord[]; nextCursor?: string }>;
  listExecutions(limit: number, cursor?: string): MaybePromise<{ items: AgentExecutionRecord[]; nextCursor?: string }>;
  getLatestConfigVersion(): MaybePromise<ConfigVersionRecord | null>;
  createConfigVersion(
    input: Omit<ConfigVersionRecord, "id">,
  ): Promise<ConfigVersionRecord>;
  createAudit(input: Omit<AuditLogRecord, "id" | "createdAt">): Promise<void>;
  listPrivateSummaries(userId: string): MaybePromise<LearningSummaryRecord[]>;
  listPrivateFlashcards(userId: string): MaybePromise<FlashcardRecord[]>;
  listPrivateQuizzes(userId: string): MaybePromise<QuizRecord[]>;
  listAttemptsByUser(userId: string): MaybePromise<QuizAttemptRecord[]>;
  listFeedbackByUser(userId: string): MaybePromise<FeedbackRecord[]>;
  listActivityByUser(userId: string): MaybePromise<ActivityEventRecord[]>;
  removeLearningSummary(id: string): Promise<void>;
  removeFlashcards(id: string): Promise<void>;
  removeQuiz(id: string): Promise<void>;
  removeQuizAttempt(id: string): Promise<void>;
  anonymizeFeedback(id: string, pseudonymId: string): Promise<void>;
  anonymizeActivity(id: string, pseudonymId: string): Promise<void>;
}

/**
 * Preserves legacy JSON-backed admin behavior for tests and pre-cutover tooling.
 */
export class JsonAdminRepository implements AdminRepository {
  public constructor(private readonly collections: SystemCollections) {}

  public listAuditLogs(limit: number, cursor?: string) {
    const records = this.collections.auditLogs
      .list()
      .filter((record) => record.id >= (cursor ?? ""))
      .sort((left, right) => left.id.localeCompare(right.id));
    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;
    const last = items.at(-1);
    return {
      items,
      ...(hasMore && last
        ? { nextCursor: Buffer.from(last.id).toString("base64url") }
        : {}),
    };
  }

  public listExecutions(limit: number, cursor?: string) {
    const records = this.collections.agentExecutions
      .list()
      .filter((record) => record.id >= (cursor ?? ""))
      .sort((left, right) => left.id.localeCompare(right.id));
    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;
    const last = items.at(-1);
    return {
      items,
      ...(hasMore && last
        ? { nextCursor: Buffer.from(last.id).toString("base64url") }
        : {}),
    };
  }

  public getLatestConfigVersion() {
    return (
      this.collections.configVersions
        .list()
        .sort((left, right) => right.version - left.version)[0] ?? null
    );
  }

  public createConfigVersion(input: Omit<ConfigVersionRecord, "id">) {
    return this.collections.configVersions.insert(input);
  }

  public async createAudit(
    input: Omit<AuditLogRecord, "id" | "createdAt">,
  ): Promise<void> {
    await this.collections.auditLogs.insert({
      ...input,
      createdAt: new Date().toISOString(),
    });
  }

  public listPrivateSummaries(userId: string) {
    return this.collections.learningSummaries.list(
      (record) => record.visibility === "private" && record.ownerId === userId,
    );
  }

  public listPrivateFlashcards(userId: string) {
    return this.collections.flashcards.list(
      (record) => record.visibility === "private" && record.ownerId === userId,
    );
  }

  public listPrivateQuizzes(userId: string) {
    return this.collections.quizzes.list(
      (record) => record.visibility === "private" && record.ownerId === userId,
    );
  }

  public listAttemptsByUser(userId: string) {
    return this.collections.quizAttempts.list(
      (record) => record.userId === userId,
    );
  }

  public listFeedbackByUser(userId: string) {
    return this.collections.feedback.list((record) => record.userId === userId);
  }

  public listActivityByUser(userId: string) {
    return this.collections.activityEvents.list(
      (record) => record.userId === userId,
    );
  }

  public removeLearningSummary(id: string) {
    return this.collections.learningSummaries.remove(id);
  }

  public removeFlashcards(id: string) {
    return this.collections.flashcards.remove(id);
  }

  public removeQuiz(id: string) {
    return this.collections.quizzes.remove(id);
  }

  public removeQuizAttempt(id: string) {
    return this.collections.quizAttempts.remove(id);
  }

  public async anonymizeFeedback(
    id: string,
    pseudonymId: string,
  ): Promise<void> {
    await this.collections.feedback.update(id, (record) => ({
      ...record,
      userId: pseudonymId,
      updatedAt: new Date().toISOString(),
    }));
  }

  public async anonymizeActivity(
    id: string,
    pseudonymId: string,
  ): Promise<void> {
    await this.collections.activityEvents.update(id, (record) => ({
      ...record,
      userId: pseudonymId,
    }));
  }
}

/**
 * Persists administrative records in the shared PostgreSQL database.
 */
export class PgAdminRepository implements AdminRepository {
  private readonly summaries: PgJsonRecordCollection<LearningSummaryRecord>;
  private readonly flashcards: PgJsonRecordCollection<FlashcardRecord>;
  private readonly quizzes: PgJsonRecordCollection<QuizRecord>;
  private readonly attempts: PgJsonRecordCollection<QuizAttemptRecord>;
  private readonly feedback: PgJsonRecordCollection<FeedbackRecord>;
  private readonly activity: PgJsonRecordCollection<ActivityEventRecord>;
  private readonly configs: PgJsonRecordCollection<ConfigVersionRecord>;
  private readonly executions: PgJsonRecordCollection<AgentExecutionRecord>;

  public constructor(private readonly pool: Pool) {
    this.summaries = new PgJsonRecordCollection(pool, "learningSummaries", learningSummarySchema);
    this.flashcards = new PgJsonRecordCollection(pool, "flashcards", flashcardSchema);
    this.quizzes = new PgJsonRecordCollection(pool, "quizzes", quizSchema);
    this.attempts = new PgJsonRecordCollection(pool, "quizAttempts", quizAttemptSchema);
    this.feedback = new PgJsonRecordCollection(pool, "feedback", feedbackSchema);
    this.activity = new PgJsonRecordCollection(pool, "activityEvents", activityEventSchema);
    this.configs = new PgJsonRecordCollection(pool, "configVersions", configVersionSchema);
    this.executions = new PgJsonRecordCollection(pool, "agentExecutions", agentExecutionSchema);
  }

  public listAuditLogs(limit: number, cursor?: string) {
    return this.listSqlRecords<AuditLogRecord>(
      `SELECT id, actor_id, actor_role, action, target_type, target_id,
              before, after, request_id, created_at
       FROM audit_logs WHERE id >= $1 ORDER BY id ASC LIMIT $2`,
      [cursor ?? "", limit + 1],
      mapAudit,
      limit,
    );
  }

  public async listExecutions(limit: number, cursor?: string) {
    const records = (await this.executions.list())
      .filter((record) => record.id >= (cursor ?? ""))
      .sort((left, right) => left.id.localeCompare(right.id));
    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;
    const last = items.at(-1);
    return {
      items,
      ...(hasMore && last
        ? { nextCursor: Buffer.from(last.id).toString("base64url") }
        : {}),
    };
  }

  public async getLatestConfigVersion() {
    const records = await this.configs.list();
    return records.sort((left, right) => right.version - left.version)[0] ?? null;
  }

  public createConfigVersion(input: Omit<ConfigVersionRecord, "id">) {
    return this.configs.insert({ ...input, id: randomUUID() });
  }

  public async createAudit(
    input: Omit<AuditLogRecord, "id" | "createdAt">,
  ): Promise<void> {
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
  }

  public listPrivateSummaries(userId: string) {
    return this.summaries.listByFields({ ownerId: userId, visibility: "private" });
  }

  public listPrivateFlashcards(userId: string) {
    return this.flashcards.listByFields({ ownerId: userId, visibility: "private" });
  }

  public listPrivateQuizzes(userId: string) {
    return this.quizzes.listByFields({ ownerId: userId, visibility: "private" });
  }

  public listAttemptsByUser(userId: string) {
    return this.attempts.listByField("userId", userId);
  }

  public listFeedbackByUser(userId: string) {
    return this.feedback.listByField("userId", userId);
  }

  public listActivityByUser(userId: string) {
    return this.activity.listByField("userId", userId);
  }

  public removeLearningSummary(id: string) {
    return this.summaries.remove(id);
  }

  public removeFlashcards(id: string) {
    return this.flashcards.remove(id);
  }

  public removeQuiz(id: string) {
    return this.quizzes.remove(id);
  }

  public removeQuizAttempt(id: string) {
    return this.attempts.remove(id);
  }

  public async anonymizeFeedback(id: string, pseudonymId: string): Promise<void> {
    await this.feedback.update(id, (record) => ({
      ...record,
      userId: pseudonymId,
      updatedAt: new Date().toISOString(),
    }));
  }

  public async anonymizeActivity(id: string, pseudonymId: string): Promise<void> {
    await this.activity.update(id, (record) => ({
      ...record,
      userId: pseudonymId,
    }));
  }

  private async listSqlRecords<T>(
    sql: string,
    values: unknown[],
    map: (row: Record<string, unknown>) => T,
    limit: number,
  ): Promise<{ items: T[]; nextCursor?: string }> {
    const result = await this.pool.query(sql, values);
    const hasMore = result.rows.length > limit;
    const items = (hasMore ? result.rows.slice(0, limit) : result.rows).map(
      (row) => map(row as Record<string, unknown>),
    );
    const last = items.at(-1) as { id?: string } | undefined;
    return {
      items,
      ...(hasMore && last?.id
        ? { nextCursor: Buffer.from(last.id).toString("base64url") }
        : {}),
    };
  }
}

function mapAudit(row: Record<string, unknown>): AuditLogRecord {
  return auditLogSchema.parse({
    id: row.id,
    actorId: row.actor_id,
    actorRole: row.actor_role,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    before: row.before,
    after: row.after,
    requestId: row.request_id,
    createdAt:
      row.created_at instanceof Date
        ? row.created_at.toISOString()
        : row.created_at,
  });
}
