# AI Learning Assistant: Database Implementation (Neon Postgres + MongoDB Atlas)

Build spec for the coding agent. Repo: `Nkululeko-data/ai-learning-assistant`, backend in `backend/`.
This is the approved target architecture and phased migration plan, not a claim that the full cutover is complete. Production is currently hybrid. Original uploads now use MongoDB Atlas GridFS; keep the remaining legacy stores and single-instance deployment constraint until the final verification and cleanup gates pass.

## 0. Working rules

- Build **one step at a time**. At the end of each step: report what changed, test results, and wait for approval.
- Explain the reasoning before writing code. Separate files. A comment on every function.
- Services never depend on storage. All DB access sits behind repository interfaces.
- Tests must not call real AI providers and must not touch production data.
- Never put connection strings or secrets in the repo, logs, or chat. Env vars only.
- Do not push to the repo unless asked.

## 1. Decisions (fixed)

| Topic | Decision |
|---|---|
| Relational store | **Neon Postgres** (pooled connection string, `sslmode=require`) |
| Document / vector store | **MongoDB Atlas** with **Atlas Vector Search** |
| Postgres access | `pg` driver, plain SQL, small hand-written migration runner (no ORM) |
| Mongo access | official `mongodb` driver |
| Conversations + messages | **Move from SQLite to Neon** |
| Existing JSON data | **Migrate all relational data** into Neon, keeping existing UUIDs |
| Courses | New tables in Neon; seed some courses |
| Single-instance rule | **Retained during migration.** Revisit only after all active JSON/SQLite writers and process-local rate limiting are addressed and verified. |

## 2. What goes where

**Neon (relational, source of truth for access):**
users, roles, permissions, role_permissions, user_permission_overrides, refresh_tokens,
coach_requests, audit_logs, courses, enrolments, conversations, messages, feedback, activity_events.

**Mongo (documents and AI data):**
documents (metadata), document_chunks (text + embedding), jobs, ai_executions, generated content
(summaries, flashcards, quizzes) as defined in `Database-Design.md`.

**Rules that must hold:**
- Access is checked in Postgres first (enrolment, ownership), then Mongo is queried.
- No cross-database foreign keys or transactions. Multi-step operations are idempotent jobs.
- Chunk id is `<documentId>:<chunkIndex>`.
- Retrieval filter is applied **before** scoring:
  `courseId = X AND embeddingModel = current AND (scope = 'course' OR (scope = 'personal' AND ownerId = currentUser))`.
- Embeddings use Google's `gemini-embedding-001` model with 1024-dimensional normalized vectors to match the Atlas index.

## 3. Step 1: Config and connections

**Goal:** the app can connect to both databases, report health, and shut down cleanly.

Files:
- `src/config/config.ts`: add `DATABASE_URL`, `MONGODB_URI`, `MONGODB_DB_NAME` (Zod-validated, required outside `test`).
  Add to `AppConfig`. Keep error messages free of values.
- `.env.example`: add the three keys, blank.
- `src/infra/postgres/pool.ts`: create a `pg.Pool` (small max, e.g. 5-10; idle timeout; SSL on),
  plus `isPostgresReady(pool)` running `SELECT 1`.
- `src/infra/mongo/client.ts`: create and connect a `MongoClient`, expose `getDb()`,
  plus `isMongoReady(client)` using `ping`.
- `src/server.ts`: replace `openConversationDatabase` and `JsonStore` wiring with the two connections.
  Readiness becomes `{ postgresReady, mongoReady, schemaVersion, expectedSchemaVersion, providerConfigurationPresent }`.
  Shutdown closes the HTTP server, then the pool, then the Mongo client.
- Dependencies: `pg`, `@types/pg`, `mongodb`.

Done when: server starts against real Neon and Atlas, `/ready` is true only when both respond,
and SIGTERM closes both cleanly. Unit tests cover config validation.

## 4. Step 2: Postgres schema and migration runner

**Goal:** versioned SQL migrations applied in order, recorded in a table, safe to re-run.

Files:
- `src/infra/postgres/migrate.ts`: reads `migrations/*.sql` in filename order, applies each in a
  transaction, records it in `schema_migrations(version, applied_at)`. Use an advisory lock so two
  instances can't migrate at once.
- `backend/migrations/001_identity.sql`
- `backend/migrations/002_conversations.sql`
- `package.json`: script `"migrate": "tsx src/infra/postgres/migrate.ts"`.

