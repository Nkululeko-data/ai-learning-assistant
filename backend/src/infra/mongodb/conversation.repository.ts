import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  type Collection,
  type Db,
  type Document,
  MongoClient,
} from "mongodb";
import { chatIntentSchema, type ChatIntent } from "../../ai/schemas/chat.schemas";
import type {
  GroundingStatus,
  ValidatedCitation,
} from "../../ai/graphs/chat-state";
import { NotFoundError } from "../../common/errors/app-error";
import type {
  ConversationExchange,
  ConversationMessageRecord,
  ConversationRecord,
} from "../sqlite/conversation.repository";
import { z } from "zod";

const citationsSchema = z.array(
  z
    .object({
      marker: z.number().int().positive(),
      chunkId: z.string().min(1),
      documentId: z.string().uuid(),
      documentName: z.string().min(1),
      pageStart: z.number().int().positive(),
      pageEnd: z.number().int().positive(),
      section: z.string().nullable(),
    })
    .strict(),
);

interface ConversationDocument extends Document, ConversationRecord {}
interface MessageDocument extends Document, ConversationMessageRecord {}

type MaybePromise<T> = T | Promise<T>;

export interface ConversationRepositoryPort {
  dailyTokenUsage(userId: string, usageDate: string): MaybePromise<number>;
  reserveDailyRequest(
    userId: string,
    usageDate: string,
    requestLimit: number,
  ): MaybePromise<boolean>;
  recordDailyTokenUsage(
    userId: string,
    usageDate: string,
    tokenCount: number,
  ): MaybePromise<void>;
  findConversation(id: string): MaybePromise<ConversationRecord | null>;
  findMessage(id: string): MaybePromise<ConversationMessageRecord | null>;
  listConversations(
    userId: string,
    courseId: string | undefined,
    limit: number,
    cursorId?: string,
  ): MaybePromise<{ items: ConversationRecord[]; nextCursor?: string }>;
  listMessages(
    conversationId: string,
  ): MaybePromise<ConversationMessageRecord[]>;
  getRecentMessages(
    conversationId: string,
    maximumMessages: number,
  ): MaybePromise<ConversationMessageRecord[]>;
  saveExchange(exchange: ConversationExchange): MaybePromise<{
    userMessageId: string;
    assistantMessageId: string;
  }>;
  updateTitle(
    conversationId: string,
    userId: string,
    title: string,
  ): MaybePromise<boolean>;
  deleteConversation(
    conversationId: string,
    userId: string,
  ): MaybePromise<boolean>;
  deleteByUser(userId: string): MaybePromise<void>;
}

