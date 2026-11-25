# Backend Release Handover

## Deployment target

The backend runs in a Node.js 22 container and connects to PostgreSQL and
MongoDB Atlas. Multiple backend instances can use the same databases, but
multi-instance operation still needs deployment-level validation. Rate limits
and effective admin insight settings are process-local. The container's
`/app/backend/data` volume is for legacy migration inputs and backups, not
shared runtime persistence.

Configure every instance with the same `DATABASE_URL`, `MONGODB_URI`,
`MONGODB_DB_NAME`, `JWT_ACCESS_SECRET`, and `JWT_REFRESH_SECRET`. Keep provider
keys in each deployment's secret manager.

## Build and run

From the repository root:

```powershell
docker compose build
docker compose up -d
docker compose logs -f backend
```

The container expects `backend/.env` to contain the shared database targets,
JWT secrets, and provider keys needed by the deployment.

For a new, empty database only, seed the initial system once:

```powershell
Set-Location backend
npm ci
npm run bootstrap
```

The API health endpoint is `/health`. Readiness is `/ready`. Swagger UI is
served at `/api/docs`, with the published contract at `/openapi.json`.

## Data migration and backup

Choose one device as the source for legacy data. Stop all backend instances,
then run the JSON-to-Neon and JSON-to-Mongo dry runs and imports from that
device only:

```powershell
Set-Location backend
npm run migrate:json-to-neon -- --dry-run
npm run migrate:json-to-mongo -- --dry-run
npm run migrate:json-to-neon
npm run migrate:json-to-mongo
```

The migration scripts keep source data and create local backups. The generic
`npm run backup` and `npm run restore` scripts snapshot/restore only legacy
`json`, `sqlite`, and `uploads` directories; they do **not** back up or restore
PostgreSQL or MongoDB. Use Neon and Atlas backup/restore facilities for shared
runtime data.

Create a legacy-source snapshot if needed:

```powershell
Set-Location backend
npm run backup
```

The command prints the snapshot directory under `data/backups/<timestamp>`.

Restore an explicit snapshot:

```powershell
npm run restore -- "C:\absolute\path\to\snapshot" --yes
```

Restore replaces only legacy `json`, `sqlite`, and `uploads` under `DATA_DIR`.
It does not restore the shared databases or erase `.env`. Backups contain
learner content and credential-derived data; encrypt them and restrict access.

## Operations

- Do not run imports independently from multiple devices into the same shared
  database. Use one authoritative source.
- Keep each instance's `DATA_DIR` local; do not share it between instances.
- Apply admin insight-setting changes on every running instance.
- Rate limits are per instance, not aggregated across backends.
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

- Multi-instance database usage is wired but not yet validated under deployment
  load; test concurrent job workers and database connection limits.
- Rate limits and effective admin insight settings are process-local.
- Inception API support is scheduled to end December 28, 2026; test a replacement
  provider before that date.
- The offline AI evaluation suite verifies deterministic citation and grounding
  behavior only. Semantic faithfulness requires a separately approved live
  evaluation dataset.
- Re-test `/health` and `/ready` on the target deployment host before release.
