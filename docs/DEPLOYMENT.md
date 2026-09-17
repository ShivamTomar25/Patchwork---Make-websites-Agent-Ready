# GitHub, Vercel and Render

This configuration deploys the central PATCHWORK platform: `platform/web` on
Vercel, `platform/api` on Render, and PostgreSQL on Render. The replica sites,
browser agents and real local pilot runner need a separate, allowlisted research
environment; they are not provisioned by this Blueprint. Mock platform workflows
can run without those services. Local research results are excluded from Git.

## Push to GitHub

The repository uses Node.js 22 and npm workspaces. Commit the root
`package-lock.json`; install dependencies from the repository root.

Create an empty GitHub repository, then run from this directory:

```sh
git status --short
git add .
git diff --cached --stat
git commit -m "Prepare PATCHWORK for GitHub and deployment"
git remote add origin https://github.com/YOUR-USERNAME/YOUR-REPOSITORY.git
git push -u origin main
```

`.gitignore` excludes environment secrets, private keys, dependencies, generated
Prisma clients, builds, local research output and browser test artifacts.
Placeholder `.env.example` and `.env.*.example` files remain versioned.
Generated graphs/results can be recreated using the research commands.

## Render: manual free API and database

Create the resources manually; a Blueprint is not required. The root
`render.yaml` is an optional equivalent and also selects free plans.

### 1. Create PostgreSQL

Choose **New → Postgres**, name it `patchwork-db`, set the database name to
`patchwork_platform`, and choose **Free**. Copy the **Internal Database URL**
from its connection details. Keep this private. Use the same region for the API.

### 2. Create the web service

Choose **New → Web Service**, connect
`ShivamTomar25/Patchwork---Make-websites-Agent-Ready`, and enter:

| Setting | Value |
| --- | --- |
| Name | `patchwork-api` |
| Branch | `main` |
| Runtime | Node |
| Region | Same as PostgreSQL |
| Root Directory | Leave blank (repository root) |
| Instance Type | Free |
| Build Command | `npm ci --include=dev && npm run build -w @patchwork/platform-api` |
| Start Command | `npm run start:render -w @patchwork/platform-api` |
| Health Check Path | `/api/v1/health` |

Leave Pre-Deploy Command unset: it is a paid feature. `start:render` applies
pending Prisma migrations before starting the API, and aborts startup if a
migration fails. Already-applied migrations are not repeated. Startup also checks
for migrations when the free service wakes up. Keep future schema changes
compatible with the previous application version during deployment.

### 3. Set environment variables before deploying

| Variable | Value |
| --- | --- |
| `NODE_VERSION` | `22` |
| `NODE_ENV` | `production` |
| `APP_ENV` | `production` |
| `DATABASE_URL` | Internal Database URL from step 1 |
| `WEB_URL` | Actual Vercel production origin, e.g. `https://your-project.vercel.app`, without a trailing slash |
| `JWT_SECRET_KEY` | A random secret of at least 32 characters |
| `PATCHWORK_INTERNAL_AGENT_TOKEN` | A second, independent random secret |

Generate each secret separately on your own machine with:

```sh
openssl rand -hex 32
```

Paste the values only into Render's environment settings. Render supplies `PORT`
and `RENDER_EXTERNAL_URL`; do not set `API_PORT`. The build deliberately installs
development dependencies because Prisma, TypeScript and `tsx` are needed.

### 4. Deploy and connect Vercel

Create the web service and wait for it to become live. Open
`https://YOUR-SERVICE.onrender.com/api/v1/health` and check for `data.ok: true`.
This checks the process; signup/login additionally verify database access.
Then follow the Vercel proxy steps below.

Free services spin down after 15 minutes of inactivity, so waking them can make
the first request slow. Free PostgreSQL has 1 GB storage, no backups, and expires
30 days after creation; arrange a data export/migration or upgrade before expiry.
Only one free PostgreSQL database is allowed per workspace. See
[Render's free-plan limits](https://render.com/docs/free) and
[deployment commands](https://render.com/docs/deploys).

Do not run `platform:setup` or `platform:seed` against the hosted database: the
local seed creates publicly documented demo credentials. Create your hosted
account through signup instead. Email delivery and integrations are still local
mock implementations; this setup does not turn them into live integrations.

## Vercel: frontend

1. Replace `REPLACE-WITH-YOUR-RENDER-SERVICE` in the root `vercel.json` with the
   actual Render service hostname, then commit and push that change.
2. Import the same repository in Vercel. Keep **Root Directory at the repository
   root**, select Node.js 22, and use the checked-in build/install/output settings.
3. Leave `VITE_API_BASE_URL` unset, or set it to `/api/v1`. Never put credentials in
   a `VITE_*` variable; these values are included in the browser bundle.
4. Deploy and ensure Render's `WEB_URL` matches the final production origin.
5. Verify `/api/v1/health` through the Vercel URL, then signup, refresh the page,
   logout, and load a nested application URL directly.

The `/api/*` rewrite proxies to Render. This keeps authentication cookies on the
frontend origin with `HttpOnly`, `Secure` and `SameSite=Lax`, avoiding cross-site
cookie dependence. The remaining rewrite serves the React SPA for deep links.
API responses are marked private/no-store at the Vercel edge. Use a separate API
and database for preview environments if you need isolated preview data.

## Local validation

```sh
npm ci
npm run platform:build
npm run platform:test
```

API tests need local PostgreSQL with the platform migrations applied. Local
development uses `npm run platform:dev`; its default API URL remains localhost.

References: [Vercel Vite setup](https://vercel.com/docs/frameworks/frontend/vite),
[Vercel rewrites](https://vercel.com/docs/routing/rewrites), and
[Render Blueprint specification](https://render.com/docs/blueprint-spec).
