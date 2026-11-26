import { NotFoundError } from "../../common/errors/app-error";
import type { AuthenticatedUser } from "../auth/auth.types";
import type { AppConfig } from "../../config/config";
import type { JobService } from "../jobs/job.service";
import type { InsightsRepository } from "./insights.repository";
import type { ActivityEventRecord, GapReportRecord } from "../../infra/jsonstore/system-collections";

export interface CourseInsights {
  courseId: string;
  periodStart: string;
  periodEnd: string;
  minCohortSizeUsed: number;
  cohortQualified: boolean;
  distinctLearnerCount: number;
  questionCount: number | null;
  insufficientQuestionCount: number | null;
  helpfulFeedbackCount: number | null;
  notHelpfulFeedbackCount: number | null;
  quizAttemptCount: number | null;
  quizAverageScore: number | null;
}

export class InsightsService {
  public constructor(
    private readonly repository: InsightsRepository,
    private readonly jobs: JobService,
    private readonly config: AppConfig,
  ) {}

  public recordActivity(
    input: Omit<ActivityEventRecord, "id" | "createdAt">,
  ): Promise<ActivityEventRecord> {
    return this.repository.recordActivity(input);
  }

  public getInsights(
    actor: AuthenticatedUser,
    courseId: string,
  ): CourseInsights {
    const course = this.requireOwnedCourse(actor, courseId);
    const periodEnd = new Date();
    const periodStart = new Date(
      periodEnd.getTime() - this.config.insightPeriodDays * 24 * 60 * 60 * 1000,
    );
    const startIso = periodStart.toISOString();
    const endIso = periodEnd.toISOString();
    const events = this.repository
      .listEvents(course.id)
      .filter((event) => event.createdAt >= startIso && event.createdAt <= endIso);
    const feedback = this.repository
      .listFeedback(course.id)
      .filter((record) => record.createdAt >= startIso && record.createdAt <= endIso);
    const attempts = this.repository
      .listQuizAttempts(course.id)
      .filter(
        (record) =>
          record.submittedAt !== null &&
          record.submittedAt !== undefined &&
          record.submittedAt >= startIso &&
          record.submittedAt <= endIso,
      );

    const learnerIds = new Set([
      ...events.map((event) => event.userId),
      ...feedback.map((record) => record.userId),
      ...attempts.map((record) => record.userId),
    ]);
    const cohortQualified =
      learnerIds.size >= this.config.insightMinCohortSize;

    if (!cohortQualified) {
      return {
        courseId,
        periodStart: startIso,
        periodEnd: endIso,
        minCohortSizeUsed: this.config.insightMinCohortSize,
        cohortQualified: false,
        distinctLearnerCount: learnerIds.size,
        questionCount: null,
        insufficientQuestionCount: null,
        helpfulFeedbackCount: null,
        notHelpfulFeedbackCount: null,
        quizAttemptCount: null,
        quizAverageScore: null,
      };
    }

    const questions = events.filter((event) => event.type === "question");
    const insufficient = questions.filter(
      (event) => event.groundingStatus === "insufficient",
    );
    const score =
      attempts.length === 0
        ? null
        : attempts.reduce(
            (total, attempt) => total + attempt.score / attempt.maxScore,
            0,
          ) / attempts.length;

    return {
      courseId,
      periodStart: startIso,
      periodEnd: endIso,
      minCohortSizeUsed: this.config.insightMinCohortSize,
      cohortQualified: true,
      distinctLearnerCount: learnerIds.size,
      questionCount: questions.length,
      insufficientQuestionCount: insufficient.length,
      helpfulFeedbackCount: feedback.filter((record) => record.rating === "helpful").length,
      notHelpfulFeedbackCount: feedback.filter((record) => record.rating === "not_helpful").length,
      quizAttemptCount: attempts.length,
      quizAverageScore: score,
    };
  }

  public getLatestGapReport(
    actor: AuthenticatedUser,
    courseId: string,
  ): GapReportRecord | null {
    this.requireOwnedCourse(actor, courseId);
    return this.repository.getLatestGapReport(courseId);
  }

  public async refreshGapReport(
    actor: AuthenticatedUser,
    courseId: string,
    requestId: string,
  ) {
    this.requireOwnedCourse(actor, courseId);
    return this.jobs.enqueue({
      type: "cluster",
      payload: { courseId },
      createdBy: actor.id,
      requestId,
      scheduleKey: `gap:${courseId}:${new Date().toISOString().slice(0, 10)}`,
    });
  }

  private requireOwnedCourse(actor: AuthenticatedUser, courseId: string) {
    const course = this.repository.findCourse(courseId);
    if (!course) throw new NotFoundError("Course not found");
    if (course.ownerId !== actor.id) {
      throw new NotFoundError("Course not found");
    }
    return course;
  }

  public async generateGapReport(courseId: string): Promise<GapReportRecord> {
    const course = this.repository.findCourse(courseId);
    if (!course) throw new NotFoundError("Course not found");
    const periodEnd = new Date();
    const periodStart = new Date(
      periodEnd.getTime() - this.config.insightPeriodDays * 24 * 60 * 60 * 1000,
    );
    const events = this.repository
      .listEvents(courseId)
      .filter(
        (event) =>
          event.type === "question" &&
          event.groundingStatus === "insufficient" &&
          event.createdAt >= periodStart.toISOString() &&
          event.createdAt <= periodEnd.toISOString(),
      );
    const distinctLearnerIds = new Set(events.map((event) => event.userId));
    const qualified =
      distinctLearnerIds.size >= this.config.insightMinCohortSize;
    const previousReports = this.repository
      .listGapReports(courseId)
      .filter((report) => report.createdAt < periodStart.toISOString());
    const previousCount =
      previousReports[0]?.topics[0]?.questionCount ?? null;
    const count = qualified ? events.length : 0;

    return this.repository.createGapReport({
      courseId,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      totalGapQuestions: events.length,
      minCohortSizeUsed: this.config.insightMinCohortSize,
      topics: qualified
        ? [
            {
              topicId: "insufficient-grounding",
              theme: "Insufficient grounded answers",
              questionCount: count,
              distinctLearnerCount: distinctLearnerIds.size,
              suggestedAction:
                "Review course materials and add content addressing recurring unanswered questions.",
              trend:
                previousCount === null
                  ? "new"
                  : count > previousCount
                    ? "up"
                    : count < previousCount
                      ? "down"
                      : "flat",
              previousCount,
            },
          ]
        : [],
      otherCount: qualified ? 0 : events.length,
      generatedBy: null,
    });
  }
}
