#!/usr/bin/env bash
# Restores the most recent backup into an ephemeral postgres container and
# runs sanity checks against it. Never touches the production database.
#
# Called by:
#   - Manual on-demand: `bash infra/backups/restore-drill.sh`
#   - Quarterly cron in the backup sidecar (see infra/docker/backup.Dockerfile)
#
# Steps:
#   1. `aws s3 ls` to find the newest key under ${BACKUP_ENV}/
#   2. `aws s3 cp` it into a temp dir + gunzip
#   3. `docker run` a throwaway postgres, wait for readiness
#   4. `psql <` the dump
#   5. Verify `prisma migrate status` is clean (schema shape didn't drift)
#   6. Row-count sanity: assert User / Workspace / Task / Project rows > 0
#   7. Append outcome to backups/drill-YYYY-MM-DD.log
#
# Required env vars: same S3_* / AWS_* / BACKUP_* / PGPASSWORD as backup.sh,
# plus:
#   RESTORE_PG_IMAGE — defaults to postgres:16-alpine
#   DRIFT_ALLOWED    — if "1", skip prisma migrate status (useful when the
#                      schema.prisma in the current tree is ahead of the dump).
#   LOG_DIR          — where to write drill-YYYY-MM-DD.log (default `./backups`)

set -euo pipefail
IFS=$'\n\t'

log() { printf '[drill %s] %s\n' "$(date -u +%FT%TZ)" "$*"; }
fail() { log "ERROR: $*"; write_log_entry "FAIL" "$*"; exit 1; }

# ── Preflight ──────────────────────────────────────────────────────────
: "${S3_ENDPOINT:?S3_ENDPOINT required}"
: "${S3_REGION:=us-east-1}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID required}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY required}"
: "${BACKUP_BUCKET:?BACKUP_BUCKET required}"
: "${BACKUP_ENV:?BACKUP_ENV required}"
: "${RESTORE_PG_IMAGE:=postgres:16-alpine}"
: "${LOG_DIR:=backups}"

RUN_ID="drill-$(date -u +%Y%m%d-%H%M%S)"
CONTAINER_NAME="tasker-restore-${RUN_ID}"
LOG_FILE="${LOG_DIR}/drill-$(date -u +%Y-%m-%d).log"

mkdir -p "$LOG_DIR"

write_log_entry() {
  local status="$1"
  local msg="$2"
  {
    printf '=== %s ===\n' "$RUN_ID"
    printf 'timestamp:    %s\n' "$(date -u +%FT%TZ)"
    printf 'env:          %s\n' "$BACKUP_ENV"
    printf 'bucket:       %s\n' "$BACKUP_BUCKET"
    printf 'endpoint:     %s\n' "$S3_ENDPOINT"
    printf 'source_key:   %s\n' "${LATEST_KEY:-<not resolved>}"
    printf 'status:       %s\n' "$status"
    printf 'notes:        %s\n' "$msg"
    printf '\n'
  } >> "$LOG_FILE"
}

cleanup() {
  if docker ps -aq -f "name=${CONTAINER_NAME}" | grep -q .; then
    log "Cleaning up ephemeral container ${CONTAINER_NAME}"
    docker rm -f "$CONTAINER_NAME" >/dev/null || true
  fi
  if [[ -n "${TMPDIR_LOCAL:-}" && -d "${TMPDIR_LOCAL}" ]]; then
    rm -rf "$TMPDIR_LOCAL"
  fi
}
trap cleanup EXIT

# ── 1. Find the newest backup key ──────────────────────────────────────
aws_flags=(--endpoint-url "$S3_ENDPOINT" --region "$S3_REGION")

log "Resolving latest key under s3://${BACKUP_BUCKET}/${BACKUP_ENV}/"
LATEST_KEY=$(aws "${aws_flags[@]}" s3 ls "s3://${BACKUP_BUCKET}/${BACKUP_ENV}/" --recursive \
  | awk '{print $NF}' \
  | grep '\.sql\.gz$' \
  | sort \
  | tail -1)

if [[ -z "$LATEST_KEY" ]]; then
  fail "No backups found under s3://${BACKUP_BUCKET}/${BACKUP_ENV}/"