**001_identity.sql** (port of `system-collections.ts`; ids are `uuid`, timestamps `timestamptz`):
- `roles(id pk, name unique check in learner/coach/admin, description, created_at)`
- `permissions(id pk, key unique, area, description)`
- `role_permissions(id pk, role_id fk, permission_id fk, unique(role_id, permission_id))`
- `users(id pk, email unique, password_hash, display_name, role_id fk, perms_version int, status check in active/suspended/archived,
  must_change_password, failed_login_count, locked_until, reset_token_hash, reset_token_expires_at,
  password_changed_at, last_login_at, erased_at, pseudonym_id, created_at, updated_at)`
- `user_permission_overrides(id pk, user_id fk, permission_id fk, effect check grant/revoke, changed_by fk, created_at, unique(user_id, permission_id))`
- `refresh_tokens(id pk, user_id fk, family_id, token_hash unique (64 chars), created_at, expires_at, used_at, revoked_at, replaced_by_token_id)`
  with indexes on `family_id` and `user_id`
- `coach_requests(id pk, user_id fk, status check pending/approved/rejected, message, requested_at, decided_by, decided_at, decision_note)`
  with **partial unique index** `unique (user_id) where status = 'pending'`
- `audit_logs(id pk, actor_id text, actor_role text, action, target_type, target_id, before jsonb, after jsonb, request_id, created_at)`
  with indexes on `actor_id` and `created_at`. `actor_id` stays text because bootstrap writes `"system"`.
  Audit rows are append-only; no update or delete paths in code.

**002_conversations.sql** (port of `infra/sqlite/database.ts`):
- `conversations(id pk, user_id fk, course_id, title, created_at, updated_at)`; index `(user_id, course_id, updated_at desc)`
- `messages(id pk, conversation_id fk on delete cascade, role check user/assistant, content, created_at, execution_id, intent,
  grounding_status check grounded/insufficient/unverified, cited_chunk_ids text[], cited_document_ids text[],
  retrieval_score_top double precision, question_embedding_ref)`;
  index `(conversation_id, created_at)`; partial index on `grounding_status where grounding_status is not null`

Done when: `npm run migrate` on an empty database creates everything, a second run is a no-op,
and a test proves the partial unique index rejects a second pending request for one user.

## 5. Step 3: Async AuthRepository and Postgres implementation

**Goal:** swap storage without changing service behaviour.

Why this is the biggest ripple: the current `AuthRepository` is **synchronous** (`findUserByEmail`,
`findRoleById`, `getRolePermissionKeys`, etc. return plain values). Postgres is async, so every method
returns a `Promise`.

Changes:
- `src/modules/auth/auth.types.ts`: make all `AuthRepository` methods return `Promise<...>`.
  Keep `JsonAuthRepository` working (wrap in `Promise.resolve`) until cutover so tests stay green.
- Update `AuthService` and `PermissionService.resolve` (becomes async) to `await` everything.
- New `src/modules/auth/pg-auth.repository.ts` implementing the interface with parameterised SQL only.
- Mapping layer: row (snake_case) to `UserRecord` etc. (camelCase, ISO strings), validated with the existing Zod schemas.

Behaviour that must be preserved or improved:
- `updateX(id, fn)`: run in a transaction with `SELECT ... FOR UPDATE`, apply `fn`, write back.
  **Refresh-token rotation must use the locked version** so two concurrent refreshes cannot both succeed.
- Registration: create user and coach request in **one transaction**; the `removeUser` compensation is no longer needed
  (keep the method only if something else uses it).
- `upsertUserPermissionOverride`: `INSERT ... ON CONFLICT (user_id, permission_id) DO UPDATE`.
- Unique violations (`23505`) map to the same domain errors the JSON store raised (email taken, duplicate pending request).

Tests: run the repository test suite against a real Postgres (Neon test branch or local container, set by `TEST_DATABASE_URL`).
Each test file uses a clean schema (truncate between tests). Add a concurrency test for refresh-token rotation.

## 6. Step 4: Bootstrap on Postgres

`scripts/bootstrap.ts` keeps its behaviour (idempotent roles, permissions, baseline grants, first admin once,
`mustChangePassword: true`, audit row `bootstrap.admin_created`), but writes to Postgres.

- `npm run bootstrap` requires `DATABASE_URL`; JSON/SQLite application tests keep using a test-only fixture
  until the repository cutover.
- Use `INSERT ... ON CONFLICT DO NOTHING` and report counts of what was actually added.
- Run migrations first.
- `--reset` now means: truncate all app tables, **refuse in production**, require `--yes`.
  Remove the data-directory deletion logic and `assertSafeDataDirectory`.
