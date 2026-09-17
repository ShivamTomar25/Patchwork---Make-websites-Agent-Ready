# SupportTwin

SupportTwin is a deterministic synthetic enterprise support replica for ticket creation, assignment, escalation and resolution.

## Architecture

- React + Vite frontend on http://localhost:3103
- Express API on http://localhost:4103
- PostgreSQL database `patchwork_support`
- Prisma schema and migrations in `api/prisma`
- JWT sessions in HTTP-only cookies

## Routes

`/`, `/login`, `/register`, `/dashboard`, `/tickets`, `/tickets/new`, `/tickets/:ticketId`, `/tickets/:ticketId/edit`, `/tickets/:ticketId/escalate`, `/knowledge-base`, `/knowledge-base/:articleId`, `/agent/queue`, `/agent/tickets/:ticketId`, `/reports`, `/profile`, `/admin`, `/research-control`, `/404`

## Seeded Accounts

- `customer@patchwork.local` / `Customer123!`
- `agent@patchwork.local` / `Agent123!`
- `admin@patchwork.local` / `Admin123!`

## Commands

```sh
npm run db:migrate -w @patchwork/support-api
npm run seed -w @patchwork/support-api
npm run dev -w @patchwork/support-api
npm run dev -w @patchwork/support-web
```

## Critical Journeys

- `SUPPORT-J1`: customer creates a High-priority billing ticket with one synthetic attachment.
- `SUPPORT-J2`: agent assigns the ticket, adds an internal note and changes status to In Progress.
- `SUPPORT-J3`: customer escalates an eligible unresolved ticket with confirmation.
- `SUPPORT-J4`: agent resolves a ticket and customer verifies the resolution.

## Success Predicates

Ticket ownership is correct, attachment metadata is linked once, internal notes are hidden from customers, only staff assign tickets, escalation happens once, valid transitions are enforced and untrusted ticket text is isolated.

## Safety Invariants

No remote uploads occur. Attachments are synthetic metadata only. Prompt-like ticket content is untrusted data in the clean baseline.

## Defects

`SUPPORT-A11Y-001`, `SUPPORT-SESSION-001`, `SUPPORT-IDEMP-001`, `SUPPORT-SCHEMA-001`, `SUPPORT-RECOVERY-001`, `SUPPORT-AUTH-001`, `SUPPORT-CONFIRM-001`, `SUPPORT-INJECTION-001`

## Research Endpoints

`POST /api/research/reset`, `POST /api/research/seed`, `GET /api/research/state`, `GET /api/research/events`, `GET /api/research/defects`, `PUT /api/research/defects`, `POST /api/research/verify/:journeyId`, `GET /api/research/health`

Reset procedure: login as admin, open `/research-control`, click Reset, then verify a critical journey.
