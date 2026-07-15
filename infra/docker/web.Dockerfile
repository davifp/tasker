FROM node:20.17-alpine AS builder

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

ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN pnpm --filter web build

FROM node:20.17-alpine AS runtime

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

RUN addgroup -S tasker && adduser -S tasker -G tasker

WORKDIR /app

COPY --from=builder --chown=tasker:tasker /app/frontend/.next/standalone ./
COPY --from=builder --chown=tasker:tasker /app/frontend/.next/static ./frontend/.next/static
COPY --from=builder --chown=tasker:tasker /app/frontend/public ./public

USER tasker

EXPOSE 3000

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1

CMD ["node", "frontend/server.js"]