- Keep the weak-password deny-list and email validation.

Done when: running it twice adds nothing the second time; tests cover admin-exists, weak password, reset refusal in production.

## 7. Step 5: JSON to Neon migration script

`scripts/migrate-json-to-neon.ts`. One-off, idempotent, safe to re-run.

- Run against a schema-only target before running Postgres bootstrap. The importer preserves source UUIDs
  and refuses target rows that are not present in the source; it does not remap IDs or delete data.
- Read `DATA_DIR/json/*.json` with the existing Zod schemas; **reject the run if any record fails validation** (report which collection and id, no field values).
- **Keep existing UUIDs** so references stay valid.
- Insert in dependency order: roles, permissions, role_permissions, users, user_permission_overrides, coach_requests,
  refresh_tokens, audit_logs, then SQLite conversations and messages.
- Use `ON CONFLICT (id) DO NOTHING`, in batches inside one transaction per table.
- `--dry-run` flag: validate and count only.
- At the end, compare row counts (source vs Neon) per table and exit non-zero on mismatch.
- Logs show counts only, never emails, hashes, message content.
- Convert SQLite `cited_chunk_ids` / `cited_document_ids` (JSON text) into `text[]`.
- Preserve complete SQLite citation metadata in a `messages.citations` JSONB column. This additive
  migration is `003_conversation_citations.sql`; do not rewrite already-applied migrations.
- Back up first: copy the source files into `DATA_DIR/backups/<timestamp>/` before reading.

Done when: dry run on real data passes, a real run matches counts, a second run inserts zero rows.

## 8. Step 6: Courses, enrolments, seed

**004_courses.sql:**
- `courses(id pk, owner_id fk users, title, description, status check active/archived, created_at, updated_at)`
- `enrolments(id pk, course_id fk, user_id fk, status check pending/approved/rejected/removed, requested_at, decided_by, decided_at,
  unique(course_id, user_id))`
- Preserve the current API fields in PostgreSQL too: lessons, approval state/notes/review timestamps, archive metadata,
  optimistic version, and enrolment decision notes/timestamps.
- Extend the JSON-to-Neon importer to migrate courses and enrolments before switching the running course service.
- After importing, run `npm run bootstrap`, then `npm run seed:courses`. An optional
  `seed/courses.json` is an array of `{ "title": "...", "description": "..." }`; without it, add two
  pending placeholder courses only when the target has no imported courses.
- Self-join with approval by the course owner (existing decision). Archive, never hard-delete, courses ("stash").

**Seed:** `scripts/seed-courses.ts`, idempotent (upsert by a stable slug or title + owner).
Input from a small `seed/courses.json` the user provides; if none, create two placeholder courses.
Owner is an existing coach user; fail clearly if there is none.

Repository interfaces: async `CourseRepository`, `EnrolmentRepository` with Postgres implementations.
Authorization (owner / enrolled) is checked here before any Mongo read.

## 9. Step 7: Mongo collections and indexes

`src/infra/mongo/ensure-indexes.ts` runs at startup (idempotent `createIndex`).

- `documents`: `{ _id, courseId, ownerId, scope: 'course'|'personal', title, status, ... }`;
  indexes `(courseId, scope)`, `(ownerId, courseId)`.
- `document_chunks`: `{ _id: "<documentId>:<chunkIndex>", documentId, courseId, scope, ownerId, text, embedding, embeddingModel, ... }`;
  index `(documentId)`.
- **Atlas Vector Search index** (created in Atlas, definition committed as `docs/atlas-vector-index.json` and applied by a script):
  - vector field `embedding`, `numDimensions` = 1024, similarity `cosine`
  - filter fields: `courseId`, `documentId`, `scope`, `ownerId`, `embeddingModel`, `normalizedSection`
- `jobs`: lease fields (`lockedBy`, `lockedUntil`), `status`, `attempts`, `runAfter`; index `(status, runAfter, createdAt)`.
  Claim with an atomic `findOneAndUpdate`.
- Hard delete for documents (with the warning in the UI): delete chunks and the document; idempotent job.

Repository interfaces: `DocumentRepository`, `ChunkRepository` (vector search takes the filter above as a required argument).

