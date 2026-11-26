import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isConversationDatabaseReady,
  openConversationDatabase,
} from "../../src/infra/sqlite/database";
import { ConversationRepository } from "../../src/infra/sqlite/conversation.repository";

const userId = "00000000-0000-4000-8000-000000000001";
const courseId = "00000000-0000-4000-8000-000000000002";
const conversationId = "00000000-0000-4000-8000-000000000003";
const executionId = "00000000-0000-4000-8000-000000000004";

describe("ConversationRepository", () => {
  let dataDirectory: string;
  let database: ReturnType<typeof openConversationDatabase>;
  let repository: ConversationRepository;

  beforeEach(() => {
    dataDirectory = mkdtempSync(join(tmpdir(), "ai-learning-chat-"));
    database = openConversationDatabase(dataDirectory);
    repository = new ConversationRepository(database);
  });

  afterEach(() => {
    database.close();
    rmSync(dataDirectory, { recursive: true, force: true });
  });

  test("persists exchanges and source metadata and cascades conversation deletion", () => {
    expect(isConversationDatabaseReady(database)).toBe(true);

    const saved = repository.saveExchange({
      conversationId,
      userId,
      courseId,
      title: "What is a database?",
      createConversation: true,
      question: "What is a database?",
      answer: "A database stores data [1].",
      executionId,
      intent: "question",
      groundingStatus: "grounded",
      answerSource: "course_material",
      citations: [
        {
          marker: 1,
          chunkId: `${courseId}:0`,
          documentId: courseId,
          documentName: "Databases.txt",
          pageStart: 2,
          pageEnd: 2,
          section: "Introduction",
        },
      ],
      retrievalScoreTop: 0.9,
    });

    const conversation = repository.findConversation(conversationId);
    const messages = repository.listMessages(conversationId);
    expect(conversation).toMatchObject({
      id: conversationId,
      userId,
      courseId,
      title: "What is a database?",
    });
    expect(messages.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: "user", content: "What is a database?" },
      { role: "assistant", content: "A database stores data [1]." },
    ]);
    expect(messages[1]?.citations[0]).toMatchObject({
      marker: 1,
      documentName: "Databases.txt",
      pageStart: 2,
    });
    expect(messages[1]?.answerSource).toBe("course_material");
    expect(saved.userMessageId).not.toBe(saved.assistantMessageId);

    repository.saveExchange({
      conversationId: "00000000-0000-4000-8000-000000000007",
      userId,
      courseId,
      title: "Next question",
      createConversation: true,
      question: "Next question",
      answer: "Not enough material.",
      executionId: "00000000-0000-4000-8000-000000000008",
      intent: "question",
      groundingStatus: "insufficient",
      answerSource: "general_knowledge",
      citations: [],
      retrievalScoreTop: null,
    });
    expect(repository.listMessages("00000000-0000-4000-8000-000000000007")[1]?.answerSource)
      .toBe("general_knowledge");
    const firstPage = repository.listConversations(userId, undefined, 1);
    expect(firstPage.items.map(({ id }) => id)).toEqual([conversationId]);
    expect(firstPage.nextCursor).toBeTruthy();
    expect(
      repository.listConversations(userId, undefined, 1, conversationId).items.map(
        ({ id }) => id,
      ),
    ).toEqual(["00000000-0000-4000-8000-000000000007"]);

    expect(repository.deleteConversation(conversationId, userId)).toBe(true);
    expect(repository.findConversation(conversationId)).toBeNull();
    expect(repository.listMessages(conversationId)).toEqual([]);
  });

  test("rolls back a conversation when saving its assistant message fails", () => {
    database.exec(`
      CREATE TRIGGER reject_assistant_message
      BEFORE INSERT ON messages
      WHEN NEW.role = 'assistant'
      BEGIN
        SELECT RAISE(ABORT, 'assistant insert failed');
      END;
    `);

    expect(() =>
      repository.saveExchange({
        conversationId,
        userId,
        courseId,
        title: "What is a database?",
        createConversation: true,
        question: "What is a database?",
        answer: "A database stores data.",
        executionId,
        intent: "question",
        groundingStatus: "grounded",
        answerSource: null,
        citations: [],
        retrievalScoreTop: null,
      }),
    ).toThrow("assistant insert failed");

    expect(repository.findConversation(conversationId)).toBeNull();
    expect(
      database.prepare("SELECT COUNT(*) AS count FROM messages").get(),
    ).toMatchObject({ count: 0 });
  });

  test("enforces daily request limits and stores only quota counts", () => {
    expect(
      repository.reserveDailyRequest(userId, "2026-11-17", 1),
    ).toBe(true);
    expect(
      repository.reserveDailyRequest(userId, "2026-11-17", 1),
    ).toBe(false);
    repository.recordDailyTokenUsage(userId, "2026-11-17", 39);
    expect(repository.dailyTokenUsage(userId, "2026-11-17")).toBe(39);
    expect(
      database
        .prepare("SELECT * FROM chat_daily_usage WHERE user_id = ?")
        .get(userId),
    ).toMatchObject({
      user_id: userId,
      usage_date: "2026-11-17",
      request_count: 1,
      token_count: 39,
    });
  });

  test("adds the answer source column when opening a legacy conversation database", () => {
    database.exec("ALTER TABLE messages DROP COLUMN answer_source");
    database.close();

    database = openConversationDatabase(dataDirectory);

    const columns = database
      .prepare("PRAGMA table_info(messages)")
      .all() as Array<{ name: string }>;
    expect(columns.some((column) => column.name === "answer_source")).toBe(true);
  });
});
