import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openConversationDatabase } from "../../src/infra/sqlite/database";
import { createSystemStore } from "../../src/infra/jsonstore/create-system-store";
import type {
  CourseRecord,
  DocumentRecord,
  EnrolmentRecord,
} from "../../src/infra/jsonstore/system-collections";
import { FakeEmbeddingProvider } from "../../src/ai/providers/fake-embedding.provider";
import { FakeLlmProvider } from "../../src/ai/providers/fake-llm.provider";
import { StructuredOutputService } from "../../src/ai/providers/structured-output.service";
import { loadConfig } from "../../src/config/config";
import { ConversationRepository } from "../../src/infra/sqlite/conversation.repository";
import type { AuthenticatedUser } from "../../src/modules/auth/auth.types";
import {
  LearningService,
} from "../../src/modules/learning/learning.service";
import { LearningRepository } from "../../src/modules/learning/learning.repository";
import { JsonLearningExecutionRepository } from "../../src/modules/learning/learning-execution.repository";
import {
  generateFlashcardsRequestSchema,
  generateQuizRequestSchema,
  generateSummaryRequestSchema,
} from "../../src/modules/learning/learning.schemas";
import {
  RetrievalService,
  type RetrievalRepository,
} from "../../src/modules/retrieval/retrieval.service";
import { createTestChunkRepository } from "../helpers/chunk-repository";

const courseId = "00000000-0000-4000-8000-000000000001";
const coachId = "00000000-0000-4000-8000-000000000002";
const learnerId = "00000000-0000-4000-8000-000000000003";
const otherLearnerId = "00000000-0000-4000-8000-000000000004";
const documentId = "00000000-0000-4000-8000-000000000005";
const createdAt = "2026-11-17T08:00:00.000Z";
const chunkId = `${documentId}:0`;
const course: CourseRecord = {
  id: courseId,
  ownerId: coachId,
  name: "Databases",
  status: "active",
  version: 1,
  createdAt,
  updatedAt: createdAt,
};
const document: DocumentRecord = {
  id: documentId,
  courseId,
  ownerId: coachId,
  scope: "course",
  filename: "Databases.txt",
  storageKey: documentId,
  mimeType: "text/plain",
  sizeBytes: 64,
  contentHash: "a".repeat(64),
  status: "ready",
  errorCode: null,
  errorDetail: null,
  extractionDiagnostics: null,
  chunkCount: 1,
  embeddingModel: "mistral-embed",
  ingestJobId: null,
  createdAt,
  updatedAt: createdAt,
  readyAt: createdAt,
};

const learner: AuthenticatedUser = {
  id: learnerId,
  email: "learner@example.test",
  displayName: "Learner",
  role: "learner",
  status: "active",
  mustChangePassword: false,
  permissions: ["content:generate", "quiz:create"],
  permsVersion: 1,
};
const otherLearner: AuthenticatedUser = {
  ...learner,
  id: otherLearnerId,
  email: "other@example.test",
};
const coach: AuthenticatedUser = {
  ...learner,
  id: coachId,
  email: "coach@example.test",
  displayName: "Coach",
  role: "coach",
};

let temporaryRoot = "";
let database: ReturnType<typeof openConversationDatabase>;

afterEach(async () => {
  database?.close();
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
});

async function createLearningService(
  llmResponse: string | string[],
): Promise<{
  service: LearningService;
  collections: ReturnType<typeof createSystemStore>["collections"];
  primary: FakeLlmProvider;
}> {
  temporaryRoot = await mkdtemp(join(tmpdir(), "learning-service-"));
  const { store, collections } = createSystemStore(join(temporaryRoot, "data"));
  await store.initialize();
  const enrolment: EnrolmentRecord = {
    id: "00000000-0000-4000-8000-000000000006",
    courseId,
    userId: learnerId,
    status: "approved",
    requestedAt: createdAt,
    createdAt,
    updatedAt: createdAt,
  };
  await collections.courses.insert(course);
  await collections.documents.insert(document);
  await collections.enrolments.insert(enrolment);
  const repository: RetrievalRepository = {
    findCourse: () => course,
    findEnrolment: (_requestedCourseId, userId) =>
      userId === learnerId || userId === otherLearnerId
        ? { ...enrolment, userId }
        : null,
    listDocumentsByCourse: () => [document],
  };
  const bytes = Buffer.alloc(2 * Float32Array.BYTES_PER_ELEMENT);
  bytes.writeFloatLE(1, 0);
  bytes.writeFloatLE(0, 4);
  const retrievalService = new RetrievalService(
    repository,
    createTestChunkRepository(async () => ({
        header: {
          documentId,
          courseId,
          ownerId: coachId,
          scope: "course",
          embeddingModel: "mistral-embed",
          dimension: 2,
          chunkCount: 1,
          createdAt,
        },
        chunks: [
          {
            id: chunkId,
            chunkIndex: 0,
            tokenEstimate: 12,
            pageStart: 1,
            pageEnd: 1,
            section: "Introduction",
            text: "A database is an organized collection of data.",
            embedding: bytes.toString("base64"),
          },
        ],
      })),
    "mistral-embed",
    2,
  );
  const primary = new FakeLlmProvider(
    "inception",
    "fake-primary",
    Array.isArray(llmResponse) ? llmResponse : [llmResponse],
  );
  const fallback = new FakeLlmProvider("groq", "fake-fallback", []);
  database = openConversationDatabase(join(temporaryRoot, "data"));
  const conversationRepository = new ConversationRepository(database);
  const service = new LearningService(
    new LearningRepository(collections),
    retrievalService,
    new FakeEmbeddingProvider("mistral-embed", 2),
    new StructuredOutputService(primary, fallback, 1200),
    new JsonLearningExecutionRepository(
      collections.agentExecutions,
      conversationRepository,
    ),
    conversationRepository,
    loadConfig({ requireJwtSecrets: false }),
    "Use only this context: {{context}}",
  );
  return { service, collections, primary };
}

