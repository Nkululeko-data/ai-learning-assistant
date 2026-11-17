# API Specification

**Status:** Approved draft baseline for B2. The OpenAPI contract is [openapi-draft.json](./openapi-draft.json); final schemas will be generated from Zod as endpoint phases are implemented.

## Conventions

- Base path: `/api/v1`; JSON unless an endpoint accepts multipart upload or returns post-validation SSE.
- Success: `{ "data": ..., "meta": ... }`. Error: `{ "error": { "code", "message", "details", "requestId" } }`.
- Protected endpoints require a bearer access token, an action permission where applicable, and a resource ownership/membership policy.
- Lists use cursor pagination with a bounded `limit`. Suitable POSTs support `Idempotency-Key`.
- Every request has a `requestId`. Long-running work returns `202 Accepted` with a job/resource status URL.
- Chat SSE runs the graph to completion and streams only the already-validated response over POST; it is not token-by-token generation.
- All bodies, query parameters, path parameters and response shapes are validated/documented with Zod.

## Error catalogue

| Code | HTTP | Meaning |
|---|---:|---|
| `VALIDATION_FAILED` | 422 | Request schema failed |
| `AUTH_INVALID_CREDENTIALS` | 401 | Invalid login credentials |
| `AUTH_TOKEN_EXPIRED`, `AUTH_TOKEN_INVALID` | 401 | Access/refresh token invalid or expired |
| `AUTH_ACCOUNT_LOCKED` | 429 | Account is locked after failed logins |
| `AUTH_PASSWORD_CHANGE_REQUIRED` | 403 | Bootstrap/reset password must be changed before privileged actions |
| `FORBIDDEN` | 403 | Permission or ownership check failed |
| `ENROLMENT_REQUIRED` | 403 | Approved course membership required |
| `NOT_FOUND` | 404 | Resource absent or intentionally hidden |
| `CONFLICT` | 409 | Duplicate, stale version or conflicting decision |
| `COURSE_ARCHIVED` | 409 | Operation not allowed for archived course |
| `FILE_TYPE_NOT_ALLOWED` | 415 | Upload type mismatch |
| `FILE_TOO_LARGE` | 413 | Upload exceeds configured limit |
| `INSUFFICIENT_MATERIAL` | 422 | Selected sources cannot support generation |
| `RATE_LIMITED`, `QUOTA_EXCEEDED` | 429 | Rate or usage limit reached |
| `GENERATION_FAILED` | 502 | Structured output invalid after repair/fallback |
| `PROVIDER_UNAVAILABLE` | 503 | Required provider unavailable |
| `SERVICE_NOT_READY` | 503 | One or more readiness checks failed |
| `INTERNAL_ERROR` | 500 | Unexpected failure; internals are not exposed |

## Endpoint groups

All IDs below are opaque identifiers. Unless a route is explicitly public, authentication and policy checks apply.