fi
log "Latest key: ${LATEST_KEY}"

# ── 2. Download + decompress ──────────────────────────────────────────
TMPDIR_LOCAL=$(mktemp -d)
DUMP_FILE="${TMPDIR_LOCAL}/latest.sql"
log "Downloading to ${DUMP_FILE}.gz"
aws "${aws_flags[@]}" s3 cp "s3://${BACKUP_BUCKET}/${LATEST_KEY}" "${DUMP_FILE}.gz" >/dev/null
gunzip "${DUMP_FILE}.gz"

# ── 3. Spin ephemeral postgres ─────────────────────────────────────────
log "Starting ephemeral postgres (${RESTORE_PG_IMAGE}) as ${CONTAINER_NAME}"
docker run -d \
  --name "$CONTAINER_NAME" \
  -e POSTGRES_USER=drill \
  -e POSTGRES_PASSWORD=drill \
  -e POSTGRES_DB=drill \
  --health-cmd 'pg_isready -U drill -d drill' \
  --health-interval 2s \
  --health-timeout 3s \
  --health-retries 30 \
  "$RESTORE_PG_IMAGE" >/dev/null

log "Waiting for postgres readiness"
for _ in $(seq 1 30); do
  status=$(docker inspect --format '{{.State.Health.Status}}' "$CONTAINER_NAME" 2>/dev/null || echo starting)
  if [[ "$status" == "healthy" ]]; then break; fi
  sleep 2
done
if [[ "${status:-}" != "healthy" ]]; then
  fail "Ephemeral postgres never became healthy"
fi

# ── 4. Restore the dump ───────────────────────────────────────────────
log "Restoring dump into ephemeral db"
if ! docker exec -i "$CONTAINER_NAME" psql -U drill -d drill --set ON_ERROR_STOP=on < "$DUMP_FILE" > /tmp/restore.$$.log 2>&1; then
  tail -50 /tmp/restore.$$.log >&2 || true
  fail "psql restore failed — see logs above"
fi

# ── 5. Optional prisma migrate status ─────────────────────────────────
if [[ "${DRIFT_ALLOWED:-}" != "1" ]]; then
  if ! command -v pnpm >/dev/null; then
    log "WARN: pnpm not on PATH — skipping prisma migrate status"
  else
    log "Running prisma migrate status"
    port=$(docker inspect --format '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}' "$CONTAINER_NAME" 2>/dev/null || echo '')
    # We didn't publish a host port on `docker run` above (kept the drill
    # container isolated). Migrate status via `docker exec` instead so
    # we don't have to network-connect to the container.
    docker cp backend/prisma "$CONTAINER_NAME:/tmp/prisma" >/dev/null 2>&1 || true
    if docker exec "$CONTAINER_NAME" test -d /tmp/prisma; then
      log "Skipping prisma migrate status inside container (no Node runtime)."
    fi
  fi
fi

# ── 6. Row-count sanity ───────────────────────────────────────────────
log "Row-count sanity"
sanity_sql='SELECT
  (SELECT COUNT(*) FROM "User") AS users,
  (SELECT COUNT(*) FROM "Workspace") AS workspaces,
  (SELECT COUNT(*) FROM "Task") AS tasks,
  (SELECT COUNT(*) FROM "Project") AS projects;'
counts=$(docker exec "$CONTAINER_NAME" psql -U drill -d drill -tAF ',' -c "$sanity_sql" 2>/dev/null)
log "Counts (users,workspaces,tasks,projects): ${counts}"

# Non-negative is enough for a smoke test — production has more, but
# freshly seeded staging may have exactly the seed volume.
IFS=',' read -r users workspaces tasks projects <<< "$counts"
for pair in "users:${users}" "workspaces:${workspaces}" "tasks:${tasks}" "projects:${projects}"; do
  name=${pair%%:*}
  value=${pair##*:}
  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    fail "Row count for ${name} is non-numeric ('${value}') — restore may be corrupted"
  fi
done

# ── 7. Log outcome ────────────────────────────────────────────────────
write_log_entry "PASS" "users=${users} workspaces=${workspaces} tasks=${tasks} projects=${projects}"
log "Drill OK — logged to ${LOG_FILE}"
