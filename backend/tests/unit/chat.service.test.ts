import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../../src/config/config";
import { FakeEmbeddingProvider } from "../../src/ai/providers/fake-embedding.provider";
import { FakeLlmProvider } from "../../src/ai/providers/fake-llm.provider";
import { StructuredOutputService } from "../../src/ai/providers/structured-output.service";
import { LangGraphChatRunner } from "../../src/ai/graphs/chat.graph";
import {
  openConversationDatabase,
} from "../../src/infra/sqlite/database";
import { ConversationRepository } from "../../src/infra/sqlite/conversation.repository";
import type { AuthenticatedUser } from "../../src/modules/auth/auth.types";
import { ChatService } from "../../src/modules/chat/chat.service";
import {
  RetrievalService,
  type RetrievalRepository,
} from "../../src/modules/retrieval/retrieval.service";
import { createTestChunkRepository } from "../helpers/chunk-repository";

const userId = "00000000-0000-4000-8000-000000000001";
const courseId = "00000000-0000-4000-8000-000000000002";
const actor: AuthenticatedUser = {
  id: userId,
  email: "learner@example.test",
  displayName: "Learner",
  role: "learner",
  status: "active",
  mustChangePassword: false,
  permissions: [],
  permsVersion: 1,
};

describe("ChatService", () => {
  let dataDirectory: string;
  let database: ReturnType<typeof openConversationDatabase>;
  let repository: ConversationRepository;
  let embeddingProvider: FakeEmbeddingProvider;
  let primary: FakeLlmProvider;
  let service: ChatService;

  beforeEach(() => {
    dataDirectory = mkdtempSync(join(tmpdir(), "ai-learning-chat-service-"));
    database = openConversationDatabase(dataDirectory);
    repository = new ConversationRepository(database);
    embeddingProvider = new FakeEmbeddingProvider("mistral-embed", 2);
    primary = new FakeLlmProvider("inception", "test-model", []);
    const config = loadConfig({ requireJwtSecrets: false });
    const retrievalRepository: RetrievalRepository = {
      findCourse: () => null,
      findEnrolment: () => null,
      listDocumentsByCourse: () => [],
    };
    const retrievalService = new RetrievalService(
      retrievalRepository,
      createTestChunkRepository(async () => ({})),
      "mistral-embed",
      2,
    );
    service = new ChatService(
      repository,
      { recordNodeExecution: async () => {} },
      retrievalService,
      embeddingProvider,
      new LangGraphChatRunner(),
      new StructuredOutputService(
        primary,
        new FakeLlmProvider("groq", "fallback", []),
        config.chatMaxCompletionTokens,
      ),
      {
        queryUnderstanding: "intent",
        rewriteQuery: "rewrite",
        answer: "answer",
      },
      config,
    );
  });

  afterEach(() => {
    database.close();
    rmSync(dataDirectory, { recursive: true, force: true });
  });

  test("denies inaccessible courses before sending a question to any provider", async () => {
    await expect(
      service.ask(
        actor,
        { courseId, question: "Private question" },
        "request-1",
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });

    expect(embeddingProvider.calls).toEqual([]);
    expect(primary.calls).toEqual([]);
    expect(repository.dailyTokenUsage(userId, new Date().toISOString().slice(0, 10)))
      .toBe(0);
  });

  test("does not allow a user to read another user's conversation", async () => {
    const conversationId = "00000000-0000-4000-8000-000000000003";
    await repository.saveExchange({
      conversationId,
      userId: "00000000-0000-4000-8000-000000000004",
      courseId,
      title: "Private",
      createConversation: true,
      question: "Private question",
      answer: "Private answer",
      executionId: "00000000-0000-4000-8000-000000000005",
      intent: "question",
      groundingStatus: "insufficient",
      citations: [],
      retrievalScoreTop: null,
    });

    await expect(service.getConversation(actor, conversationId)).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404,
    });
  });
});
