import { z } from "zod";
import type { Pool, PoolClient, QueryResultRow } from "pg";
import { ConflictError, NotFoundError } from "../../common/errors/app-error";

const recordTables = {
  learningSummaries: "learning_summaries",
  flashcards: "flashcards",
  quizzes: "quizzes",
  quizAttempts: "quiz_attempts",
  feedback: "feedback",
  activityEvents: "activity_events",
  gapReports: "gap_reports",
  configVersions: "config_versions",
  agentExecutions: "agent_executions",
} as const;

export type SharedRecordCollection = keyof typeof recordTables;

interface PayloadRow extends QueryResultRow {
  payload: unknown;
}

/**
 * Provides schema-validated JSONB persistence for feature records shared by all API instances.
 */
export class PgJsonRecordCollection<T extends { id: string }> {
  private readonly table: string;

  public constructor(
    private readonly pool: Pool,
    collection: SharedRecordCollection,
    private readonly schema: z.ZodType<T>,
  ) {
    this.table = recordTables[collection];
  }

  public async getById(id: string): Promise<T | null> {
    const result = await this.pool.query<PayloadRow>(
      `SELECT payload FROM ${this.table} WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? this.parse(result.rows[0].payload) : null;
  }

  public async list(): Promise<T[]> {
    const result = await this.pool.query<PayloadRow>(
      `SELECT payload FROM ${this.table} ORDER BY id`,
    );
    return result.rows.map((row) => this.parse(row.payload));
  }

  public async listByField(field: string, value: string): Promise<T[]> {
    const result = await this.pool.query<PayloadRow>(
      `SELECT payload FROM ${this.table}
       WHERE payload->>$1 = $2
       ORDER BY payload->>'createdAt', id`,
      [field, value],
    );
    return result.rows.map((row) => this.parse(row.payload));
  }

  public async listByFields(
    fields: Record<string, string>,
  ): Promise<T[]> {
    const entries = Object.entries(fields);
    if (entries.length === 0) return this.list();
    const clauses = entries.map(
      (_, index) => `payload->>$${index * 2 + 1} = $${index * 2 + 2}`,
    );
    const values = entries.flatMap(([field, value]) => [field, value]);
    const result = await this.pool.query<PayloadRow>(
      `SELECT payload FROM ${this.table}
       WHERE ${clauses.join(" AND ")}
       ORDER BY payload->>'createdAt', id`,
      values,
    );
    return result.rows.map((row) => this.parse(row.payload));
  }

  public async findByFields(fields: Record<string, string>): Promise<T | null> {
    const entries = Object.entries(fields);
    if (entries.length === 0) {
      throw new Error("At least one field is required to find a shared record");
    }
    const clauses = entries.map(
      (_, index) => `payload->>$${index * 2 + 1} = $${index * 2 + 2}`,
    );
    const values = entries.flatMap(([field, value]) => [field, value]);
    const result = await this.pool.query<PayloadRow>(
      `SELECT payload FROM ${this.table}
       WHERE ${clauses.join(" AND ")}
       LIMIT 1`,
      values,
    );
    return result.rows[0] ? this.parse(result.rows[0].payload) : null;
  }

  public async insert(record: T): Promise<T> {
    const parsed = this.schema.parse(record);
    await this.pool.query(
      `INSERT INTO ${this.table} (id, payload) VALUES ($1, $2::jsonb)`,
      [parsed.id, JSON.stringify(parsed)],
    );
    return parsed;
  }

  public async update(
    id: string,
    update: (record: T) => T,
    expectedVersion?: number,
  ): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      try {
        const result = await client.query<PayloadRow>(
          `SELECT payload FROM ${this.table} WHERE id = $1 FOR UPDATE`,
          [id],
        );
        if (!result.rows[0]) throw new NotFoundError();
        const current = this.parse(result.rows[0].payload);
        if (
          expectedVersion !== undefined &&
          "version" in current &&
          current.version !== expectedVersion
        ) {
          throw new ConflictError("The record was changed by another request");
        }
        const next = this.schema.parse(update(current));
        if (next.id !== id) {
          throw new Error("Shared record update cannot change its ID");
        }
        await client.query(
          `UPDATE ${this.table} SET payload = $2::jsonb WHERE id = $1`,
          [id, JSON.stringify(next)],
        );
        await client.query("COMMIT");
        return next;
      } catch (error) {
        await rollback(client, error);
        throw error;
      }
    } finally {
      client.release();
    }
  }

  public async remove(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM ${this.table} WHERE id = $1`, [id]);
  }

  public async deleteByField(field: string, value: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM ${this.table} WHERE payload->>$1 = $2`,
      [field, value],
    );
  }

  private parse(value: unknown): T {
    return this.schema.parse(value);
  }
}

async function rollback(client: PoolClient, cause: unknown): Promise<void> {
  try {
    await client.query("ROLLBACK");
  } catch (rollbackError) {
    throw new AggregateError(
      [cause, rollbackError],
      "Shared record transaction failed and rollback also failed",
    );
  }
}