export class MongoConversationRepository
  implements ConversationRepositoryPort
{
  private readonly conversations: Collection<ConversationDocument>;
  private readonly messages: Collection<MessageDocument>;

  public constructor(
    private readonly client: MongoClient,
    database: Db,
    private readonly postgres: Pool,
  ) {
    this.conversations =
      database.collection<ConversationDocument>("conversations");
    this.messages = database.collection<MessageDocument>("messages");
  }

  public async initialize(): Promise<void> {
    await Promise.all([
      this.conversations.createIndex({ id: 1 }, { unique: true }),
      this.conversations.createIndex({ userId: 1, id: 1 }),
      this.conversations.createIndex({ userId: 1, courseId: 1, id: 1 }),
      this.messages.createIndex({ id: 1 }, { unique: true }),
      this.messages.createIndex({ conversationId: 1, createdAt: 1, id: 1 }),
    ]);
  }

  public async dailyTokenUsage(
    userId: string,
    usageDate: string,
  ): Promise<number> {
    const result = await this.postgres.query<{ token_count: string | number }>(
      `SELECT token_count FROM chat_daily_usage
       WHERE user_id = $1 AND usage_date = $2`,
      [userId, usageDate],
    );
    const tokenCount = Number(result.rows[0]?.token_count ?? 0);
    if (!Number.isSafeInteger(tokenCount) || tokenCount < 0) {
      throw new Error("Stored chat token usage is invalid");
    }
    return tokenCount;
  }

  public async reserveDailyRequest(
    userId: string,
    usageDate: string,
    requestLimit: number,
  ): Promise<boolean> {
    const result = await this.postgres.query(
      `INSERT INTO chat_daily_usage (user_id, usage_date, request_count, token_count)
       VALUES ($1, $2, 1, 0)
       ON CONFLICT (user_id, usage_date) DO UPDATE
       SET request_count = chat_daily_usage.request_count + 1
       WHERE chat_daily_usage.request_count < $3
       RETURNING request_count`,
      [userId, usageDate, requestLimit],
    );
    return result.rowCount === 1;
  }

  public async recordDailyTokenUsage(
    userId: string,
    usageDate: string,
    tokenCount: number,
  ): Promise<void> {
    const result = await this.postgres.query(
      `UPDATE chat_daily_usage
       SET token_count = token_count + $1
       WHERE user_id = $2 AND usage_date = $3`,
      [tokenCount, userId, usageDate],
    );
    if (result.rowCount !== 1) {
      throw new Error("Chat daily usage reservation is missing");
    }
  }

  public async findConversation(id: string): Promise<ConversationRecord | null> {
    const document = await this.conversations.findOne(
      { id },
      { projection: { _id: 0 } },
    );
    return document ? mapConversation(document) : null;
  }

  public async findMessage(
    id: string,
  ): Promise<ConversationMessageRecord | null> {
    const document = await this.messages.findOne(
      { id },
      { projection: { _id: 0 } },
    );
    return document ? mapMessage(document) : null;
  }

  public async listConversations(
    userId: string,
    courseId: string | undefined,
    limit: number,
    cursorId?: string,
  ): Promise<{ items: ConversationRecord[]; nextCursor?: string }> {
    const query: Document = { userId };
    if (courseId) query.courseId = courseId;
    if (cursorId) query.id = { $gt: cursorId };
    const documents = await this.conversations
      .find(query, { projection: { _id: 0 } })
      .sort({ id: 1 })
      .limit(limit + 1)
      .toArray();
    const hasMore = documents.length > limit;
    const items = (hasMore ? documents.slice(0, limit) : documents).map(
      mapConversation,
    );
    const lastItem = items.at(-1);
    if (!hasMore || !lastItem) return { items };
    return {
      items,
      nextCursor: Buffer.from(lastItem.id).toString("base64url"),
    };
  }

  public async listMessages(
    conversationId: string,
  ): Promise<ConversationMessageRecord[]> {
    const documents = await this.messages
      .find({ conversationId }, { projection: { _id: 0 } })
      .sort({ createdAt: 1, id: 1 })
      .toArray();
    return documents.map(mapMessage);
  }

  public async getRecentMessages(
    conversationId: string,
    maximumMessages: number,
  ): Promise<ConversationMessageRecord[]> {
    if (maximumMessages === 0) return [];
    const documents = await this.messages
      .find({ conversationId }, { projection: { _id: 0 } })
      .sort({ createdAt: -1, id: -1 })
      .limit(maximumMessages)
      .toArray();
    return documents.reverse().map(mapMessage);
  }

  public async saveExchange(exchange: ConversationExchange): Promise<{
    userMessageId: string;
    assistantMessageId: string;
  }> {
    const userMessageId = randomUUID();
    const assistantMessageId = randomUUID();
    const now = new Date();
    const createdAt = now.toISOString();
    const assistantCreatedAt = new Date(now.getTime() + 1).toISOString();
    const session = this.client.startSession();

    try {
      await session.withTransaction(async () => {
        if (exchange.createConversation) {
          await this.conversations.insertOne(
            {
              id: exchange.conversationId,
              userId: exchange.userId,
              courseId: exchange.courseId,
              title: exchange.title,
              createdAt,
              updatedAt: assistantCreatedAt,
            },
            { session },
          );
        } else {
          const updated = await this.conversations.updateOne(
            { id: exchange.conversationId, userId: exchange.userId },
            { $set: { updatedAt: assistantCreatedAt } },
            { session },
          );
          if (updated.matchedCount !== 1) throw new NotFoundError();
        }

        await this.messages.insertMany(
          [
            {
              id: userMessageId,
              conversationId: exchange.conversationId,
              role: "user",
              content: exchange.question,
              createdAt,
              executionId: null,
              intent: null,
              groundingStatus: null,
              citations: [],
              retrievalScoreTop: null,
            },
            {
              id: assistantMessageId,
              conversationId: exchange.conversationId,
              role: "assistant",
              content: exchange.answer,
              createdAt: assistantCreatedAt,
              executionId: exchange.executionId,
              intent: exchange.intent,
              groundingStatus: exchange.groundingStatus,
              citations: exchange.citations,
              retrievalScoreTop: exchange.retrievalScoreTop,
            },
          ],
          { session },
        );
      });
    } finally {
      await session.endSession();
    }
    return { userMessageId, assistantMessageId };
  }

  public async updateTitle(
    conversationId: string,
    userId: string,
    title: string,
  ): Promise<boolean> {
    const result = await this.conversations.updateOne(
      { id: conversationId, userId },
      { $set: { title, updatedAt: new Date().toISOString() } },
    );
    return result.matchedCount === 1;
  }

  public async deleteConversation(
    conversationId: string,
    userId: string,
  ): Promise<boolean> {
    const session = this.client.startSession();
    try {
      let deleted = false;
      await session.withTransaction(async () => {
        const result = await this.conversations.deleteOne(
          { id: conversationId, userId },
          { session },
        );
        deleted = result.deletedCount === 1;
        if (deleted) {
          await this.messages.deleteMany({ conversationId }, { session });
        }
      });
      return deleted;
    } finally {
      await session.endSession();
    }
  }

  public async deleteByUser(userId: string): Promise<void> {
    const session = this.client.startSession();
    try {
      await session.withTransaction(async () => {
        const conversations = await this.conversations
          .find({ userId }, { projection: { id: 1, _id: 0 }, session })
          .toArray();
        const conversationIds = conversations.map((conversation) => conversation.id);
        await this.conversations.deleteMany({ userId }, { session });
        if (conversationIds.length > 0) {
          await this.messages.deleteMany(
            { conversationId: { $in: conversationIds } },
            { session },
          );
        }
      });
    } finally {
      await session.endSession();
    }
  }
}

