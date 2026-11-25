import type { Pool } from "pg";
import { repairApplicationRecordsMigrationSql } from "./007-repair-application-records";

export const CURRENT_DATABASE_SCHEMA_VERSION = 7;

const runtimeStorageMigrationSql = `
CREATE TABLE IF NOT EXISTS user_id_aliases (
  legacy_id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_id_aliases_not_self CHECK (legacy_id <> user_id)
);

CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY,
  type text NOT NULL CHECK (type IN ('ingest', 'reembed', 'generate', 'cluster', 'cleanup', 'reconcile', 'backup', 'erase', 'prune')),
  status text NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed', 'dead')),
  attempts integer NOT NULL CHECK (attempts >= 0),
  max_attempts integer NOT NULL CHECK (max_attempts BETWEEN 1 AND 10),
  run_after timestamptz NOT NULL,
  locked_until timestamptz,
  lease_token uuid,
  payload jsonb NOT NULL,
  result jsonb,
  error jsonb,
  created_by text NOT NULL,
  request_id text,
  schedule_key text,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  finished_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS jobs_schedule_key_unique
  ON jobs (schedule_key) WHERE schedule_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS jobs_status_run_after_idx
  ON jobs (status, run_after);
CREATE INDEX IF NOT EXISTS jobs_type_status_idx
  ON jobs (type, status);

CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY,
  course_id uuid NOT NULL REFERENCES courses(id),
  owner_id uuid NOT NULL REFERENCES users(id),
  scope text NOT NULL CHECK (scope IN ('course', 'personal')),
  filename text NOT NULL CHECK (length(filename) BETWEEN 1 AND 255),
  storage_key uuid NOT NULL,
  mime_type text NOT NULL CHECK (mime_type IN (
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'video/mp4'
  )),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  status text NOT NULL CHECK (status IN ('uploaded', 'processing', 'ready', 'failed', 'deleting')),
  error_code text,
  error_detail text CHECK (error_detail IS NULL OR length(error_detail) <= 500),
  extraction_diagnostics jsonb,
  chunk_count integer CHECK (chunk_count IS NULL OR chunk_count >= 0),
  embedding_model text,
  ingest_job_id uuid REFERENCES jobs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  ready_at timestamptz,
  CONSTRAINT documents_storage_key_unique UNIQUE (storage_key)
);

CREATE INDEX IF NOT EXISTS documents_course_id_idx ON documents (course_id);
CREATE INDEX IF NOT EXISTS documents_status_idx ON documents (status);
CREATE UNIQUE INDEX IF NOT EXISTS documents_course_scope_owner_hash_unique
  ON documents (course_id, scope, owner_id, content_hash)
  WHERE status <> 'deleting';

CREATE TABLE IF NOT EXISTS scheduler_state (
  id uuid PRIMARY KEY,
  task_name text NOT NULL UNIQUE,
  last_run_at timestamptz,
  next_run_at timestamptz NOT NULL,
  last_status text NOT NULL CHECK (last_status IN ('ok', 'error', 'skipped'))
);

CREATE UNIQUE INDEX IF NOT EXISTS learning_summaries_source_version_unique
  ON learning_summaries (
    (payload->>'courseId'),
    (COALESCE(payload->>'ownerId', 'course')),
    (payload->>'sourceHash'),
    ((payload->>'version')::integer)
  );
CREATE UNIQUE INDEX IF NOT EXISTS flashcards_source_version_unique
  ON flashcards (
    (payload->>'courseId'),
    (COALESCE(payload->>'ownerId', 'course')),
    (payload->>'sourceHash'),
    ((payload->>'version')::integer)
  );
CREATE UNIQUE INDEX IF NOT EXISTS quizzes_lineage_version_unique
  ON quizzes ((payload->>'lineageId'), ((payload->>'version')::integer));
CREATE UNIQUE INDEX IF NOT EXISTS feedback_message_user_unique
  ON feedback ((payload->>'messageId'), (payload->>'userId'));
CREATE UNIQUE INDEX IF NOT EXISTS activity_events_dedupe_key_unique
  ON activity_events ((payload->>'dedupeKey'));
CREATE UNIQUE INDEX IF NOT EXISTS config_versions_version_unique
  ON config_versions (((payload->>'version')::integer));
`;

const migrations = [
{ version: 6, sql: runtimeStorageMigrationSql },
{ version: 7, sql: repairApplicationRecordsMigrationSql },
];

export async function runDatabaseMigrations(pool: Pool): Promise<number> {
  const client = await pool.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN");
    transactionOpen = true;
    await client.query("SELECT pg_advisory_xact_lock(761204019)");
    const current = await client.query<{ version: number }>(
      "SELECT COALESCE(MAX(version), 0)::integer AS version FROM schema_migrations",
    );
    const currentVersion = current.rows[0]?.version ?? 0;
    if (currentVersion > CURRENT_DATABASE_SCHEMA_VERSION) {
      throw new Error(
        `Neon schema version ${currentVersion} is newer than supported version ${CURRENT_DATABASE_SCHEMA_VERSION}`,
      );
    }
    if (currentVersion < 5) {
      throw new Error(
        `Neon schema version ${currentVersion} is unsupported; version 5 is required before runtime migration`,
      );
    }

    const appliedResult = await client.query<{ version: number }>(
      "SELECT version FROM schema_migrations WHERE version IN ($1, $2, $3)",
      [5, 6, 7],
    );
    const appliedVersions = new Set(
      appliedResult.rows.map((row) => row.version),
    );
    for (const version of [5, 6, 7]) {
      if (currentVersion >= version && !appliedVersions.has(version)) {
        throw new Error(
          `Neon migration history is inconsistent; version ${version} is missing`,
        );
      }
    }

    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) {
        continue;
      }
      if (!appliedVersions.has(migration.version - 1)) {
        throw new Error(
          `Neon schema version ${migration.version - 1} is required before migration ${migration.version}`,
        );
      }
      await client.query(migration.sql);
      await client.query(
        "INSERT INTO schema_migrations (version, applied_at) VALUES ($1, now())",
        [migration.version],
      );
      appliedVersions.add(migration.version);
    }

    await client.query("COMMIT");
    transactionOpen = false;
    return CURRENT_DATABASE_SCHEMA_VERSION;
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          "Database migration failed and rollback could not complete",
        );
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function getDatabaseSchemaVersion(pool: Pool): Promise<number> {
  const result = await pool.query<{ version: number }>(
    "SELECT COALESCE(MAX(version), 0)::integer AS version FROM schema_migrations",
  );
  return result.rows[0]?.version ?? 0;
}
