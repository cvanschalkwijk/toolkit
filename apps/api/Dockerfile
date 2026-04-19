# toolkit-api — Bun + Hono + MCP HTTP/SSE server.
#
# Multi-stage build:
#   deps: install prod dependencies against the frozen lockfile
#   runner: copy only node_modules + source, run as non-root
#
# Image lives at ghcr.io/<owner>/toolkit/api.

# --- deps --------------------------------------------------------------------
FROM oven/bun:1.3.12-alpine AS deps
WORKDIR /app

# Copy manifests first so layer caching works: as long as package.json and
# bun.lock don't change, the (slow) install layer stays cached.
COPY package.json bun.lock* ./
COPY apps/api/package.json ./apps/api/

RUN bun install --frozen-lockfile --production

# --- runner ------------------------------------------------------------------
FROM oven/bun:1.3.12-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=3000

# wget for HEALTHCHECK; alpine's bun image is minimal.
RUN apk add --no-cache wget

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY tsconfig.json ./
COPY apps/api ./apps/api

# Non-root user — the oven/bun image ships `bun` (uid 1000) already.
USER bun

EXPOSE 3000

# Fail the container if /health doesn't answer 200 within the grace period.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${API_PORT:-3000}/health" > /dev/null || exit 1

CMD ["bun", "run", "apps/api/src/index.ts"]
