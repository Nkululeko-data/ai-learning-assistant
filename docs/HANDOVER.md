# Backend Release Handover

## Deployment target

The approved release target is a **single Node.js 22 container** with one
persistent volume mounted at `/app/backend/data`. This target is intentional:
the JSON store is a single-writer implementation and must not be horizontally
scaled or shared by multiple backend processes.

AWS or Azure container deployment is acceptable only if the volume remains
private, persistent, and attached to one backend instance.

## Build and run

From the repository root:

```powershell
docker compose build
docker compose up -d
docker compose logs -f backend
```

The container expects `backend/.env` to contain distinct JWT secrets and all
provider keys needed by the deployment. It also requires
`BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD`.

Before first start, seed the initial system:

```powershell
Set-Location backend
npm ci
npm run bootstrap
```

The API health endpoint is `/health`. Readiness is `/ready`. Swagger UI is
served at `/api/docs`, with the published contract at `/openapi.json`.

## Data and backup

The persistent volume contains JSON collections, SQLite conversations, private
uploads and backups. Stop writers before restoring an offline snapshot.

Create a snapshot:

```powershell
Set-Location backend
npm run backup
```

The command prints the snapshot directory under `data/backups/<timestamp>`.

Restore an explicit snapshot:

```powershell
npm run restore -- "C:\absolute\path\to\snapshot" --yes
```

Restore replaces only `json`, `sqlite`, and `uploads` under `DATA_DIR`. It does
not erase the configured `.env` or unrelated files. Backups contain learner
content and credentials-derived data; they must be encrypted and access
controlled by the deployment platform.

## Operations

- Run exactly one backend instance against each data directory.
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

- JSON storage is one-process, single-writer storage.
- No horizontal scaling is supported until storage is migrated.
- Inception API support is scheduled to end December 28, 2026; test a replacement
  provider before that date.
- The offline AI evaluation suite verifies deterministic citation and grounding
  behavior only. Semantic faithfulness requires a separately approved live
  evaluation dataset.
- Docker image builds are verified, but this Windows Docker Desktop host showed
  a native `better-sqlite3` crash during container startup. Re-test
  `/health` and `/ready` on the deployment Linux host before release.
