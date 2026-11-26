import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { FakeEmbeddingProvider } from "../../src/ai/providers/fake-embedding.provider";
import { createJsonSystemStore as createSystemStore } from "../../src/infra/jsonstore/create-json-system-store";
import type { CourseRecord } from "../../src/infra/jsonstore/system-collections";
import { loadConfig } from "../../src/config/config";
import { openConversationDatabase } from "../../src/infra/sqlite/database";
import { ConversationRepository } from "../../src/infra/sqlite/conversation.repository";
import { FeedbackRepository } from "../../src/modules/feedback/feedback.repository";
import { FeedbackService } from "../../src/modules/feedback/feedback.service";
import { InsightsRepository } from "../../src/modules/insights/insights.repository";
import { InsightsService } from "../../src/modules/insights/insights.service";
import { JobService } from "../../src/modules/jobs/job.service";
import { JsonJobRepository } from "../../src/modules/jobs/job.types";
import type { AuthenticatedUser } from "../../src/modules/auth/auth.types";

const courseId = "00000000-0000-4000-8000-000000000001";
const coachId = "00000000-0000-4000-8000-000000000002";
const learnerId = "00000000-0000-4000-8000-000000000003";
const createdAt = "2026-11-17T08:00:00.000Z";

const coach: AuthenticatedUser = {
  id: coachId,
  email: "coach@example.test",
  displayName: "Coach",
  role: "coach",
  status: "active",
  mustChangePassword: false,
  permissions: ["insights:view"],
  permsVersion: 1,
};

let temporaryRoot = "";
let database: ReturnType<typeof openConversationDatabase>;

afterEach(async () => {
  database?.close();
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
});

test("B10 hides small cohorts and reports zero when there are no gap signals", async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), "b10-insights-"));
  const { store, collections } = createSystemStore(join(temporaryRoot, "data"));
  await store.initialize();
  database = openConversationDatabase(join(temporaryRoot, "data"));
  const course = await collections.courses.insert({
    ownerId: coachId,
    name: "Databases",
    status: "active",
    version: 1,
    createdAt,
    updatedAt: createdAt,
  });
  const config = loadConfig({ requireJwtSecrets: false });
  const jobRepository = new JsonJobRepository(
    collections.jobs,
    collections.schedulerState,
  );
  const repository = new InsightsRepository(collections);
  const conversations = new ConversationRepository(database);
  const service = new InsightsService(
    repository,
    new JobService(jobRepository),
    config,
    conversations,
    new FakeEmbeddingProvider(config.embeddingModel, config.embeddingDimension),
  );
  await repository.recordActivity({
    dedupeKey: "message-one",
    courseId: course.id,
    userId: learnerId,
    type: "question",
    groundingStatus: "insufficient",
    retrievalScoreTop: null,
    usedPersonalScope: false,
    citedCourseDocumentIds: [],
  });

  const insights = service.getInsights(coach, course.id);
  expect(insights.cohortQualified).toBe(false);
  expect(insights.questionCount).toBeNull();
  expect(insights.insufficientQuestionCount).toBeNull();
  const report = await service.generateGapReport(
    course.id,
    new AbortController().signal,
  );
  expect(report.totalGapQuestions).toBeNull();
  expect(report.otherCount).toBeNull();
  expect(report.topics).toEqual([]);

  const emptyCourse = await collections.courses.insert({
    ownerId: coachId,
    name: "Empty course",
    status: "active",
    version: 1,
    createdAt,
    updatedAt: createdAt,
  });
  const emptyReport = await service.generateGapReport(
    emptyCourse.id,
    new AbortController().signal,
  );
  expect(emptyReport.totalGapQuestions).toBe(0);
  expect(emptyReport.otherCount).toBe(0);
  expect(emptyReport.topics).toEqual([]);
});

