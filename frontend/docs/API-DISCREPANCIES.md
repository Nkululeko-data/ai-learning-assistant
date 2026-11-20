# API and Project Discrepancies

**Inspection date:** 2026-11-19

This is the frontend inspection log. The mounted Express routes, their Zod
schemas, and runtime responses are authoritative for frontend calls. No
frontend application code had been created during the initial inspection gate;
the F1 scaffold was added after approval.

## What the backend actually exposes

- Feature APIs are mounted under `/api/v1` by
  [`app.ts`](../../backend/src/app.ts).
- Liveness, readiness, and OpenAPI are root routes: `/health`, `/ready`, and
  `/openapi.json`. Swagger UI is at `/api/docs`.
- Success responses use `{ data, meta? }`; list `meta.nextCursor` is omitted
  when there is no next page. `204` responses have no JSON body.
- Errors use `{ error: { code, message, details?, requestId } }`. Validation
  errors have `code: "VALIDATION_FAILED"` and `details` is an array of issue
  paths and messages. Unexpected failures return `INTERNAL_ERROR`.
- Login returns an access token in JSON and sets the refresh token as an
  `HttpOnly`, `Secure`, `SameSite=Strict` cookie. Refresh uses that cookie by
  default; refresh tokens in request bodies are disabled by default.
- `/me` returns the signed-in user's safe profile and effective permissions.
  The frontend must use those permissions for navigation only; the API still
  enforces authorization.
- Document status values include `uploaded`, `processing`, `ready`, `failed`,
  and `deleting`. The UI may label `uploaded` as “Pending”, but must preserve
  the backend value when handling responses.

## Differences from the project brief and design documents

1. **Persistence and AI providers:** the brief proposes MongoDB/Atlas Vector
   Search and Claude/OpenAI. The code uses JSON collections, SQLite for
   conversations and daily chat usage, private chunk files with in-process
   cosine retrieval, Inception/Groq for LLM calls, and Mistral embeddings.
   [`design-decisions (1).md`](<../../design-decisions%20(1).md>) records these
   choices as decided/tabled; the older decision table in
   [`Architecture.md`](../../docs/architecture/Architecture.md) still labels
   several as proposals requiring approval. Follow the decided choices and
   code, not the older table.
2. **Dataset terminology:** the brief refers to courses and datasets. The
   mounted API has courses, enrolments, and course-associated documents; it
   has no dataset resource or dataset endpoints. The frontend will use the
   course/document model.
3. **Project phase status:** this file's companion
   [`current-project-status.md`](../../docs/current-project-status.md) says
   B10 is complete and B11-B12 have not started. The README and
   [`implementation-phases.md`](../../docs/implementation-phases.md) say
   B0-B12 are complete, and the source mounts admin routes and release
   endpoints. The phase-status document is stale and should be reconciled.
4. **Architecture module exports:** `Architecture.md` says modules
   communicate through exported `index.ts` service surfaces. The current
   server wires concrete service classes by importing their module files
   directly. This does not change the frontend API, but the architecture
   statement does not describe the current wiring.
5. **SQLite scope:** design decisions and architecture describe SQLite as
   holding only conversations and messages. The current schema also stores
   `chat_daily_usage` in SQLite.
6. **Docker SQLite dependency:** the root `Dockerfile` rebuilds
   `better-sqlite3`, while the backend source uses Node's built-in
   `node:sqlite` and the backend package does not declare `better-sqlite3`.
   The handover also records a native SQLite container-startup issue. The
   frontend Docker image will be independent; this inspection does not change
   backend Docker files.

## API specification and OpenAPI differences

- A comparison of the nine mounted module route files with the OpenAPI paths
  found the same HTTP methods and route shapes. Parameter names such as
  Express `:id` versus OpenAPI `{userId}` differ textually but are equivalent
  path placeholders.
- The OpenAPI document has `servers: [{ "url": "/api/v1" }]`, which also
  prefixes its `/health` and `/ready` paths. In the actual app those two
  endpoints are at the root, not `/api/v1/health` or `/api/v1/ready`.
- OpenAPI omits query parameters accepted by mounted routes:
  - `GET /admin/coach-requests` accepts optional `status`.
  - `GET /admin/users`, `GET /admin/audit-logs`, and
    `GET /admin/executions` accept `limit` and `cursor`.
- Some Zod refinements are not represented in OpenAPI:
  - `PATCH /quizzes/{quizId}` requires `version` **and** at least one of
    `title` or `questions`; the OpenAPI schema only requires `version`.
  - Learning `selection.sections` must be unique; OpenAPI does not mark the
    array `uniqueItems`.
  - Quiz-attempt `answers` cannot repeat a `questionId`; OpenAPI does not
    express this constraint.
  - A section-scoped summary requires at least one selected section; OpenAPI
    does not express this conditional validation.
- The OpenAPI success schema leaves `data` unconstrained, and many endpoint
  responses are generic envelopes. `app.ts` serves the draft file as
  `/openapi.json`; it is not generated from the runtime Zod schemas. The API
  specification itself says final schemas are to be generated from Zod, so
  the published draft is not sufficient as the sole source for typed frontend
  responses.
