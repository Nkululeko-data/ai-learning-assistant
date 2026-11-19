# Current Project Status

**Review date:** 2026-11-19

## Current position

**Current phase: B10 complete.** The B10 feature work is present and the
backend tests, typecheck, and build pass.

**Next phase: B11 administrative operations.** B11 has not started.

The project is a backend REST API. No frontend source is present in the
repository. Phase descriptions and acceptance criteria are in
[`implementation-phases.md`](implementation-phases.md).

## Phase-by-phase status and implementation

### B0 — Understand the repository

**Status:** Assessment documented. This phase is repository inspection and
planning, so it has no application function.

**Main file:** [`initial-assessment.md`](initial-assessment.md).

### B1 — Agree on design and contracts

**Status:** Design and API documentation is present; these are design
artifacts, not runtime functions.

**Main files:** [`Architecture.md`](architecture/Architecture.md),
[`Database-Design.md`](architecture/Database-Design.md),
[`API-Specification.md`](api/API-Specification.md),
[`Security-Architecture.md`](architecture/Security-Architecture.md), and
[`openapi-draft.json`](api/openapi-draft.json).

### B2 — Backend foundation

**Status:** Implemented.

- [`server.ts`](../backend/src/server.ts): `startServer()` starts and wires
  the backend.
- [`app.ts`](../backend/src/app.ts): `createApp()` installs middleware and
  routes; health and readiness endpoints are included.
- [`config.ts`](../backend/src/config/config.ts): `loadConfig()` loads and
  validates configuration.
- [`bootstrap.ts`](../backend/scripts/bootstrap.ts):
  `bootstrapSystem()` initializes storage and seeds baseline data.
- [`json-store.ts`](../backend/src/infra/jsonstore/json-store.ts):
  `JsonStore.initialize()`, collection `initialize()`, and collection
  `insert()`, `update()`, and `remove()` manage JSON persistence.
- [`database.ts`](../backend/src/infra/sqlite/database.ts):
  `openConversationDatabase()` initializes conversation storage.

### B3 — Accounts and access control

**Status:** Implemented, including some coach/admin operations.

- [`auth.service.ts`](../backend/src/modules/auth/auth.service.ts):
  `AuthService.register()`, `login()`, `refresh()`, `logout()`, and
  `changePassword()` implement account and session operations.
- The same service implements `decideCoachRequest()`, `changeUserRole()`,
  and `setPermissionOverride()` for selected admin actions.
- [`auth.middleware.ts`](../backend/src/modules/auth/auth.middleware.ts):
  `requireAuthentication()` and `requirePermission()` guard protected routes.
- [`permission.service.ts`](../backend/src/modules/roles/permission.service.ts):
  `PermissionService.resolve()` calculates effective permissions.

### B4 — Courses and enrolments

**Status:** Implemented.

- [`course.service.ts`](../backend/src/modules/courses/course.service.ts):
  `CourseService.createCourse()`, `listCourses()`, `requestJoin()`, and
  `decideEnrolment()` handle course and enrolment operations, with ownership
  and access checks.
- [`course.routes.ts`](../backend/src/modules/courses/course.routes.ts):
  `createCourseRouter()` exposes the course API.

### B5 — Background jobs and scheduling

**Status:** Implemented.

- [`job.service.ts`](../backend/src/modules/jobs/job.service.ts):
  `JobService.enqueue()`, `claimNext()`, `complete()`, and `fail()` manage
  persistent job execution and failure handling.
- [`job.runner.ts`](../backend/src/modules/jobs/job.runner.ts):
  `JobRunner.start()` and `stop()` control the worker.
- [`job.scheduler.ts`](../backend/src/modules/jobs/job.scheduler.ts):
  `JobScheduler.runDue()` processes scheduled work.

### B6 — Document upload and ingestion

**Status:** Implemented.

- [`document.service.ts`](../backend/src/modules/documents/document.service.ts):
  `DocumentService.upload()`, `getStatus()`, `retry()`, and `delete()` handle
  document operations and access rules.
- [`document.validation.ts`](../backend/src/modules/documents/document.validation.ts):
  `validateDocumentUpload()` validates files.
- [`document.extractors.ts`](../backend/src/modules/documents/document.extractors.ts):
  `extractDocumentText()` extracts supported file text.
- [`document.chunker.ts`](../backend/src/modules/documents/document.chunker.ts):
  `chunkDocumentPages()` splits extracted text into searchable chunks.
