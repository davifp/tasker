# Multi-arch worker image. Same base and build strategy as api.Dockerfile —
# buildx picks the right `node:24-alpine` variant per --platform.
FROM --platform=$BUILDPLATFORM node:24-alpine AS builder
ARG TARGETPLATFORM
ARG BUILDPLATFORM
RUN echo "Building worker for ${TARGETPLATFORM:-unknown} on ${BUILDPLATFORM:-unknown}"

RUN npm install -g pnpm@10.15.0

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY packages/config/package.json ./packages/config/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY backend/package.json ./backend/

RUN pnpm install --frozen-lockfile

COPY packages/tsconfig/ ./packages/tsconfig/
COPY packages/config/ ./packages/config/
COPY backend/ ./backend/

RUN pnpm --filter api build

# ---- runtime ---------------------------------------------------------------
FROM node:24-alpine AS runtime

RUN addgroup -S tasker && adduser -S tasker -G tasker

RUN npm install -g pnpm@10.15.0

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY packages/config/package.json ./packages/config/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY backend/package.json ./backend/

RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/backend/dist ./backend/dist

USER tasker

# Process presence is the best signal for a headless worker — pgrep runs
# cheap and doesn't touch Redis (which would restart-loop the container on
# any Redis blip).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD pgrep -f "node.*worker.js" || exit 1

CMD ["node", "backend/dist/worker.js"]
