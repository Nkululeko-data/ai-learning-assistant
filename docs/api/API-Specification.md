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
| `EXTRACTION_LOW_TEXT`, `INGESTION_FAILED` | 422 | Document could not be processed |
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

## Critical response contracts

- **Quiz learner view:** includes prompt and options only; never `correctOptionId` or `explanation` until after attempt submission.
- **Chat response:** includes `groundingStatus`, validated answer (or null for insufficient/unverified), and citations whose metadata is resolved from chunk records.
- **Document status:** includes status and actionable diagnostics, never extracted document text.
- **Insights:** includes cohort-qualified themes and counts only; no question examples or verbatim text.
- **Admin response:** never includes course content, chunks, conversation bodies or credentials.

## Contract tests

Test common envelopes and error codes; permissions and ownership; pagination; idempotency; learner answer-key exclusion; cross-learner note isolation; and absence of content in admin/insight responses. Keep final schemas aligned with generated OpenAPI.
