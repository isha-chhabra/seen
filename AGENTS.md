# AGENTS.md

## What this is

Seen is a self-hosted AI-visibility platform: it tracks how AI answer engines
(ChatGPT, Google AI Mode and AI Overviews, Gemini, Perplexity, Copilot) mention,
cite and describe brands, and adds an affiliate-outreach article finder. It is a
**pnpm + Turborepo monorepo** on **Node.js 24** (enforced via `engines`),
**TypeScript**, and **PostgreSQL**. See `NOTICE` for the fork's provenance.

- `apps/web` — product dashboard and REST API (TanStack Start + Vite, port 3000)
- `apps/worker` — pg-boss background jobs (prompt runs, citation tracking, reports)
- `packages/lib` — shared logic and the Drizzle schema/migrations
- `packages/ui` — shared component library
- `packages/deployment` — deployment-mode config (reads `DEPLOYMENT_MODE`, exposes per-mode features)
- `packages/config` — env validation and shared constants/types
- `packages/cloud` — cloud-mode deployment factory and auth hooks
- `packages/api-spec` — OpenAPI spec
- `packages/og` — Open Graph image rendering

## Commands

- `pnpm dev` — all dev servers (turbo)
- `pnpm test` — Vitest unit tests
- `pnpm build` — build all packages
- `pnpm format` — Biome format
- `pnpm lint` — Biome check (errors only; warnings are not gated)
- `pnpm lint:fix` — apply everything Biome can fix on its own
- Migrations: from `packages/lib`, `pnpm exec drizzle-kit migrate` (NEVER RUN THESE UNLESS EXPLICITLY INSTRUCTED BY THE USER)
- shadcn components: always install with the CLI (`pnpm dlx shadcn@latest add <component>`, from `packages/ui`) — never hand-create them

Don't run formatting, linting, type checks, or tests after every change — only to diagnose what you're working on, or when asked.

Before handing work back or opening a PR, run `pnpm lint` and get it passing; CI fails on it. `pnpm lint:fix` handles the rest. Never silence a lint error with `biome-ignore` — fix the code.

## Tests

- Add tests for the purpose and externally observable behavior of the code, not its implementation shape. Do not test that internal helpers, component structure, configuration objects, or incidental markup have a particular form unless that form is itself a supported contract.
- Prefer tests that exercise a user outcome, public API, business rule, failure mode, or regression. A refactor that preserves behavior should not require test changes.

## Package management and supply-chain security

- **Always use pnpm.** Never install or run dependencies with npm, yarn, or `npx` — that sidesteps the workspace's protections.
- This repo enforces [pnpm supply-chain security](https://pnpm.io/supply-chain-security) via `pnpm-workspace.yaml`: `minimumReleaseAge` (a multi-day cooldown on new releases), `trustPolicy: no-downgrade`, `blockExoticSubdeps`, and an `allowBuilds` allowlist for install scripts.
- **Never weaken or bypass these controls**: don't add `minimumReleaseAgeExclude` entries, don't flip packages to `true` in `allowBuilds`, don't suppress `pnpm audit` advisories, and don't remove `overrides` (many are scoped security patches or dedup anchors). If an install fails because of these controls, that is the system working — report it instead of working around it.

## Environment

`.env` must exist at **both** the repo root and `apps/web/.env` (Vite reads its project root; the worker reads `apps/web/.env` via `--env-file`). Minimum for local mode: `DATABASE_URL`, `DEPLOYMENT_MODE=local`, `VITE_DEPLOYMENT_MODE=local`, `BETTER_AUTH_SECRET`, `SEEN_ENCRYPTION_KEY` (`openssl rand -base64 32`), `APP_URL`/`VITE_APP_URL`, `DISABLE_TELEMETRY=1`. Env validation also requires `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DATAFORSEO_LOGIN`, and `DATAFORSEO_PASSWORD` — placeholder values work for UI-only work. For a Docker Compose deployment see `.env.example`.

## Git workflow

- Work happens in PRs against `main`.
- Commit as you go: small, atomic commits that show real progress. Don't rewrite history (amend, rebase, force-push) to make it look tidy afterward.
- Commit subjects are plain imperative sentences — no conventional-commit prefixes. Write `paginate top cited domains`, not `feat(web): paginate top cited domains`.

## Comments and docs

- Comment only to explain **why** or to add context the code can't show. Never restate what the code already says.
- The same applies to docs and this file: never write down what's already derivable from the repo (what a file imports, what a script runs, how code is structured).
- Don't describe prior behavior ("previously this did X") and don't reference GitHub issues or tickets in code — that context belongs in the commit message or PR.
