#!/usr/bin/env bash
# Executes a single production deploy on the current host. Called over SSH
# by .github/workflows/deploy.yml, and also runnable by hand for local
# recovery drills.
#
# Contract (env vars set by caller):
#   TAG              — release tag to deploy (e.g. v1.4.2). Required.
#   READINESS_URL    — full URL of /api/v1/health/readiness. Required.
#   COMPOSE_FILE     — path to compose file (default infra/docker-compose.prod.yml).
#   READINESS_TIMEOUT_SECS — max wait for readiness (default 180).
#   READINESS_POLL_SECS    — poll interval  (default 5).
#
# Exit codes:
#   0  deploy succeeded and new tag is serving traffic
#   1  argument or environment error
#   2  image pull failed
#   3  migration failed — no traffic switch performed
#   4  readiness gate timed out — traffic did NOT switch, previous
#      containers still running (compose up --no-deps only replaces the
#      services named, and we bail before the traffic-switching cleanup).
#   5  post-deploy cleanup failed (non-fatal for traffic but flagged)
#
# Idempotent: rerunning with the same TAG is a no-op if the tag is already
# live. The workflow relies on this for rollback (re-running with a prior
# tag rolls back).

set -euo pipefail
IFS=$'\n\t'

: "${TAG:?TAG env var is required}"
: "${READINESS_URL:?READINESS_URL env var is required}"

COMPOSE_FILE="${COMPOSE_FILE:-infra/docker-compose.prod.yml}"
READINESS_TIMEOUT_SECS="${READINESS_TIMEOUT_SECS:-180}"
READINESS_POLL_SECS="${READINESS_POLL_SECS:-5}"

log() {
  printf '[deploy %s] %s\n' "$(date -u +%FT%TZ)" "$*"
}

fail() {
  local code="$1"
  shift
  log "ERROR: $*"
  exit "$code"
}

compose() {
  # Passes TAG through as an env var so docker-compose.prod.yml can
  # interpolate `${TAG:-main}` into the image references.
  TAG="$TAG" docker compose -f "$COMPOSE_FILE" "$@"
}

log "Starting deploy for TAG=${TAG}"

# ── 1. Pull the multi-arch images for the target tag ────────────────────
log "Pulling images for tag ${TAG}"
if ! compose pull api worker web; then
  fail 2 "docker compose pull failed for tag ${TAG} — check GHCR availability"
fi

# ── 2. Run migrations BEFORE switching traffic ──────────────────────────
# `run --rm` creates a throwaway api container against the current
# datastore. If migrate fails (schema drift, invalid SQL, DB unreachable)
# we abort before touching any running service.
log "Running Prisma migrations"
if ! compose run --rm --entrypoint '' api pnpm --filter api exec prisma migrate deploy; then
  fail 3 "Prisma migrations failed — previous ${TAG} not switched in"
fi

# ── 3. Roll the app services to the new tag ─────────────────────────────
# `--no-deps` avoids restarting postgres/redis/tempo/grafana/prometheus;
# `--pull always` re-pulls in case an image was retagged upstream.
log "Rolling api, worker, web to ${TAG}"
compose up -d --no-deps --pull always api worker web

# ── 4. Readiness gate ───────────────────────────────────────────────────
# `/readiness` returns 200 only when postgres, redis, storage, and the
# default LLM are all reachable per the deep health probes in Task 5.0.
log "Waiting up to ${READINESS_TIMEOUT_SECS}s for ${READINESS_URL}"
deadline=$(( $(date +%s) + READINESS_TIMEOUT_SECS ))
while :; do
  now=$(date +%s)
  if (( now >= deadline )); then
    fail 4 "Readiness gate timed out after ${READINESS_TIMEOUT_SECS}s — previous containers still running"
  fi
  http_code=$(curl -sS -o /tmp/readiness.$$.json -w '%{http_code}' \
    --max-time 10 "${READINESS_URL}" || true)
  if [[ "$http_code" == "200" ]]; then
    log "Readiness OK after $(( now - (deadline - READINESS_TIMEOUT_SECS) ))s"
    rm -f /tmp/readiness.$$.json
    break
  fi
  log "Readiness ${http_code:-<curl-fail>} — retrying in ${READINESS_POLL_SECS}s"
  sleep "$READINESS_POLL_SECS"
done

# ── 5. Post-deploy cleanup ──────────────────────────────────────────────
# Prune only untagged intermediates. Never `docker system prune -a`
# because the previous release image is our fastest rollback path.
log "Pruning dangling images"
if ! docker image prune -f >/dev/null; then
  log "WARN: docker image prune failed; not fatal"
  exit 5
fi

log "Deploy of ${TAG} complete"
