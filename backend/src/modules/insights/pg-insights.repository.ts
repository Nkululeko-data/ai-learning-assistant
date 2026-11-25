import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  activityEventSchema,
  feedbackSchema,
  gapReportSchema,
  quizAttemptSchema,
  type ActivityEventRecord,
  type FeedbackRecord,
  type GapReportRecord,
  type QuizAttemptRecord,
} from "../../infra/jsonstore/system-collections";
import { PgJsonRecordCollection } from "../../infra/postgres/json-record.repository";
import type { CourseRepository } from "../courses/course.types";
import type { InsightsRepositoryPort } from "./insights.repository";

/**
 * Persists course insights and activity in PostgreSQL for all backend instances.
 */
export class PgInsightsRepository implements InsightsRepositoryPort {
  private readonly feedback: PgJsonRecordCollection<FeedbackRecord>;
  private readonly events: PgJsonRecordCollection<ActivityEventRecord>;
  private readonly attempts: PgJsonRecordCollection<QuizAttemptRecord>;
  private readonly reports: PgJsonRecordCollection<GapReportRecord>;

  public constructor(
    pool: Pool,
    private readonly courses: CourseRepository,
  ) {
    this.feedback = new PgJsonRecordCollection(pool, "feedback", feedbackSchema);
    this.events = new PgJsonRecordCollection(
      pool,
      "activityEvents",
      activityEventSchema,
    );
    this.attempts = new PgJsonRecordCollection(
      pool,
      "quizAttempts",
      quizAttemptSchema,
    );
    this.reports = new PgJsonRecordCollection(
      pool,
      "gapReports",
      gapReportSchema,
    );
  }

  public findCourse(courseId: string) {
    return this.courses.findCourseById(courseId);
  }

  public listFeedback(courseId: string) {
    return this.feedback.listByField("courseId", courseId);
  }

  public listEvents(courseId: string) {
    return this.events.listByField("courseId", courseId);
  }

  public listQuizAttempts(courseId: string) {
    return this.attempts.listByField("courseId", courseId);
  }

  public async recordActivity(
    input: Omit<ActivityEventRecord, "id" | "createdAt">,
  ): Promise<ActivityEventRecord> {
    const existing = await this.events.findByFields({
      dedupeKey: input.dedupeKey,
    });
    if (existing) return existing;
    const record = activityEventSchema.parse({
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    });
    try {
      return await this.events.insert(record);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const concurrent = await this.events.findByFields({
        dedupeKey: input.dedupeKey,
      });
      if (!concurrent) throw error;
      return concurrent;
    }
  }

  public async listGapReports(courseId: string): Promise<GapReportRecord[]> {
    const reports = await this.reports.listByField("courseId", courseId);
    return reports.sort((left, right) =>
      right.createdAt.localeCompare(left.createdAt),
    );
  }

  public async getLatestGapReport(
    courseId: string,
  ): Promise<GapReportRecord | null> {
    return (await this.listGapReports(courseId))[0] ?? null;
  }

  public async createGapReport(
    input: Omit<GapReportRecord, "id" | "createdAt">,
  ): Promise<GapReportRecord> {
    const created = await this.reports.insert({
      ...input,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
    });
    const stale = (await this.listGapReports(input.courseId)).slice(10);
    await Promise.all(stale.map((report) => this.reports.remove(report.id)));
    return created;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505"
  );
}
