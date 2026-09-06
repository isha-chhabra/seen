# Seen

Self-hosted AI-visibility tracking, plus an affiliate-outreach article finder.

Seen tracks how AI answer engines (ChatGPT, Google AI Mode and AI Overviews,
Gemini, Perplexity, Copilot) mention, cite and describe a brand, and turns that
into visibility scores, citation analysis, competitor comparison and
stakeholder reports. On top of that it adds **Article Finder**, a pipeline for
finding editorial sites worth pitching for affiliate placements.

**Live demo:** https://165-227-198-85.sslip.io — sign in as `demo@seen-demo.app`
/ `SeenDemo-2026` (read-only viewer).

---

## Features

| Area | Summary |
| --- | --- |
| **Article Finder** | Free-text brief → topic-grounded query expansion → SERP retrieval → filtering (syndication, retailers, non-US) → per-page affiliate-signal scan → LLM vetting (editorial fit, authority tier, US focus, outreach verdict). Split into high-authority vs niche/blog, CSV export, last run persisted per brand. |
| **Reports** | Aspect-correct, lossless PDF export; narrative prompt tuned for short, number-led copy. |
| **Viewer role** | Read-only workspace role, enforced server-side and reflected across the UI. |
| **Team invites** | Self-serve, admin-only, selectable link expiry, no email round-trip. |
| **Design system** | Palette and shared components (page headers, stat cards, empty states, callouts). |
| **Self-hosting** | CI builds images to GHCR; the host only pulls and runs them. Cloud mode with billing disabled. Public HTTPS demo behind Caddy. |

## Architecture

```
apps/web      TanStack Start + Vite dashboard and REST API (port 3000)
apps/worker   pg-boss background jobs: prompt runs, citation tracking, reports
packages/lib  shared logic + Drizzle schema and migrations
packages/ui   shared component library
packages/*    deployment-mode config, env validation, OpenAPI spec, OG images
```

PostgreSQL stores both the application data and the job queue. One image serves
every deployment mode; `DEPLOYMENT_MODE` is read at runtime.

## Running it

Images are built by [`.github/workflows/build-images.yml`](.github/workflows/build-images.yml)
and pushed to GHCR. A host running the stack only pulls and runs them.

```bash
cp .env.example .env      # then fill in the values
docker compose pull
docker compose up -d
```

The `migrate` container applies Drizzle migrations on start; `web` comes up on
port 1515. Required env is documented in `.env.example`; `OPENAI_API_KEY` and
`BRIGHTDATA_API_TOKEN` are what Article Finder and the scrapers need.

To deploy an update: push to `main`, wait for the build-images workflow, then
`docker compose pull && docker compose up -d` on the host.

## Development

```bash
pnpm install
pnpm dev            # all dev servers
pnpm test           # Vitest unit tests
pnpm lint           # Biome
pnpm build
```

`.env` is read from both the repo root and `apps/web/.env`. See
[`AGENTS.md`](AGENTS.md) for conventions.

## License

MIT — see [`LICENSE.md`](LICENSE.md).