test("gap reports cluster unanswered course questions and suppress small topics", async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), "gap-report-"));
  const dataDir = join(temporaryRoot, "data");
  const { store, collections } = createSystemStore(dataDir);
  await store.initialize();
  database = openConversationDatabase(dataDir);

  const course = await collections.courses.insert({
    ownerId: coachId,
    name: "Databases",
    status: "active",
    version: 1,
    createdAt,
    updatedAt: createdAt,
  });
  const config = loadConfig({ requireJwtSecrets: false });
  const repository = new InsightsRepository(collections);
  const jobRepository = new JsonJobRepository(
    collections.jobs,
    collections.schedulerState,
  );
  const conversations = new ConversationRepository(database);
  const embeddingProvider = new FakeEmbeddingProvider(
    config.embeddingModel,
    2,
    (text) => (/index/i.test(text) ? [1, 0] : [0, 1]),
  );
  const service = new InsightsService(
    repository,
    new JobService(jobRepository),
    config,
    conversations,
    embeddingProvider,
  );

  const addQuestion = async (
    userId: string,
    question: string,
    daysAgo: number,
    usedPersonalScope = false,
    retrievalScoreTop: number | null = 0.4,
  ) => {
    const conversationId = randomUUID();
    const saved = conversations.saveExchange({
      conversationId,
      userId,
      courseId: course.id,
      title: question,
      createConversation: true,
      question,
      answer: "I could not find enough course evidence.",
      executionId: randomUUID(),
      intent: "question",
      groundingStatus: "insufficient",
      answerSource: null,
      citations: [],
      retrievalScoreTop: null,
    });
    const event = await repository.recordActivity({
      dedupeKey: saved.userMessageId,
      courseId: course.id,
      userId,
      type: "question",
      groundingStatus: "insufficient",
      retrievalScoreTop,
      usedPersonalScope,
      citedCourseDocumentIds: [],
    });
    const eventDate = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
    await collections.activityEvents.update(event.id, (current) => ({
      ...current,
      createdAt: eventDate.toISOString(),
    }));
    return { ...saved, conversationId };
  };

  const indexLearners = Array.from({ length: 4 }, () => randomUUID());
  const firstQuestion = await addQuestion(
    indexLearners[0]!,
    "How does a database index improve lookup performance?",
    1,
    false,
    0.2,
  );
  await addQuestion(
    indexLearners[1]!,
    "Why do database indexes speed up searches?",
    1,
  );
  const feedbackService = new FeedbackService(
    new FeedbackRepository(collections),
    conversations,
  );
  const learner: AuthenticatedUser = {
    id: indexLearners[0]!,
    email: "learner@example.test",
    displayName: "Learner",
    role: "learner",
    status: "active",
    mustChangePassword: false,
    permissions: [],
    permsVersion: 1,
  };
  await feedbackService.submit(learner, {
    messageId: firstQuestion.assistantMessageId,
    conversationId: firstQuestion.conversationId,
    courseId: course.id,
    rating: "not_helpful",
    comment: "A private comment that must not appear in reports",
  });
  await addQuestion(
    indexLearners[2]!,
    "Can you explain database index selection?",
    1,
  );
  await addQuestion(
    indexLearners[3]!,
    "Database indexing and query performance",
    1,
  );
  await addQuestion(
    randomUUID(),
    "How does a database index improve lookup performance?",
    1,
  );
  await addQuestion(
    randomUUID(),
    "Private personal finance data",
    1,
    true,
  );

  const addQuizAttempt = async (
    visibility: "course" | "private",
    prompt: string,
    userId: string,
  ) => {
    const quiz = await collections.quizzes.insert({
      lineageId: randomUUID(),
      version: 1,
      courseId: course.id,
      createdBy: coachId,
      origin: "coach",
      visibility,
      ownerId: visibility === "private" ? userId : null,
      status: "published",
      title: "Index practice",
      questions: [
        {
          id: "index-question",
          prompt,
          type: "mcq",
          options: [
            { id: "correct", text: "Correct option" },
            { id: "incorrect", text: "Incorrect option" },
          ],
          correctOptionId: "correct",
          sourceChunkIds: [],
        },
      ],
      sourceDocumentIds: [],
      sourceChunkIds: [],
      generationParams: null,
      generatedBy: null,
      publishedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const submittedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await collections.quizAttempts.insert({
      quizId: quiz.id,
      lineageId: quiz.lineageId,
      quizVersion: quiz.version,
      courseId: course.id,
      userId,
      answers: [
        {
          questionId: "index-question",
          selectedOptionId: "incorrect",
          correct: false,
        },
      ],
      score: 0,
      maxScore: 1,
      startedAt: submittedAt,
      submittedAt,
    });
  };
  await addQuizAttempt(
    "course",
    "How does a database index improve lookup performance?",
    indexLearners[0]!,
  );
  await addQuizAttempt(
    "private",
    "Private finance question about investments",
    randomUUID(),
  );

  for (let index = 0; index < 3; index += 1) {
    await addQuestion(
      randomUUID(),
      "Database index performance topic",
      10,
    );
  }

  const report = await service.generateGapReport(
    course.id,
    new AbortController().signal,
  );

  expect(report.totalGapQuestions).toBe(6);
  expect(report.topics).toHaveLength(1);
  expect(report.topics[0]).toMatchObject({
    questionCount: 6,
    insufficientEvidenceCount: 5,
    averageRetrievalScore: 0.36,
    distinctLearnerCount: 5,
    helpfulFeedbackCount: 0,
    notHelpfulFeedbackCount: 1,
    quizMissCount: 1,
    trend: "up",
    previousCount: 3,
  });
  expect(report.topics[0]?.suggestedAction).toContain(
    "add a worked example",
  );
  expect(report.topics[0]?.suggestedAction).not.toContain("private comment");
  expect(report.otherCount).toBe(0);
  expect(JSON.stringify(report)).not.toContain(
    "How does a database index improve lookup performance?",
  );
  expect(embeddingProvider.calls.flat()).not.toContain(
    "Private personal finance data",
  );
  expect(embeddingProvider.calls.flat()).not.toContain(
    "Private finance question about investments",
  );
});

