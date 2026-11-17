# Current Project Status

**Review date:** 2026-11-17

**Scope:** Repository files present at the time of this review. This is a
snapshot, not a claim that every documented requirement has been implemented
or tested.

## Summary

The project has a working backend foundation and implemented course,
background-job, and document-ingestion features. The latest implemented phase
is **B6: Documents and ingestion**. The project is **not yet the complete
learning assistant** described by the design: retrieval, AI chat, learning
content, insights, and most administrative features are still planned.

The current state is broadly:

- **B0:** Repository assessment is documented.
- **B1:** Architecture, data, API, and security documents are present. They
  describe an approved baseline, but some decisions remain open.
- **B2:** Backend infrastructure, persistent stores, bootstrap, and HTTP
  foundation are implemented.
- **B3:** Registration, login, tokens, permissions, password changes, and
  coach-request review are implemented.
- **B4:** Courses and enrolments are implemented.
- **B5:** Background jobs and scheduling are implemented.
- **B6:** Document upload, ingestion, chunking, and embedding are implemented.
- **B7-B12:** Not implemented yet, except for a few admin-related operations
  already included in B3.

The phase descriptions are in [`implementation-phases.md`](implementation-phases.md).
The older [`initial-assessment.md`](initial-assessment.md) describes the
repository before implementation and should be treated as historical.

## What exists today

### Backend startup and HTTP foundation

- [`backend/src/server.ts`](../backend/src/server.ts)
  - `startServer()` loads configuration, initializes JSON and SQLite storage,
    wires authentication into the app, and starts the HTTP server.
  - `registerShutdownHandlers()` closes the server and SQLite on shutdown.
  - `main()` is the process entry point.
- [`backend/src/app.ts`](../backend/src/app.ts)
  - `createApp()` installs Helmet, request IDs, Pino HTTP logging, credentialed
    CORS, JSON parsing, health/readiness endpoints, optional auth routes, and
    shared error handling.
  - `createReadinessHandler()` checks storage, schema version, and provider
    configuration.
  - `createCorsOriginValidator()` restricts browser origins to configuration.
- [`backend/src/common/middleware/request-id.ts`](../backend/src/common/middleware/request-id.ts)
  - `requestIdMiddleware` validates or generates a request ID and returns it
    in the response header.
- [`backend/src/common/middleware/error-handler.ts`](../backend/src/common/middleware/error-handler.ts)
  - `createErrorHandler()` maps Zod and application errors into the common
    response envelope and logs unexpected failures.
- [`backend/src/common/logging/logger.ts`](../backend/src/common/logging/logger.ts)
  - `createLogger()` configures structured logging and redacts common secret
    and token fields.
- [`backend/src/common/errors/app-error.ts`](../backend/src/common/errors/app-error.ts)
  - `AppError`, `ConflictError`, and `NotFoundError` provide typed application
    errors.

### Configuration and storage

- [`backend/src/config/config.ts`](../backend/src/config/config.ts)
  - `loadConfig()` validates environment variables and defaults.
  - `hasProviderConfiguration()` checks for the configured Inception, Groq,
    and Mistral credentials.
- [`backend/src/infra/jsonstore/json-store.ts`](../backend/src/infra/jsonstore/json-store.ts)
  - `JsonStore.register()` registers typed collections;
    `JsonStore.initialize()` initializes storage and collections.
  - `JsonCollection.initialize()` validates persisted JSON and builds indexes.
  - `getById()`, `findByIndex()`, `findUnique()`, and `list()` read records.
  - `insert()`, `update()`, and `remove()` serialize writes, validate records,
    enforce unique indexes, and persist changes.
  - `update()` can enforce optimistic record versions when requested.
- [`backend/src/infra/jsonstore/atomic-write.ts`](../backend/src/infra/jsonstore/atomic-write.ts)
  - `writeJsonAtomically()` persists JSON using a temporary file and rename.
