# AI Learning Assistant

The currently runnable application in this repository is the backend REST API.
It requires Node.js 22 or later.

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

## Production build

From the `backend` directory, configure the production environment and secrets,
then build and start the compiled server:

```powershell
npm run build
npm start
```

API endpoints and request formats are documented in
[`docs/api/API-Specification.md`](docs/api/API-Specification.md).
