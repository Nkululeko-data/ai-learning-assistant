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
npm run bootstrap
```

Start the development server:

```powershell
npm run dev
```

The API listens on `http://localhost:3000` by default. Change `PORT` in
`.env` to use another port.

## Verify the server

In another PowerShell window, check that the server is responding:

```powershell
Invoke-RestMethod http://localhost:3000/health
```

The `/ready` endpoint also checks the data stores, schema version, and provider
configuration. It returns `503` until all three provider keys are configured
in `.env`: `INCEPTION_API_KEY`, `GROQ_API_KEY`, and `MISTRAL_API_KEY`.

Document upload and ingestion support PDF, DOCX and UTF-8 TXT. The configured
upload limit is 10 MB; expanded DOCX and extracted text are limited to 50 MB.
Document and personal-note text is sent to Mistral for embeddings, so disclose
this data flow to users before enabling uploads. `MISTRAL_API_KEY` is required
for ingestion jobs to finish.

## Implemented functionality and tester focus

The backend implementation is complete through phases B0-B10. B0-B1 cover
repository assessment and design/contracts; B2-B9 provide the main runnable
features, and B10 adds feedback and privacy-safe course insights:

- **B2 — Backend foundation:** configuration, logging and shared error
  handling, storage initialization, health/readiness checks, and administrator
  bootstrap. Test startup, `/health`, `/ready`, and bootstrap behavior.
- **B3 — Accounts and access control:** registration and login, access and
  refresh tokens, permissions, coach approval, and protected operations. Test
  successful and rejected authentication/authorization flows.
- **B4 — Courses and enrolments:** course management and discovery, learner
  join requests, coach decisions, ownership checks, and archive rules. Test
  both allowed and denied course/member actions.
- **B5 — Background jobs:** persistent jobs, retries and recovery, status
  handling, and graceful shutdown. Test job completion, failure/retry, and
  recovery behavior.
- **B6 — Document upload and ingestion:** PDF, DOCX, and UTF-8 TXT validation;
  private storage; text extraction, chunking, and Mistral embeddings; plus
  status, retry, listing, deduplication, and deletion. Focus on upload limits
  and invalid files, course-owner versus personal-note access, ingestion
  success/failure, and retry/delete behavior.
- **B7 — Access-filtered retrieval:** cosine-ranked search over ready chunks
  for active courses, restricted to course documents and the requesting
  learner's own notes, with source metadata. Focus on approved enrolment and
  course ownership checks, personal-note isolation, archived-course exclusion,
  stale embedding models, and ranking. This is an internal service, not a
  standalone HTTP endpoint. Run its focused tests from `backend` with
  `npm test -- --runTestsByPath tests/unit/retrieval.service.test.ts tests/unit/private-file-storage.test.ts`.
- **B8 — Grounded question answering:** `POST /api/v1/chat/ask` uses the
  caller's permitted course material, gates insufficient evidence, and returns
  only system-validated citations. Conversations and messages are stored in
  SQLite and are visible only to their owner. JSON is the default response;
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

For B6, the upload endpoint is `POST /api/v1/documents/upload`; requests use
multipart fields `courseId`, `scope` (`course` or `personal`), and `file`.
Uploads are limited to 10 MB, with expanded DOCX and extracted text limited to
50 MB. See the [API specification](docs/api/API-Specification.md) for all
request formats and related endpoints.

**Not implemented yet:** B11-B12 (administrative operations, privacy erasure,
and release handover) remain for later phases.

**Provider deployment warning:** the Inception API is scheduled to wind down
on December 28, 2026. Choose and test a replacement before that date.

## Production build

From the `backend` directory, configure the production environment and secrets,
then build and start the compiled server:

```powershell
npm run build
npm start
```

API endpoints and request formats are documented in
[`docs/api/API-Specification.md`](docs/api/API-Specification.md).
