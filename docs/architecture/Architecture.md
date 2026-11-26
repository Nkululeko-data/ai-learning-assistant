# AI Learning Assistant Architecture

**Status:** Original B2 design baseline with the current runtime storage update recorded below.

### Current runtime storage (2026-11)

The current runtime is hybrid. Authentication and authorization, courses,
enrolments, feedback, activity, analytics, quiz attempts, audit logs, and
configuration history use Neon PostgreSQL. Authentication's repository
adapter is named `JsonAuthRepository`, but its system collections are
registered on the PostgreSQL store. MongoDB Atlas stores document metadata and
chunks, jobs and scheduler state, generated learning content, AI execution
metadata, and source uploads in GridFS (`document_uploads`). SQLite in
`DATA_DIR` remains active for conversations, messages, and daily chat usage.
The legacy JSON and local upload files are migration inputs or retained
copies, not the runtime source of PostgreSQL-backed collections.

## Authority and scope

Use the following source order for this draft:

1. Owner decisions in `design-decisions (1).md`.
2. The Capstone 01 project brief.
3. `backend-architecture (1).md` and `Database-Design.md` for detailed technical contracts, except where a higher-priority source differs.

The application is a full-stack project, delivered in stages: backend APIs and AI workflows first, then the React frontend consuming those APIs. The browser never connects directly to storage or providers.

## Proposed architecture

Use a modular monolith with a Node.js/TypeScript backend and a React/TypeScript frontend. The current backend runs as one process and one instance because repository reads use process-local indexes and background work is in-process. Express exposes REST APIs under `/api/v1`; all request and response contracts use Zod.

### Backend layers

| Layer | Responsibility | Dependency rule |
|---|---|---|
| HTTP | Express routes, controllers, middleware, request/response shaping | Controllers call application services only |
| Application | Use cases, orchestration, policies, transactions across repository ports | Depends on domain types and repository/service interfaces |
| Domain | Entities, invariants, value objects and pure business rules | No infrastructure imports |
| Infrastructure | Neon repositories, MongoDB repositories, file storage and external provider adapters | Implements application/domain ports |
| AI | LangGraph graphs, typed nodes, prompts and deterministic validation | Invoked through an application `GraphRunner`; data access is injected |

Modules communicate through their exported `index.ts` service surface. Repositories are the only layer that touches persistence.

### Technology decisions

| Concern | Draft decision |
|---|---|
| Runtime | Node.js current LTS, TypeScript strict mode |
| API | Express REST, `/api/v1` |
| Validation | Zod for environment, request, response and AI schemas |
| Primary data | Neon PostgreSQL for authentication, courses, enrolments, and selected operational records |
| Documents and AI data | MongoDB Atlas for document metadata, chunks, jobs, learning content, execution metadata, and GridFS uploads |
| Conversations | SQLite conversations, messages, and daily chat usage (migration target: Neon PostgreSQL) |
| Retrieval | Access-filtered in-process BM25 keyword and cosine-vector search, combined with weighted reciprocal-rank fusion |
| Orchestration | LangGraph.js with stateless graphs |
| LLM | Inception Labs primary, Groq fallback |
| Embeddings | Gemini `gemini-embedding-001`; no embedding fallback |
| Background work | MongoDB-backed in-process job runner and scheduler |
| Auth | Short-lived JWT access tokens, rotating opaque refresh tokens, argon2 password hashes |
| Files | Private MongoDB Atlas GridFS bucket; PDF, DOCX and TXT ingestion |
| Tests | Jest, Supertest, isolated integration tests and an on-demand AI evaluation suite |
| Operations | Docker single container with a persistent data volume |

The detailed field-level data model is in [Database-Design.md](./Database-Design.md). Endpoint contracts are in [API-Specification.md](../api/API-Specification.md).

## Request and data boundaries

- Every protected request passes both a permission check and a resource ownership/membership policy.
- Services depend on repository interfaces, not JSON or SQLite details.
- `RetrievalService` is the only service allowed to read chunks. It verifies course access, filters by course, embedding model, scope and owner, then scores candidates.
- Admin workflows expose account, configuration, audit and execution metadata only. They do not read course content, documents, chunks or message text.
- Coach insights return cohort-qualified themes and aggregates, never question text or individual conversations.
- Long-running ingestion, generation, cleanup, reconciliation and backup work uses idempotent jobs.

## Runtime and scaling constraints

Run one backend process for now and mount `data/` on persistent storage for
SQLite conversations, messages, daily usage, and local backup/migration data.
MongoDB stores document chunks and GridFS source uploads. PostgreSQL-backed
collections hydrate synchronous
process-local read indexes at startup, and job ownership is in-process; do not
run multiple API instances until cache invalidation and distributed job
ownership are addressed.

LangChain/LangSmith tracing is forced off. Provider calls are made only through adapters. Non-evaluation tests use deterministic fakes and never call external providers.

## Decision status and gates

The following decisions are incorporated from the supplied design decisions and their recommendations:

- SQLite for conversation history pending migration to PostgreSQL; active-course discovery shows only name and description.
- Gap reports cluster course-scoped insufficient-grounding questions and missed course-visible quiz prompts with transient Gemini embeddings, label topics from repeated terms, and return cohort-qualified themes with evidence-source counts and targeted teaching actions. Empty reports distinguish no gap signals from signals withheld below the topic cohort threshold. Personal-scope questions, private quizzes, raw question text, and feedback comments are excluded from reports.
- `minCohortSize` defaults to 3 and is configurable.
- Pending coach applicants retain learner access.
- Feedback comment text remains hidden from coaches; re-request cool-down is configurable (24 hours); gap-report question embeddings are recomputed in memory for clustering; conversation deletion is a hard delete.
- Active course discovery exposes only name and description; a deactivated coach's courses may be reassigned to an active coach or archived.
- The architecture/provider deviations below remain subject to the coach approval explicitly required by the design decisions.

| Item | Status before implementation |
|---|---|
| JSON and SQLite initial persistence | JSON is now a legacy import source; SQLite remains active only for conversations, messages, and daily usage |
| Single instance and in-process jobs | Current limitation from process-local indexes and in-process workers |
| Inception/Groq and Gemini instead of the brief's provider choices | Proposed; coach approval and privacy notice required |
| LangGraph.js | Proposed; coach approval and written rationale required |
| Admin handling of a deactivated coach's courses | Resolved for B4: reassign to an active coach or archive |
| Groq structured-output support | Must be verified before the chat graph; use the documented JSON-mode fallback if unsupported |
| AWS or Azure | Open; decide before deployment |
| Real database migration timing | Implemented via Neon/MongoDB adapters and legacy import scripts |

Do not implement an open item until its decision is recorded. Do not start application coding until this architecture/contracts phase is reviewed and approved.

## Security and privacy

The security controls are specified in [Security-Architecture.md](./Security-Architecture.md). In particular: never log secrets or learner/course text; treat retrieved and uploaded material as untrusted; keep uploaded files outside the web root; and disclose that document, note and question text is sent to the configured LLM and Gemini embedding services.

## Documentation and implementation phases

The architecture package includes:

- [HLD.md](./HLD.md), [LLD.md](./LLD.md), [Component-Design.md](./Component-Design.md) and [Data-Flow.md](./Data-Flow.md)
- [Database-Design.md](./Database-Design.md), [Security-Architecture.md](./Security-Architecture.md)
- [API-Specification.md](../api/API-Specification.md) and [openapi-draft.json](../api/openapi-draft.json)

After approval, follow the backend implementation order B0-B12 in the supplied backend architecture. Deliver one phase at a time, show files and test evidence at each boundary, and wait for coach approval before proceeding.
