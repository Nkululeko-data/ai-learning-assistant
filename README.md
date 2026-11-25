# AI Learning Assistant

The currently runnable application in this repository is the backend REST API.
It requires Node.js 22.13 or later.

## Start the backend locally

Run these commands from the repository root in PowerShell:

```powershell
Set-Location .\backend
npm ci
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

Edit `.env` and set distinct JWT secrets. Generate each secret locally
with this command, running it twice:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Paste the two results into `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`. Keep
them private and do not commit `.env`.

To create the initial administrator, also set `BOOTSTRAP_ADMIN_EMAIL` and
`BOOTSTRAP_ADMIN_PASSWORD` in `.env`. The password must meet the configured
minimum length (12 characters by default). Then seed the initial roles,
permissions, and administrator:

```powershell
Set-Location .\backend
npm run bootstrap
```

Start the development server:

```powershell
Set-Location .\backend
npm run dev
```

The API listens on `http://localhost:3000` by default. Change `PORT` in
`.env` to use another port.
Development logs are formatted for readability in the terminal; `LOG_LEVEL`
controls their verbosity. Production logs remain structured JSON. Set
`INCEPTION_MODEL` and `GROQ_MODEL` in `.env` to choose the LLM models.

## Store deployment secrets in GitHub

This backend reads credentials from environment variables; it does not load a
`credentials.json` file. Do not commit provider keys, JWT secrets, or service
account JSON files. The repository `.gitignore` excludes local `.env` files
and common credentials JSON filenames. `backend/.env.example` contains blank
placeholders and is safe to commit; put real values only in your local
`backend/.env`.

For GitHub Actions, add secrets under **Settings > Secrets and variables >
Actions > New repository secret**. Use these names when a workflow needs them:

- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- `MISTRAL_API_KEY`
- At least one of `INCEPTION_API_KEY` or `GROQ_API_KEY`
- `BOOTSTRAP_ADMIN_PASSWORD` only for a job that runs the initial bootstrap

Map secrets into the specific workflow job's environment using
`${{ secrets.SECRET_NAME }}`; never place secret values in workflow YAML,
README examples, or committed JSON. This repository does not currently include
a GitHub Actions workflow, so adding repository secrets alone will not run or
deploy the backend. Configure the same values in your deployment platform's
secret manager for production.

## Verify the server

In another PowerShell window, check that the server is responding:

```powershell
Invoke-RestMethod http://localhost:3000/health
```

The `/ready` endpoint also checks the data stores, schema version, and provider
configuration. It returns `503` until `MISTRAL_API_KEY` and at least one LLM
provider key (`INCEPTION_API_KEY` or `GROQ_API_KEY`) are configured in `.env`.
Configuring both LLM providers enables fallback between them.

## Run a backend on each device with shared data

The backend now stores application records in PostgreSQL and MongoDB rather
than using JSON or SQLite at runtime. Each device can run its own backend while
both connect to the same Neon PostgreSQL database and MongoDB database:

- Set the same `DATABASE_URL` on both devices.
- Set the same `MONGODB_URI` and `MONGODB_DB_NAME` on both devices.
- Set the same `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` so tokens issued
  by either backend can be used with the other.
- Configure provider credentials on each backend that needs to make AI calls.

Use a secret manager or another secure channel to configure those values.
Never commit or post connection strings or secrets. Keep `DATA_DIR` local; it
is used as the source for one-time JSON/SQLite/file migrations, not as shared
runtime storage. Each frontend should call its own local backend.

### One-time migration of existing local data

Choose **one** device as the authoritative source. Stop both backend instances
while migrating, and do not run the import commands independently on each
device. On the source device, from `backend`, run the dry runs first:

```powershell
npm run migrate:json-to-neon -- --dry-run
npm run migrate:json-to-mongo -- --dry-run
```

Review the printed counts and backup locations. When they match the data to
preserve, import from that same source device:

```powershell
npm run migrate:json-to-neon
npm run migrate:json-to-mongo
```

The commands create backups under the configured `DATA_DIR` and leave the
original data in place. The Neon importer applies the PostgreSQL migrations;
the Mongo importer copies document metadata, chunks, jobs, and private upload
bytes into MongoDB GridFS. Importers reject incompatible existing target data
instead of deleting it. Keep the backups and source files until you have
verified users, courses, conversations, documents, and uploaded files through
the application.

