# AI Learning Assistant: Design Decisions (v2)

Companion to the Capstone 01 brief and to `backend-architecture.md`. This file records product, access and technology decisions. If it disagrees with `backend-architecture.md`, **this file wins** and the architecture file must be corrected.

**Status labels**
- **DECIDED** = confirmed by the project owner. Implement as written.
- **DERIVED** = follows from a decision, but the detail was proposed, not explicitly confirmed. Implement and flag in review.
- **OPEN** = not decided. Do not implement until resolved.
- **TABLED** = decided to postpone. Do not build now, but do not design against it.

---

## 1. Roles and access

| ID | Status | Decision |
|---|---|---|
| R-1 | DECIDED | Three roles: **Learner**, **Coach**, **Admin**. |
| R-2 | DECIDED | Nobody can change their own role. Roles are changed only by an Admin. |
| R-3 | DECIDED | **A user can register as a Coach, and the Admin approves it.** Until approved, the account has Learner access only (DERIVED). On approval the admin assigns the coach role and its fine-grained permissions; on rejection the user stays a Learner. The admin may also change an existing user's role directly (DERIVED). |
| R-4 | DECIDED | Coach privileges are **fine-grained**: the admin can grant/revoke individual permissions per coach. |
| R-5 | DECIDED | Users, courses and enrolments are **stashed (soft-deleted/archived)**, never hard-deleted. A stashed coach cannot log in. (Exception: privacy erasure, R-8.) |
| R-6 | DECIDED | **Admin sees interaction with the system only**: users, roles, config, audit logs, execution metadata. Admin has **no access to course content, documents, chunks or message text.** |
| R-7 | DECIDED | **Coach sees engagement with their course, not individual conversations** (section 5). |
| R-8 | DERIVED | **Privacy erasure** (POPIA): an admin-initiated job hard-deletes the user's personal notes and conversations, tombstones identity fields, revokes tokens, and pseudonymises the user in analytics so aggregates survive. |
| R-9 | DECIDED | If a coach is deactivated, an admin may reassign owned courses to an active coach; courses not reassigned are archived. |

**Permissions (DERIVED):** effective permissions = role baseline + user grants - user revokes. Keys: `course:create`, `course:edit`, `course:archive`, `document:upload`, `document:delete`, `enrolment:approve`, `insights:view`, `feedback:review`, `content:generate`, `quiz:create`, `user:manage`, `role:manage`, `config:manage`, `audit:view`, `executions:view`. A permission never replaces an ownership check; both run on every request. Learner permissions are fixed. Role and permission changes are audited (actor, target, before/after, no content).

---

## 2. Enrolment

| ID | Status | Decision |
|---|---|---|
| E-1 | DECIDED | Learners **self-join** a course, **with approval from the course owner** (the coach). |
| E-2 | DECIDED | Any authenticated user can discover active courses; discovery exposes only the course name and description. |
| E-3 | DECIDED | Learners may re-request enrolment after rejection or removal following a configurable 24-hour default cool-down. |

Derived: `enrolments` has status `pending` / `approved` / `rejected` / `removed`, unique per (course, user). Only `approved` grants access to course documents, retrieval and coach quizzes; `pending` sees only the course card. The configurable cool-down can be set to zero to disable the wait.

---

## 3. Documents and visibility

| ID | Status | Decision |
|---|---|---|
| D-1 | DECIDED | Learners can upload **personal notes**, always **associated with a course**. |
| D-2 | DECIDED | Personal notes are **visible only to their owner**: not coach, not admin. |
| D-3 | DECIDED | **Learner personal notes: hard delete**, with a warning that it **cannot be undone**. |
| D-4 | DECIDED | **Coach documents: hard delete too**, with a warning. |

Derived: documents and chunks carry `courseId`, `scope` (`course`/`personal`) and `ownerId`. **Retrieval filter** (enforced in the retrieval/repository layer, not the prompt): `courseId = X AND (scope='course' OR (scope='personal' AND ownerId=currentUser))`, applied **before** similarity scoring, after an enrolment/ownership check. Citations to personal notes are labelled "Your notes". Personal notes are excluded from coach analytics. Messages that cited a deleted document keep their text and show "source removed". Required test: upload notes as learner A, ask as learner B, expect zero hits. Archived course: read-only, documents retained but excluded from retrieval.

---

## 4. Question answering and grounding

| ID | Status | Decision |
|---|---|---|
| G-1 | DECIDED | Three grounding states on every assistant message: `grounded`, `insufficient`, `unverified`. |
| G-2 | DECIDED | "Insufficient evidence" is determined by a **similarity threshold plus Citation Validator failure**. |
| G-3 | DECIDED | **Stream the answer only after citation validation.** |
| G-4 | DECIDED | The **Citation Validator is a deterministic check that cited IDs exist in the retrieved set** (no LLM call). |
| G-5 | DECIDED | Message fields are stored: `intent`, `citedChunkIds`, `citedDocumentIds`, `groundingStatus`, `retrievalScoreTop`, question embedding reference, `executionId`. |

