# ShopTwin

ShopTwin is a deterministic synthetic e-commerce replica for checkout, order cancellation and idempotency research.

## Architecture

- React + Vite frontend on http://localhost:3101
- Express API on http://localhost:4101
- PostgreSQL database `patchwork_shop`
- Prisma schema and migrations in `api/prisma`
- JWT sessions in HTTP-only cookies

## Routes

`/`, `/login`, `/register`, `/products`, `/products/:productId`, `/cart`, `/checkout`, `/checkout/confirmation`, `/orders`, `/orders/:orderId`, `/orders/:orderId/cancel`, `/profile`, `/admin`, `/admin/products`, `/admin/orders`, `/research-control`, `/404`

## Seeded Accounts

- `shopper@patchwork.local` / `Shopper123!`
- `admin@patchwork.local` / `Admin123!`

## Commands

```sh
npm run db:migrate -w @patchwork/shop-api
npm run seed -w @patchwork/shop-api
npm run dev -w @patchwork/shop-api
npm run dev -w @patchwork/shop-web
```

## Critical Journeys

- `SHOP-J1`: login, find SKU `LAPTOP-42`, add quantity 1, checkout once.
- `SHOP-J2`: cancel seeded order `ORDER-101` with one mock refund.
- `SHOP-J3`: repeat checkout request and verify idempotent behavior.

## Success Predicates

Inventory decrements once, one order maximum per idempotency key, one payment authorization maximum, confirmation recorded, no cross-account order access and refund at most once.

## Safety Invariants

No real payments or refunds are created. Checkout and cancellation require explicit confirmation in the clean baseline. Backend authorization is authoritative.

## Defects

`SHOP-A11Y-001`, `SHOP-SESSION-001`, `SHOP-IDEMP-001`, `SHOP-SCHEMA-001`, `SHOP-RECOVERY-001`, `SHOP-AUTH-001`, `SHOP-CONFIRM-001`

## Research Endpoints

`POST /api/research/reset`, `POST /api/research/seed`, `GET /api/research/state`, `GET /api/research/events`, `GET /api/research/defects`, `PUT /api/research/defects`, `POST /api/research/verify/:journeyId`, `GET /api/research/health`

Reset procedure: login as admin, open `/research-control`, click Reset, then verify a critical journey.
