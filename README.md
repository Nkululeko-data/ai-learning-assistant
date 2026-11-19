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

The backend implementation is complete through phases B0-B7. B0-B1 cover
repository assessment and design/contracts; B2-B6 provide the current runnable
features, and B7 adds internal access-filtered retrieval:

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
  standalone HTTP endpoint; B8 will connect it to question answering. Run its
  focused tests from `backend` with
  `npm test -- --runTestsByPath tests/unit/retrieval.service.test.ts tests/unit/private-file-storage.test.ts`.

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

**Not implemented yet:** B8 and later AI learning features (including grounded
question answering, summaries, flashcards, and quizzes) are not available to
test yet. They will be implemented in later phases.

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
