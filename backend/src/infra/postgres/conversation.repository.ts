import { randomUUID } from "node:crypto";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { chatIntentSchema, type ChatIntent } from "../../ai/schemas/chat.schemas";
import type {
  GroundingStatus,
  ValidatedCitation,
} from "../../ai/graphs/chat-state";
import type {
  ConversationExchange,
  ConversationMessageRecord,
  ConversationRecord,
  ConversationStore,
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

interface ConversationRow extends QueryResultRow {
  id: string;
  user_id: string;
  course_id: string;
  title: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface MessageRow extends QueryResultRow {
  id: string;
  conversation_id: string;
  role: "user" | "assistant";
  content: string;
  created_at: Date | string;
  execution_id: string | null;
  intent: string | null;
  grounding_status: GroundingStatus | null;
  citations: unknown;
  retrieval_score_top: number | null;
}

/**
 * Stores conversation history and daily usage in the shared PostgreSQL database.
 */
export class PgConversationRepository implements ConversationStore {
  public constructor(private readonly pool: Pool) {}

  public async dailyTokenUsage(userId: string, usageDate: string): Promise<number> {
    const result = await this.pool.query<{ token_count: string | number }>(
      `SELECT token_count FROM chat_daily_usage
       WHERE user_id = $1 AND usage_date = $2::date`,
      [userId, usageDate],
    );
    return Number(result.rows[0]?.token_count ?? 0);
  }

  public async reserveDailyRequest(
    userId: string,
    usageDate: string,
    requestLimit: number,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO chat_daily_usage
       (user_id, usage_date, request_count, token_count)
       VALUES ($1, $2::date, 1, 0)
       ON CONFLICT (user_id, usage_date) DO UPDATE
       SET request_count = chat_daily_usage.request_count + 1
       WHERE chat_daily_usage.request_count < $3
       RETURNING user_id`,
      [userId, usageDate, requestLimit],
    );
    return result.rowCount === 1;
  }

  public async recordDailyTokenUsage(
    userId: string,
    usageDate: string,
    tokenCount: number,
  ): Promise<void> {
    const result = await this.pool.query(
      `UPDATE chat_daily_usage SET token_count = token_count + $3
       WHERE user_id = $1 AND usage_date = $2::date`,
      [userId, usageDate, tokenCount],
    );
    if (result.rowCount !== 1) {
      throw new Error("Chat daily usage reservation is missing");
    }
  }

  public async findConversation(id: string): Promise<ConversationRecord | null> {
    const result = await this.pool.query<ConversationRow>(
      "SELECT * FROM conversations WHERE id = $1",
      [id],
    );
    return result.rows[0] ? mapConversation(result.rows[0]) : null;
  }

  public async findMessage(
    id: string,
  ): Promise<ConversationMessageRecord | null> {
    const result = await this.pool.query<MessageRow>(
      "SELECT * FROM messages WHERE id = $1",
      [id],
    );
    return result.rows[0] ? mapMessage(result.rows[0]) : null;
  }

  public async listConversations(
    userId: string,
    courseId: string | undefined,
    limit: number,
    cursorId?: string,
  ): Promise<{ items: ConversationRecord[]; nextCursor?: string }> {
    const result = courseId
      ? await this.pool.query<ConversationRow>(
          `SELECT * FROM conversations
           WHERE user_id = $1 AND course_id = $2 AND id > $3
           ORDER BY id ASC LIMIT $4`,
          [userId, courseId, cursorId ?? "", limit + 1],
        )
      : await this.pool.query<ConversationRow>(
          `SELECT * FROM conversations
           WHERE user_id = $1 AND id > $2
           ORDER BY id ASC LIMIT $3`,
          [userId, cursorId ?? "", limit + 1],
        );
    const hasMore = result.rows.length > limit;
    const items = (hasMore ? result.rows.slice(0, limit) : result.rows).map(
      mapConversation,
    );
    const last = items.at(-1);
    return !hasMore || !last
      ? { items }
      : { items, nextCursor: Buffer.from(last.id).toString("base64url") };
  }

  public async listMessages(
    conversationId: string,
  ): Promise<ConversationMessageRecord[]> {
    const result = await this.pool.query<MessageRow>(
      `SELECT * FROM messages
       WHERE conversation_id = $1
       ORDER BY created_at ASC, id ASC`,
      [conversationId],
    );
    return result.rows.map(mapMessage);
  }

  public async getRecentMessages(
    conversationId: string,
    maximumMessages: number,
  ): Promise<ConversationMessageRecord[]> {
    if (maximumMessages === 0) return [];
    const result = await this.pool.query<MessageRow>(
      `SELECT * FROM (
         SELECT * FROM messages
         WHERE conversation_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT $2
       ) recent
       ORDER BY created_at ASC, id ASC`,
      [conversationId, maximumMessages],
    );
    return result.rows.map(mapMessage);
  }

  public async saveExchange(exchange: ConversationExchange): Promise<{
    userMessageId: string;
    assistantMessageId: string;
  }> {
    const userMessageId = randomUUID();
    const assistantMessageId = randomUUID();
    const createdAt = new Date();
    const assistantCreatedAt = new Date(createdAt.getTime() + 1);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      try {
        if (exchange.createConversation) {
          await client.query(
            `INSERT INTO conversations
             (id, user_id, course_id, title, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              exchange.conversationId,
              exchange.userId,
              exchange.courseId,
              exchange.title,
              createdAt,
              assistantCreatedAt,
            ],
          );
        } else {
          const updated = await client.query(
            `UPDATE conversations SET updated_at = $1
             WHERE id = $2 AND user_id = $3 AND course_id = $4`,
            [
              assistantCreatedAt,
              exchange.conversationId,
              exchange.userId,
              exchange.courseId,
            ],
          );
          if (updated.rowCount !== 1) {
            throw new Error("Conversation changed before the exchange was saved");
          }
        }

        await insertMessage(client, {
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
        });
        await insertMessage(client, {
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
        });
        await client.query("COMMIT");
      } catch (error) {
        await rollback(client, error);
        throw error;
      }
    } finally {
      client.release();
    }
    return { userMessageId, assistantMessageId };
  }

  public async updateTitle(
    conversationId: string,
    userId: string,
    title: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE conversations SET title = $1, updated_at = $2
       WHERE id = $3 AND user_id = $4`,
      [title, new Date(), conversationId, userId],
    );
    return result.rowCount === 1;
  }

  public async deleteConversation(
    conversationId: string,
    userId: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      "DELETE FROM conversations WHERE id = $1 AND user_id = $2",
      [conversationId, userId],
    );
    return result.rowCount === 1;
  }

  public async deleteByUser(userId: string): Promise<void> {
    await this.pool.query("DELETE FROM conversations WHERE user_id = $1", [
      userId,
    ]);
  }
}

async function insertMessage(
  client: PoolClient,
  message: {
    id: string;
    conversationId: string;
    role: "user" | "assistant";
    content: string;
    createdAt: Date;
    executionId: string | null;
    intent: ChatIntent | null;
    groundingStatus: GroundingStatus | null;
    citations: ValidatedCitation[];
    retrievalScoreTop: number | null;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO messages
     (id, conversation_id, role, content, created_at, execution_id, intent,
      grounding_status, cited_chunk_ids, cited_document_ids, citations,
      retrieval_score_top)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12)`,
    [
      message.id,
      message.conversationId,
      message.role,
      message.content,
      message.createdAt,
      message.executionId,
      message.intent,
      message.groundingStatus,
      message.citations.map(({ chunkId }) => chunkId),
      message.citations.map(({ documentId }) => documentId),
      JSON.stringify(message.citations),
      message.retrievalScoreTop,
    ],
  );
}

function mapConversation(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    userId: row.user_id,
    courseId: row.course_id,
    title: row.title,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function mapMessage(row: MessageRow): ConversationMessageRecord {
  const intent = row.intent === null ? null : chatIntentSchema.parse(row.intent);
  const citations = citationsSchema.safeParse(row.citations ?? []);
  if (!citations.success) {
    throw new Error("Stored conversation citations are invalid");
  }
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    createdAt: toIsoString(row.created_at),
    executionId: row.execution_id,
    intent,
    groundingStatus: row.grounding_status,
    citations: citations.data,
    retrievalScoreTop: row.retrieval_score_top,
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function rollback(client: PoolClient, cause: unknown): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch (rollbackError) {
    throw new AggregateError(
      [cause, rollbackError],
      "Conversation transaction failed and rollback also failed",
    );
  }
}