| Group | Method and path | Purpose |
|---|---|---|
| Auth | `POST /auth/register` | Register learner and optionally submit coach request |
| Auth | `POST /auth/login` | Authenticate and issue access/refresh tokens |
| Auth | `POST /auth/refresh` | Rotate refresh token |
| Auth | `POST /auth/logout` | Revoke refresh-token family |
| Auth | `POST /auth/change-password` | Change password, including forced initial change |
| Auth | `GET /me` | Get current user's safe profile and effective permissions |
| Courses | `POST /courses` | Create course |
| Courses | `GET /courses` | List active course cards and accessible courses |
| Courses | `GET /courses/{id}` | Get course details allowed to the caller |
| Courses | `PATCH /courses/{id}` | Update or archive an owned course using optimistic version |
| Enrolments | `POST /courses/{id}/join` | Request to join course |
| Enrolments | `GET /me/enrolments` | List current user's enrolments |
| Enrolments | `GET /courses/{id}/join-requests` | List join requests for owned course |
| Enrolments | `PATCH /enrolments/{id}` | Approve/reject request |
| Enrolments | `DELETE /courses/{id}/enrolment` | Remove learner enrolment |
| Admin | `PATCH /admin/courses/{id}/owner` | Reassign a course to an active coach |
| Admin | `PATCH /admin/courses/{id}` | Archive a course when its owner cannot be retained |
| Documents | `POST /documents/upload` | Validate/store upload and enqueue ingestion; returns 202 |
| Documents | `GET /documents/{id}/status` | Get processing status and safe diagnostics |
| Documents | `POST /documents/{id}/retry` | Retry failed ingestion |
| Documents | `GET /courses/{id}/documents` | List visible course document metadata |
| Documents | `DELETE /documents/{id}` | Enqueue hard deletion |
| Chat | `POST /chat/ask` | Grounded answer; JSON or validated POST-based SSE |
| Conversations | `GET /conversations` | List caller's conversations |
| Conversations | `GET /conversations/{id}` | Read owned conversation and messages |
| Conversations | `PATCH /conversations/{id}` | Rename owned conversation |
| Conversations | `DELETE /conversations/{id}` | Hard-delete owned conversation and messages |
| Learning | `POST /summaries/generate` | Generate/store selected-source summary |
| Learning | `POST /flashcards/generate` | Generate/store selected-source flashcards |
| Quizzes | `POST /quizzes/generate` | Generate private learner quiz or coach draft |
| Quizzes | `POST /quizzes` | Create coach quiz draft |
| Quizzes | `PATCH /quizzes/{id}` | Edit draft or create new version when required |
| Quizzes | `POST /quizzes/{id}/publish` | Publish coach quiz |
| Quizzes | `GET /courses/{id}/quizzes` | List visible quizzes using caller-specific view |
| Quizzes | `GET /quizzes/{id}` | Get learner-safe or owner quiz view |
| Quizzes | `POST /quizzes/{id}/attempts` | Submit answers; server scores and returns result |
| Quizzes | `GET /me/quiz-attempts` | List caller's attempts |
| Feedback | `POST /feedback` | Submit/update rating and optional comment |
| Insights | `GET /courses/{id}/insights` | Get owner-only cohort aggregates |
| Insights | `GET /courses/{id}/gap-report` | Get latest theme-only gap report |
| Insights | `POST /courses/{id}/gap-report/refresh` | Enqueue gap-report job |
| Admin | `GET /admin/coach-requests`, `PATCH /admin/coach-requests/:id` | List and decide coach requests |
| Admin | `GET /admin/users` | List user metadata |
| Admin | `PATCH /admin/users/{id}/role` | Change role (not own role) |
| Admin | `PATCH /admin/users/{id}/permissions` | Grant/revoke fine-grained permissions |
| Admin | `PATCH /admin/users/{id}/status` | Stash/suspend/restore user |
| Admin | `POST /admin/users/{id}/reset-password` | Issue one-time reset token |
| Admin | `POST /admin/users/{id}/erase` | Enqueue privacy erasure |
| Admin | `GET /admin/audit-logs` | List redacted audit metadata |
| Admin | `GET /admin/executions` | List AI execution metadata only |
| Admin | `GET/PATCH /admin/config` | Read/update validated non-secret config |
| Admin | `GET /admin/jobs` | List job metadata |
| Admin | `POST /admin/jobs/{id}/retry` | Retry dead job |
| Jobs | `GET /jobs/{id}` | Get caller-authorized job status |
| System | `GET /health` | Liveness |
| System | `GET /ready` | Readiness of stores, schema and provider configuration |

## Course and enrolment contracts (B4)

- `POST /courses` requires `course:create` and an active coach. Its JSON body
  requires `name` (1-120 characters) and accepts an optional `description`
  (maximum 2000 characters), for example:

  ```json
  { "name": "Biology 101", "description": "Introductory biology" }
  ```
- `GET /courses` returns active course cards to signed-in users. Cards expose
  only `id`, `name` and `description`; owners and approved learners also receive
  full details for their accessible courses. `GET /courses/{id}` follows the
  same visibility rule. Archived courses are visible only to their owner and
  approved learners.
- Course, enrolment and join-request lists accept `limit` (default 20, maximum
  100) and an opaque base64url `cursor`; paginated responses include
  `meta.nextCursor` when another page is available.
- `PATCH /courses/{id}` requires ownership and a current `version`. The body
  may contain `name`, `description`, and/or `status` (`active` or `archived`).
  Content edits require `course:edit`; status changes require
  `course:archive`. Archived courses are read-only until reactivated. A stale
  version returns `409 CONFLICT`; for example:

  ```json
  { "name": "Biology 102", "version": 1 }
  ```
- `POST /courses/{id}/join` is for the learner's own request and takes no
  body. A new request returns `201`; repeating a pending request returns `200`
  without creating another record. Approved enrolments grant course access;
  pending requests expose only the course card.
- Re-requesting after rejection or removal is allowed after a configurable
  cooldown, defaulting to 24 hours. The same `(courseId, userId)` record is
  reused. A request during the cooldown returns `409 CONFLICT`.
- `GET /me/enrolments` returns only the caller's records. Course owners with
  `enrolment:approve` may list their join requests and `PATCH
  /enrolments/{id}` with `{ "status": "approved" }` or
  `{ "status": "rejected", "decisionNote": "..." }`. Repeating the same
  decision is idempotent; a conflicting decision returns `409`.
- `DELETE /courses/{id}/enrolment` removes the caller's approved enrolment;
  the record is stashed as `removed`.
