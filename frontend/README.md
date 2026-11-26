# AI Learning Assistant Frontend

React + TypeScript frontend for the existing REST API. The client calls the
backend only; AI provider credentials and data stores remain server-side.

## Requirements

- Node.js 22 or later
- The backend running locally on `http://localhost:3000` for API-backed use

## Setup

```powershell
cd frontend
npm ci
Copy-Item .env.example .env
npm run dev
```

The Vite development server proxies `/api/*` to `http://localhost:3000`.
`VITE_API_BASE_URL` defaults to `/api/v1`; set it to an absolute API base URL
when the backend is hosted elsewhere.
`VITE_MAX_UPLOAD_SIZE_MB` defaults to the backend's 10 MB upload limit. Set it
to the same value as the backend's `MAX_UPLOAD_SIZE_MB` when that limit is
overridden. The backend remains authoritative for upload and expanded DOCX size
checks.

The backend's default CORS configuration allows both
`http://localhost:5173` and `http://127.0.0.1:5173`. For a separate production
origin, configure the backend's `CORS_ORIGINS`, or serve the frontend and
backend behind one origin.

## Scripts

| Script                 | Purpose                                    |
| ---------------------- | ------------------------------------------ |
| `npm run dev`          | Start the Vite development server          |
| `npm run build`        | Type-check and create the production build |
| `npm run typecheck`    | Run TypeScript without emitting files      |
| `npm run lint`         | Run ESLint                                 |
| `npm run format`       | Format supported files with Prettier       |
| `npm run format:check` | Check formatting                           |
| `npm test`             | Run unit and component tests with Vitest   |
| `npm run e2e`          | Run Playwright browser tests               |

The F1 Playwright test checks the unauthenticated app shell against the real
backend, which must be running locally. Install its browser once with
`npx playwright install chromium`. The main workflow is planned for F7.

## Current frontend phase

F1 authentication and the app shell are in place. F2 adds the dashboard,
paginated course list, coach-owned course create/edit/archive/reactivate flows,
and privacy-thresholded coach insights with gap-report job polling. F3 adds
course-scoped document listing, upload, ingestion status polling, failure
diagnostics/retry, and asynchronous deletion. The dashboard shows document
statuses for accessible courses; open the course library for live polling and
document actions. F4 adds grounded chat, citations, feedback, and paginated
conversation history with client-side search, rename, delete, and reopen
actions. The backend returns a complete answer rather than partial tokens, so
the chat UI does not simulate streaming. Recent activity remains unavailable
from the API. Admin course status controls are withheld because the API does
not provide administrators the course version needed by its update endpoint.
Admins have a role-specific dashboard with quick links to administration tasks;
their course catalog is read-only. The `/admin` workspace includes
permission-gated user and coach-request management, job retry/status, audit and
AI execution metadata, and insight configuration. User erasure is queued as a
job; the UI does not expose job payloads, learner content, or secret
configuration.
Coaches have a separate dashboard focused on owned courses, course materials,
enrolment requests, and privacy-thresholded course insights. Its overview
surfaces pending learner requests with direct links to the relevant course,
alongside activity totals for courses that meet the cohort threshold.

Course owners with `course:edit` can create and reorder lessons from a course's
detail page. Each lesson needs a topic and introduction, and may reference one
ready course PDF and one uploaded MP4 video (up to 100 MiB). Videos stay in the
course library, are not ingested as AI study sources, and cannot be deleted
while attached to a lesson. Learners with approved course access see an ordered
course outline and can play uploaded videos with native controls. Previously
saved YouTube or Vimeo links remain playable until a coach replaces or removes
them; new external links are not accepted. Published course quizzes appear in a
course-wide section below the lesson list, where learners can take them without
opening the separate study-tools workspace.

The learner study workspace is available from a course at
`/courses/:courseId/study`. Learners select up to ten ready course documents or
their own notes, then generate summaries, reveal flashcard answers, or take
generated and published quizzes. The workspace links to the document library to
upload personal PDF, DOCX, or TXT notes; those notes are private to the learner
and become selectable after processing. Uploading requires the `document:upload`
permission. Quiz answer keys and explanations are shown only after submission.
Course owners with quiz-management permission can choose AI generation from ready
course documents or create a manual quiz draft from the course details page.
Manual drafts do not require documents or AI; coaches can add, edit, reorder, and
remove single-choice, multiple-choice, and true/false questions, preview, save,
and publish. Learners can select multiple answers where appropriate. Document
processing status remains on the learner dashboard; coaches manage materials
from each course's document library. The current course reports do not provide
a ranked list of all queried topics.

## Authentication foundation

The access token is held in memory only. Refresh uses the backend's HttpOnly
cookie with `credentials: include`; a protected request retries once after a
401 and clears the local session if refresh fails. Registration, login, logout,
current-user loading, and password change use the actual backend routes and
response shapes. The backend remains authoritative for password policy and
permissions.

## Docker

Build a separate static frontend image with:

```powershell
docker build -t ai-learning-assistant-frontend .
```

The Nginx configuration serves the SPA and proxies `/api/v1`, `/health`,
`/ready`, and `/openapi.json` to a backend container named `backend` on the
same Docker network. The existing root Dockerfile and backend data volume are
unchanged. For deployments with a different service name or topology, update
the Nginx upstream or set `VITE_API_BASE_URL` at build time.
