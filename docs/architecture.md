# narrator-ai-web Architecture

[中文](./architecture_CN.md)

## Layered architecture (SOC, single responsibility)

```
┌─────────────────────────────────────────┐
│  narrator-ai-web (Next.js, this repo)   │   ← presentation + BFF layer
│  ─ React UI                             │
│  ─ /api/* route handlers (BFF)          │
└─────────────────────────────────────────┘
              │  HTTP only
              ▼
┌─────────────────────────────────────────┐
│  Compatible backend service             │   ← pricing, wallet, orchestration
│  NarratorAI-compatible OpenAPI provider │   ← commentary generation, task pipeline
└─────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────┐
│  Managed Postgres                       │   ← data layer
│  (managed by the API layer, never web)  │
└─────────────────────────────────────────┘
```

## Invariants (enforced by lint + CI)

1. **No direct DB drivers in web.** Forbidden under `src/`:
   - **DB connectors:** `pg`, `pg-pool`, `pg-native`, `postgres`, `mysql`, `mysql2` (incl. `mysql2/promise`), `mongodb`, `mongoose`, `better-sqlite3`, `sqlite3`
   - **ORMs / migration tools:** `drizzle-orm` (incl. `drizzle-orm/*`), `drizzle-zod`, `drizzle-kit`, `prisma`, `@prisma/*`, `typeorm`, `sequelize`
   - **Query builders:** `knex`, `kysely` (incl. `kysely/*`)

   Enforced by `eslint.config.mjs`:
   - `no-restricted-imports` covers ESM `import` specifiers (incl. subpath patterns).
   - `no-restricted-syntax` covers CommonJS `require('pg')` and dynamic `import('mysql2')` forms.

   The web layer talks to services over HTTP only.
2. **Avoid direct database configuration in web deployments.** New deployments should keep database connections behind the API/pricing services. Legacy `MYSQL_*` settings may remain in `.env.example` for compatibility, but should stay unset unless you explicitly use that compatibility path.
3. **Server-only secrets stay server-only.** Anything prefixed `NEXT_PUBLIC_` is exposed to the browser bundle — only feature flags and public API URLs may use that prefix.

## Why this matters

Mixing layers (e.g. web reading prod DB) breaks:
- **Failure isolation** — DB outage takes down web, not just API
- **Schema coupling** — schema changes force coordinated cross-repo deploys
- **Auth / row-level security** — the API layer is where access control lives
- **Connection limits** — Next.js per-request handlers can exhaust DB pools

If you find yourself wanting a DB query in `src/`, **add it to the API service instead** and call it from web.

## Outbound dependencies (allowed)

| Service | Used for | Module |
|---|---|---|
| Upstream NarratorAI-compatible OpenAPI (`NARRATORAI_BASE_URL`) | Templates, tasks, narration core | `src/lib/narrator-client.ts` |
| Compatible backend service (`NARRATOR_PRICING_API_URL`) | Template price lookup, wallet, orchestration | `src/lib/hard-price-client.ts` |
| Upstream storage / integrations | App-specific integrations | various |
