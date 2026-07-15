FROM node:20.17-alpine AS builder

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

FROM node:20.17-alpine AS runtime

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

HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/v1/health || exit 1

CMD ["node", "backend/dist/main.js"]
