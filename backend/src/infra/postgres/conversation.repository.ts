import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { chatIntentSchema } from "../../ai/schemas/chat.schemas";
import type {
  GroundingStatus,
  ValidatedCitation,
} from "../../ai/graphs/chat-state";
import type {
  ConversationRepositoryPort,
} from "../mongodb/conversation.repository";
import type {
  ConversationExchange,
  ConversationMessageRecord,
  ConversationRecord,
} from "../sqlite/conversation.repository";

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
 * Persists conversations, messages, and daily quotas in PostgreSQL.
 */
export class PgConversationRepository implements ConversationRepositoryPort {
  public constructor(private readonly pool: Pool) {}

  public async dailyTokenUsage(userId: string, usageDate: string): Promise<number> {
    const result = await this.pool.query<{ token_count: number }>(
      `SELECT token_count FROM chat_daily_usage
       WHERE user_id = $1 AND usage_date = $2`,
      [userId, usageDate],
    );
    return result.rows[0]?.token_count ?? 0;
  }

  public async reserveDailyRequest(
    userId: string,
    usageDate: string,
    requestLimit: number,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `INSERT INTO chat_daily_usage(user_id, usage_date, request_count, token_count)
       VALUES ($1, $2, 1, 0)
       ON CONFLICT (user_id, usage_date) DO UPDATE
       SET request_count = chat_daily_usage.request_count + 1
       WHERE chat_daily_usage.request_count < $3`,
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
       WHERE user_id = $1 AND usage_date = $2`,
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
           ORDER BY id LIMIT $4`,
          [userId, courseId, cursorId ?? "", limit + 1],
        )
      : await this.pool.query<ConversationRow>(
          `SELECT * FROM conversations WHERE user_id = $1 AND id > $2
           ORDER BY id LIMIT $3`,
          [userId, cursorId ?? "", limit + 1],
        );
    const hasMore = result.rows.length > limit;
    const items = (hasMore ? result.rows.slice(0, limit) : result.rows).map(
      mapConversation,
    );
    const last = items.at(-1);
    return {
      items,
      ...(hasMore && last
        ? { nextCursor: Buffer.from(last.id).toString("base64url") }
        : {}),
    };
  }

  public async listMessages(
    conversationId: string,
  ): Promise<ConversationMessageRecord[]> {
    const result = await this.pool.query<MessageRow>(
      `SELECT * FROM messages WHERE conversation_id = $1
       ORDER BY created_at, id`,
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
         SELECT * FROM messages WHERE conversation_id = $1
         ORDER BY created_at DESC, id DESC LIMIT $2
       ) recent ORDER BY created_at, id`,
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
    const now = new Date();
    const createdAt = now.toISOString();
    const assistantCreatedAt = new Date(now.getTime() + 1).toISOString();
    await this.withTransaction(async (client) => {
      if (exchange.createConversation) {
        await client.query(
          `INSERT INTO conversations(id, user_id, course_id, title, created_at, updated_at)
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
          "UPDATE conversations SET updated_at = $1 WHERE id = $2 AND user_id = $3",
          [assistantCreatedAt, exchange.conversationId, exchange.userId],
        );
        if (updated.rowCount !== 1) {
          throw new Error("Conversation disappeared before the exchange was saved");
        }
      }

      const citationIds = exchange.citations;
      const insert = `INSERT INTO messages(
        id, conversation_id, role, content, created_at, execution_id, intent,
        grounding_status, cited_chunk_ids, cited_document_ids,
        retrieval_score_top, citations
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb)`;
      await client.query(insert, [
        userMessageId,
        exchange.conversationId,
        "user",
        exchange.question,
        createdAt,
        null,
        null,
        null,
        [],
        [],
        null,
        JSON.stringify([]),
      ]);
      await client.query(insert, [
        assistantMessageId,
        exchange.conversationId,
        "assistant",
        exchange.answer,
        assistantCreatedAt,
        exchange.executionId,
        exchange.intent,
        exchange.groundingStatus,
        citationIds.map(({ chunkId }) => chunkId),
        citationIds.map(({ documentId }) => documentId),
        exchange.retrievalScoreTop,
        JSON.stringify(citationIds),
      ]);
    });
    return { userMessageId, assistantMessageId };
  }

  public async updateTitle(
    conversationId: string,
    userId: string,
    title: string,
  ): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE conversations SET title = $3, updated_at = $4
       WHERE id = $1 AND user_id = $2`,
      [conversationId, userId, title, new Date().toISOString()],
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

  private async withTransaction<T>(
    operation: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      try {
        const result = await operation(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            "Conversation transaction failed and could not be rolled back",
          );
        }
        throw error;
      }
    } finally {
      client.release();
    }
  }
}

function mapConversation(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    userId: row.user_id,
    courseId: row.course_id,
    title: row.title,
    createdAt: toIsoTimestamp(row.created_at),
    updatedAt: toIsoTimestamp(row.updated_at),
  };
}

function mapMessage(row: MessageRow): ConversationMessageRecord {
  const intent = row.intent === null ? null : chatIntentSchema.parse(row.intent);
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    createdAt: toIsoTimestamp(row.created_at),
    executionId: row.execution_id,
    intent,
    groundingStatus: row.grounding_status,
    citations: citationsSchema.parse(row.citations) as ValidatedCitation[],
    retrievalScoreTop: row.retrieval_score_top,
  };
}

function toIsoTimestamp(value: Date | string): string {
  const timestamp = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new Error("Stored PostgreSQL conversation timestamp is invalid");
  }
  return timestamp.toISOString();
}
