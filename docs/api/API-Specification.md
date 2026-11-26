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

| Code                                       | HTTP | Meaning                                                            |
| ------------------------------------------ | ---: | ------------------------------------------------------------------ |
| `VALIDATION_FAILED`                        |  422 | Request schema failed                                              |
| `AUTH_INVALID_CREDENTIALS`                 |  401 | Invalid login credentials                                          |
| `AUTH_TOKEN_EXPIRED`, `AUTH_TOKEN_INVALID` |  401 | Access/refresh token invalid or expired                            |
| `AUTH_ACCOUNT_LOCKED`                      |  429 | Account is locked after failed logins                              |
| `AUTH_PASSWORD_CHANGE_REQUIRED`            |  403 | Bootstrap/reset password must be changed before privileged actions |
| `FORBIDDEN`                                |  403 | Permission or ownership check failed                               |
| `ENROLMENT_REQUIRED`                       |  403 | Approved course membership required                                |
| `NOT_FOUND`                                |  404 | Resource absent or intentionally hidden                            |
| `CONFLICT`                                 |  409 | Duplicate, stale version or conflicting decision                   |
| `COURSE_ARCHIVED`                          |  409 | Operation not allowed for archived course                          |
| `COURSE_NOT_AVAILABLE`                     |  409 | Course is awaiting administrator approval                          |
| `FILE_TYPE_NOT_ALLOWED`                    |  415 | Upload type mismatch                                               |
| `FILE_TOO_LARGE`                           |  413 | Upload exceeds configured limit                                    |
| `INSUFFICIENT_MATERIAL`                    |  422 | Selected sources cannot support generation                         |
| `RATE_LIMITED`, `QUOTA_EXCEEDED`           |  429 | Rate or usage limit reached                                        |
| `GENERATION_FAILED`                        |  502 | Structured output invalid after repair/fallback                    |
| `PROVIDER_UNAVAILABLE`                     |  503 | Required provider unavailable                                      |
| `NODE_TIMEOUT`                             |  504 | A bounded AI workflow node exceeded its configured timeout         |
| `SERVICE_NOT_READY`                        |  503 | One or more readiness checks failed                                |
| `INTERNAL_ERROR`                           |  500 | Unexpected failure; internals are not exposed                      |

## Endpoint groups

All IDs below are opaque identifiers. Unless a route is explicitly public, authentication and policy checks apply.

