# AI Learning Assistant: Implementation Phases

This guide explains the implementation order in plain language. Use it to see
what each phase is for, what it depends on, and how to decide whether it is
finished. It reorganizes the B0-B12 build order from
[`backend-architecture (1).md`](../backend-architecture%20(1).md); it does not
replace the detailed requirements in the architecture, API, database, or
security documents.

## How to use this guide

1. Work on one phase at a time, in order.
2. Before starting a phase, check its prerequisites and any open decisions.
3. Implement and test only the work in that phase.
4. At the phase gate, report what changed, test results, API examples where
   relevant, and any remaining issues. Get approval before moving on.
5. If project documents disagree, stop and resolve the decision before building
   the affected behavior. The owner decisions take precedence; see
   [`design-decisions (1).md`](../design-decisions%20(1).md) and
   [`Architecture.md`](architecture/Architecture.md).

## At a glance

| Phase | Main result |
|---|---|
| B0 | Understand the repository and agree on the starting point |
| B1 | Agree on the architecture, data model, API, and diagrams |
| B2 | Establish the backend foundation and initialize its storage |
| B3 | Add accounts, authentication, permissions, and coach approval |
| B4 | Add courses and approved learner enrolments |
| B5 | Run reliable background jobs |
| B6 | Accept, store, and process learning documents |
| B7 | Retrieve only material the current learner is allowed to see |
| B8 | Answer learner questions using retrieved evidence and verified citations |
| B9 | Generate and manage summaries, flashcards, and quizzes |
| B10 | Collect feedback and provide privacy-safe course insights |
| B11 | Add administrative operations and privacy erasure |
| B12 | Verify, package, document, and hand over the complete backend |

The React frontend is a later stage. These phases build the backend APIs that
the frontend will use.

**Current repository position:** B0-B6 are complete; B7 is next. B7-B12
remain to be implemented, with approval required at each phase gate.

## Phase details

### B0 — Understand the repository

**Purpose:** Establish what already exists so the project does not overwrite
work or assume a greenfield starting point.

**Work:** Inspect source files, tests, dependencies, project documents, and
repository status. Record the runtime and framework choices and identify
conflicting or missing requirements.

**Done when:** There is a short, accurate baseline describing existing code,
known gaps, and decisions that need clarification. The current assessment is in
[`initial-assessment.md`](initial-assessment.md).

### B1 — Agree on the design and contracts

**Purpose:** Decide what the system should do and how its parts communicate
before adding application features.

**Work:** Review the architecture, data model, API specification, OpenAPI draft,
and system diagrams. Resolve decision gates that affect implementation.

**Done when:** The team has reviewed the contracts and agrees they are ready to
guide implementation. Do not start feature coding based on an unresolved
architecture choice.

**References:** [`Architecture.md`](architecture/Architecture.md),
[`Database-Design.md`](architecture/Database-Design.md),
[`API-Specification.md`](api/API-Specification.md),
[`openapi-draft.json`](api/openapi-draft.json),
[`HLD.md`](architecture/HLD.md),
[`LLD.md`](architecture/LLD.md),
[`Component-Design.md`](architecture/Component-Design.md), and
[`Data-Flow.md`](architecture/Data-Flow.md).

### B2 — Build the backend foundation

**Purpose:** Make a safe, testable application shell that later phases can
extend.

**Work:** Validate configuration; set up structured logging, request IDs, and
shared error handling; implement JSON collection storage and SQLite
conversations; add health and readiness endpoints; and provide an idempotent
bootstrap command for initial roles, permissions, and an administrator.

**Done when:** The service starts from configuration, initializes its stores
and schema, reports health/readiness correctly, and the foundation and
bootstrap behavior have automated tests.

**Implementation note:** The B2 foundation includes configuration, logging,
middleware, JSON storage, SQLite setup, health/readiness, and bootstrap. Check
the code and tests before treating every B2 requirement as complete.

### B3 — Add accounts and access control

**Purpose:** Know who is using the system and enforce what they may do.

**Work:** Implement registration, login, password handling, access and rotating
refresh tokens, lockout, permissions, authorization middleware, audit records,
and admin decisions on coach requests. Coach applicants retain learner access
until approved.

**Done when:** Authentication and permission flows work, sensitive operations
are audited, and tests prove both permitted and denied access. Permissions
alone are not enough: ownership and course membership must also be checked.

### B4 — Add courses and enrolments

**Purpose:** Connect coaches, learners, and the courses whose content they use.

**Work:** Implement course creation and management, course discovery, learner
join requests, and coach approval or rejection. Enforce course ownership and
the project's archive/stash rules.

**Done when:** Only authorized coaches can manage their courses, and only
approved enrolments grant access to course materials and activities.

**Current status:** Complete in the current workspace. Course ownership,
discovery, archive rules, learner join requests, coach decisions, pagination,
and admin reassignment/archive behavior are implemented and tested.

### B5 — Add background jobs and scheduling

**Purpose:** Run long tasks without making API requests wait for all the work.

