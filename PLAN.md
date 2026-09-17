# PATCHWORK Plan

1. Establish the npm workspace, shared TypeScript configuration and safety defaults.
2. Implement shared replica contracts, validation, seeded identities, defect definitions and verification helpers.
3. Implement three Express/Prisma APIs with deterministic seed/reset, audit logging, auth, research endpoints and domain routes.
4. Implement three React/Vite frontends with protected navigation, critical journeys and research control pages.
5. Add Prisma schemas, migrations, research artifacts, documentation and automated tests.
6. Run install, generation, migrations where a local PostgreSQL server is available, then type checks, builds and tests.

Baseline assumptions:

- Local PostgreSQL is reachable from the configured `DATABASE_URL` values.
- All external effects are local mocks.
- No production credentials are used or committed.

## Agent Harness Plan

1. Add `@patchwork/agents` as a separate npm workspace under `agents/`.
2. Reuse existing replica URLs, contracts and research endpoints through site registry and contract loader services.
3. Implement shared run schemas, safety checks, budget/loop controls, model provider adapters and trajectory recording.
4. Implement scripted Playwright, accessibility-text, screenshot-vision and OpenAPI/tool-native agents behind one `ResearchAgent` interface.
5. Add Prisma storage for `patchwork_agents`, JSONL/CSV exporters, CLI run/matrix/smoke commands and offline mock tests.
6. Verify with Prisma migration, TypeScript build, Vitest tests and smoke/matrix commands against local replicas.

## Central Platform Plan

1. Add `platform/api` and `platform/web` as npm workspaces with root scripts and a separate `patchwork_platform` database.
2. Implement a Prisma/Express API with secure cookie auth, organization isolation, CRUD routes and a mock experiment engine.
3. Implement a dark React/Vite platform with public, auth and app layouts, shared UI components and route-level screens.
4. Add seed data, migrations, unit/API tests, Playwright coverage, production builds and leave platform servers running.