| Group         | Method and path                                                | Purpose                                                                                 |
| ------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Auth          | `POST /auth/register`                                          | Register learner and optionally submit coach request                                    |
| Auth          | `POST /auth/login`                                             | Authenticate and issue access/refresh tokens                                            |
| Auth          | `POST /auth/refresh`                                           | Rotate refresh token                                                                    |
| Auth          | `POST /auth/logout`                                            | Revoke refresh-token family                                                             |
| Auth          | `POST /auth/change-password`                                   | Change password, including forced initial change                                        |
| Auth          | `GET /me`                                                      | Get current user's safe profile and effective permissions                               |
| Courses       | `POST /courses`                                                | Create course                                                                           |
| Courses       | `POST /courses/{id}/submit-for-approval`                       | Resubmit a course returned for changes                                                  |
| Courses       | `GET /courses`                                                 | List active course cards and accessible courses                                         |
| Courses       | `GET /me/courses`                                              | List paginated courses owned by the authenticated coach                                 |
| Courses       | `GET /courses/{id}`                                            | Get course details allowed to the caller                                                |
| Courses       | `GET /courses/{id}/preview`                                    | Preview ordered lesson titles without accessing lesson content                          |
| Courses       | `GET /courses/{id}/lessons`                                    | List ordered lesson topics and available course media for the owner or approved learner |
| Courses       | `PUT /courses/{id}/lessons`                                    | Replace an owned course's ordered lessons using optimistic versioning                   |
| Documents     | `POST /courses/{id}/lesson-videos`                             | Store an MP4 in the course library without document ingestion                           |
| Courses       | `PATCH /courses/{id}`                                          | Update or archive an owned course using optimistic version                              |
| Enrolments    | `POST /courses/{id}/join`                                      | Request to join course                                                                  |
| Enrolments    | `GET /me/enrolments`                                           | List current user's enrolments                                                          |
| Enrolments    | `GET /courses/{id}/learners`                                   | List active learners visible to the course owner and approved class members             |
| Enrolments    | `GET /courses/{id}/join-requests`                              | List join requests for owned course                                                     |
| Enrolments    | `PATCH /enrolments/{id}`                                       | Approve/reject request                                                                  |
| Enrolments    | `POST /enrolments/{id}/remove`                                 | Remove an enrolled learner with a required reason                                       |
| Enrolments    | `DELETE /courses/{id}/enrolment`                               | Remove learner enrolment                                                                |
| Admin         | `PATCH /admin/courses/{id}/owner`                              | Reassign a course to an active coach                                                    |
| Admin         | `PATCH /admin/courses/{id}`                                    | Archive a course when its owner cannot be retained                                      |
| Admin         | `GET /admin/courses/approval-queue`                            | List courses awaiting review                                                            |
| Admin         | `PATCH /admin/courses/{id}/approval`                           | Approve a course or request changes                                                     |
| Documents     | `POST /documents/upload`                                       | Validate/store upload and enqueue ingestion; returns 202                                |
| Documents     | `GET /documents/{id}/status`                                   | Get processing status and safe diagnostics                                              |
| Documents     | `GET /documents/{id}/file`                                     | Stream a ready course PDF or lesson MP4 to an authorized course member                  |
| Documents     | `POST /documents/{id}/retry`                                   | Retry failed ingestion                                                                  |
| Documents     | `GET /courses/{id}/documents`                                  | List visible course document metadata                                                   |
| Documents     | `DELETE /documents/{id}`                                       | Enqueue hard deletion                                                                   |
| Chat          | `POST /chat/ask`                                               | Grounded answer; JSON or validated POST-based SSE                                       |
| Conversations | `GET /conversations`                                           | List caller's conversations                                                             |
| Conversations | `GET /conversations/{id}`                                      | Read owned conversation and messages                                                    |
| Conversations | `PATCH /conversations/{id}`                                    | Rename owned conversation                                                               |
| Conversations | `DELETE /conversations/{id}`                                   | Hard-delete owned conversation and messages                                             |
| Learning      | `POST /summaries/generate`                                     | Generate/store selected-source summary                                                  |
| Learning      | `GET /courses/{id}/summaries`, `GET /summaries/{id}`           | List or read caller-visible summaries                                                   |
| Learning      | `POST /summaries/{id}/publish`                                 | Publish an owned coach summary draft                                                    |
| Learning      | `POST /flashcards/generate`                                    | Generate/store selected-source flashcards                                               |
| Learning      | `GET /courses/{id}/flashcards`, `GET /flashcards/{id}`         | List or read caller-visible flashcard sets                                              |
| Learning      | `POST /flashcards/{id}/publish`                                | Publish an owned coach flashcard draft                                                  |
| Quizzes       | `POST /quizzes/generate`                                       | Generate private learner quiz or coach draft                                            |
| Quizzes       | `POST /quizzes`                                                | Create coach quiz draft                                                                 |
| Quizzes       | `POST /quizzes/manual`                                         | Create a source-free coach quiz draft without AI                                        |
| Quizzes       | `PATCH /quizzes/{id}`                                          | Edit draft or create new version when required                                          |
| Quizzes       | `POST /quizzes/{id}/publish`                                   | Publish coach quiz                                                                      |
| Quizzes       | `GET /courses/{id}/quizzes`                                    | List visible quizzes using caller-specific view                                         |
| Quizzes       | `GET /quizzes/{id}`                                            | Get learner-safe or owner quiz view                                                     |
| Quizzes       | `POST /quizzes/{id}/attempts`                                  | Submit answers; server scores and returns result                                        |
| Quizzes       | `GET /me/quiz-attempts`                                        | List caller's attempts                                                                  |
| Feedback      | `POST /feedback`                                               | Submit/update rating and optional comment                                               |
| Insights      | `GET /courses/{id}/insights`                                   | Get owner-only cohort aggregates                                                        |
| Insights      | `GET /courses/{id}/gap-report`                                 | Get latest cohort-qualified themes, evidence counts, and teaching actions               |
| Insights      | `POST /courses/{id}/gap-report/refresh`                        | Enqueue gap-report job                                                                  |
| Admin         | `GET /admin/coach-requests`, `PATCH /admin/coach-requests/:id` | List and decide coach requests                                                          |
| Admin         | `GET /admin/users`                                             | List safe user metadata, including the role name and status                             |
| Admin         | `PATCH /admin/users/{id}/role`                                 | Change role (not own role)                                                              |
| Admin         | `PATCH /admin/users/{id}/permissions`                          | Grant/revoke fine-grained permissions                                                   |
| Admin         | `PATCH /admin/users/{id}/status`                               | Stash/suspend/restore user                                                              |
| Admin         | `POST /admin/users/{id}/reset-password`                        | Issue one-time reset token                                                              |
| Admin         | `POST /admin/users/{id}/erase`                                 | Enqueue privacy erasure                                                                 |
| Admin         | `GET /admin/audit-logs`                                        | List redacted audit metadata                                                            |
| Admin         | `GET /admin/executions`                                        | List AI execution metadata only                                                         |
| Admin         | `GET/PATCH /admin/config`                                      | Read/update validated non-secret config                                                 |
| Admin         | `GET /admin/jobs`                                              | List job metadata                                                                       |
| Admin         | `POST /admin/jobs/{id}/retry`                                  | Retry dead job                                                                          |
| Jobs          | `GET /jobs/{id}`                                               | Get caller-authorized job status                                                        |
| System        | `GET /health`                                                  | Liveness                                                                                |
| System        | `GET /ready`                                                   | Readiness of stores, schema and provider configuration                                  |

