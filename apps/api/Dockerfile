# toolkit-api: Bun + Hono + MCP API.

FROM oven/bun:1.3 AS deps
WORKDIR /app
COPY package.json bun.lock* ./
COPY apps/api/package.json ./apps/api/
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3 AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY tsconfig.json ./
COPY apps/api ./apps/api

EXPOSE 3000

CMD ["bun", "run", "apps/api/src/index.ts"]
