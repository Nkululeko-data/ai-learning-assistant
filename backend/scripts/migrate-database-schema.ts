import { loadConfig } from "../src/config/config";
import { createPostgresPool } from "../src/infra/postgres/connection";
import { runDatabaseMigrations } from "../src/infra/postgres/migrations/006-runtime-storage";

async function main(): Promise<void> {
  const config = loadConfig({ requireJwtSecrets: false });
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required to run Neon migrations");
  }
  const pool = createPostgresPool(config.databaseUrl);
  try {
    const version = await runDatabaseMigrations(pool);
    console.log(`Neon database schema is at version ${version}`);
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Migration failed";
  process.stderr.write(`Database migration failed: ${message}\n`);
  process.exitCode = 1;
});
