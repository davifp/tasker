#!/usr/bin/env bash
# Postgres → S3-compatible object storage backup.
#
# Runs inside the `backup` sidecar container (see
# infra/docker-compose.prod.yml) on the schedule wired into the container's
# crontab. Same script is exercised in CI + locally against MinIO.
#
# Pipeline:
#   pg_dump --format=custom \
#     | gzip -9 \
#     | aws --endpoint-url $S3_ENDPOINT s3 cp - s3://$BUCKET/$KEY
#
# Object key convention (ADR 0003):
#   s3://${BUCKET}/${ENV}/${YYYY}/${MM}/${DD}/tasker-${YYYYMMDDHHMM}.sql.gz
#
# After a successful upload we POST the observed timestamp to a Prometheus
# Pushgateway so `backup_last_success_timestamp_seconds` can drive the
# "backup missing" alert (ADR 0003 §Alerting).
#
# Required env vars:
#   PGHOST, PGUSER, PGDATABASE  — read by pg_dump.
#   PGPASSWORD                   — read by pg_dump (do NOT put in .env logs).
#   S3_ENDPOINT                  — full URL, e.g. https://<ns>.compat.objectstorage.<region>.oraclecloud.com
#   S3_REGION                    — region string (matters for AWS sigv4 signing)
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY — matched to a scoped IAM user.
#   BACKUP_BUCKET                — bucket name (no s3:// prefix).
#   BACKUP_ENV                   — "production" / "staging" / "local".
# Optional:
#   PUSHGATEWAY_URL              — e.g. http://pushgateway:9091; skipped if empty.
#   BACKUP_SSE                   — if set, passed as `--sse ${BACKUP_SSE}` to aws s3 cp.
#
# Exit codes:
#   0 success
#   1 argument / env error
#   2 pg_dump failed
#   3 upload failed
#   4 pushgateway update failed (backup itself succeeded — non-fatal for
#     the artefact but flagged so it does not silently drift)

set -euo pipefail
IFS=$'\n\t'

log() { printf '[backup %s] %s\n' "$(date -u +%FT%TZ)" "$*"; }

# ── Preflight ──────────────────────────────────────────────────────────
: "${PGHOST:?PGHOST required}"
: "${PGUSER:?PGUSER required}"
: "${PGDATABASE:?PGDATABASE required}"
: "${PGPASSWORD:?PGPASSWORD required (feeds pg_dump)}"
: "${S3_ENDPOINT:?S3_ENDPOINT required (S3-compatible URL)}"
: "${S3_REGION:=us-east-1}"
: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID required}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY required}"
: "${BACKUP_BUCKET:?BACKUP_BUCKET required}"
: "${BACKUP_ENV:?BACKUP_ENV required (production/staging/local)}"

# ── Build the object key ───────────────────────────────────────────────
# UTC to make cross-region debugging painless. Minute-level precision so
# an hourly cron cannot ever produce the same key twice.
ts=$(date -u +%Y%m%d%H%M)
yyyy=${ts:0:4}
mm=${ts:4:2}
dd=${ts:6:2}
key="${BACKUP_ENV}/${yyyy}/${mm}/${dd}/tasker-${ts}.sql.gz"
uri="s3://${BACKUP_BUCKET}/${key}"

log "Dumping ${PGDATABASE}@${PGHOST} → ${uri}"

# ── Assemble aws-cli flags ─────────────────────────────────────────────
aws_flags=(--endpoint-url "$S3_ENDPOINT" --region "$S3_REGION")

sse_flags=()
if [[ -n "${BACKUP_SSE:-}" ]]; then
  sse_flags=(--sse "$BACKUP_SSE")
fi

# ── Run the pipeline ───────────────────────────────────────────────────
# `pg_dump | gzip | aws s3 cp -` avoids buffering the dump to disk. The
# tradeoff: no restart on failure of any single stage — but each stage
# is idempotent when re-run so a fresh cron tick is the recovery path.
# `set -o pipefail` (already on) surfaces pg_dump failure through the pipe.
if ! pg_dump \
      --format=plain \
      --no-owner \
      --no-privileges \
      --clean \
      --if-exists \
      "$PGDATABASE" \
      | gzip -9 \
      | aws "${aws_flags[@]}" s3 cp - "$uri" "${sse_flags[@]}"; then
  # We cannot distinguish pg_dump failure from aws-cli failure at this
  # point because pipefail masks individual exit codes. Log and treat
  # the more common cause (upload) as the primary failure — operators
  # will find pg_dump errors on stderr in container logs.
  log "ERROR: dump-and-upload pipeline failed"
  exit 3
fi

log "Upload complete: ${uri}"

# ── Push metric to Prometheus Pushgateway ──────────────────────────────
# The gauge is named `backup_last_success_timestamp_seconds`. Grafana
# alert fires when `time() - metric > 26h` (ADR 0003 §Alerting).
if [[ -n "${PUSHGATEWAY_URL:-}" ]]; then
  now_epoch=$(date +%s)
  payload="# TYPE backup_last_success_timestamp_seconds gauge
backup_last_success_timestamp_seconds ${now_epoch}
"
  # Job label matches the Prometheus scrape job in prometheus.yml.
  if ! printf '%s' "$payload" \
      | curl --silent --show-error --fail --max-time 10 \
             --data-binary @- \
             "${PUSHGATEWAY_URL%/}/metrics/job/tasker_backup/env/${BACKUP_ENV}"; then
    log "WARN: pushgateway update failed — backup artefact is safe, but alerting will lag"
    exit 4
  fi
  log "Pushed backup_last_success_timestamp_seconds=${now_epoch}"
fi

log "Done"
