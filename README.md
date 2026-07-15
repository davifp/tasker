# Tasker

Multi-tenant project management SaaS.

## Prerequisites

- Node.js ≥ 20 LTS ([nvm](https://github.com/nvm-sh/nvm): `nvm use`)
- pnpm ≥ 9 (`npm install -g pnpm`)
- Docker Engine ≥ 24

## Quick start

```bash
# 1. Install dependencies
pnpm install

# 2. Copy env file and fill in values
cp .env.example .env

# 3. Boot dev services (Postgres, Redis, Mailhog)
docker compose -f infra/docker-compose.yml up -d

# 4. Apply Prisma migrations
pnpm --filter api exec prisma migrate deploy

# 5. Start dev servers
pnpm dev
```

API: http://localhost:3001/api/v1/health  
Mailhog UI: http://localhost:8025

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start all apps in parallel |
| `pnpm build` | Build all apps |
| `pnpm lint` | Lint all workspaces |
| `pnpm typecheck` | Type-check all workspaces |
| `pnpm test` | Run all test suites |
