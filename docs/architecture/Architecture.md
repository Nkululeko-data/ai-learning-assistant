# AI Learning Assistant Architecture

**Status:** Approved baseline for B2. This document consolidates the supplied backend architecture and design decisions. Remaining open items below remain gated.

## Authority and scope

Use the following source order for this draft:

1. Owner decisions in `design-decisions (1).md`.
2. The Capstone 01 project brief.
3. `backend-architecture (1).md` and `Database-Design.md` for detailed technical contracts, except where a higher-priority source differs.

The application is a full-stack project, delivered in stages: backend APIs and AI workflows first, then the React frontend consuming those APIs. The browser never connects directly to storage or providers.

## Proposed architecture

Use a modular monolith with a Node.js/TypeScript backend and a React/TypeScript frontend. The backend runs as one process and one instance while the JSON store is in use. Express exposes REST APIs under `/api/v1`; all request and response contracts use Zod.

### Backend layers

| Layer | Responsibility | Dependency rule |
|---|---|---|
| HTTP | Express routes, controllers, middleware, request/response shaping | Controllers call application services only |
| Application | Use cases, orchestration, policies, transactions across repository ports | Depends on domain types and repository/service interfaces |
| Domain | Entities, invariants, value objects and pure business rules | No infrastructure imports |
| Infrastructure | JSON repositories, SQLite repositories, file storage and external provider adapters | Implements application/domain ports |
| AI | LangGraph graphs, typed nodes, prompts and deterministic validation | Invoked through an application `GraphRunner`; data access is injected |

Modules communicate through their exported `index.ts` service surface. Repositories are the only layer that touches persistence.

### Technology decisions

| Concern | Draft decision |
|---|---|
| Runtime | Node.js current LTS, TypeScript strict mode |
| API | Express REST, `/api/v1` |
| Validation | Zod for environment, request, response and AI schemas |
| Primary data | JSON file collections behind repository interfaces |
| Conversations | SQLite, limited to conversations and messages |
| Retrieval | In-process cosine similarity over Mistral embeddings; access filtering before scoring |
| Orchestration | LangGraph.js with stateless graphs |
| LLM | Inception Labs primary, Groq fallback |
| Embeddings | Mistral only; no embedding fallback |
| Background work | JSON-backed in-process job runner and scheduler |
| Auth | Short-lived JWT access tokens, rotating opaque refresh tokens, argon2 password hashes |
| Files | Local disk outside the web root; PDF, DOCX and TXT ingestion |
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

The JSON store is single-writer. Run one backend process against a data directory and mount `data/` on persistent storage. Do not horizontally scale this implementation or share the same data directory across instances. Repository interfaces preserve a later database migration path; real database work is tabled.

LangChain/LangSmith tracing is forced off. Provider calls are made only through adapters. Non-evaluation tests use deterministic fakes and never call external providers.

## Decision status and gates

The following decisions are incorporated from the supplied design decisions and their recommendations:

- SQLite for conversation history; active-course discovery shows only name and description.
- Topic clustering uses embeddings, clustering and LLM labels; coach summaries are theme-level.
- `minCohortSize` defaults to 3 and is configurable.
- Pending coach applicants retain learner access.
- Feedback comment text remains hidden from coaches; re-request cool-down is configurable (24 hours); question embeddings are recomputed for clustering; conversation deletion is a hard delete.
- Active course discovery exposes only name and description; a deactivated coach's courses may be reassigned to an active coach or archived.
- The architecture/provider deviations below remain subject to the coach approval explicitly required by the design decisions.

| Item | Status before implementation |
|---|---|
| JSON + SQLite instead of MongoDB/Atlas | Proposed; coach approval and written rationale required |
| Single instance and in-process jobs | Proposed consequence of JSON storage; approve with the storage choice |
| Inception/Groq and Mistral instead of the brief's provider choices | Proposed; coach approval and privacy notice required |
| LangGraph.js | Proposed; coach approval and written rationale required |
| Admin handling of a deactivated coach's courses | Resolved for B4: reassign to an active coach or archive |
| Groq structured-output support | Must be verified before the chat graph; use the documented JSON-mode fallback if unsupported |
| AWS or Azure | Open; decide before deployment |
| Real database migration timing | Tabled until separately approved |

Do not implement an open item until its decision is recorded. Do not start application coding until this architecture/contracts phase is reviewed and approved.

## Security and privacy

The security controls are specified in [Security-Architecture.md](./Security-Architecture.md). In particular: never log secrets or learner/course text; treat retrieved and uploaded material as untrusted; keep uploaded files outside the web root; and disclose that document, note and question text is sent to the configured LLM and Mistral embedding services.

## Documentation and implementation phases

The architecture package includes:

- [HLD.md](./HLD.md), [LLD.md](./LLD.md), [Component-Design.md](./Component-Design.md) and [Data-Flow.md](./Data-Flow.md)
- [Database-Design.md](./Database-Design.md), [Security-Architecture.md](./Security-Architecture.md)
- [API-Specification.md](../api/API-Specification.md) and [openapi-draft.json](../api/openapi-draft.json)

After approval, follow the backend implementation order B0-B12 in the supplied backend architecture. Deliver one phase at a time, show files and test evidence at each boundary, and wait for coach approval before proceeding.