## Course and enrolment contracts (B4)

- `POST /courses` requires `course:create` and an active coach. Its JSON body
  requires `name` (1-120 characters) and accepts an optional `description`
  (maximum 2000 characters), for example:

  ```json
  { "name": "Biology 101", "description": "Introductory biology" }
  ```

- Newly created courses enter `pending` approval and remain visible to their
  owner, but not learners. Admins with `user:manage` review them through
  `GET /admin/courses/approval-queue`. `PATCH /admin/courses/{id}/approval`
  accepts `{ "decision": "approved", "version": 1 }` or
  `{ "decision": "changes_requested", "note": "Add an overview", "version": 1 }`.
  A course returned for changes stays editable by its coach; the coach can
  resubmit it with `POST /courses/{id}/submit-for-approval` and
  `{ "version": 2 }`. Only approved courses appear in learner discovery or
  accept enrolment requests.
- `GET /courses` returns active, approved course cards to signed-in users. Cards expose
  only `id`, `name` and `description`; owners and approved learners also receive
  full details for their accessible courses. `GET /courses/{id}` follows the
  same visibility rule. Archived courses are visible only to their owner and
  approved learners.
- `GET /courses/{id}/preview` returns only lesson IDs and titles for an active
  course to signed-in users. It never includes lesson introductions or media
  references. Archived courses remain hidden from callers without course access.
- Course, enrolment and join-request lists accept `limit` (default 20, maximum 100) and an opaque base64url `cursor`; paginated responses include
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
- `GET /courses/{id}/learners` returns active learners' display names and
  enrolment dates to the course owner or an approved class member. It does not
  expose learner email addresses.
- Course owners with `enrolment:approve` may remove an approved learner with
  `POST /enrolments/{id}/remove` and `{ "reason": "..." }`. The reason is
  required, stored on the learner's enrolment, and visible to that learner
  after removal. The enrolment is retained with status `removed`.
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
- `POST /courses/{id}/lesson-videos` accepts an MP4 file as
  `multipart/form-data`. It requires course edit and document upload
  permissions, limits the file to 100 MiB, validates its extension, declared
  MIME type and file signature, then stores it as a ready course document
  without enqueuing ingestion or creating embeddings. Videos are not eligible
  as AI study sources. An attached lesson video cannot be deleted until it is
  detached from the lesson.