- Admin course-owner reassignment requires `user:manage`; the target must be
  an active coach. `PATCH /admin/courses/{id}/owner` takes
  `{ "ownerId": "<coach-uuid>", "version": 1 }`. If a deactivated coach's
  course is not reassigned, an admin can archive it with
  `PATCH /admin/courses/{id}` and `{ "status": "archived", "version": 1 }`.
  An admin may reactivate an archived course only after its owner is active
  again or the course is reassigned to an active coach.

## Background job contracts (B5)

- Jobs are enqueued by backend services; there is no public enqueue endpoint.
  Payloads contain identifiers and parameters only, never document or question
  text. The runner claims one due job at a time using a persisted lease.
- New jobs allow three attempts by default (up to ten). Retryable failures use
  exponential backoff from one second, capped at 60 seconds. Expired leases are
  recovered as another attempt. Exhausted jobs become `dead`; explicitly
  non-retryable failures become `failed`. Administrators can retry either
  terminal status, which resets the attempt count and preserves the job ID.
- `GET /jobs/{id}` returns status only to the job creator or an administrator
  with `executions:view`. Missing and unauthorized jobs both return `404`.
- `GET /admin/jobs` requires `executions:view`; it accepts `limit` (default
  20, maximum 100), a UUID `cursor`, and an optional `status` filter. Results
  are in stable UUID order and include `meta.nextCursor` when another page is
  available.
- `POST /admin/jobs/{id}/retry` requires `user:manage`, accepts no body, and
  returns `200` with the safe job-status projection. It returns `409` unless
  the job is `failed` or `dead`.
- Job-status responses include only `id`, `type`, `status`, attempt counts,
  `runAfter`, safe error code/message, and timestamps. They never include
  payloads, results, creator IDs, or request IDs.
- Scheduled occurrences use a persisted task state and unique occurrence key,
  so a restart between enqueueing and advancing the schedule reuses the same
  job. Domain handlers and scheduled tasks are registered by the phase that
  introduces them.

## Document contracts (B6)

- `POST /documents/upload` accepts `multipart/form-data` with `courseId`
  (UUID), `scope` (`course` or `personal`) and `file`. Only PDF, DOCX and
  UTF-8 TXT files are accepted. The compressed upload limit is 10 MB by
  default; expanded DOCX and extracted text are limited to 50 MB. Extension,
  declared MIME, file signature and DOCX package structure are checked.
- Course-scope uploads require the active course's owning coach and
  `document:upload`. Personal-scope uploads require an active, approved
  learner and are visible only to that learner. The course owner and approved
  learners can see course-document metadata; admins cannot access documents
  or content. Archived courses reject new uploads and retries.
- Successful uploads return `202` with safe metadata and an `ingestJobId`.
  Poll `GET /documents/{id}/status` for `uploaded`, `processing`, `ready`,
  `failed` or `deleting`; the response may include parser/page/character
  diagnostics, safe error codes and actionable error detail, never extracted
  text, hashes or storage keys.
- Duplicate files are rejected within the same `(courseId, scope, ownerId)`
  using SHA-256. `POST /documents/{id}/retry` returns `202` only for a failed
  document with the required ownership and `document:upload` permission.
  `DELETE /documents/{id}` marks the record deleting and returns `202`; a
  cleanup job hard-deletes the source file, chunks and metadata.
- `GET /courses/{id}/documents` accepts `limit` (default 20, maximum 100) and
  a UUID cursor. Approved learners see course documents and only their own
  personal notes; course owners see course documents only. Archived courses
  remain readable to existing members, but later retrieval excludes them.
- Chunks use the configured approximate 512-token size and 100-token overlap
  by default (about four characters per token); chunks never cross PDF pages.
  OCR is not supported. PDFs with fewer than 50 extracted characters fail
  with `EXTRACTION_LOW_TEXT` and a scanned-file diagnostic.
- Document and personal-note text is sent to Mistral for embeddings. Deployers
  must disclose this before upload. `MISTRAL_API_KEY` is optional at startup
  but required to complete ingestion; provider failures are exposed only as
  safe status diagnostics.

## Critical response contracts

- **Quiz learner view:** includes prompt and options only; never `correctOptionId` or `explanation` until after attempt submission.
- **Chat response:** includes `groundingStatus`, validated answer (or null for insufficient/unverified), and citations whose metadata is resolved from chunk records.
- **Document status:** includes status and actionable diagnostics, never extracted document text.
- **Insights:** includes cohort-qualified themes and counts only; no question examples or verbatim text.
- **Admin response:** never includes course content, chunks, conversation bodies or credentials.

## Contract tests

Test common envelopes and error codes; permissions and ownership; pagination; idempotency; learner answer-key exclusion; cross-learner note isolation; and absence of content in admin/insight responses. Keep final schemas aligned with generated OpenAPI.
