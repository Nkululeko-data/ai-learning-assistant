import { loadConfig } from "../src/config/config";
import { createPostgresPool } from "../src/infra/postgres/pool";
import {
  getSchemaVersion,
  runMigrations,
} from "../src/infra/postgres/migrate";

async function main(): Promise<void> {
  const config = loadConfig({ requireJwtSecrets: false });
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required to run Neon migrations");
  }
  const pool = createPostgresPool(config.databaseUrl);
  try {
    const appliedVersions = await runMigrations(pool);
    const version = await getSchemaVersion(pool);
    console.log(
      `PostgreSQL schema is at version ${version}; newly applied migrations: ${
        appliedVersions.length ? appliedVersions.join(", ") : "none"
      }`,
    );
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Migration failed";
  process.stderr.write(`Database migration failed: ${message}\n`);
  process.exitCode = 1;
});