| State | Condition | Behaviour | Counts as |
|---|---|---|---|
| `grounded` | Evidence gate passes and validator passes | Answer with citations | normal |
| `insufficient` | Best score below `minSimilarity`, or too few chunks, or explicit refusal | No answer; say material doesn't cover it; never invent citations | **content gap** |
| `unverified` | Evidence passes but validator fails | Suppress answer / "couldn't verify" | **quality issue** |

Derived details (see architecture section 8.5): the validator checks that every cited chunk ID is in the **context set** actually sent to the model, that marker-to-chunk pairs match those issued by the system, and that markers and citations are consistent. Document name and page/section are filled by the system from the chunk record. **Known limitation:** this proves citations are real, not that a claim is semantically entailed; semantic faithfulness is measured offline in the AI evaluation suite. Chat uses conversation history to **rewrite follow-up questions** into standalone retrieval queries. Summary/quiz/flashcard intents in chat return a suggested action pointing to the relevant endpoint; they do not generate inside chat. Thresholds live in versioned config.

---

## 5. Coach insights

| ID | Status | Decision |
|---|---|---|
| C-1 | DECIDED | Questions are **grouped into topics** so the coach can address content gaps. |
| C-2 | DECIDED | Coach sees **themes only** (no question text, verbatim or example), with a **minimum cohort size**. |
| C-3 | DECIDED | The coach gets a **summary of the questions** (read as a theme-level summary; OPEN-9). |

Derived: cluster only gap signals (`insufficient`, low retrieval score, `not_helpful`). Batch job writes `gap_reports` (theme, question count, **distinct learner count**, suggested action, trend). Topics below `minCohortSize` distinct learners are hidden or merged into "Other"; same minimum for any per-learner or per-quiz breakdown. Personal notes and learner-private quizzes are excluded. Dashboards read `activity_events` (no text) and `gap_reports`. Clustering method OPEN-8 (recommended: embed, cluster, LLM-label).

---

## 6. Quizzes

| ID | Status | Decision |
|---|---|---|
| Q-1 | DECIDED | The **LLM can generate specialized quizzes for a learner**. |
| Q-2 | DECIDED | **Coaches can create quizzes**, **visible to learners** in the course. |
| Q-3 | DECIDED | **Answer keys must never reach learners before submission.** Separate learner and owner response views; scoring is server-side; a contract test enforces it. |
| Q-4 | DECIDED | **"Specialized" learner quizzes are generated from the content the learner is studying**: the learner selects documents (optionally sections and a topic phrase) and the quiz is built only from that selection, through the normal access filter. |

Derived: coach quiz (`origin=coach`, `visibility=course`, draft then published; manual or LLM draft then review) and learner quiz (`origin=learner_generated`, `visibility=private`). Visibility rule after enrolment check: `visibility='course' AND status='published'` OR `ownerId=currentUser`. New `quiz_attempts` store (with `quizVersion`). Question types v1: multiple choice and true/false. Every question traces to source chunks via the same deterministic check. Editing a published quiz with attempts creates a new version. Correct answers and explanations are shown after submission. Quiz versions are separate records sharing a `lineageId`; see `Database-Design.md`.

---

## 7. Data stores and processing

| ID | Status | Decision |
|---|---|---|
| S-1 | DECIDED | The approved persistence target is **Neon PostgreSQL** for relational data and **MongoDB Atlas** for documents, chunks, and jobs. |
| S-2 | DECIDED | PostgreSQL is the relational source of truth for migrated access and course data; conversations are planned for PostgreSQL but still use SQLite at runtime. |
| S-3 | DECIDED | MongoDB Atlas stores migrated document metadata, chunks, jobs, and scheduler state; Atlas Vector Search is the retrieval target. |
| S-4 | DERIVED | The migration is partial. Production still uses JSON auth, SQLite conversations, and JSON for other feature data. Keep a single instance until all active local stores and process-local limits are addressed. |
| S-5 | DECIDED | Existing source UUIDs are preserved during imports; importers must preflight targets and must not delete existing target data. |
| S-6 | DECIDED | Jobs use MongoDB-backed atomic claims and leases. Uploaded bytes remain in private persistent storage; replicas must share the same storage before scaling. |
| S-7 | DERIVED | Storage access remains behind repository interfaces. Remove legacy implementations only after every dependent repository and data set is migrated, verified, and approved. |

