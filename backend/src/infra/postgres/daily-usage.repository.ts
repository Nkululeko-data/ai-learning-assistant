import type { Pool } from "pg";
import type { DailyUsageRepository } from "../sqlite/conversation.repository";

/**
 * Stores shared daily request and token budgets in PostgreSQL.
 */
export class PgDailyUsageRepository implements DailyUsageRepository {
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
      `UPDATE chat_daily_usage
       SET token_count = token_count + $3
       WHERE user_id = $1 AND usage_date = $2::date`,
      [userId, usageDate, tokenCount],
    );
    if (result.rowCount !== 1) {
      throw new Error("Chat daily usage reservation is missing");
    }
  }
}