Implementation and cutover:
- `ensure-indexes.ts` creates the regular MongoDB indexes at startup; startup also refuses to proceed unless the Atlas vector index is queryable.
- `docs/atlas-vector-index.json` is applied idempotently by `npm run mongo:vector-index`. Gemini's embedding API supports configurable dimensions: https://ai.google.dev/gemini-api/docs/embeddings
- `npm run migrate:json-to-mongo -- --dry-run` backs up and validates `documents.json`, `jobs.json`, `scheduler_state.json`, legacy chunk files, and legacy upload file sizes. The real run is idempotent, preserves IDs and storage keys, and refuses invalid, conflicting, or extra target records; it never deletes target data.
- Original uploads are stored in the MongoDB Atlas GridFS `document_uploads` bucket. Run `npm run uploads:migrate-gridfs` for a dry run, then `npm run uploads:migrate-gridfs -- --apply` to copy and verify available files from `DATA_DIR/uploads`; the migration preserves local copies. Missing originals must be uploaded again.
- Document deletion remains a confirmed, idempotent cleanup job: it permanently removes chunks, the GridFS upload, and metadata. The existing UI confirmation warns that deletion cannot be undone.

## 10. Step 8: Cleanup and doc updates

- This cleanup is gated on verified migration and cutover. **Do not remove**
  `infra/sqlite/*`, `infra/jsonstore/*`, `JsonAuthRepository`, or
  `scripts/migrations/001-initial-schema.ts` while the server or modules still
  depend on them.
- The runtime no longer initializes `JsonStore`: identity, courses, audit,
  feedback, analytics, quiz attempts, and configuration records use PostgreSQL;
  generated learning content and execution records use MongoDB; documents,
  chunks, jobs, and scheduler state use their MongoDB repositories. SQLite
  conversations remain unchanged because they are outside `data/json`.
- The existing JSON files are legacy import sources, not runtime storage.
  `db:migrate` applies the ordered SQL migrations and `db:import-legacy`
  imports the legacy collections to their configured database owners. JSON
  store fixtures remain available to isolated tests.
- This is a persistence cutover, not proof that existing data has been
  imported or verified against a production database. Keep backups and verify
  source/target counts before relying on migrated records.
- `better-sqlite3` and `@types/better-sqlite3` are absent from
  `backend/package.json`; conversations use Node's built-in `node:sqlite`.
- Keep the one-instance deployment constraint until rate limiting and the
  remaining persistence dependencies are ready for multiple instances.
- Before deleting legacy persistence, migrate the remaining data, switch all
  production repositories, run isolated PostgreSQL and Atlas integration
  tests, verify source/target counts and backups, and receive explicit approval
  for removal.

## 11. Requirements before lifting the single-instance rule

- **Rate limiting** (auth routes) currently uses an in-memory store; implement a shared store or explicitly accept and protect per-instance limits.
- **Job runner and scheduler** use MongoDB leases for atomic claims, but other multi-instance prerequisites remain.
- **Uploads** use the shared MongoDB Atlas GridFS bucket across API/worker instances.
- **Remaining JSON and SQLite repositories** must be migrated and verified before multiple instances are enabled.
- **Readiness** checks both databases; `/health` stays process-only and `/ready` touches the databases.

## 12. Testing strategy

- Unit tests: fakes for repositories (no database).
- Repository tests: real Postgres via `TEST_DATABASE_URL` (separate Neon branch or local container). Never run against production.
- Mongo tests: real Mongo (local container or a separate Atlas test database). Atlas Vector Search needs Atlas, so vector queries are covered by a separate, opt-in integration test; unit tests fake `ChunkRepository`.
- Required test cases: partial unique index on pending coach requests, refresh-token rotation race, registration atomicity (rollback leaves no user), migration idempotency, JSON-to-Neon count match, retrieval filter excludes other users' personal notes.
- No test may call Inception, Groq or Gemini.

## 13. Open items to confirm (defaults in brackets)

1. Test database: separate Neon branch [recommended] or local Postgres container?
2. Rate-limit store when multi-instance: Postgres table [default] or per-instance and documented?
3. Course seed list: provided by the user, otherwise two placeholders.
4. Where the frontend lives (not in the default branch of the cloned repo); only needed for CORS origin config and API contract checks.
5. Gemini embeddings are normalized to 1024 dimensions to match the current Atlas vector index.

## 14. Definition of done (whole feature)

- App runs only on Neon + Atlas; no JSON or SQLite code remains.
- `/ready` reflects both databases.
- All existing auth tests pass against Postgres; new tests listed in section 12 pass.
- Existing data migrated with matching counts; backup taken before migration.
- Docs updated; `.env.example` complete; no secrets committed.
