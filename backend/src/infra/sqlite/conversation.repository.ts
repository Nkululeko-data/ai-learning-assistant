import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { chatIntentSchema, type ChatIntent } from "../../ai/schemas/chat.schemas";
import type {
  GroundingStatus,
  ValidatedCitation,
} from "../../ai/graphs/chat-state";
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

export interface ConversationRecord {
  id: string;
  userId: string;
  courseId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessageRecord {
  id: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  executionId: string | null;
  intent: ChatIntent | null;
  groundingStatus: GroundingStatus | null;
  citations: ValidatedCitation[];
  retrievalScoreTop: number | null;
}

export interface ConversationExchange {
  conversationId: string;
  userId: string;
  courseId: string;
  title: string | null;
  createConversation: boolean;
  question: string;
  answer: string;
  executionId: string;
  intent: ChatIntent | null;
  groundingStatus: GroundingStatus | null;
  citations: ValidatedCitation[];
  retrievalScoreTop: number | null;
}

export class ConversationRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public dailyTokenUsage(userId: string, usageDate: string): number {
    const row = this.database
      .prepare(
        `SELECT token_count FROM chat_daily_usage
         WHERE user_id = ? AND usage_date = ?`,
      )
      .get(userId, usageDate) as { token_count: number } | undefined;
    return row?.token_count ?? 0;
  }

  public reserveDailyRequest(
    userId: string,
    usageDate: string,
    requestLimit: number,
  ): boolean {
    const result = this.database
      .prepare(
        `INSERT INTO chat_daily_usage (user_id, usage_date, request_count, token_count)
         VALUES (?, ?, 1, 0)
         ON CONFLICT(user_id, usage_date) DO UPDATE
         SET request_count = request_count + 1
         WHERE request_count < ?`,
      )
      .run(userId, usageDate, requestLimit);
    return result.changes === 1;
  }

  public recordDailyTokenUsage(
    userId: string,
    usageDate: string,
    tokenCount: number,
  ): void {
    const result = this.database
      .prepare(
        `UPDATE chat_daily_usage
         SET token_count = token_count + ?
         WHERE user_id = ? AND usage_date = ?`,
      )
      .run(tokenCount, userId, usageDate);
    if (result.changes !== 1) {
      throw new Error("Chat daily usage reservation is missing");
    }
  }

  public findConversation(id: string): ConversationRecord | null {
    const row = this.database
      .prepare("SELECT * FROM conversations WHERE id = ?")
      .get(id);
    return row ? mapConversation(row) : null;
  }

  public findMessage(id: string): ConversationMessageRecord | null {
    const row = this.database
      .prepare("SELECT * FROM messages WHERE id = ?")
      .get(id);
    return row ? mapMessage(row) : null;
  }

  public listConversations(
    userId: string,
    courseId: string | undefined,
    limit: number,
    cursorId?: string,
  ): { items: ConversationRecord[]; nextCursor?: string } {
    const rows = courseId
      ? this.database
          .prepare(
            `SELECT * FROM conversations
             WHERE user_id = ? AND course_id = ? AND id > ?
             ORDER BY id ASC LIMIT ?`,
          )
          .all(userId, courseId, cursorId ?? "", limit + 1)
      : (this.database
          .prepare(
            `SELECT * FROM conversations
             WHERE user_id = ? AND id > ?
             ORDER BY id ASC LIMIT ?`,
          )
          .all(userId, cursorId ?? "", limit + 1));
    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map(mapConversation);
    const lastItem = items.at(-1);
    if (!hasMore || !lastItem) return { items };
    return {
      items,
      nextCursor: Buffer.from(lastItem.id).toString("base64url"),
    };
  }

  public listMessages(conversationId: string): ConversationMessageRecord[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM messages
         WHERE conversation_id = ?
         ORDER BY created_at ASC, rowid ASC`,
      )
      .all(conversationId);
    return rows.map(mapMessage);
  }

  public getRecentMessages(
    conversationId: string,
    maximumMessages: number,
  ): ConversationMessageRecord[] {
    if (maximumMessages === 0) return [];
    const rows = this.database
      .prepare(
        `SELECT * FROM (
           SELECT * FROM messages
           WHERE conversation_id = ?
           ORDER BY created_at DESC, rowid DESC
           LIMIT ?
         )
         ORDER BY created_at ASC, rowid ASC`,
      )
      .all(conversationId, maximumMessages);
    return rows.map(mapMessage);
  }

  public saveExchange(exchange: ConversationExchange): {
    userMessageId: string;
    assistantMessageId: string;
  } {
    const userMessageId = randomUUID();
    const assistantMessageId = randomUUID();
    const now = new Date();
    const createdAt = now.toISOString();
    const assistantCreatedAt = new Date(now.getTime() + 1).toISOString();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (exchange.createConversation) {
        this.database
          .prepare(
            `INSERT INTO conversations
             (id, user_id, course_id, title, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            exchange.conversationId,
            exchange.userId,
            exchange.courseId,
            exchange.title,
            createdAt,
            assistantCreatedAt,
          );
      } else {
        this.database
          .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
          .run(assistantCreatedAt, exchange.conversationId);
      }