function mapConversation(
  document: ConversationDocument,
): ConversationRecord {
  return {
    id: requiredString(document.id, "id"),
    userId: requiredString(document.userId, "userId"),
    courseId: requiredString(document.courseId, "courseId"),
    title: nullableString(document.title, "title"),
    createdAt: requiredString(document.createdAt, "createdAt"),
    updatedAt: requiredString(document.updatedAt, "updatedAt"),
  };
}

function mapMessage(document: MessageDocument): ConversationMessageRecord {
  const role = requiredString(document.role, "role");
  if (role !== "user" && role !== "assistant") {
    throw new Error("Stored conversation message role is invalid");
  }
  const groundingStatus = nullableString(
    document.groundingStatus,
    "groundingStatus",
  );
  if (
    groundingStatus !== null &&
    groundingStatus !== "grounded" &&
    groundingStatus !== "insufficient" &&
    groundingStatus !== "unverified"
  ) {
    throw new Error("Stored conversation grounding status is invalid");
  }
  const intent = nullableString(document.intent, "intent");
  const parsedIntent =
    intent === null ? null : chatIntentSchema.safeParse(intent);
  if (parsedIntent && !parsedIntent.success) {
    throw new Error("Stored conversation intent is invalid");
  }
  const parsedCitations = citationsSchema.safeParse(document.citations);
  if (!parsedCitations.success) {
    throw new Error("Stored conversation citations are invalid");
  }

  return {
    id: requiredString(document.id, "id"),
    conversationId: requiredString(document.conversationId, "conversationId"),
    role,
    content: requiredString(document.content, "content"),
    createdAt: requiredString(document.createdAt, "createdAt"),
    executionId: nullableString(document.executionId, "executionId"),
    intent: parsedIntent?.data ?? null,
    groundingStatus,
    citations: parsedCitations.data,
    retrievalScoreTop: nullableNumber(
      document.retrievalScoreTop,
      "retrievalScoreTop",
    ),
  };
}

function requiredString(value: unknown, column: string): string {
  if (typeof value !== "string") {
    throw new Error(`Stored conversation field ${column} is invalid`);
  }
  return value;
}

function nullableString(value: unknown, column: string): string | null {
  return value === null || value === undefined
    ? null
    : requiredString(value, column);
}

function nullableNumber(value: unknown, column: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Stored conversation field ${column} is invalid`);
  }
  return value;
}

export function parseLegacyConversationIntent(value: string | null): ChatIntent | null {
  if (value === null) return null;
  const parsed = chatIntentSchema.safeParse(value);
  if (!parsed.success) throw new Error("Stored conversation intent is invalid");
  return parsed.data;
}

export function parseLegacyConversationCitations(
  value: string | null,
): ValidatedCitation[] {
  if (value === null) return [];
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    throw new Error("Stored conversation citations are invalid");
  }
  const parsed = citationsSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new Error("Stored conversation citations are invalid");
  }
  return parsed.data;
}