describe("LearningService", () => {
  test("generates source-validated private summaries and reuses identical requests", async () => {
    const response = JSON.stringify({
      title: "Database basics",
      blocks: [
        {
          heading: "Definition",
          text: "A database organizes data.",
          sourceChunkIds: [chunkId],
        },
      ],
    });
    const { service, collections, primary } = await createLearningService(response);
    const input = generateSummaryRequestSchema.parse({
      courseId,
      selection: { documentIds: [documentId] },
      scope: "document",
    });

    const first = await service.generateSummary(
      learner,
      input,
      "request-1",
      new AbortController().signal,
    );
    const second = await service.generateSummary(
      learner,
      input,
      "request-2",
      new AbortController().signal,
    );

    expect(first).toMatchObject({
      visibility: "private",
      ownerId: learnerId,
      status: "published",
      sourceChunkIds: [chunkId],
      sourceDocumentIds: [documentId],
      generatedBy: {
        provider: "inception",
        promptVersion: "v1",
      },
    });
    expect(second.id).toBe(first.id);
    expect(primary.calls).toHaveLength(1);
    expect(
      (await service.listSummaries(otherLearner, courseId, 20)).items,
    ).toEqual([]);
    expect(collections.agentExecutions.list()).toMatchObject([
      {
        graph: "learning",
        node: "generate_summary",
        conversationId: null,
        errorCode: null,
      },
    ]);
  });

  test("rejects generated sources outside the selected context without persisting content", async () => {
    const response = JSON.stringify({
      title: "Database basics",
      blocks: [
        {
          heading: "Definition",
          text: "Unsupported.",
          sourceChunkIds: ["00000000-0000-4000-8000-000000000099:0"],
        },
      ],
    });
    const { service, collections } = await createLearningService(response);
    const input = generateSummaryRequestSchema.parse({
      courseId,
      selection: { documentIds: [documentId] },
      scope: "document",
    });

    await expect(
      service.generateSummary(
        learner,
        input,
        "request-2",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "GENERATION_FAILED",
      statusCode: 502,
    });
    expect(collections.learningSummaries.list()).toHaveLength(0);
    expect(collections.agentExecutions.list()).toMatchObject([
      { graph: "learning", status: "error", errorCode: "GENERATION_FAILED" },
    ]);
  });

  test("keeps coach summaries as drafts until the owner publishes them", async () => {
    const response = JSON.stringify({
      title: "Database basics",
      blocks: [
        {
          heading: "Definition",
          text: "A database organizes data.",
          sourceChunkIds: [chunkId],
        },
      ],
    });
    const { service } = await createLearningService([response, response]);
    const input = generateSummaryRequestSchema.parse({
      courseId,
      selection: { documentIds: [documentId] },
      scope: "document",
    });
    const draft = await service.generateSummary(
      coach,
      input,
      "request-6",
      new AbortController().signal,
    );
    const regenerated = await service.generateSummary(
      coach,
      { ...input, regenerate: true },
      "request-6-regenerate",
      new AbortController().signal,
    );

    expect(draft).toMatchObject({
      visibility: "course",
      ownerId: null,
      status: "draft",
      version: 1,
    });
    expect(regenerated.version).toBe(2);
    expect((await service.listSummaries(learner, courseId, 20)).items).toEqual(
      [],
    );
    const published = await service.publishSummary(
      coach,
      draft.id,
      draft.version,
      "request-7",
    );
    expect(published).toMatchObject({ status: "published", version: 1 });
    expect(
      (await service.listSummaries(learner, courseId, 20)).items,
    ).toMatchObject([{ id: draft.id, status: "published" }]);
  });

  test("does not return generated quiz keys to a learner before submission", async () => {
    const response = JSON.stringify({
      title: "Database basics quiz",
      questions: [
        {
          type: "mcq",
          prompt: "What is a database?",
          options: [
            { id: "a", text: "An organized collection of data" },
            { id: "b", text: "A programming language" },
          ],
          correctOptionId: "a",
          explanation: "The source defines a database as an organized collection of data.",
          sourceChunkIds: [chunkId],
        },
      ],
    });
    const { service } = await createLearningService(response);
    const quiz = await service.generateQuiz(
      learner,
      generateQuizRequestSchema.parse({
        courseId,
        selection: { documentIds: [documentId] },
        count: 1,
        types: ["mcq"],
        difficulty: "medium",
      }),
      "request-generated-quiz",
      new AbortController().signal,
    );

    expect(quiz).toMatchObject({
      title: "Database basics quiz",
      status: "published",
      questions: [
        {
          prompt: "What is a database?",
          options: expect.any(Array),
        },
      ],
    });
    expect(JSON.stringify(quiz)).not.toContain("correctOptionId");
    expect(JSON.stringify(quiz)).not.toContain("explanation");
  });

  test("repairs generated quizzes that do not match the requested count and types", async () => {
    const question = {
      type: "mcq",
      prompt: "What is a database?",
      options: [
        { id: "a", text: "An organized collection of data" },
        { id: "b", text: "A programming language" },
      ],
      correctOptionId: "a",
      explanation:
        "The source defines a database as an organized collection of data.",
      sourceChunkIds: [chunkId],
    };
    const invalidResponse = JSON.stringify({
      title: "Incorrect draft",
      questions: [{ ...question, type: "true_false" }, question],
    });
    const correctedResponse = JSON.stringify({
      title: "Corrected draft",
      questions: [question],
    });
    const { service, primary } = await createLearningService([
      invalidResponse,
      correctedResponse,
    ]);

    const quiz = await service.generateQuiz(
      learner,
      generateQuizRequestSchema.parse({
        courseId,
        selection: { documentIds: [documentId] },
        count: 1,
        types: ["mcq"],
        difficulty: "medium",
      }),
      "request-repaired-quiz",
      new AbortController().signal,
    );

    expect(quiz).toMatchObject({
      title: "Corrected draft",
      questions: [{ type: "mcq", prompt: "What is a database?" }],
    });
    expect(primary.calls).toHaveLength(2);
  });

  test("publishes coach flashcards without changing their content version", async () => {
    const response = JSON.stringify({
      title: "Database basics",
      cards: [
        {
          front: "What is a database?",
          back: "An organized collection of data.",
          sourceChunkIds: [chunkId],
        },
      ],
    });
    const { service } = await createLearningService(response);
    const draft = await service.generateFlashcards(
      coach,
      generateFlashcardsRequestSchema.parse({
        courseId,
        selection: { documentIds: [documentId] },
        count: 1,
      }),
      "request-flashcards",
      new AbortController().signal,
    );

    const published = await service.publishFlashcards(
      coach,
      draft.id,
      draft.version,
      "request-flashcards-publish",
    );

    expect(draft).toMatchObject({
      status: "draft",
      visibility: "course",
      version: 1,
    });
    expect(published).toMatchObject({
      id: draft.id,
      status: "published",
      version: draft.version,
    });
    expect((await service.getFlashcards(learner, draft.id)).status).toBe(
      "published",
    );
  });

  test("hides quiz keys from learners, scores on the server, and versions edits after attempts", async () => {
    const { service, collections } = await createLearningService("{}");
    const draft = await service.createCoachQuiz(
      coach,
      {
        courseId,
        title: "Database quiz",
        sourceDocumentIds: [documentId],
        questions: [
          {
            type: "mcq",
            prompt: "What is a database?",
            options: [
              { id: "a", text: "An organized collection of data" },
              { id: "b", text: "A programming language" },
            ],
            correctOptionId: "a",
            explanation: "The source defines a database as an organized collection of data.",
            sourceChunkIds: [chunkId],
          },
        ],
      },
      "request-3",
    );
    const published = await service.publishQuiz(
      coach,
      draft.id,
      draft.version,
      "request-4",
    );
    expect(published.version).toBe(draft.version);
    const learnerView = await service.getQuiz(learner, published.id);
    expect(JSON.stringify(learnerView)).not.toContain("correctOptionId");
    expect(JSON.stringify(learnerView)).not.toContain("explanation");

    const questionId = published.questions[0]?.id;
    if (!questionId) throw new Error("Expected quiz question");
    const result = await service.submitQuizAttempt(learner, published.id, [
      { questionId, selectedOptionId: "a" },
    ]);
    expect(result.attempt).toMatchObject({
      score: 1,
      maxScore: 1,
      quizVersion: published.version,
    });
    expect(result.results[0]).toMatchObject({
      correctOptionId: "a",
      explanation: "The source defines a database as an organized collection of data.",
      correct: true,
    });

    const newDraft = await service.updateQuiz(
      coach,
      published.id,
      { version: published.version, title: "Database quiz revised" },
      "request-5",
    );
    expect(newDraft).toMatchObject({
      lineageId: published.lineageId,
      version: published.version + 1,
      status: "draft",
      publishedAt: null,
    });
    expect(newDraft.id).not.toBe(published.id);
    expect(collections.quizzes.getById(published.id)?.status).toBe("superseded");
  });
});