      const insertMessage = this.database.prepare(
        `INSERT INTO messages
         (id, conversation_id, role, content, created_at, execution_id, intent,
          grounding_status, cited_chunk_ids, cited_document_ids, citations,
          retrieval_score_top)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      insertMessage.run(
        userMessageId,
        exchange.conversationId,
        "user",
        exchange.question,
        createdAt,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
      );
      insertMessage.run(
        assistantMessageId,
        exchange.conversationId,
        "assistant",
        exchange.answer,
        assistantCreatedAt,
        exchange.executionId,
        exchange.intent,
        exchange.groundingStatus,
        JSON.stringify(exchange.citations.map(({ chunkId }) => chunkId)),
        JSON.stringify(exchange.citations.map(({ documentId }) => documentId)),
        JSON.stringify(exchange.citations),
        exchange.retrievalScoreTop,
      );
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { userMessageId, assistantMessageId };
  }

  public updateTitle(
    conversationId: string,
    userId: string,
    title: string,
  ): boolean {
    const result = this.database
      .prepare(
        `UPDATE conversations SET title = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
      )
      .run(title, new Date().toISOString(), conversationId, userId);
    return result.changes === 1;
  }

  public deleteConversation(conversationId: string, userId: string): boolean {
    const result = this.database
      .prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?")
      .run(conversationId, userId);
    return result.changes === 1;
  }

  public deleteByUser(userId: string): void {
    this.database
      .prepare("DELETE FROM conversations WHERE user_id = ?")
      .run(userId);
  }

}

function mapConversation(row: Record<string, unknown>): ConversationRecord {
  return {
    id: requiredString(row.id, "id"),
    userId: requiredString(row.user_id, "user_id"),
    courseId: requiredString(row.course_id, "course_id"),
    title: nullableString(row.title, "title"),
    createdAt: requiredString(row.created_at, "created_at"),
    updatedAt: requiredString(row.updated_at, "updated_at"),
  };
}

function mapMessage(row: Record<string, unknown>): ConversationMessageRecord {
  const role = requiredString(row.role, "role");
  if (role !== "user" && role !== "assistant") {
    throw new Error("Stored conversation message role is invalid");
  }
  const groundingStatus = nullableString(
    row.grounding_status,
    "grounding_status",
  );
  if (
    groundingStatus !== null &&
    groundingStatus !== "grounded" &&
    groundingStatus !== "insufficient" &&
    groundingStatus !== "unverified"
  ) {
    throw new Error("Stored conversation grounding status is invalid");
  }

  return {
    id: requiredString(row.id, "id"),
    conversationId: requiredString(row.conversation_id, "conversation_id"),
    role,
    content: requiredString(row.content, "content"),
    createdAt: requiredString(row.created_at, "created_at"),
    executionId: nullableString(row.execution_id, "execution_id"),
    intent: parseIntent(nullableString(row.intent, "intent")),
    groundingStatus,
    citations: decodeCitations(nullableString(row.citations, "citations")),
    retrievalScoreTop: nullableNumber(
      row.retrieval_score_top,
      "retrieval_score_top",
    ),
  };
}

function requiredString(value: unknown, column: string): string {
  if (typeof value !== "string") {
    throw new Error(`Stored conversation column ${column} is invalid`);
  }
  return value;
}

function nullableString(value: unknown, column: string): string | null {
  return value === null ? null : requiredString(value, column);
}

function nullableNumber(value: unknown, column: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number") {
    throw new Error(`Stored conversation column ${column} is invalid`);
  }
  return value;
}

function parseIntent(value: string | null): ChatIntent | null {
  if (value === null) return null;
  const parsed = chatIntentSchema.safeParse(value);
  if (!parsed.success) throw new Error("Stored conversation intent is invalid");
  return parsed.data;
}

function decodeCitations(value: string | null): ValidatedCitation[] {
  if (value === null) return [];
  const parsed = citationsSchema.safeParse(JSON.parse(value));
  if (!parsed.success) {
    throw new Error("Stored conversation citations are invalid");
  }
  return parsed.data;
}
