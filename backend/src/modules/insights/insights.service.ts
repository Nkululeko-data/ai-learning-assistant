import { NotFoundError } from "../../common/errors/app-error";
import type { AuthenticatedUser } from "../auth/auth.types";
import type { AppConfig } from "../../config/config";
import type { JobService } from "../jobs/job.service";
import type { InsightsRepository } from "./insights.repository";
import type {
  ActivityEventRecord,
  FeedbackRecord,
  GapReportRecord,
  QuizAttemptRecord,
  QuizRecord,
} from "../../infra/jsonstore/system-collections";
import type { ConversationRepositoryPort } from "../../infra/mongodb/conversation.repository";
import type { DocumentEmbeddingProvider } from "../documents/embedding-provider";
import { clusterGapQuestions } from "./gap-topic-clustering";

const MAX_UNIQUE_QUESTIONS_PER_PERIOD = 250;

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
    private readonly conversations: ConversationRepositoryPort,
    private readonly embeddingProvider: DocumentEmbeddingProvider,
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

  public async generateGapReport(
    courseId: string,
    signal: AbortSignal,
  ): Promise<GapReportRecord> {
    const course = this.repository.findCourse(courseId);
    if (!course) throw new NotFoundError("Course not found");
    const periodEnd = new Date();
    const periodDurationMs =
      this.config.insightPeriodDays * 24 * 60 * 60 * 1000;
    const periodStart = new Date(
      periodEnd.getTime() - periodDurationMs,
    );
    const previousPeriodStart = new Date(
      periodStart.getTime() - periodDurationMs,
    );
    const events = this.repository
      .listEvents(courseId)
      .filter(
        (event) =>
          event.type === "question" &&
          event.groundingStatus === "insufficient" &&
          !event.usedPersonalScope &&
          event.createdAt >= previousPeriodStart.toISOString() &&
          event.createdAt <= periodEnd.toISOString(),
      );
    const messages = await this.conversations.findUserMessagesByIds(
      events.map((event) => event.dedupeKey),
    );
    const messagesById = new Map(messages.map((message) => [message.id, message]));
    const feedbackByAssistantMessageId = new Map<
      string,
      Array<Pick<FeedbackRecord, "userId" | "rating" | "updatedAt">>
    >();
    for (const feedback of this.repository.listFeedback(courseId)) {
      if (
        feedback.updatedAt < previousPeriodStart.toISOString() ||
        feedback.updatedAt > periodEnd.toISOString()
      ) {
        continue;
      }
      const associated =
        feedbackByAssistantMessageId.get(feedback.messageId) ?? [];
      associated.push({
        userId: feedback.userId,
        rating: feedback.rating,
        updatedAt: feedback.updatedAt,
      });
      feedbackByAssistantMessageId.set(feedback.messageId, associated);
    }
    const currentChatSamples = createQuestionSamples(
      events.filter((event) => event.createdAt >= periodStart.toISOString()),
      messagesById,
      feedbackByAssistantMessageId,
      courseId,
      periodStart.toISOString(),
      periodEnd.toISOString(),
      "current",
    );
    const previousChatSamples = createQuestionSamples(
      events.filter((event) => event.createdAt < periodStart.toISOString()),
      messagesById,
      feedbackByAssistantMessageId,
      courseId,
      previousPeriodStart.toISOString(),
      periodStart.toISOString(),
      "previous",
    );
    const quizzes = this.repository
      .listQuizzes(courseId)
      .filter((quiz) => quiz.visibility === "course");
    const quizAttempts = this.repository.listQuizAttempts(courseId);
    const currentQuizSamples = createQuizMissSamples(
      quizAttempts,
      quizzes,
      periodStart.toISOString(),
      periodEnd.toISOString(),
      "current",
    );
    const previousQuizSamples = createQuizMissSamples(
      quizAttempts,
      quizzes,
      previousPeriodStart.toISOString(),
      periodStart.toISOString(),
      "previous",
    );
    const currentSamples = aggregateQuestionSamples([
      ...currentChatSamples,
      ...currentQuizSamples,
    ]);
    const previousSamples = aggregateQuestionSamples([
      ...previousChatSamples,
      ...previousQuizSamples,
    ]);
    const currentChatEventCount = events.filter(
      (event) => event.createdAt >= periodStart.toISOString(),
    ).length;
    if (
      currentChatEventCount === 0 &&
      sumQuestionCounts(currentQuizSamples) === 0
    ) {
      return this.repository.createGapReport({
        courseId,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        totalGapQuestions: 0,
        minCohortSizeUsed: this.config.insightMinCohortSize,
        topics: [],
        otherCount: 0,
        generatedBy: null,
      });
    }
    const distinctLearnerCount = new Set(
      currentSamples.flatMap((sample) => sample.userIds),
    ).size;
    const cohortQualified =
      distinctLearnerCount >= this.config.insightMinCohortSize;

    if (!cohortQualified) {
      return this.repository.createGapReport({
        courseId,
        periodStart: periodStart.toISOString(),
        periodEnd: periodEnd.toISOString(),
        totalGapQuestions: null,
        minCohortSizeUsed: this.config.insightMinCohortSize,
        topics: [],
        otherCount: null,
        generatedBy: null,
      });
    }

    const previousQuestionTexts = selectQuestionTexts(previousSamples);
    const currentQuestionTexts = selectQuestionTexts(currentSamples);
    const analysisSamples = [
      ...previousSamples.filter((sample) =>
        previousQuestionTexts.has(sample.content),
      ),
      ...currentSamples.filter((sample) =>
        currentQuestionTexts.has(sample.content),
      ),
    ];
    const uniqueQuestions = [
      ...new Set(analysisSamples.map((sample) => sample.content)),
    ];
    const uniqueEmbeddings = await this.embeddingProvider.embed(
      uniqueQuestions,
      signal,
      "RETRIEVAL_QUERY",
    );
    if (uniqueEmbeddings.length !== uniqueQuestions.length) {
      throw new Error("Gap-question embedding count does not match the request");
    }
    const embeddingByQuestion = new Map<string, number[]>();
    uniqueQuestions.forEach((question, index) => {
      const embedding = uniqueEmbeddings[index];
      if (!embedding) {
        throw new Error("Gap-question embedding is missing");
      }
      embeddingByQuestion.set(question, embedding);
    });
    const clustering = clusterGapQuestions(
      analysisSamples,
      analysisSamples.map((sample) =>
        requireQuestionEmbedding(embeddingByQuestion, sample.content),
      ),
      this.config.insightMinCohortSize,
    );
    const topics = clustering.topics.map((topic) => ({
      ...topic,
      suggestedAction: buildGapTopicAction(topic),
      trend:
        topic.previousCount === null
          ? "new" as const
          : topic.questionCount > topic.previousCount
            ? "up" as const
            : topic.questionCount < topic.previousCount
              ? "down" as const
              : "flat" as const,
    }));

    const unprocessedCurrentChatEventCount = Math.max(
      0,
      currentChatEventCount - sumQuestionCounts(currentChatSamples),
    );
    const unreportedQuestionCount =
      unprocessedCurrentChatEventCount +
      clustering.otherCount +
      sumQuestionCounts(currentSamples) -
      analysisSamples
        .filter((sample) => sample.period === "current")
        .reduce((total, sample) => total + sample.questionCount, 0);
    const currentQuestionCount = sumQuestionCounts(currentSamples);
    return this.repository.createGapReport({
      courseId,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      totalGapQuestions:
        unreportedQuestionCount === 0 ? currentQuestionCount : null,
      minCohortSizeUsed: this.config.insightMinCohortSize,
      topics,
      otherCount: unreportedQuestionCount === 0 ? 0 : null,
      generatedBy: null,
    });
  }
}

