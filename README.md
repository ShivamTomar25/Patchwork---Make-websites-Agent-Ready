# PATCHWORK

## Platform and deployment

The central research platform lives in `platform/web` and `platform/api`.
Start it locally with `npm run platform:dev` and open http://localhost:3200.
See [GitHub and Vercel + Render setup](docs/DEPLOYMENT.md) for publishing the
repository and deploying the platform. The root `vercel.json` and `render.yaml`
provide deployment configuration; set the Render proxy hostname before deploying.

PATCHWORK is a local-only research monorepo containing three deterministic website replicas for testing web agents against clean and intentionally defective interfaces.

| Replica | Frontend | API | Database | Purpose |
| --- | --- | --- | --- | --- |
| ShopTwin | http://localhost:3101 | http://localhost:4101 | `patchwork_shop` | Synthetic e-commerce checkout and order management |
| SaaSTwin | http://localhost:3102 | http://localhost:4102 | `patchwork_saas` | Synthetic SaaS onboarding and workspace management |
| SupportTwin | http://localhost:3103 | http://localhost:4103 | `patchwork_support` | Synthetic enterprise support ticket workflow |

## Requirements

- Node.js 22+
- PostgreSQL reachable locally
- npm workspaces

## Database Setup

Create the three databases:

```sh
npm run db:create
```

Apply migrations:

```sh
npm run db:migrate
```

Seed deterministic state:

```sh
npm run seed:all
```

Local database URLs default to `postgresql://$USER@localhost:5432/<database>`. Override with `SHOP_DATABASE_URL`, `SAAS_DATABASE_URL` and `SUPPORT_DATABASE_URL` when your local PostgreSQL uses different credentials.

## Commands

```sh
npm install
npm run db:create
npm run db:migrate
npm run seed:all
npm run dev:all
npm run build:all
npm run test
npm run test:e2e
npm run reset:all
```

`npm run dev:all` starts all six services and prints the frontend/API URLs.

## Seeded Synthetic Accounts

ShopTwin:

- `shopper@patchwork.local` / `Shopper123!`
- `admin@patchwork.local` / `Admin123!`

SaaSTwin:

- `owner@patchwork.local` / `Owner123!`
- `member@patchwork.local` / `Member123!`
- `admin@patchwork.local` / `Admin123!`

SupportTwin:

- `customer@patchwork.local` / `Customer123!`
- `agent@patchwork.local` / `Agent123!`
- `admin@patchwork.local` / `Admin123!`

These credentials are synthetic local fixtures only.

## Research Controls

Each frontend exposes `/research-control` to the seeded admin. The page can reset or reseed the database, toggle deterministic defect flags, inspect authoritative state, read recent audit events and run machine-readable journey verifiers.

All external effects are local mocks: payments, refunds, invitations, uploads, integrations and API keys never call real services.
