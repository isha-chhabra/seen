# Architecture

A pnpm + Turborepo monorepo. **Two deployables** in `apps/`; everything else in
`packages/` is shared library code they both import.

```
apps/
  web/      dashboard + REST API   (TanStack Start / React / Vite)
  worker/   background jobs        (pg-boss consumer)
packages/
  lib/      the core: DB schema + migrations, AI/scraper providers, scheduling,
            onboarding inference, secret encryption, entitlements
  ui/       component library (@workspace/ui)
  config/   env-var validation + shared constants
  cloud/    the deployment wiring this project runs (auth, optional Stripe/email)
  og/       social-preview image rendering
  api-spec/ OpenAPI document
  deployment/, local/, whitelabel/   alternate deployment modes, unused here
```

One PostgreSQL database holds both the application data and the job queue.

## apps/web

| Folder | What lives there |
| --- | --- |
| `src/routes/` | File-based routes. `_authed/` is everything behind login, `api/` the REST API and webhooks, `auth/` sign-in/up. |
| `src/server/` | Server functions (`createServerFn`), one file per domain: `brands.ts`, `prompts.ts`, `article-finder.ts`, `brand-reports.ts`, `team.ts`, `citations.ts`, `visibility.ts`… This is the only web code that touches the database. |
| `src/lib/auth/` | Access checks every server write runs first (`requireBrandAccess`, `requireBrandWriteAccess` for the read-only viewer role). |
| `src/hooks/` | React Query hooks the UI calls; each wraps a server function. |
| `src/components/` | UI. `src/lib/` — browser + server helpers, grouped by area (`charts/`, `prompts/`, `citations/`…). |

## apps/worker

A `pg-boss` consumer. One file per job in `src/jobs/`:

| Job | Does |
| --- | --- |
| `process-prompt` | Run one tracked prompt against one AI engine; store the answer, mentions, and citations. |
| `analyze-brand` | Onboarding: infer a new brand's competitors, prompts, and topics. |
| `generate-report` | Build a brand's PDF report for a date range. |
| `schedule-maintenance` | Self-healing scheduler: enqueue prompt runs that are due. |

## How a request flows

**Dashboard action** — browser → route → `src/hooks/` query → `src/server/*.ts`
server function → access check → Drizzle → Postgres.

**Tracked-prompt run** — `schedule-maintenance` finds due prompts → enqueues
`process-prompt` → worker calls a provider in
`packages/lib/src/providers/registry/` (BrightData for scraped engines,
OpenAI / Anthropic / OpenRouter / Mistral for direct APIs) → parses mentions and
citations → writes `prompt_runs` + `citations`.

## Database

Drizzle schema and migrations live in `packages/lib/src/db/`. The `migrate`
container runs `drizzle-kit migrate` on start. Never run migrations by hand.

## Running it

Images are built in CI (`.github/workflows/build-images.yml`), pushed to GHCR,
and the host pulls and runs them with Docker Compose. See the [README](README.md).