- [`backend/src/infra/jsonstore/async-mutex.ts`](../backend/src/infra/jsonstore/async-mutex.ts)
  - `AsyncMutex.runExclusive()` serializes asynchronous work.
- [`backend/src/infra/jsonstore/system-collections.ts`](../backend/src/infra/jsonstore/system-collections.ts)
  - `registerSystemCollections()` defines validated, indexed collections for
    users, roles, permissions, role grants, user permission overrides, refresh
    tokens, coach requests, and audit logs.
- [`backend/src/infra/jsonstore/schema-metadata.ts`](../backend/src/infra/jsonstore/schema-metadata.ts)
  - `initializeSchemaMetadata()` tracks JSON schema version and applies
    registered migrations. The current initial migration is a no-op.
- [`backend/src/infra/sqlite/database.ts`](../backend/src/infra/sqlite/database.ts)
  - `openConversationDatabase()` creates the SQLite conversation/message
    schema through Node's built-in `node:sqlite` API, enables WAL and foreign
    keys, and creates indexes. This avoids compiling `better-sqlite3`.
  - `isConversationDatabaseReady()` runs a lightweight readiness query.

### Bootstrap and identity/access features

- [`backend/scripts/bootstrap.ts`](../backend/scripts/bootstrap.ts)
  - `bootstrapSystem()` initializes data directories and stores, then seeds
    baseline data.
  - `seedSystemCollections()` creates the learner, coach, and admin roles,
    15 permissions, role grants, and the first admin.
  - `validateAdminCredentials()` enforces required bootstrap credentials.
  - `assertSafeDataDirectory()` protects destructive reset from unsafe paths.
  - Bootstrap is idempotent, hashes the administrator password, audits initial
    admin creation, refuses production reset, and currently refuses demo
    seeding.
- [`backend/src/modules/auth/auth.service.ts`](../backend/src/modules/auth/auth.service.ts)
  - `AuthService.register()` creates learner accounts and optional pending
    coach requests.
  - `login()` verifies passwords, tracks failed attempts, applies lockout, and
    issues tokens.
  - `refresh()` rotates opaque refresh tokens and revokes a token family on
    reuse; `logout()` revokes the associated family.
  - `authenticateAccessToken()` validates the access token and resolves current
    user permissions.
  - `changePassword()` updates the password and revokes existing refresh
    sessions.
  - `listCoachRequests()` and `decideCoachRequest()` support admin coach
    application review.
  - `changeUserRole()` prevents self-role changes and audits role changes.
  - `setPermissionOverride()` grants or revokes coach permissions and
    invalidates old access tokens by permission version.
  - `getCurrentUser()` returns the current safe user/permission view.
- [`backend/src/modules/auth/auth.routes.ts`](../backend/src/modules/auth/auth.routes.ts)
  - `createAuthRouter()` exposes:
    `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`,
    `/auth/change-password`; `GET /me`; admin coach-request list/decision
    endpoints; and admin user role/permission updates.
  - Refresh cookies are configured as `HttpOnly`, `Secure`, and `SameSite=Strict`.
- [`backend/src/modules/auth/auth.middleware.ts`](../backend/src/modules/auth/auth.middleware.ts)
  - `requireAuthentication()` validates bearer access tokens.
  - `requirePermission()` enforces effective permissions.
  - `requirePasswordChangeComplete` blocks privileged actions until a forced
    password change is complete.
- [`backend/src/modules/roles/permission.service.ts`](../backend/src/modules/roles/permission.service.ts)
  - `PermissionService.resolve()` combines role permissions with user grants
    and revocations.
- [`backend/src/common/middleware/rate-limit.ts`](../backend/src/common/middleware/rate-limit.ts)
  - `createRateLimiter()` provides an in-memory fixed-window limiter;
    `emailRateLimitKey()` hashes normalized email values for limiter keys.

### Courses, jobs, and document ingestion

- [`backend/src/modules/courses/`](../backend/src/modules/courses/) contains
  course and enrolment schemas, services, and routes, including course access
  and ownership rules.