- `GET /documents/{id}/file` serves ready course PDFs or MP4s only to the
  course owner or an approved learner. Lesson responses may include
  `videoDocumentId`, `videoFilename`, and `videoSizeBytes`. Existing external
  video URLs remain readable and may be retained or removed, but new external
  URLs are not accepted. If the stored original is missing, the endpoint
  returns `410 ORIGINAL_FILE_MISSING` and instructs the caller to upload it
  again.
- Document and personal-note text is sent to Google Gemini for embeddings. Deployers
  must disclose this before upload. `GEMINI_API_KEY` is optional at startup
  but required to complete ingestion; provider failures are exposed only as
  safe status diagnostics.

## Chat and conversation contracts (B8)

- `POST /chat/ask` requires `courseId` (UUID) and `question` (1-4000
  characters); `conversationId` is optional for follow-up turns. The caller
  must own the course or have an approved enrolment. Administrators do not
  receive course-content access. Example:

  ```json
  {
    "courseId": "00000000-0000-4000-8000-000000000001",
    "question": "What is a database?"
  }
  ```

- A grounded response includes `conversationId`, `messageId`,
  `executionId`, `groundingStatus`, `answerSource`, `answer`, `message`, `citations`, and
  `retrievalScoreTop`. `grounded` returns an answer and citations resolved
  from the numbered chunks actually sent to the model, with
  `answerSource: "course_material"`. When course evidence cannot be validated
  or the grounded answer cannot be safely produced, the assistant may return a
  separately labeled general-knowledge answer with `groundingStatus: "insufficient"` and
  `answerSource: "general_knowledge"`; it has no citations and is not described
  as web-sourced. If that fallback cannot answer reliably, `answer` is null.
  `unverified` suppresses the draft and returns `answer: null`; only explicit
  learning-content intents return a `suggestedAction`.
- For local retrieval diagnostics, set `CHAT_LOG_REWRITTEN_QUERY=true` in a
  non-production environment. The backend logs the contextualized query for
  the request; it is not written to conversation storage or coach reports.
- `Accept: text/event-stream` replays the already validated response in a
  `response` event followed by `done`. It does not expose provider tokens
  before evidence and citations have been checked.
- Conversation list accepts optional `courseId`, `limit` (default 20,
  maximum 50), and an opaque base64url `cursor`; paginated responses include
  `meta.nextCursor`. Read, rename, and delete operations are restricted to the
  owning user. Deletion hard-deletes the conversation and its messages.
- Chat requests are limited to 10 per minute, 100 requests per UTC day, and
  100,000 recorded provider tokens per UTC day by default. These limits are
  configurable. `429 QUOTA_EXCEEDED` indicates a daily limit; `429
RATE_LIMITED` indicates the short-window limit.
- Each graph node has a configurable timeout (`CHAT_NODE_TIMEOUT_MS`, 60
  seconds by default); an expired node returns `504 NODE_TIMEOUT` and records
  only safe execution metadata.
- The question, bounded conversation history, and retrieved context are sent
  to the configured LLM provider. The question is sent to Google Gemini for query
  embedding. This data flow must be disclosed to users. Execution records
  store only request/resource identifiers, node/status/timing, token counts,
  provider/model, prompt version, and safe error codes—not prompts, answers,
  questions, or document text.
- Gap-report jobs may also send course-scoped questions with insufficient
  grounding and missed course-visible quiz prompts to Gemini for temporary
  topic clustering. Personal-scope questions and private quizzes are excluded;
  only cohort-qualified themes and aggregate counts/feedback ratings are
  stored and returned. This additional processing must be included in the
  privacy disclosure. `totalGapQuestions` and `otherCount` are `null` when
  below-threshold topics or unprocessed questions would make an aggregate
  count disclose suppressed activity.

## Learning content and quiz contracts (B9)