Rules: Treat the current system as a hybrid, not a completed cutover. Do not remove active JSON/SQLite storage, claim multi-instance readiness, or run importers against production without the migration plan's backups, preflight, and verification steps. See `backend/database-implementation-neon-mongo.md` and architecture section 5.

---

## 8. Providers and orchestration

| ID | Status | Decision |
|---|---|---|
| P-1 | DECIDED | **Inception Labs** is the primary LLM provider; **Groq** is the fallback. |
| P-2 | DECIDED | **LangGraph.js** orchestrates the agent workflows, on a Node.js + TypeScript backend. |
| P-3 | DECIDED | **Embeddings use Google Gemini (`gemini-embedding-001`)** through the `EmbeddingProvider` adapter, at 1024 dimensions. There is no embedding fallback. Changing the model requires re-embedding. Document and note text is sent to Gemini for embedding, so this goes in the privacy notice. |

All provider access goes through adapters; fallback uses bounded retries then switches to Groq; the provider actually used is recorded per execution. LangSmith/LangChain tracing is forced off. Fake providers are used in all non-evaluation tests.

The B8 adapters call the documented OpenAI-compatible REST APIs through `fetch`. The Inception and Groq SDK packages were not added because the Inception SDK's optional Zod 3 peer dependency conflicts with this project’s Zod 4; no forced or legacy-peer installation was used. Reassess the Inception adapter/provider before the announced API wind-down on **December 28, 2026**.

---

## 9. Bootstrap

| ID | Status | Decision |
|---|---|---|
| B-1 | DECIDED | A **bootstrap script** creates the initial state: data directories, schema, roles, permissions, baseline permission sets, and the **first admin** from environment variables. Idempotent; never logs the password; sets `mustChangePassword`; optional `--demo` seed (refused in production); `--reset` refused in production. See architecture section 6. |

---

## 10. Deviations from the brief (need coach approval and a written rationale in `Architecture.md`)

1. **Persistence migration is partial:** selected relational and document/job data use Neon and MongoDB Atlas; auth, conversations, and other feature data still use JSON/SQLite.
2. **Single-instance, single-process deployment remains required** until the remaining legacy stores, process-local rate limiting, and upload sharing are addressed.
3. LLM providers are Inception Labs and Groq instead of Claude and OpenAI.
4. LangGraph.js for orchestration (brief allows LangChain.js or custom).
5. Deterministic citation validation as the runtime gate.
6. New artefacts not in the brief: enrolments, coach requests, quiz attempts, activity events, gap reports, permission overrides, bootstrap, backup/restore, extra endpoints.

---

## 11. Retained requirements from the brief (unchanged)

- Node.js + TypeScript (strict), Express, Zod, REST under `/api/v1`, OpenAPI/Swagger. React frontend comes later.
- Modular monolith with separate routes/controllers, services, domain logic, repositories, agent workflows, integrations.
- Explicit agent nodes with typed schemas, execution IDs, logging, timeouts, error handling (Query Understanding, Retrieval, Context Builder, Answer Generation, Citation Validator, Learning Content, Feedback Analyzer). Not a single generic chatbot.
- Frontend calls backend only; no keys or storage access from the browser.
- Untrusted-input handling and prompt-injection defence; externalised, versioned prompts and thresholds; structured logs without credentials.
- Jest + Supertest tests plus an AI evaluation suite; never claim unrun tests passed.
- Docker, `.env.example`, README, architecture docs. No secrets in the repo.
- Work in phases with coach approval at each gate.

---

## 12. Open questions

| # | Question | Recommendation |
|---|---|---|
| 1 | Does "basic SQL" mean SQLite? | Yes (assumed) |
| 8 | Topic grouping method | Hybrid: embed, cluster, LLM label |
| 9 | "Summary of the questions" reading | Theme-level summary for the coach |
| 11 | `minCohortSize` | 3, configurable |
| 13 | Existing repository for the assessment phase | Confirm |
| 15 | Pending-coach access level | Learner access only |
| 16 | RESOLVED — Does the Groq fallback support JSON-schema structured output? | Yes. Groq documents strict JSON Schema for selected models; B8 defaults to `openai/gpt-oss-20b`. Requests still undergo Zod validation and the one-repair policy. |
| 19, 21-22 | Data-design points (feedback comment visibility for coaches, question embedding storage, conversation hard delete) | See `Database-Design.md` section 12. OPEN-20 was resolved by E-3. |
| 17 | AWS vs Azure target | Decide before deployment |
| 18 | When to move to real databases | Approved and in progress; complete remaining migrations and verify before removing legacy stores |

---

## 13. Build order

See `backend-architecture.md` section 22 (B0 to B12), one step at a time with an approval gate at each, building one small piece at a time in separate files with a comment on every function.