- [`backend/src/modules/jobs/`](../backend/src/modules/jobs/) contains the
  persistent job service, runner, scheduler, schemas, and job status routes.
- [`backend/src/modules/documents/`](../backend/src/modules/documents/)
  contains upload validation, text extraction, chunking, ingestion and document
  services/routes, and the Mistral embedding adapter.
- [`backend/src/infra/storage/private-file-storage.ts`](../backend/src/infra/storage/private-file-storage.ts)
  provides private local file storage.

### Documentation and automated tests

Architecture and API documentation currently exists under [`architecture/`](architecture/)
and [`api/`](api/), including the API specification and OpenAPI draft.
[`implementation-phases.md`](implementation-phases.md) describes the intended
B0-B12 build sequence.

Automated tests cover configuration, JSON storage, SQLite, bootstrap, HTTP,
authentication, courses, jobs, and document processing:

- [`backend/tests/unit/config.test.ts`](../backend/tests/unit/config.test.ts)
- [`backend/tests/unit/json-store.test.ts`](../backend/tests/unit/json-store.test.ts)
- [`backend/tests/integration/sqlite.test.ts`](../backend/tests/integration/sqlite.test.ts)
- [`backend/tests/integration/bootstrap.test.ts`](../backend/tests/integration/bootstrap.test.ts)
- [`backend/tests/integration/app.test.ts`](../backend/tests/integration/app.test.ts)
- [`backend/tests/integration/auth.test.ts`](../backend/tests/integration/auth.test.ts)
- [`backend/tests/integration/courses.test.ts`](../backend/tests/integration/courses.test.ts)
- [`backend/tests/integration/jobs.test.ts`](../backend/tests/integration/jobs.test.ts)
- [`backend/tests/integration/documents.test.ts`](../backend/tests/integration/documents.test.ts)
- [`backend/tests/unit/document.chunker.test.ts`](../backend/tests/unit/document.chunker.test.ts)
- [`backend/tests/unit/document.validation.test.ts`](../backend/tests/unit/document.validation.test.ts)
- [`backend/tests/unit/mistral-embedding.provider.test.ts`](../backend/tests/unit/mistral-embedding.provider.test.ts)

The latest validation results are recorded below.

## What is not implemented yet

No corresponding application modules or routes were found for:

- **B7:** Access-filtered retrieval and its isolation tests.
- **B8:** AI provider adapters, LangGraph workflows, grounded chat, citation
  validation, or chat endpoints. SQLite has tables ready for conversations and
  messages, but no chat service currently uses them.
- **B9:** Summary, flashcard, quiz, and quiz-attempt features.
- **B10:** Feedback, activity events, coach insights, and gap reports.
- **B11:** Most admin features, including user status management, password
  reset, executions/config/jobs views, and privacy erasure. Some role and coach
  request operations are already present in B3.
- **B12:** Integrated AI evaluation, generated/final Swagger output, deployment
  packaging, Docker, backup/restore, and handover materials.

The root [`README.md`](../README.md) now documents the backend setup. No
frontend source files were found in the repository scan, consistent with the
plan to build the backend first.

## Validation

After merging the B4-B6 implementation and using Node's built-in `node:sqlite`:

- `npm install` completed from `backend/` without requiring Visual Studio C++
  Build Tools.
- `npm test` passed: 12 suites and 34 tests.
- `npm run typecheck` passed.
- `npm run build` passed.
- Node 22.19 emits an `ExperimentalWarning` for `node:sqlite`; the package now
  declares Node `>=22.13.0`, which satisfies the SQLite API and PDF.js runtime
  requirements.
- `npm install` reported 18 moderate audit advisories. They were not
  investigated or changed as part of this review.

## Bottom line

The project has progressed through **B6**, with tests for its foundation,
authentication, courses, jobs, and document ingestion. The next planned
feature phase is **B7: access-filtered retrieval**. The backend uses built-in
Node SQLite and does not require the Visual Studio C++ Build Tools for its
conversation database.