- All generation calls require `courseId` and a `selection` containing 1-10
  unique `documentIds`; optional `sections` and `topic` further constrain the
  selected material. A document the caller cannot access is rejected rather
  than silently skipped. Documents must be ready and use the active embedding
  model. Every returned summary block, flashcard, and quiz question must cite
  chunk IDs from the bounded context sent to the model.
- Summary request:

  ```json
  {
    "courseId": "00000000-0000-4000-8000-000000000001",
    "selection": {
      "documentIds": ["00000000-0000-4000-8000-000000000002"],
      "sections": ["Transactions"],
      "topic": "atomicity"
    },
    "scope": "section",
    "regenerate": false
  }
  ```

  Section scope requires at least one selected section. An identical request
  reuses its stored result unless `regenerate` is true; regeneration stores a
  new version.

- Flashcard generation accepts `count` from 1-50 (default 10) and the same
  selection shape. Quiz generation accepts `count` from 1-50 (default 10),
  `types` (`mcq` and/or `true_false`, default `mcq`), and `difficulty`
  (`easy`, `medium`, or `hard`, default `medium`).
- Learner-generated summaries, flashcards, and quizzes are private to the
  learner; generated learner quizzes are immediately available for attempts.
  Coach-generated summaries and flashcards are course-wide drafts; only the
  course owner can read them before publication. Coaches publish with
  `POST /summaries/{id}/publish` or `POST /flashcards/{id}/publish`, sending
  `{ "version": 1 }`. Read/list routes expose published course content to
  approved learners and drafts to the owning coach.
- `POST /quizzes` creates a coach draft. Questions require source chunk IDs
  from the supplied accessible `sourceDocumentIds`. `PATCH /quizzes/{id}`
  requires the current `version`; editing a published quiz with attempts
  creates a new draft version and supersedes the old one.
- `POST /quizzes/manual` creates an unpublished, course-scoped coach draft
  without source documents, retrieval, embeddings, or LLM calls. The course is
  selected by opening its quiz-management page. Drafts may be incomplete;
  publishing requires at least one valid question. Supported types are
  single-choice (`mcq`), multiple-choice (`multiple_choice`), and
  true/false. Single-answer questions use `correctOptionId`; multiple-choice
  questions use a non-empty `correctOptionIds` array. Quiz instructions are
  stored as the optional `description`.
- Quiz reads and course lists always use a caller-specific view. Before an
  attempt, learner views omit `correctOptionId` and `explanation`, including
  `correctOptionIds` for multiple-choice questions. `POST /quizzes/{id}/attempts`
  accepts `selectedOptionId` for single-answer questions and
  `selectedOptionIds` for multiple-answer questions. The server requires the
  exact correct set for a multiple-answer point, stores the attempt, then
  returns correct answers and explanations. Attempts record the exact quiz
  version. Learners can list only their own attempts with
  `GET /me/quiz-attempts`. Stored attempts may also include an optional
  `status` string or `null`, which is preserved as metadata and does not affect
  scoring.
- Content-generation requests are subject to the configured per-user
  short-window and shared daily AI request/token quotas. `INSUFFICIENT_MATERIAL`
  means the selected source set could not support generation;
  `GENERATION_FAILED` means output or source references failed validation.
  Manual quiz creation does not consume AI-generation quota.

## Critical response contracts

- **Quiz learner view:** includes title, instructions, prompts, and options only; never answer keys or explanations until after attempt submission.
- **Chat response:** includes `groundingStatus` and `answerSource`; course-grounded answers have validated citations resolved from chunk records, while general-knowledge fallbacks are clearly labeled and uncited.
- **Document status:** includes status and actionable diagnostics, never extracted document text.
- **Insights:** includes cohort-qualified themes and counts only; no question examples or verbatim text.
- **Admin response:** never includes course content, chunks, conversation bodies or credentials.

## Contract tests

Test common envelopes and error codes; permissions and ownership; pagination; idempotency; learner answer-key exclusion; cross-learner note isolation; and absence of content in admin/insight responses. Keep final schemas aligned with generated OpenAPI.
