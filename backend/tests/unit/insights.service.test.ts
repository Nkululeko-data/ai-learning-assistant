import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

test("B10 hides aggregate insights below the minimum cohort size", async () => {
  temporaryRoot = await mkdtemp(join(tmpdir(), "b10-insights-"));
  const { store, collections } = createSystemStore(join(temporaryRoot, "data"));
  await store.initialize();
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
  const service = new InsightsService(
    repository,
    new JobService(jobRepository),
    config,
  );
  await repository.recordActivity({
    dedupeKey: "message-one",
    courseId: course.id,
    userId: learnerId,
    type: "question",
    groundingStatus: "insufficient",
    retrievalScoreTop: 0.8,
    usedPersonalScope: false,
    citedCourseDocumentIds: [],
  });

  const insights = service.getInsights(coach, course.id);
  expect(insights.cohortQualified).toBe(false);
  expect(insights.questionCount).toBeNull();
  expect(insights.insufficientQuestionCount).toBeNull();
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
