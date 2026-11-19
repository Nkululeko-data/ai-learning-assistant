# Postman collection

Import [AI-Learning-Assistant.postman_collection.json](./AI-Learning-Assistant.postman_collection.json)
into Postman.

## Setup

1. Start the backend at `http://localhost:3000`.
2. In the collection variables, confirm `baseUrl` is
   `http://localhost:3000`.
3. Set real IDs after creating the corresponding resources:
   `courseId`, `documentId`, `conversationId`, `messageId`, `summaryId`,
   `flashcardId`, `quizId`, `jobId`, `userId`, `enrolmentId`, and `requestId`.

## Authentication

Run **Auth > Register** or **Auth > Authenticate and issue tokens**.
The login test script stores `accessToken` in collection variables
automatically.

When `ALLOW_REFRESH_TOKEN_IN_BODY=true`, refresh responses can also populate
`refreshToken`. The default configuration disables refresh tokens in request
bodies and uses the secure refresh cookie instead. Postman must enable the
cookie jar and use the same origin for login, refresh, and logout.

The collection sends the access token as a bearer token for protected
requests. Register, login, refresh, and logout use no bearer auth.

## Test order

1. Register or log in.
2. Create a course as an active coach account.
3. Upload a PDF, DOCX, or TXT file and wait for ingestion to become `ready`.
4. Ask a grounded question or generate a summary, flashcards, or a quiz.
5. Submit feedback and test owned conversations.
6. Test coach publication and learner attempt routes with separate accounts.
7. Test admin, job, audit, insight, and erasure routes only with authorized
   accounts.

The collection contains one representative JSON body for mutation endpoints.
Replace placeholder IDs and values with IDs returned by earlier requests.

## Multipart upload

Open **Documents > Upload a document and enqueue ingestion**, select a local
file in the `file` form field, set `courseId`, and choose `scope`:

- `course` for an owning coach
- `personal` for an approved learner
