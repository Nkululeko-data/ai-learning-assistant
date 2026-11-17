# Security Architecture

**Status:** Approved implementation baseline for B2; open decisions remain gated.

## Identity and authorization

- Passwords use argon2; credentials and tokens are never logged or returned.
- Access JWTs are short-lived. Refresh tokens are opaque, stored hashed, rotated on every use, and grouped into families. Reuse of a revoked token revokes its family.
- Access tokens carry a permission version. Role and coach permission changes increment that version, so stale access tokens are rejected on the next request.
- Refresh cookies are `HttpOnly`, `Secure`, `SameSite=Strict` and narrowly scoped. Optional body-based refresh is disabled unless explicitly configured.
- Suspended and archived users cannot authenticate or refresh.
- Registration and login are throttled by IP and a hashed normalized email key; failed passwords trigger configured account lockout.
- `POST /api/v1/auth/register` accepts a validated JSON body with `email`, `password` and `displayName`. `requestCoach` and `coachMessage` are optional; unknown fields are rejected. For example:

  ```json
  {
    "email": "learner@example.com",
    "password": "A-strong-password-123!",
    "displayName": "Test Learner",
    "requestCoach": true,
    "coachMessage": "I teach a class."
  }
  ```

- Registration responses must never include password hashes or credentials. Coach requests remain pending until an administrator reviews them.
- Every protected operation performs both an action permission check and a resource ownership/membership check. Permissions do not imply ownership.
- Users cannot change their own roles. Coach approval, role changes and permission overrides are admin-controlled and audited.
- Course access requires an active course and either course ownership or approved enrolment. Pending, rejected and removed enrolments do not authorize content access.
- Active course discovery exposes only the name and description to authenticated users. Full course details require ownership or approved enrolment; archived courses are read-only and hidden from non-members.

## Content isolation

- Learner personal notes are visible only to their owner; neither coaches nor admins can read them.
- Admin APIs and tools may expose user, role, configuration, audit and execution metadata only. They must not access course content, documents, chunks or conversation text.
- Coaches see cohort-qualified themes and aggregates only, never individual conversations or raw learner question text.
- `RetrievalService` is the only chunk access path. It checks course access and filters scope, owner and current embedding model before similarity scoring.
- Learner quiz schemas never include correct answers or explanations before submission. Scoring happens on the server.

## File and input handling

- Permit PDF, DOCX and TXT only after extension allowlist, MIME validation and file-content sniffing.
- Enforce the 10 MB upload limit and 50 MB expanded DOCX/extracted-text limit. Store upload and chunk files under random UUID paths outside any web root with private file permissions; never derive paths from user filenames.
- Treat uploaded text, retrieved chunks, conversation history and external content as untrusted data. Delimit evidence and never promote it to system instructions.
- Never execute uploaded files or render uploaded content as HTML.
- Use parameterised SQL only. Apply request body limits, security headers, CORS allowlists and validation to every endpoint.

## AI provider privacy and safety

Document and personal-note text is sent to Mistral for embeddings. Questions and context may be sent to the configured LLM provider for generation. This data flow must be disclosed in the user-facing upload/privacy notices and in deployment documentation before a user uploads a document or personal note. OCR is not performed; low-text PDFs fail with a safe diagnostic.

Provider SDKs are isolated behind adapters; secrets are environment/secret-manager values. Logs and `agent_executions` contain metadata only: no prompts, outputs, document text or question text. Production tracing to external services is disabled and startup fails if prohibited tracing variables are set.

Structured output is Zod-validated with one repair attempt and the documented bounded fallback. Citation validation is deterministic and citations are resolved from system-owned chunk metadata. Semantic faithfulness is evaluated offline; citation existence alone is not proof of entailment.

## Storage, deletion and recovery

- JSON writes use a per-collection write queue, temporary file, flush and atomic rename. The runtime is single-writer and single-instance.
- Uploaded files, chunk files and databases live under private persistent data directories.
- Cross-store workflows are idempotent jobs; reconciliation detects missing/orphaned records and files.
- Personal notes and conversations are hard-deleted when requested. User erasure deletes personal content and conversations, tombstones identity fields and pseudonymizes analytics identities. Audit records contain no content.
- Backups are access-controlled, encrypted at rest by the deployment platform, and retained for the configured period. The privacy notice must explain that erased data may remain in retained backups until they expire.

## Audit and observability

Audit logs are append-only and include actor, action, target, request ID and whitelisted before/after fields. They never include secrets or content. Structured logs carry request/execution IDs, redact sensitive fields, and exclude credentials, tokens, document text and question text.

Expose liveness and readiness separately. Readiness verifies stores, schema version and provider configuration without logging secret values.

## Security test requirements

Cover cross-learner personal-note isolation, pending/removed enrolments, archived courses, coach and admin content boundaries, role self-escalation, refresh-token reuse, quiz answer-key leakage, prompt-injection fixtures, upload validation, SQL parameterization, and redaction rules. Unit/integration/CI tests must use fake providers and never send real user content to external services.
