# Multi-arch API image. Buildx picks the right `node:24-alpine` variant per
# --platform target (linux/amd64 for local dev, linux/arm64 for the Ampere
# A1 free-tier deploy) automatically because Docker Hub publishes both under
# the same manifest list. `TARGETPLATFORM` is exposed for build logs only —
# the base image is arch-agnostic.
FROM --platform=$BUILDPLATFORM node:24-alpine AS builder
ARG TARGETPLATFORM
ARG BUILDPLATFORM
RUN echo "Building api for ${TARGETPLATFORM:-unknown} on ${BUILDPLATFORM:-unknown}"

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

RUN pnpm --filter api build && \
    pnpm --filter api exec prisma generate

# ---- runtime ---------------------------------------------------------------
FROM node:24-alpine AS runtime

# curl for HEALTHCHECK — busybox `wget` misinterprets 3xx as fatal and would
# trip a restart loop when the reverse proxy sends a redirect.
RUN apk add --no-cache curl

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
COPY --from=builder /app/backend/prisma ./backend/prisma
COPY --from=builder /app/node_modules/.pnpm ./node_modules/.pnpm

USER tasker

EXPOSE 3001

# Liveness only — no DB / Redis / LLM I/O. A transient dep outage must not
# restart the container; deep readiness (`/api/v1/health/readiness`) is what
# Nginx / the load balancer polls for traffic gating.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://localhost:3001/api/v1/health/liveness || exit 1

CMD ["node", "backend/dist/main.js"]