function selectQuestionTexts(
  samples: Array<{ content: string }>,
): Set<string> {
  const distinct = [...new Set(samples.map((sample) => sample.content))];
  return new Set(distinct.slice(-MAX_UNIQUE_QUESTIONS_PER_PERIOD));
}

function createQuestionSamples(
  events: ActivityEventRecord[],
  messagesById: Map<
    string,
    {
      id: string;
      userId: string;
      courseId: string;
      content: string;
      assistantMessageId: string | null;
    }
  >,
  feedbackByAssistantMessageId: Map<
    string,
    Array<Pick<FeedbackRecord, "userId" | "rating" | "updatedAt">>
  >,
  courseId: string,
  periodStart: string,
  periodEnd: string,
  period: "current" | "previous",
): Array<{
  userIds: string[];
  content: string;
  questionCount: number;
  period: "current" | "previous";
  helpfulFeedbackCount: number;
  notHelpfulFeedbackCount: number;
  quizMissCount: number;
  insufficientEvidenceCount: number;
  retrievalScoreTop: number | null;
  retrievalScoreCount: number;
}> {
  return events
    .sort(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) ||
        left.dedupeKey.localeCompare(right.dedupeKey),
    )
    .flatMap((event) => {
      const message = messagesById.get(event.dedupeKey);
      const content = message?.content.trim();
      if (
        !message ||
        message.userId !== event.userId ||
        message.courseId !== courseId ||
        !content ||
        content.length > 4000
      ) {
        return [];
      }
      const feedback = message.assistantMessageId
        ? feedbackByAssistantMessageId.get(message.assistantMessageId) ?? []
        : [];
      const relevantFeedback = feedback.filter(
        (record) =>
          record.userId === event.userId &&
          record.updatedAt >= periodStart &&
          record.updatedAt < periodEnd,
      );
      return [
        {
          userIds: [event.userId],
          content,
          questionCount: 1,
          insufficientEvidenceCount: 1,
          retrievalScoreTop: event.retrievalScoreTop,
          retrievalScoreCount: event.retrievalScoreTop === null ? 0 : 1,
          period,
          helpfulFeedbackCount: relevantFeedback.filter(
            (record) => record.rating === "helpful",
          ).length,
          notHelpfulFeedbackCount: relevantFeedback.filter(
            (record) => record.rating === "not_helpful",
          ).length,
          quizMissCount: 0,
        },
      ];
    });
}