test("B10 submits and updates feedback while never exposing comments to insights", async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), "b10-feedback-"));
  const dataDir = join(temporaryRoot, "data");
  const { store, collections } = createSystemStore(dataDir);
  await store.initialize();
  database = openConversationDatabase(dataDir);
  const conversationRepository = new ConversationRepository(database);
  const saved = conversationRepository.saveExchange({
    conversationId: "00000000-0000-4000-8000-000000000010",
    userId: learnerId,
    courseId,
    title: "Databases",
    createConversation: true,
    question: "Private question text",
    answer: "A grounded answer",
    executionId: "00000000-0000-4000-8000-000000000011",
    intent: "question",
    groundingStatus: "grounded",
    answerSource: "course_material",
    citations: [],
    retrievalScoreTop: 0.8,
  });

  const feedbackRepository = new FeedbackRepository(collections);
  const feedbackService = new FeedbackService(
    feedbackRepository,
    conversationRepository,
  );
  const learner: AuthenticatedUser = {
    id: learnerId,
    email: "learner@example.test",
    displayName: "Learner",
    role: "learner",
    status: "active",
    mustChangePassword: false,
    permissions: [],
    permsVersion: 1,
  };
  const first = await feedbackService.submit(learner, {
    messageId: saved.assistantMessageId,
    conversationId: "00000000-0000-4000-8000-000000000010",
    courseId,
    rating: "helpful",
    comment: "Useful",
  });
  const updated = await feedbackService.submit(learner, {
    messageId: saved.assistantMessageId,
    conversationId: "00000000-0000-4000-8000-000000000010",
    courseId,
    rating: "not_helpful",
  });

  expect(updated.id).toBe(first.id);
  expect(updated.rating).toBe("not_helpful");
  expect(updated.comment).toBeNull();
  expect(JSON.stringify(updated)).not.toContain("Useful");
});
