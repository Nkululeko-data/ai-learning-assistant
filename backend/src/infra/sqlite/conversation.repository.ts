import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
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

interface ConversationRow {
  id: string;
  user_id: string;
  course_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  execution_id: string | null;
  intent: string | null;
  grounding_status: GroundingStatus | null;
  cited_chunk_ids: string | null;
  cited_document_ids: string | null;
  citations: string | null;
  retrieval_score_top: number | null;
}

export class ConversationRepository {
  public constructor(private readonly database: Database.Database) {}

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
      .get(id) as ConversationRow | undefined;
    return row ? mapConversation(row) : null;
  }

  public findMessage(id: string): ConversationMessageRecord | null {
    const row = this.database
      .prepare("SELECT * FROM messages WHERE id = ?")
      .get(id) as MessageRow | undefined;
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
          .all(userId, courseId, cursorId ?? "", limit + 1) as ConversationRow[]
      : (this.database
          .prepare(
            `SELECT * FROM conversations
             WHERE user_id = ? AND id > ?
             ORDER BY id ASC LIMIT ?`,
          )
          .all(userId, cursorId ?? "", limit + 1) as ConversationRow[]);
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
      .all(conversationId) as MessageRow[];
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
      .all(conversationId, maximumMessages) as MessageRow[];
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
    const transaction = this.database.transaction(() => {
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
    });
    transaction();
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

}

function mapConversation(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    userId: row.user_id,
    courseId: row.course_id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMessage(row: MessageRow): ConversationMessageRecord {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
    executionId: row.execution_id,
    intent: parseIntent(row.intent),
    groundingStatus: row.grounding_status,
    citations: decodeCitations(row.citations),
    retrievalScoreTop: row.retrieval_score_top,
  };
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
