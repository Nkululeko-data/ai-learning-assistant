# Component Design

**Status:** Approved implementation baseline for B2; open decisions remain gated.

| Component | Responsibility | Public boundary | Key dependencies |
|---|---|---|---|
| `config` | Load and validate environment and non-secret runtime config | Typed configuration object | Zod, environment |
| `common/errors` | Error hierarchy and stable API error codes | `AppError` and error codes | None |
| `common/middleware` | Request ID, auth, permission, validation, rate limit, error mapping | Express middleware | Auth/config services |
| `auth` / `users` | Registration, login, password changes, refresh rotation/reuse detection, lockout, user status | Auth and user services | User/token/role repositories, argon2id, JWT, refresh-cookie policy |
| `roles` | Resolve role baselines and per-user permission overrides | Permission resolution service | Role and permission repositories |
| `courses` | Create, update, archive, discover and access courses | Course service and ownership policy | Course repository |
| `enrolments` | Join requests and coach decisions | Enrolment service and policy | Course/user/enrolment repositories |
| `documents` | Validate upload requests, metadata, listing, retry and deletion lifecycle | Document service | Storage adapter, job service, document repository |
| `ingestion` | Extract, chunk and embed documents | Ingestion job handler | Parsers, embedding provider, chunk repository |
| `retrieval` | Enforce access before similarity search | `RetrievalService.search(user, courseId, embedding, opts)` | Course/enrolment/document/chunk repositories |
| `chat` / `conversations` | Coordinate chat graph, own conversation history and feedback references | Chat and conversation services | GraphRunner, retrieval, SQLite repository |
| `learning` / `quizzes` | Generate summaries, flashcards and quizzes; publish and score attempts | Learning and quiz services | GraphRunner, retrieval, repositories |
| `feedback` | Store learner ratings and comments under privacy rules | Feedback service | Feedback repository, message reference |
| `insights` | Aggregate signals, enforce cohort thresholds, persist gap reports | Insights service and job | Events, feedback, SQLite insights job, graph |
| `jobs` | Enqueue, claim, retry, dead-letter and report long-running work | Job service and runner | JSON job repository, handlers |
| `admin` / `audit` | User/config/job administration and append-only audit | Admin service | Domain services, audit repository |
| `jsonstore` | Atomic single-writer JSON collections, validation, cache and indexes | Store primitives used by repositories | Filesystem |
| `sqlite` | Conversations/messages schema and repository | Conversation repository | `better-sqlite3` |
| `storage` | Random-key private file storage and deletion | File storage adapter | Local filesystem |
| `ai/graphs` and `ai/nodes` | Explicit typed AI workflows | GraphRunner implementations | Injected services and provider ports |
| `ai/providers` | Inception, Groq, Mistral and deterministic test fakes | `LlmProvider`, `EmbeddingProvider` | Provider SDKs/config |
| `ai/validation` | Deterministic citation/source validation | Citation validation result | Context set and draft output |
| `ai/evaluation` | Offline question sets and faithfulness/retrieval evaluation | Evaluation runner | Fixtures and optional real providers |

## Dependency constraints

- Routes call controllers; controllers call application services only.
- Services depend on repository interfaces, not storage SDKs or file paths.
- Domain code imports no infrastructure.
- AI nodes do not import provider SDKs or directly access repositories.
- Cross-module calls use exported service interfaces.
- Admin handlers never read conversations or content-bearing collections.
- Retrieval policy is enforced before candidate scoring, not delegated to prompts.

## B3 authentication boundaries

- The auth service depends on `AuthRepository` and the permission service; JSON collections are accessed through the repository adapter.
- Authentication responses expose a narrow safe-user projection. Password and reset-token hashes are never serialized.
- Access tokens contain `userId`, current role and `permsVersion`; every protected request re-reads the active user, validates token version, and resolves current permissions.
- Refresh tokens are opaque, stored as SHA-256 hashes, rotated on every use, and revoked family-wide if a used/revoked token is replayed.
- The refresh cookie is `HttpOnly`, `Secure`, `SameSite=Strict`, scoped to `/api/v1/auth`; body-based refresh is disabled by default and is an explicit config option.
- Login/register throttling is in-memory by IP and hashed normalized email. This is appropriate only for the documented single-instance deployment.

## B4 course and enrolment boundaries

- `CourseService` and its repository own course visibility, versioned updates, archive state, enrolment transitions and the configurable re-request cool-down.
- Active course discovery exposes only the course ID, name and description; full details require course ownership or an approved enrolment.
- Course mutations enforce the coach permission and ownership together. Join approval is performed only by the owning coach; pending enrolments do not grant course access.
- Admin course reassignment accepts only an active coach. If an owner is deactivated and a course is not reassigned, the admin may archive it.

## Primary workflows

- **Authentication:** route -> auth service -> user/token repositories -> password/JWT adapters -> audit.
- **Document ingestion:** upload service -> safe file adapter -> document/job repositories -> job runner -> extraction/chunking/embedding -> chunk repository.
- **Grounded chat:** chat service -> access policy -> GraphRunner -> retrieval -> evidence gate -> generation -> citation validator -> conversation repository -> deduplicated activity event.
- **Learning content:** learning service -> selection access checks -> GraphRunner -> context/source validation -> learning repository; coach quizzes require a separate publish action.
- **Coach insights:** scheduled job -> aggregate signals -> clustering/labeling -> cohort threshold -> gap report; no learner question text leaves the job or reaches the coach response.