**Work:** Add persistent job records, claiming, retries with bounded attempts,
dead-letter handling, scheduler state, and graceful shutdown/recovery.
Handlers must be idempotent so retries do not duplicate effects.

**Done when:** Jobs can be queued, completed, retried, recovered after restart,
and inspected safely. Do this before document ingestion, which depends on it.

**Current status:** Complete. Persistent job records, lease-based claiming and
recovery, bounded retries/dead-lettering, scheduler state, safe job-status
routes, and graceful shutdown are implemented and tested. No document-ingestion
handlers or scheduled domain tasks are registered before B6.

### B6 — Add document upload and ingestion

**Purpose:** Turn course documents and learner notes into material that can be
searched.

**Work:** Validate uploads, store files outside the public web root, extract
text, chunk it with source metadata, create embeddings through the configured
adapter, and track status, failures, retries, and deletion through jobs.

**Done when:** Supported files can be processed end to end; invalid or
unreadable files fail safely with useful diagnostics; and document access and
deletion rules are enforced.

**Current status:** Complete. Authenticated PDF, DOCX and UTF-8 TXT uploads are
validated and stored under private random keys. Persistent jobs extract text,
create approximately 512-token chunks with 100-token overlap, embed through
Mistral, and atomically write private chunk files. Status, retry, listing,
deduplication and deletion endpoints enforce course and personal-note access
rules. Focused integration and unit tests cover processing, validation,
visibility, provider retries and deletion.

### B7 — Add access-filtered retrieval

**Purpose:** Find useful learning material without exposing another course's
content or another learner's notes.

**Work:** Implement retrieval behind the agreed service boundary. Check
enrolment and ownership, filter candidates by course and document visibility
before scoring, and return source metadata with the selected chunks.

**Done when:** Retrieval returns relevant authorized chunks, and isolation
tests prove that unauthorized course content and other learners' personal notes
never appear in results.

### B8 — Add grounded question answering

**Purpose:** Answer learner questions from permitted course material and make
the evidence behind each answer inspectable.

**Work:** Add provider adapters and test fakes, typed workflow nodes, follow-up
question rewriting, context construction, an evidence gate, deterministic
citation validation, grounding states, execution metadata, and the chat API.
Persist conversations and messages in SQLite. Return or stream a response only
after validation is complete.

**Done when:** Supported questions produce answers with verified citations;
insufficient evidence does not produce an invented answer; and tests cover
grounding states, access boundaries, provider failures, and citation checks.
Resolve the Groq structured-output question before implementing its fallback
path.

### B9 — Add learning content and quizzes

**Purpose:** Help learners study and let coaches provide course quizzes.

**Work:** Implement summaries, flashcards, quiz generation, coach-created
quizzes and publishing, attempts, scoring, and versioning. Use only material
the requesting user may access.

**Done when:** Generated content has valid source references, quiz attempts are
scored by the server, and learner responses never expose answer keys before
submission.

### B10 — Add feedback and course insights

**Purpose:** Help coaches identify course-level learning gaps without exposing
private conversations.

**Work:** Record feedback and content-free activity events; implement
course-owner insight endpoints and a background gap-report job. Add topic
clustering only after the underlying signals and privacy rules are working.

**Done when:** Insights are limited to the authorized course owner and
cohort-qualified themes and aggregates. They must not disclose question text,
individual conversations, or personal notes.

### B11 — Add administrative operations

**Purpose:** Let admins manage system-level records and respond to operational
and privacy requests without giving them access to learning content.

**Work:** Provide safe views and actions for users, audit records, AI execution
metadata, validated non-secret configuration, and jobs. Add the approved
account erasure workflow.

**Done when:** Admin APIs expose only permitted metadata, administrative
changes are auditable, and erasure is safe, repeatable, and covered by tests.

### B12 — Verify and prepare the release

**Purpose:** Confirm the integrated backend is usable, supportable, and ready
for handover.

**Work:** Run the full automated suite and AI evaluation; align and publish
OpenAPI/Swagger; complete setup and operating documentation; prepare Docker,
backup/restore, and handover materials; and resolve deployment choices.

**Done when:** The agreed checks pass, setup and recovery instructions are
followable, known limitations are documented, and the deployment target and
release decisions are approved. Do not claim a check passed unless it was run.

## Important rules that apply to every phase

- Validate API inputs and outputs, and use the shared response and error
  contracts.
- Enforce both action permissions and resource ownership or membership.
- Keep secrets, document text, learner notes, and conversation text out of
  logs and administrative or coach-only responses.
- Use repository/service boundaries so application behavior does not depend on
  storage implementation details.
- Use deterministic fakes in ordinary tests; tests must not call real AI
  providers.
- Treat uploaded and retrieved content as untrusted input.
- Keep the single-process/single-instance constraint while JSON storage is in
  use. Do not scale multiple writers against the same data directory.
- Respect open decisions listed in
  [`design-decisions (1).md`](../design-decisions%20(1).md) and the
  implementation notes in
  [`backend-architecture (1).md`](../backend-architecture%20(1).md).
