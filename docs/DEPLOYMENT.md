# Deployment Guide

[中文](./DEPLOYMENT_CN.md)

This document covers running NarratorAI Web in three environments: local development, a self-built Docker image, and Fly.io (the project's reference deployment target). Other PaaS providers should work with minor adjustments.

## 1. Prerequisites

Regardless of target environment, you need:

- **Node.js 20 or 22** — verified against both in CI
- **pnpm 9+** — enforced by the `preinstall` script (`npx only-allow pnpm`)
- A **NarratorAI-compatible OpenAPI key** (`NARRATORAI_API_KEY`)
- A **pricing / orchestration backend** reachable at `NARRATOR_PRICING_API_URL` — this is required at first call; the lib clients throw `NARRATOR_PRICING_API_URL environment variable is required` if missing

All environment variables and their purpose are documented in [`.env.example`](../.env.example). Use that file as the source of truth.

---

## 2. Local development

```bash
git clone <your-fork-or-clone-url> narrator-ai-web
cd narrator-ai-web
pnpm install
cp .env.example .env.local
# edit .env.local — at minimum, set NARRATOR_PRICING_API_URL
pnpm dev
```

The dev server listens on `http://localhost:5000` (configurable via `PORT`).

### Useful local commands

```bash
pnpm test            # run the Vitest unit suite (~340 tests)
pnpm test:watch      # Vitest watch mode for iterating on a single file
pnpm ts-check        # tsc --noEmit project-wide
pnpm lint            # ESLint
pnpm build           # production build (writes to .next/)
pnpm start           # serve the production build
```

### Turbopack vs webpack

Next.js 16 defaults to Turbopack for `pnpm dev`. If Turbopack crashes on your machine (Windows has hit `STATUS_DLL_INIT_FAILED` on some hosts), force webpack:

```bash
NEXT_DEV_BUNDLER=webpack pnpm dev
```

This only affects `pnpm dev`; production builds always use webpack.

---

## 3. Docker

A `Dockerfile` is included for self-built images. Build and run locally:

```bash
docker build -t narrator-ai-web:local .

docker run --rm -p 5000:5000 \
  -e NARRATOR_PRICING_API_URL=https://your-backend.example.com \
  -e NARRATORAI_BASE_URL=https://api.example.com \
  -e NARRATORAI_API_KEY=<your-key> \
  -e PRICING_BFF_AUTH_TOKEN=<your-bff-token> \
  narrator-ai-web:local
```

`docker-compose.yml` is also included for a longer-lived local stack with health checks.

### What the image contains

- Multi-stage build: `node:20-alpine` for build, slim runtime for `pnpm start`
- Static assets served by Next.js (no separate CDN required for basic deploys)
- Default port: `5000`
- `HOSTNAME=0.0.0.0` (so it accepts connections from outside the container)

---

## 4. Fly.io

Fly.io is a supported deployment target. Two configuration files are included:

- `fly.toml` — production app config
- `fly-test.toml` — test/staging app config

You must **rename the `app` field** to your own Fly.io app names before deploying. The bundled app names are placeholders.

### First-time setup

```bash
# Install flyctl and authenticate
curl -L https://fly.io/install.sh | sh
fly auth login

# Edit fly.toml — change `app = "..."` to your app name
# Edit fly-test.toml similarly if you want a test env

# Create the apps on Fly
fly apps create <your-prod-app-name>
fly apps create <your-test-app-name>      # optional

# Set required secrets (these become env vars at runtime)
fly secrets set \
  NARRATOR_PRICING_API_URL=https://your-backend.example.com \
  NARRATORAI_BASE_URL=https://api.example.com \
  NARRATORAI_API_KEY=<your-key> \
  PRICING_BFF_AUTH_TOKEN=<your-bff-token> \
  -a <your-prod-app-name>
```

### Deploy

```bash
# Production
fly deploy -a <your-prod-app-name>

# Test environment (uses fly-test.toml)
fly deploy -c fly-test.toml -a <your-test-app-name>
```

### Health check & rollback

Fly.io rolling deploy strategy is configured in `fly.toml`:

```bash
fly status -a <your-app-name>          # see current machines + version
fly releases -a <your-app-name>        # release history
fly deploy -a <your-app-name> --image registry.fly.io/<your-app>:deployment-<id>   # roll back to a specific image
```

---

## 5. Environment variables — full reference

Authoritative source: [`.env.example`](../.env.example). Summary:

### Required

| Variable | Purpose |
|---|---|
| `NARRATOR_PRICING_API_URL` | Base URL of the pricing / orchestration backend. Lib clients throw at first call if unset. |
| `NARRATORAI_BASE_URL` | Base URL of your NarratorAI-compatible OpenAPI provider. Use your provider URL for production and a local URL for development. |
| `NARRATORAI_API_KEY` | Server-side NarratorAI OpenAPI key. |

### Recommended

| Variable | Purpose |
|---|---|
| `PRICING_BFF_AUTH_TOKEN` | Bearer token for backend endpoints that proxy upstream (consumes upstream quota). Must match the backend's `PRICING_BFF_AUTH_TOKEN`. Without it, several `/api/narrator/*` routes return 401 in prod. |
| `APP_ENV` | One of `DEV` / `UAT` / `PROD`. Controls dev-only logging and branding. |

### Feature flags

| Variable | Default | Purpose |
|---|---|---|
| `HARD_PRICE_ROLLOUT_PERCENT` | `0` | Server-side rollout percentage for hard-price v2. Read per request — change + restart, no rebuild. |
| `HARD_PRICE_KILL_SWITCH` | `false` | Force-disable hard-price v2 (override rollout percent). |
| `NEXT_PUBLIC_HARD_PRICE_ROLLOUT_PERCENT` | `0` | Client-side fallback (baked into JS bundle at build time). Prefer the server-side var above. |
| `NEXT_PUBLIC_HARD_PRICE_KILL_SWITCH` | `false` | Client-side fallback. |
| `NEXT_PUBLIC_BACKEND_ORCHESTRATOR_ON` | `"1"` | When `"1"`, frontend stops calling `triggerNextStep` for auto-advance tasks; backend orchestrator owns the state machine. Rollback = set to `"0"` + redeploy. |

### Optional — MySQL (master-task persistence)

Used by the sync orchestrator for persisting master-task state. Leave blank to disable.

| Variable | Default |
|---|---|
| `MYSQL_HOST` | (none) |
| `MYSQL_PORT` | `3306` |
| `MYSQL_USER` | (none) |
| `MYSQL_PASSWORD` | (none) |
| `MYSQL_DATABASE` | (none) |

### Optional — Runtime

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `5000` | HTTP port (used by `server.ts`). |
| `NEXT_DEV_BUNDLER` | unset | Set to `webpack` to opt out of Turbopack in dev. No effect on prod. |
| `NEXT_PUBLIC_BASE_URL` | (auto) | Frontend origin for absolute URL generation (share links, etc.). |
| `NEXT_PUBLIC_SSE_BASE_URL` | falls back to `NARRATORAI_BASE_URL` | SSE endpoint. |

---

## 6. CI / GitHub Actions

This repository can run GitHub Actions checks for pull requests and pushes.
If workflow files are present in your fork or deployment repository, configure
the following repository variables before enabling deployment or e2e jobs:

- `e2e.yml` — Playwright e2e against a deployed environment. Requires repo variables `NARRATOR_PRICING_API_URL` and `E2E_BASE_URL` to be set:

  ```bash
  gh variable set NARRATOR_PRICING_API_URL --body "<backend-url>"
  gh variable set E2E_BASE_URL --body "<frontend-url>"
  ```

- Typical CI checks for this project are lint, TypeScript checks, unit tests,
  production build, dependency audit, and optional Playwright e2e tests.

---

## 7. Troubleshooting

### `NARRATOR_PRICING_API_URL environment variable is required`

The lib clients in `src/lib/*-backend-client.ts` fail fast if the env var is not set. Make sure your `.env.local` (local dev) or fly secrets (deploy) has it set to a reachable backend URL.

### `401` from `/api/narrator/*` routes

Most likely `PRICING_BFF_AUTH_TOKEN` is missing or doesn't match the backend's expected value. Compare with the backend's `PRICING_BFF_AUTH_TOKEN` setting.

### Turbopack crash on Windows (`STATUS_DLL_INIT_FAILED`)

Set `NEXT_DEV_BUNDLER=webpack` and re-run `pnpm dev`.

### Tests fail with `getPricingApiUrl is not a function` style errors

Vitest runs `src/__tests__/setup.ts` which seeds a default `NARRATOR_PRICING_API_URL`. If you removed or renamed that file, re-add it or set the env var in your shell before running tests.
