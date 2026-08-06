# Multi-arch web image. Buildx picks the right `node:24-alpine` variant per
# --platform target (linux/amd64 local, linux/arm64 for Ampere A1).
FROM --platform=$BUILDPLATFORM node:24-alpine AS builder
ARG TARGETPLATFORM
ARG BUILDPLATFORM
RUN echo "Building web for ${TARGETPLATFORM:-unknown} on ${BUILDPLATFORM:-unknown}"

RUN npm install -g pnpm@10.15.0

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/tsconfig/package.json ./packages/tsconfig/
COPY packages/config/package.json ./packages/config/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY frontend/package.json ./frontend/

RUN pnpm install --frozen-lockfile

COPY packages/tsconfig/ ./packages/tsconfig/
COPY packages/config/ ./packages/config/
COPY frontend/ ./frontend/
# `/docs` route reads ADR markdown from ../docs/adr/. Standalone build traces
# those files (see frontend/next.config.ts outputFileTracingIncludes) and
# copies them under .next/standalone/docs/adr/, but they must be present in
# the build context first.
COPY docs/ ./docs/

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN pnpm --filter web build

# ---- runtime ---------------------------------------------------------------
FROM node:24-alpine AS runtime

RUN apk add --no-cache curl

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup -S tasker && adduser -S tasker -G tasker

WORKDIR /app

COPY --from=builder --chown=tasker:tasker /app/frontend/.next/standalone ./
COPY --from=builder --chown=tasker:tasker /app/frontend/.next/static ./frontend/.next/static
COPY --from=builder --chown=tasker:tasker /app/frontend/public ./frontend/public

USER tasker

EXPOSE 3000

# The root path resolves to the login page and always returns 200 as long
# as the Next.js server is up. Adding a dedicated /health route buys no
# extra signal over what `curl /` already proves.
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD curl -fsS http://localhost:3000/ || exit 1

CMD ["node", "frontend/server.js"]
