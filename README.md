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

### Realtime load smoke

`scripts/rt-load.mjs` opens N concurrent Socket.IO clients against a running
API, triggers a broadcast, and reports the client-observed P95 latency.
Fails with a non-zero exit code when P95 exceeds `RT_LOAD_P95_SLO_MS`
(default 500 ms). Not wired into CI — run locally before a release or when
touching the realtime path.

```bash
node scripts/rt-load.mjs \
  --api http://localhost:3001 \
  --token <bearer-jwt> \
  --workspace <workspaceId> \
  --clients 100
```

The multi-node adapter profile can be exercised with:

```bash
docker compose -f infra/docker-compose.yml -f infra/docker-compose.multi.yml up
# Then point the load smoke at either --api http://localhost:3011 (node A)
# or --api http://localhost:3012 (node B); events emitted on one are seen
# by clients on the other via the Redis adapter.
```
