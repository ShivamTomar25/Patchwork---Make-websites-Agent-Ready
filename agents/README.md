# PATCHWORK Agents

`agents/` is the multi-agent execution harness for running deterministic and model-assisted agents against ShopTwin, SaaSTwin and SupportTwin.

## Architecture

- `src/core`: shared schemas, budgets, loop detection, safety guards and manifest validation.
- `src/sites`: site registry and environment-based credential resolution.
- `src/contracts`: journey contract loading from existing replica YAML.
- `src/verifiers`: reset, state, defects and authoritative verifier clients.
- `src/browser`: Playwright sessions, observations and action execution.
- `src/providers`: OpenAI-compatible text/vision providers and deterministic mock providers.
- `src/agents`: scripted baseline, Accessibility A, Accessibility B, Screenshot and OpenAPI/tool agents.
- `src/runner`: single-run, smoke and matrix orchestration.
- `src/storage`: PostgreSQL trajectory records plus JSONL/CSV result exports.

## Agents

- Scripted baseline: deterministic Playwright workflows for every clean critical journey; no model API needed.
- Accessibility Agent A: semantic DOM/ARIA observation, no screenshots or raw HTML.
- Accessibility Agent B: same observation/action space as A with separate provider/model config.
- Screenshot Agent: screenshot-only observation, viewport-aware coordinate actions, saved screenshot artifacts.
- OpenAPI/tool Agent: documented OpenAPI operations only; rejects undocumented and unauthorized research-control calls.

## Environment

Copy `.env.example` values into your shell or local env manager. Do not commit `.env` files.

Required for local reset/login:

- `AGENTS_DATABASE_URL`
- `PATCHWORK_SHOP_ADMIN_EMAIL`, `PATCHWORK_SHOP_ADMIN_PASSWORD`
- `PATCHWORK_SHOP_USER_EMAIL`, `PATCHWORK_SHOP_USER_PASSWORD`
- `PATCHWORK_SAAS_ADMIN_EMAIL`, `PATCHWORK_SAAS_ADMIN_PASSWORD`
- `PATCHWORK_SAAS_USER_EMAIL`, `PATCHWORK_SAAS_USER_PASSWORD`
- `PATCHWORK_SAAS_MEMBER_EMAIL`, `PATCHWORK_SAAS_MEMBER_PASSWORD`
- `PATCHWORK_SUPPORT_ADMIN_EMAIL`, `PATCHWORK_SUPPORT_ADMIN_PASSWORD`
- `PATCHWORK_SUPPORT_USER_EMAIL`, `PATCHWORK_SUPPORT_USER_PASSWORD`
- `PATCHWORK_SUPPORT_AGENT_EMAIL`, `PATCHWORK_SUPPORT_AGENT_PASSWORD`

Required only for live model runs:

- Accessibility A: `TEXT_AGENT_A_BASE_URL`, `TEXT_AGENT_A_API_KEY`, `TEXT_AGENT_A_MODEL`
- Accessibility B: `TEXT_AGENT_B_BASE_URL`, `TEXT_AGENT_B_API_KEY`, `TEXT_AGENT_B_MODEL`
- Screenshot: `VISION_BASE_URL`, `VISION_API_KEY`, `VISION_MODEL`
- Tool agent: `TOOL_AGENT_BASE_URL`, `TOOL_AGENT_API_KEY`, `TOOL_AGENT_MODEL`

Temperatures default to `0`. Groq, OpenAI or another OpenAI-compatible provider can be used by changing base URL, API key and model. No provider or model name is hardcoded.

## Database

```sh
npm run db:create
npm run agents:db:migrate
```

This creates and migrates the separate `patchwork_agents` PostgreSQL database. Runs are also exported to `agents/results/raw/...jsonl`.

## Commands

Build and test:

```sh
npm run agents:build
npm run agents:test
```

Smoke all replicas with the scripted baseline:

```sh
npm run agents:smoke
```

Run one journey:

```sh
npm run agents:run -- --site shop --journey SHOP-J1 --agent accessibility-a --seed 1
npm run agents:run -- --site saas --journey SAAS-J1 --agent screenshot --seed 1
npm run agents:run -- --site support --journey SUPPORT-J1 --agent tool --seed 1
npm run agents:run -- --site shop --journey SHOP-J3 --agent scripted --seed 1 --defects SHOP-IDEMP-001=true
```

Run a mock matrix:

```sh
npm run agents:matrix -- --mode mock --seeds 1-3 --concurrency 1
npm run agents:matrix -- --mode mock --resume true --defects SHOP-IDEMP-001=true
```

Run a live matrix:

```sh
npm run agents:matrix -- --mode live --seeds 1-5 --agents accessibility-a,accessibility-b,tool
```

Live tests are opt-in. They are not claimed to pass unless valid provider keys are configured and the live command is actually run.

## Artifacts

- Raw trajectories: `agents/results/raw/<site>/<journey>/<agent>/<run-id>.jsonl`
- Screenshots: `agents/results/artifacts/<run-id>/`
- Summary CSVs: `agents/results/run-summary.csv`, `model-usage.csv`, `termination-summary.csv`

Stored records redact passwords, tokens, cookies, API keys and secret fields. Hidden chain-of-thought is never requested or stored; only action, short reason, usage, latency and validation errors are recorded.

## Adding A Provider

Implement `ModelProvider` or configure an OpenAI-compatible endpoint. Providers must return strict JSON and support temperature `0`, timeout, retries and token limits.

## Limitations

- Mock providers prove orchestration and storage, not real model performance.
- Patch generation, Bayesian search and failure-cone synthesis are intentionally not implemented yet.
- Final cross-agent studies require different provider/model pairs for Accessibility A and B; duplicate pairs are rejected outside pilot mode.