function createQuizMissSamples(
  attempts: QuizAttemptRecord[],
  quizzes: QuizRecord[],
  periodStart: string,
  periodEnd: string,
  period: "current" | "previous",
): Array<{
  userIds: string[];
  content: string;
  questionCount: number;
  period: "current" | "previous";
  helpfulFeedbackCount: number;
  notHelpfulFeedbackCount: number;
  quizMissCount: number;
  insufficientEvidenceCount: number;
  retrievalScoreTop: number | null;
  retrievalScoreCount: number;
}> {
  const quizzesById = new Map(
    quizzes.map((quiz) => [`${quiz.id}:${quiz.version}`, quiz]),
  );
  const samples = [];
  for (const attempt of attempts) {
    if (
      attempt.submittedAt < periodStart ||
      attempt.submittedAt >= periodEnd
    ) {
      continue;
    }
    const quiz = quizzesById.get(`${attempt.quizId}:${attempt.quizVersion}`);
    if (!quiz) continue;
    for (const answer of attempt.answers) {
      if (answer.correct) continue;
      const question = quiz.questions.find(
        (candidate) => candidate.id === answer.questionId,
      );
      if (!question?.prompt.trim()) continue;
      samples.push({
        userIds: [attempt.userId],
        content: question.prompt.trim(),
        questionCount: 1,
        insufficientEvidenceCount: 0,
        retrievalScoreTop: null,
        retrievalScoreCount: 0,
        period,
        helpfulFeedbackCount: 0,
        notHelpfulFeedbackCount: 0,
        quizMissCount: 1,
      });
    }
  }
  return samples;
}

