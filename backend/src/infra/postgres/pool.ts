import { Pool } from "pg";

/**
 * Creates one reusable PostgreSQL pool with a conservative cap for the current modest load.
 */
export function createPostgresPool(connectionString: string): Pool {
  return new Pool({
    connectionString,
    max: 5, // Current low traffic and one initial container need only a small pool.
    idleTimeoutMillis: 10_000, // Release idle connections promptly between small bursts.
  });
}

/**
 * Probes PostgreSQL without exposing connection details in the readiness response.
 */
export async function isPostgresReady(pool: Pool): Promise<boolean> {
  await pool.query("SELECT 1");
  return true;
}
