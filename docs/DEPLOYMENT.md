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

## Render: API and database

1. Create a Blueprint from the GitHub repository using the root `render.yaml`.
2. The Blueprint selects a **paid Starter web service and Basic PostgreSQL**.
   Review Render's displayed costs before creating resources.
3. Set `WEB_URL` to the exact Vercel production origin, for example
   `https://your-project.vercel.app`, without a trailing slash. Reserve the Vercel
   project name first, or update this value after Vercel assigns the URL.
4. Render generates the JWT and internal agent secrets and supplies `DATABASE_URL`.
   `PORT` and `RENDER_EXTERNAL_URL` are supplied by Render. Do not set `API_PORT`.
5. Migrations run before deployment; the start command runs the API using `tsx`.
   The install command includes development dependencies because Prisma,
   TypeScript and `tsx` are required by this setup.
6. Verify `https://YOUR-SERVICE.onrender.com/api/v1/health` returns `data.ok: true`.
   This endpoint checks the process; signup/login additionally verify the database.

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