function aggregateQuestionSamples(
  samples: Array<{
    userIds: string[];
    content: string;
    questionCount: number;
    insufficientEvidenceCount: number;
    retrievalScoreTop: number | null;
    retrievalScoreCount: number;
    period: "current" | "previous";
    helpfulFeedbackCount: number;
    notHelpfulFeedbackCount: number;
    quizMissCount: number;
  }>,
): Array<{
  userIds: string[];
  content: string;
  questionCount: number;
  insufficientEvidenceCount: number;
  retrievalScoreTop: number | null;
  retrievalScoreCount: number;
  period: "current" | "previous";
  helpfulFeedbackCount: number;
  notHelpfulFeedbackCount: number;
  quizMissCount: number;
}> {
  const grouped = new Map<string, {
    userIds: Set<string>;
    content: string;
    questionCount: number;
    insufficientEvidenceCount: number;
    retrievalScoreTotal: number;
    retrievalScoreCount: number;
    period: "current" | "previous";
    helpfulFeedbackCount: number;
    notHelpfulFeedbackCount: number;
    quizMissCount: number;
  }>();
  for (const sample of samples) {
    const key = JSON.stringify([sample.period, sample.content]);
    const group = grouped.get(key) ?? {
      userIds: new Set<string>(),
      content: sample.content,
      questionCount: 0,
      insufficientEvidenceCount: 0,
      retrievalScoreTotal: 0,
      retrievalScoreCount: 0,
      period: sample.period,
      helpfulFeedbackCount: 0,
      notHelpfulFeedbackCount: 0,
      quizMissCount: 0,
    };
    sample.userIds.forEach((userId) => group.userIds.add(userId));
    group.questionCount += sample.questionCount;
    group.insufficientEvidenceCount += sample.insufficientEvidenceCount;
    group.retrievalScoreCount += sample.retrievalScoreCount;
    if (sample.retrievalScoreTop !== null) {
      group.retrievalScoreTotal +=
        sample.retrievalScoreTop * sample.retrievalScoreCount;
    }
    group.helpfulFeedbackCount += sample.helpfulFeedbackCount;
    group.notHelpfulFeedbackCount += sample.notHelpfulFeedbackCount;
    group.quizMissCount += sample.quizMissCount;
    grouped.set(key, group);
  }
  return [...grouped.values()].map(
    ({ userIds, retrievalScoreTotal, retrievalScoreCount, ...sample }) => ({
      ...sample,
      retrievalScoreCount,
      retrievalScoreTop:
        retrievalScoreCount === 0
          ? null
          : retrievalScoreTotal / retrievalScoreCount,
      userIds: [...userIds],
    }),
  );
}

function sumQuestionCounts(
  samples: Array<{ questionCount: number }>,
): number {
  return samples.reduce((total, sample) => total + sample.questionCount, 0);
}

function buildGapTopicAction(
  topic: ReturnType<typeof clusterGapQuestions>["topics"][number],
): string {
  if (topic.insufficientEvidenceCount > 0 && topic.quizMissCount > 0) {
    return `Strengthen the course explanation for ${topic.theme}, add a worked example, and follow it with a short practice question.`;
  }
  if (topic.insufficientEvidenceCount > 0) {
    return `Add or clarify course material on ${topic.theme}; include a worked example and check understanding with a short course quiz.`;
  }
  return `Add a worked example for ${topic.theme} and a low-stakes practice question that targets the missed step.`;
}

function requireQuestionEmbedding(
  embeddings: Map<string, number[]>,
  question: string,
): number[] {
  const embedding = embeddings.get(question);
  if (!embedding) throw new Error("Gap-question embedding is missing");
  return embedding;
}
