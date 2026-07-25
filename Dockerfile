FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/package.json
COPY packages/domain/package.json ./packages/domain/package.json
RUN corepack enable && pnpm install --frozen-lockfile --prod --shamefully-hoist --ignore-scripts

FROM oven/bun:1-alpine AS runner
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY apps/api/src ./src
COPY apps/api/drizzle ./drizzle
# @ado/domain is a workspace dependency; node_modules/@ado/domain symlinks here and
# Bun resolves its raw .ts at runtime, so the package source must be present.
COPY packages/domain/package.json ./packages/domain/package.json
COPY packages/domain/src ./packages/domain/src

ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["bun", "src/index.ts"]
