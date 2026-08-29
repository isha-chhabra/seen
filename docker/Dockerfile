# Elmo
# Supports: web app (Nitro server) and worker

# Base stage with Node.js
FROM node:24-alpine AS base
RUN corepack enable pnpm
RUN apk add --no-cache curl

# Dependencies stage
FROM base AS deps
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY apps/worker/package.json ./apps/worker/
COPY packages/ui/package.json ./packages/ui/
COPY packages/config/package.json ./packages/config/
COPY packages/lib/package.json ./packages/lib/
COPY packages/local/package.json ./packages/local/
COPY packages/whitelabel/package.json ./packages/whitelabel/
COPY packages/cloud/package.json ./packages/cloud/
COPY packages/deployment/package.json ./packages/deployment/
COPY packages/og/package.json ./packages/og/
COPY packages/api-spec/package.json ./packages/api-spec/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Builder stage
FROM base AS builder
WORKDIR /app

# Warm pnpm store + the fully-installed node_modules tree from the deps stage.
# This stage then never needs the network (the droplet's link to npmjs.org is flaky).
COPY --from=deps /root/.local/share/pnpm /root/.local/share/pnpm
COPY --from=deps /root/.cache/node /root/.cache/node
COPY --from=deps /app /app

# Copy source code. node_modules/.next/etc are excluded by .dockerignore,
# so the installed dependency tree copied above survives this.
COPY . .

# Keep pnpm from doing any network work in this offline stage:
#  - verifyDepsBeforeRun:false  -> no implicit `pnpm install` before run/deploy
#  - minimumReleaseAge:0        -> no supply-chain re-scan (deps stage already validated it)
RUN sed -i 's/^minimumReleaseAge:.*/minimumReleaseAge: 0/' pnpm-workspace.yaml \
 && printf '\nverifyDepsBeforeRun: false\n' >> pnpm-workspace.yaml

# Build arguments for VITE_ env vars (baked into client bundle)
ARG DEPLOYMENT_MODE=local
ARG VITE_DEPLOYMENT_MODE=${DEPLOYMENT_MODE}
ENV VITE_DEPLOYMENT_MODE=${VITE_DEPLOYMENT_MODE}

ENV NODE_OPTIONS=--max-old-space-size=2048
ENV npm_config_prefer_offline=true
ENV npm_config_offline=true
ENV npm_config_fetch_retries=6
ENV npm_config_fetch_timeout=600000

# Build the web application. Invoke vite directly rather than `pnpm --filter ... build`,
# because `pnpm run` triggers a deps-status precheck that reinstalls from the network.
RUN cd apps/web && node_modules/.bin/vite build && node ../../scripts/check-server-bundle.mjs .

# Create pruned standalone deployments (only each package's own deps)
# --legacy: allows deploy without inject-workspace-packages (which breaks Alpine Docker builds)
RUN pnpm --filter @workspace/worker deploy --legacy /deploy/worker
RUN pnpm --filter @workspace/lib deploy --legacy /deploy/lib

# Runner stage for web app (Nitro)
FROM base AS web
WORKDIR /app

ENV NODE_ENV=production

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 elmo

# Copy entrypoint script
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Copy Nitro output - this is the entire server bundle
COPY --from=builder --chown=elmo:nodejs /app/apps/web/.output ./.output

USER elmo

EXPOSE 3000
ENV PORT=3000
ENV HOST="0.0.0.0"

ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", ".output/server/index.mjs"]

# Migration stage — runs drizzle-kit migrate then exits
FROM base AS migrate
WORKDIR /app

COPY --from=builder /deploy/lib ./

CMD ["npx", "drizzle-kit", "migrate"]

# Worker stage
FROM base AS worker
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 worker

COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

COPY --from=builder --chown=worker:nodejs /deploy/worker ./

USER worker

ENTRYPOINT ["/entrypoint.sh"]
CMD ["npx", "tsx", "src/index.ts"]
