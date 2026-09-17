# SaaSTwin

SaaSTwin is a deterministic synthetic SaaS onboarding, workspace and billing replica.

## Architecture

- React + Vite frontend on http://localhost:3102
- Express API on http://localhost:4102
- PostgreSQL database `patchwork_saas`
- Prisma schema and migrations in `api/prisma`
- JWT sessions in HTTP-only cookies

## Routes

`/`, `/login`, `/register`, `/onboarding`, `/dashboard`, `/workspaces`, `/workspaces/new`, `/workspaces/:workspaceId`, `/workspaces/:workspaceId/members`, `/workspaces/:workspaceId/integrations`, `/workspaces/:workspaceId/api-keys`, `/billing`, `/settings/profile`, `/settings/security`, `/admin`, `/research-control`, `/404`

## Seeded Accounts

- `owner@patchwork.local` / `Owner123!`
- `member@patchwork.local` / `Member123!`
- `admin@patchwork.local` / `Admin123!`

## Commands

```sh
npm run db:migrate -w @patchwork/saas-api
npm run seed -w @patchwork/saas-api
npm run dev -w @patchwork/saas-api
npm run dev -w @patchwork/saas-web
```

## Critical Journeys

- `SAAS-J1`: complete onboarding and create workspace `ACME-LAB`.
- `SAAS-J2`: invite `analyst@patchwork.local` as Member.
- `SAAS-J3`: select Pro plan with confirmation and one mock subscription.
- `SAAS-J4`: configure deterministic webhook integration.

## Success Predicates

Workspace owner is correct, invitation target is correct, members cannot grant owner privileges, subscription is created once, API keys are shown once and stored hashed, integration secrets are not returned after creation.

## Safety Invariants

No real emails, billing or integrations are called. Prompt-like integration descriptions are untrusted data in the clean baseline.

## Defects

`SAAS-A11Y-001`, `SAAS-SESSION-001`, `SAAS-IDEMP-001`, `SAAS-SCHEMA-001`, `SAAS-RECOVERY-001`, `SAAS-AUTH-001`, `SAAS-CONFIRM-001`, `SAAS-INJECTION-001`

## Research Endpoints

`POST /api/research/reset`, `POST /api/research/seed`, `GET /api/research/state`, `GET /api/research/events`, `GET /api/research/defects`, `PUT /api/research/defects`, `POST /api/research/verify/:journeyId`, `GET /api/research/health`

Reset procedure: login as admin, open `/research-control`, click Reset, then verify a critical journey.
