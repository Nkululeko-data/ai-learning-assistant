import type { Db, Document, MongoClient } from "mongodb";
import type { Pool } from "pg";
import type { ConversationExchange } from "../../src/infra/sqlite/conversation.repository";
import { MongoConversationRepository } from "../../src/infra/mongodb/conversation.repository";

describe("MongoConversationRepository", () => {
  test("finds user question text and its course without returning assistant text", async () => {
    const userMessage = {
      id: "00000000-0000-4000-8000-000000000010",
      conversationId: "00000000-0000-4000-8000-000000000001",
      role: "user",
      content: "Question text",
      createdAt: "2026-11-26T08:00:00.000Z",
    };
    const assistantMessage = {
      id: "00000000-0000-4000-8000-000000000011",
      conversationId: userMessage.conversationId,
      role: "assistant",
      content: "Answer text",
      createdAt: "2026-11-26T08:00:00.001Z",
    };
    const cursor = (documents: Document[]) => ({
      sort: jest.fn().mockReturnThis(),
      toArray: jest.fn().mockResolvedValue(documents),
    });
    const conversationCollection = {
      find: jest.fn(() =>
        cursor([
          {
            id: userMessage.conversationId,
            userId: "00000000-0000-4000-8000-000000000002",
            courseId: "00000000-0000-4000-8000-000000000003",
          },
        ]),
      ),
    };
    const messageCollection = {
      find: jest.fn((query: Document) =>
        cursor(query.role === "user" ? [userMessage] : [assistantMessage]),
      ),
    };
    const database = {
      collection: jest.fn((name: string) =>
        name === "conversations" ? conversationCollection : messageCollection,
      ),
    } as unknown as Db;
    const repository = new MongoConversationRepository(
      {} as MongoClient,
      database,
      {} as Pool,
    );

    const result = await repository.findUserMessagesByIds([userMessage.id]);

    expect(result).toEqual([
      {
        id: userMessage.id,
        userId: "00000000-0000-4000-8000-000000000002",
        courseId: "00000000-0000-4000-8000-000000000003",
        content: "Question text",
        assistantMessageId: assistantMessage.id,
      },
    ]);
  });

  test("stores a conversation exchange in MongoDB collections within a transaction", async () => {
    const conversations: Document[] = [];
    const messages: Document[] = [];
    const conversationCollection = {
      createIndex: jest.fn().mockResolvedValue("conversation-index"),
      insertOne: jest.fn(async (document: Document) => {
        conversations.push(document);
        return { acknowledged: true, insertedId: "conversation" };
      }),
    };
    const messageCollection = {
      createIndex: jest.fn().mockResolvedValue("message-index"),
      insertMany: jest.fn(async (documents: Document[]) => {
        messages.push(...documents);
        return { acknowledged: true, insertedCount: documents.length, insertedIds: {} };
      }),
    };
    const database = {
      collection: jest.fn((name: string) =>
        name === "conversations" ? conversationCollection : messageCollection,
      ),
    } as unknown as Db;
    const session = {
      withTransaction: jest.fn(async (operation: () => Promise<void>) =>
        operation(),
      ),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    const client = {
      startSession: jest.fn(() => session),
    } as unknown as MongoClient;
    const repository = new MongoConversationRepository(
      client,
      database,
      {} as Pool,
    );
    const exchange: ConversationExchange = {
      conversationId: "00000000-0000-4000-8000-000000000001",
      userId: "00000000-0000-4000-8000-000000000002",
      courseId: "00000000-0000-4000-8000-000000000003",
      title: "Transactions",
      createConversation: true,
      question: "What is atomicity?",
      answer: "Atomicity means all-or-nothing execution.",
      executionId: "00000000-0000-4000-8000-000000000004",
      intent: "question",
      groundingStatus: "grounded",
      answerSource: "course_material",
      citations: [],
      retrievalScoreTop: 0.9,
    };

    await repository.initialize();
    const result = await repository.saveExchange(exchange);

    expect(conversationCollection.insertOne).toHaveBeenCalledTimes(1);
    expect(conversations[0]).toMatchObject({
      id: exchange.conversationId,
      userId: exchange.userId,
      courseId: exchange.courseId,
      title: exchange.title,
    });
    expect(messageCollection.insertMany).toHaveBeenCalledTimes(1);
    expect(messages).toHaveLength(2);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages.map((message) => message.content)).toEqual([
      exchange.question,
      exchange.answer,
    ]);
    expect(result.userMessageId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(session.withTransaction).toHaveBeenCalledTimes(1);
    expect(session.endSession).toHaveBeenCalledTimes(1);
  });
});
