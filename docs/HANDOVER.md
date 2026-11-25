# Backend Release Handover

## Deployment target

The release target is a **single Node.js 22 container** with one persistent
volume mounted at `/app/backend/data`, plus Neon PostgreSQL and a MongoDB
replica set or sharded deployment. Keep one backend instance for now because
the current repository interface maintains process-local read indexes and the
job runner/scheduler are in-process.

AWS or Azure container deployment is acceptable only if the volume remains
private, persistent, and attached to one backend instance.

## Build and run

From the repository root:

```powershell
docker compose build
docker compose up -d
docker compose logs -f backend
```

The container expects `backend/.env` to contain `DATABASE_URL`,
`MONGODB_URI`, `MONGODB_DATABASE`, distinct JWT secrets, and provider keys.
It also requires `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD`.

Before first start, apply the schema migration, import any existing JSON/SQLite
records, and seed the initial system:

```powershell
Set-Location backend
npm ci
npm run db:migrate
npm run db:import-legacy
npm run bootstrap
```

The checked-in migration upgrades an existing Neon schema from version 5 to
version 6; provisioning a new Neon database still requires the earlier schema.
The import is idempotent and preserves the source files. Skip it only when no
legacy files need importing.

The API health endpoint is `/health`. Readiness is `/ready`. Swagger UI is
served at `/api/docs`, with the published contract at `/openapi.json`.

## Data and backup

The persistent volume contains private uploads, generated chunk files, legacy
JSON/SQLite data (until it is retired), and local file snapshots. Neon stores
structured application records; MongoDB stores conversations and messages.

Create a snapshot:

```powershell
Set-Location backend
npm run backup
```

The command prints the snapshot directory under `data/backups/<timestamp>`.
It snapshots local files only; it does not back up Neon or MongoDB. Use the
providers' backup/restore tools for those databases.

Restore an explicit snapshot:

```powershell
npm run restore -- "C:\absolute\path\to\snapshot" --yes
```

Restore replaces only directories present in the selected snapshot under
`DATA_DIR`. It does not erase the configured `.env` or unrelated files.
Backups contain learner
content and credentials-derived data; they must be encrypted and access
controlled by the deployment platform.

## Operations

- Run exactly one backend instance until process-local index invalidation and
  distributed job ownership are implemented.
- Mount persistent storage before bootstrap or the first start.
- Do not copy or share `data/` across instances.
- Do not enable LangSmith/LangChain tracing in production.
- Prune or retain backups according to the privacy notice. Erased users remain
  represented in older backups until those snapshots expire.
- Monitor `/ready`, job dead-letter state, disk space, failed ingestion,
  provider quotas, audit growth and backup completion.

## Security and privacy

- Keep `.env` outside source control and never commit secrets.
- Admin APIs expose metadata only, never conversation text, document text,
  chunk text or credentials.
- Feedback comments and conversation text remain private to the learner.
- Personal notes are owner-only.
- Erasure is a persistent job; verify the job reaches `done` after submission.
- Backups can retain erased user data until expiration. Document this in the
  privacy notice.

## Known limitations

- Neon and MongoDB are runtime stores. JSON collections and SQLite remain
  supported only as one-time migration sources and in isolated tests.
- Inception API support is scheduled to end December 28, 2026; test a replacement
  provider before that date.
- The offline AI evaluation suite verifies deterministic citation and grounding
  behavior only. Semantic faithfulness requires a separately approved live
  evaluation dataset.
- Docker image builds are verified, but this Windows Docker Desktop host showed
  a native `better-sqlite3` crash during container startup. Re-test
  `/health` and `/ready` on the deployment Linux host before release.