- The API specification says long-running work returns `202 Accepted`, but
  summary, flashcard, and quiz generation routes actually return `201` with
  the generated result synchronously.
- `GET /admin/coach-requests` is not cursor-paginated in the code, despite the
  API specification's general statement that lists use cursor pagination.
- Registration's public request schema/OpenAPI permits a one-character
  password, while `AuthService.register()` enforces a configurable minimum
  length (12 by default) and rejects common weak passwords. The effective
  policy is not exposed by a public configuration endpoint.

## Frontend features without matching backend endpoints

- **Source passage preview:** chat citations include document name, page
  range, section, and chunk ID, but no route returns chunk text or a document
  preview. Show citation metadata only and leave passage preview behind a
  typed, disabled API stub until an endpoint is approved and implemented.
- **Document content preview/download:** the document routes expose metadata,
  status, and diagnostics only; there is no route to fetch the original
  document or extracted text. The library can show safe document metadata but
  cannot render a content preview.
- **Document list filters:** `GET /courses/{courseId}/documents` supports only
  `limit` and `cursor`; it has no server-side filename or status filter.
  Frontend filters can only cover pages already fetched.
- **Runtime upload limit:** the default compressed upload limit is 10 MB and
  expanded DOCX/extracted text is limited to 50 MB. `MAX_UPLOAD_SIZE_MB` and
  `MAX_DOCX_EXPANDED_SIZE_MB` can be overridden by the deployment, but the
  backend has no public endpoint to expose those effective values. The client
  uses a matching `VITE_MAX_UPLOAD_SIZE_MB` setting; the server remains
  authoritative, including for expanded DOCX limits.
- **Recent activity feed:** the backend exposes privacy-safe course aggregates
  and gap reports, not a general recent-activity feed. Do not query or expose
  individual activity events. Open question: derive a personal feed from the
  caller's own paginated conversations/quiz attempts, or omit it?
- **Conversation search:** `GET /conversations` accepts `courseId`, `limit`,
  and `cursor`, but no search term or message text in list results. The
  frontend can search titles only on fetched pages unless a backend search
  contract is approved.
- **Conversation order:** the conversation list is ordered by UUID ascending,
  not by `updatedAt`. The frontend sorts only conversations on loaded pages,
  so it cannot guarantee globally newest-first ordering without loading every
  page or adding a backend sort option.
- **Feedback readback:** the backend has `POST /feedback` but no endpoint to
  retrieve a user's prior rating/comment. The frontend can confirm a submitted
  rating in the current view, but cannot prefill feedback when reopening an
  answer.
- **Self-service account deletion:** the backend exposes admin-initiated
  `POST /api/v1/admin/users/{userId}/erase`, not a “delete my account” route.
  Keep self-service deletion feature-flagged off behind a typed stub.
- **Admin course status management:** the backend has
  `PATCH /api/v1/admin/courses/{courseId}`, but the course list/detail routes
  return only a public course card (without owner or version) to non-owners.
  There is no admin course-list/detail route to obtain the required optimistic
  `version`, so do not present non-owner admin status controls until the
  backend exposes the required read shape.
- **Retrieval/search screen:** retrieval is an internal service with no
  public search endpoint. Do not build a standalone retrieval screen.
- **Cancel/progress controls:** document upload/deletion, gap-report refresh,
  and account erasure return job IDs/statuses and can be polled through
  `GET /api/v1/jobs/{jobId}`. Chat and learning generation are synchronous
  with no job-progress endpoints; the chat route aborts work when its request
  connection closes, but there is no separate cancellation endpoint.

## Chat and document behavior to preserve

- Chat `POST /api/v1/chat/ask` supports `Accept: text/event-stream`, but the
  route waits for the full answer and citation validation, then sends one
  `response` event followed by `done`. This is a post-validation replay, not
  incremental token streaming. The UI will show a truthful in-progress state
  and render the completed response when it arrives.
- Insufficient and unverified chat results carry a `groundingStatus` and
  suppress the answer (`answer: null`). Render this distinctly; do not show
  citation chips when citations are empty.
- Chat citations contain metadata only, not the cited passage.
- Chat intent classification includes `explanation`, `summary`, `quiz`, and
  `flashcards`; there is no separate explanation endpoint. Summary, quiz, and
  flashcard intents return a suggested action to their respective endpoints
  rather than generating that content inside chat.
- Upload accepts PDF, DOCX, and UTF-8 TXT. The backend defaults to a 10 MB
  upload limit and a 50 MB expanded DOCX/extracted-text limit. The document
  list is scoped to a course and includes only the caller's own personal notes
  alongside visible course documents.

## F1 implementation choices

- **Material UI** (rather than Tailwind) provides the accessible component
  foundation.
- **Vitest** with React Testing Library and MSW is used because it integrates
  directly with Vite; Playwright is used for real-backend E2E.
- Default the client base to `/api/v1`; use `VITE_API_BASE_URL`, send
  credentials for refresh cookies, and keep the access token in memory rather
  than persistent browser storage.
- Configure Vite's local API proxy or direct CORS access; the backend default
  CORS origin already allows `http://localhost:5173`. Production origins must
  be configured by the operator.
- Build the frontend as a separate multi-stage static Nginx image; keep the
  existing backend container and its single persistent data volume separate.
