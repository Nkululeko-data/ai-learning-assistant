import { Pool } from "pg";

export function createPostgresPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000,
    application_name: "ai-learning-assistant",
  });
}

export async function verifyPostgresConnection(pool: Pool): Promise<void> {
  await pool.query("SELECT 1");
}