On the other device, configure the same database targets and JWT secrets, but
do not import that device's local JSON. Start its backend only after the
authoritative data has been imported and both databases are ready. `/ready`
checks connectivity and schema/index readiness; it cannot confirm that two
different environment files point to identical cloud resources.

Rate limiting is currently held in each backend process, so limits are not
aggregated between devices. Admin insight-setting changes are persisted in
PostgreSQL for audit, but effective settings are process-local; apply the same
change on each running backend.

Document upload and ingestion support PDF, DOCX and UTF-8 TXT. The configured
upload limit is 10 MB; expanded DOCX and extracted text are limited to 50 MB.
Document and personal-note text is sent to Mistral for embeddings, so disclose
this data flow to users before enabling uploads. `MISTRAL_API_KEY` is required
for ingestion jobs to finish.

## Implemented functionality and tester focus

The backend implementation is complete through phases B0-B12. B0-B1 cover
repository assessment and design/contracts; B2-B9 provide the main runnable
features; B10 adds feedback and privacy-safe course insights, B11 adds
administrative operations and privacy erasure, and B12 provides release
verification and operating artefacts:

- **B2 — Backend foundation:** configuration, logging and shared error
  handling, storage initialization, health/readiness checks, and administrator
  bootstrap. Test startup, `/health`, `/ready`, and bootstrap behavior.
- **B3 — Accounts and access control:** registration and login, access and
  refresh tokens, permissions, coach approval, and protected operations. Test
  successful and rejected authentication/authorization flows.
- **B4 — Courses and enrolments:** coach course creation and preparation,
  administrator approval before learner discovery, learner join requests,
  coach decisions, ownership checks, and archive rules. Test both allowed and
  denied course/member actions.
- **B5 — Background jobs:** persistent jobs, retries and recovery, status
  handling, and graceful shutdown. Test job completion, failure/retry, and
  recovery behavior.
- **B6 — Document upload and ingestion:** PDF, DOCX, and UTF-8 TXT validation;
  private storage; text extraction, chunking, and Mistral embeddings; plus
  status, retry, listing, deduplication, and deletion. Focus on upload limits
  and invalid files, course-owner versus personal-note access, ingestion
  success/failure, and retry/delete behavior.
- **B7 — Access-filtered retrieval:** hybrid BM25 keyword and cosine semantic
  search over ready chunks, combined with weighted reciprocal-rank fusion
  for active courses, restricted to course documents and the requesting
  learner's own notes, with source metadata. Focus on approved enrolment and
  course ownership checks, personal-note isolation, archived-course exclusion,
  stale embedding models, and ranking. This is an internal service, not a
  standalone HTTP endpoint. Run its focused tests from `backend` with
  `npm test -- --runTestsByPath tests/unit/retrieval.service.test.ts tests/unit/private-file-storage.test.ts`.
- **B8 — Grounded question answering:** `POST /api/v1/chat/ask` uses the
caller's permitted course material, gates insufficient evidence, and returns
only system-validated citations. Conversations and messages are stored in
PostgreSQL and are visible only to their owner. JSON is the default response;
  `Accept: text/event-stream` replays the complete validated response (not
  model tokens). Test prompt injection handling, evidence threshold behavior,
  citation suppression, access isolation, conversation CRUD, provider failure
  fallback, and request/daily quotas. Focused offline tests:

  ```powershell
  npm test -- --runTestsByPath tests/unit/chat.graph.test.ts tests/unit/chat.service.test.ts tests/unit/conversation.repository.test.ts tests/unit/structured-output.service.test.ts
  ```

  Example request (replace the bearer token and course ID with values from an
  active account and a course the user owns or is approved to access):

  ```json
  {
    "courseId": "00000000-0000-4000-8000-000000000001",
    "question": "What does the course material say about this topic?"
  }
  ```

  Include `conversationId` from a previous response to continue that
  conversation. Ensure the course has at least one `ready` document. Chat
  sends questions to Mistral for embeddings and sends bounded history and
  retrieved evidence to the configured LLM provider. The default limits are
  10 requests/minute, 100 requests/UTC day, and 100,000 provider tokens/UTC
  day; they are configurable.