- [`document.ingestion.service.ts`](../backend/src/modules/documents/document.ingestion.service.ts):
  `DocumentIngestionService.ingest()` runs ingestion.
- [`mistral-embedding.provider.ts`](../backend/src/modules/documents/mistral-embedding.provider.ts):
  `MistralEmbeddingProvider.embed()` creates embeddings.

### B7 — Access-filtered retrieval

**Status:** Implemented as an internal service; it is not a standalone API.

- [`retrieval.service.ts`](../backend/src/modules/retrieval/retrieval.service.ts):
  `RetrievalService.search()`, `assertCourseAccess()`, and
  `getSelectedChunks()` enforce access filtering and return matching chunks.

### B8 — Grounded question answering

**Status:** Implemented.

- [`chat.service.ts`](../backend/src/modules/chat/chat.service.ts):
  `ChatService.ask()` runs question answering; conversation methods list,
  retrieve, rename, and delete the caller's conversations.
- [`chat.graph.ts`](../backend/src/ai/graphs/chat.graph.ts):
  `runChatGraph()` runs the chat workflow.
- The workflow uses node functions in [`backend/src/ai/nodes/`](../backend/src/ai/nodes/),
  including `queryUnderstandingNode()`, `retrievalNode()`,
  `evidenceGateNode()`, `answerGenerationNode()`, and
  `citationValidatorNode()`.
- [`conversation.repository.ts`](../backend/src/infra/sqlite/conversation.repository.ts):
  `ConversationRepository` persists conversations, messages, and usage data.

### B9 — Learning content and quizzes

**Status:** Implemented.

- [`learning.service.ts`](../backend/src/modules/learning/learning.service.ts):
  `LearningService.generateSummary()`, `generateFlashcards()`,
  `generateQuiz()`, `createCoachQuiz()`, `publishQuiz()`, and
  `submitQuizAttempt()` handle generation, publishing, and scoring.
- [`learning-content.graph.ts`](../backend/src/ai/graphs/learning-content.graph.ts):
  `runLearningContentGraph()` runs the content-generation workflow.
- [`learning.repository.ts`](../backend/src/modules/learning/learning.repository.ts):
  `LearningRepository` persists learning content and quiz attempts.

### B10 — Feedback and course insights

**Status:** Implemented and validated. The complete backend test suite,
typecheck, and build pass.

- [`feedback.service.ts`](../backend/src/modules/feedback/feedback.service.ts):
  `FeedbackService.submit()` records or updates feedback for the caller's own
  assistant answer.
- [`insights.service.ts`](../backend/src/modules/insights/insights.service.ts):
  `InsightsService.recordActivity()` records privacy-safe activity;
  `getInsights()` returns course aggregates; `refreshGapReport()` queues
  background work; `generateGapReport()` creates a report.
- [`app.ts`](../backend/src/app.ts): `createApp()` mounts the feedback and
  insights routers when their dependencies are provided.

### B11 — Administrative operations

**Status:** Not started. Some related actions already exist in B3, including
coach-request decisions and role/permission changes. Remaining B11 work
includes system administration and account erasure.

### B12 — Release verification and handover

**Status:** Not started. Integrated evaluation, final API documentation,
deployment packaging, backup/restore, and handover remain.

## Validation results

Checks were run from `backend/` after restoring the lockfile dependencies with
`npm ci`:

- `npm test`: **21 suites passed; 66 tests passed**.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- The runtime prints Node's `node:sqlite` experimental warning.

The SQLite mismatch is resolved:

- [`database.ts`](../backend/src/infra/sqlite/database.ts):
  `openConversationDatabase()` reads the message schema with a prepared
  `PRAGMA table_info` query.
- [`conversation.repository.ts`](../backend/src/infra/sqlite/conversation.repository.ts)
  now uses Node's `DatabaseSync` API for queries and transactions, validates
  stored row values, and no longer imports the undeclared `better-sqlite3`
  package.
- [`conversation.repository.test.ts`](../backend/tests/unit/conversation.repository.test.ts)
  verifies that a failed assistant-message insert rolls back the full exchange.

`npm ci` reported 18 moderate audit advisories; they have not been investigated.

## Risks and next steps

The Inception API is scheduled to wind down on **2026-12-28**. Choose and test
a replacement before then.

1. Begin B11 administrative operations.
2. Complete B12 release and handover work.
