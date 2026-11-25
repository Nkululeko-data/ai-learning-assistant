import type {
  ActivityEventRecord,
  CourseRecord,
  FeedbackRecord,
  GapReportRecord,
  QuizAttemptRecord,
  SystemCollections,
} from "../../infra/jsonstore/system-collections";

export interface InsightsRepositoryPort {
  findCourse(courseId: string): CourseRecord | null | Promise<CourseRecord | null>;
  listFeedback(courseId: string): FeedbackRecord[] | Promise<FeedbackRecord[]>;
  listEvents(courseId: string): ActivityEventRecord[] | Promise<ActivityEventRecord[]>;
  listQuizAttempts(courseId: string): QuizAttemptRecord[] | Promise<QuizAttemptRecord[]>;
  recordActivity(
    input: Omit<ActivityEventRecord, "id" | "createdAt">,
  ): Promise<ActivityEventRecord>;
  listGapReports(courseId: string): GapReportRecord[] | Promise<GapReportRecord[]>;
  getLatestGapReport(courseId: string): GapReportRecord | null | Promise<GapReportRecord | null>;
  createGapReport(
    input: Omit<GapReportRecord, "id" | "createdAt">,
  ): Promise<GapReportRecord>;
}

export class InsightsRepository implements InsightsRepositoryPort {
  public constructor(private readonly collections: SystemCollections) {}

  public findCourse(courseId: string) {
    return this.collections.courses.getById(courseId);
  }

  public listFeedback(courseId: string) {
    return this.collections.feedback
      .list((record) => record.courseId === courseId);
  }

  public listEvents(courseId: string): ActivityEventRecord[] {
    return this.collections.activityEvents
      .list((record) => record.courseId === courseId);
  }

  public listQuizAttempts(courseId: string) {
    return this.collections.quizAttempts
      .list((record) => record.courseId === courseId);
  }

  public recordActivity(
    input: Omit<ActivityEventRecord, "id" | "createdAt">,
  ): Promise<ActivityEventRecord> {
    const existing = this.collections.activityEvents.findUnique(
      "dedupeKey",
      input.dedupeKey,
    );
    if (existing) return Promise.resolve(existing);
    return this.collections.activityEvents.insert({
      ...input,
      createdAt: new Date().toISOString(),
    });
  }

  public listGapReports(courseId: string): GapReportRecord[] {
    return this.collections.gapReports
      .list((record) => record.courseId === courseId)
      .sort((left, right) =>
        right.createdAt.localeCompare(left.createdAt),
      );
  }

  public getLatestGapReport(courseId: string): GapReportRecord | null {
    return this.listGapReports(courseId)[0] ?? null;
  }

  public async createGapReport(
    input: Omit<GapReportRecord, "id" | "createdAt">,
  ): Promise<GapReportRecord> {
    const created = await this.collections.gapReports.insert({
      ...input,
      createdAt: new Date().toISOString(),
    });
    const reports = this.listGapReports(input.courseId);
    const stale = reports.slice(10);
    for (const report of stale) {
      await this.collections.gapReports.remove(report.id);
    }
    return created;
  }
}