- **B9 — Learning content and quizzes:** summaries, flashcards, and quizzes
  are generated only from selected, accessible, ready course documents.
  Learner-generated content is private; coach summaries, flashcards, and
  quizzes remain drafts until the course owner publishes them. Learner quiz
  views omit answer keys before submission; the server scores attempts and
  returns explanations afterward. Test source selection/isolation, invalid
  citation rejection, coach publish permissions, learner answer-key privacy,
  attempt scoring, and quiz versioning. Focused offline tests:

  ```powershell
  npm test -- --runTestsByPath tests/unit/learning.service.test.ts tests/unit/retrieval.service.test.ts tests/unit/structured-output.service.test.ts
  ```

  Example summary request to `POST /api/v1/summaries/generate`:

  ```json
  {
    "courseId": "00000000-0000-4000-8000-000000000001",
    "selection": {
      "documentIds": ["00000000-0000-4000-8000-000000000002"],
      "sections": ["Transactions"],
      "topic": "atomicity"
    },
    "scope": "section"
  }
  ```

  Learners can read published course content and their own private content;
  coaches can read their drafts and publish with `{ "version": 1 }` to the
  corresponding `/summaries/{id}/publish` or `/flashcards/{id}/publish`
  endpoint. See the API specification for flashcard, quiz, and attempt bodies.
- **B10 — Feedback and course insights:** learners can submit or update feedback
  for an owned assistant answer with `POST /api/v1/feedback`. Coach insight
  endpoints are owner-only and use `insights:view`; aggregates are withheld
  until the configured cohort threshold is reached. Gap-report refresh queues
  a privacy-safe background job. Feedback comments and conversation text are
  never exposed by coach insight responses.

  Example feedback body:

  ```json
  {
    "messageId": "00000000-0000-4000-8000-000000000010",
    "conversationId": "00000000-0000-4000-8000-000000000011",
    "courseId": "00000000-0000-4000-8000-000000000001",
    "rating": "helpful",
    "comment": "The explanation was clear"
  }
  ```
- **B11 — Administration and privacy erasure:** admins can review submitted
  courses, group safe user metadata by role, change roles and coach permission
  overrides, suspend or restore accounts, issue one-time password reset
  tokens, and review redacted audit and AI execution metadata. Effective
  non-secret insight settings can be read and changed by authorized admins.
  Privacy erasure is queued as a persistent
  job and deletes conversations, personal documents/chunks/uploads, private
  learning content, quiz attempts, and refresh tokens. It then tombstones the
  user and pseudonymizes retained feedback/activity records. Admin APIs never
  return conversation text, document text, chunk text, secrets, or credentials.

  Example status and erasure requests:

  ```json
  { "status": "suspended" }
  ```

  Use `PATCH /api/v1/admin/users/{id}/status` for the body above, and
  `POST /api/v1/admin/users/{id}/erase` to enqueue erasure.
- **B12 — Release verification and packaging:** the API contract is published
  at `/openapi.json` and Swagger UI at `/api/docs`. Docker packaging uses one
  container and persistent shared PostgreSQL/MongoDB services. Offline AI evaluation
  checks deterministic citation and refusal behavior and does not call external
  providers. Backup/restore scripts and the handover guide are included.

Run the focused B6 tests from the `backend` directory:

```powershell
npm test -- --runTestsByPath tests/integration/documents.test.ts tests/unit/document.chunker.test.ts tests/unit/document.validation.test.ts tests/unit/mistral-embedding.provider.test.ts
```

Run the focused B5 integration tests from the `backend` directory:

```powershell
npm test -- --runTestsByPath tests/integration/jobs.test.ts
```

For B6, the upload endpoint is `POST /api/v1/documents/upload`; requests use
multipart fields `courseId`, `scope` (`course` or `personal`), and `file`.
Uploads are limited to 10 MB, with expanded DOCX and extracted text limited to
50 MB. See the [API specification](docs/api/API-Specification.md) for all
request formats and related endpoints.

**Release status:** B0-B12 are implemented. Deployment approval still requires
the operator to choose credentials, persistent storage, backup retention, and
a supported replacement for the Inception provider before its December 28,
2026 shutdown. Docker image builds are verified; container startup must also
be smoke-tested on the target Linux host because the current Windows Docker
Desktop host produced a native `better-sqlite3` startup crash.

**Provider deployment warning:** the Inception API is scheduled to wind down
on December 28, 2026. Choose and test a replacement before that date.

## Production build

From the `backend` directory, configure the production environment and secrets,
then build and start the compiled server:

```powershell
Set-Location .\backend
npm run build
npm start
```

API endpoints and request formats are documented in
[`docs/api/API-Specification.md`](docs/api/API-Specification.md).
