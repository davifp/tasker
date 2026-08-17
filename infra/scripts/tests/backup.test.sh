#!/usr/bin/env bash
# Unit tests for infra/backups/backup.sh.
#
# Stubs pg_dump / gzip / aws / curl / date on PATH; asserts on the
# recorded call log and captured stdin. No real datastore required.
#
# Run: bash infra/scripts/tests/backup.test.sh

set -uo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_SH="$(cd "$SCRIPT_DIR/../../backups" && pwd)/backup.sh"

# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

prepare_env() {
  export PGHOST=fake-host
  export PGUSER=fake-user
  export PGDATABASE=fake-db
  export PGPASSWORD=fake-pass
  export S3_ENDPOINT='https://fake.example/s3'
  export S3_REGION=us-east-1
  export AWS_ACCESS_KEY_ID=key
  export AWS_SECRET_ACCESS_KEY=secret
  export BACKUP_BUCKET=tasker-backups
  export BACKUP_ENV=local
  unset PUSHGATEWAY_URL BACKUP_SSE
}

# ────────────────────────────────────────────────────────────────────────
# 1. Happy path: pg_dump | gzip | aws s3 cp — object key format matches
# ────────────────────────────────────────────────────────────────────────
object_key_format() {
  prepare_env

  # Make `date -u` deterministic. All backup.sh invocations of `date`
  # take arguments starting with `-u`, so returning a fixed string is
  # safe.
  make_stub_dynamic date '
    case "$*" in
      *"+%Y%m%d%H%M"*) echo "202601020304" ;;
      *"+%FT%TZ"*)    echo "2026-01-02T03:04:00Z" ;;
      *"+%s"*)         echo "1767326640" ;;
      *)               command /usr/bin/date "$@" ;;
    esac
  '

  # pg_dump emits some fake SQL on stdout so gzip has something to chew.
  make_stub pg_dump 0 '-- fake dump'
  # gzip forwards stdin unchanged for the test.
  make_stub_dynamic gzip 'cat'

  # aws stub captures stdin so we can assert on it, plus records the
  # `s3 cp - <uri>` invocation.
  make_stub_dynamic aws '
    if [[ "$1$2" == "s3cp" ]] || [[ " $* " == *" s3 cp "* ]]; then
      cat > "$STUB_BIN/aws.stdin"
    fi
    exit 0
  '

  "$BACKUP_SH" > "$STUB_BIN/backup.out" 2>&1
  local rc=$?
  assert_eq 0 "$rc" 'happy path should exit 0'

  local calls; calls=$(cat "$CALL_LOG")
  # Key format assertion — the whole point of the object-key section.
  assert_contains "$calls" 'local/2026/01/02/tasker-202601020304.sql.gz' \
    'object key must match ${env}/${YYYY}/${MM}/${DD}/tasker-${YYYYMMDDHHMM}.sql.gz'
  assert_contains "$calls" 's3://tasker-backups/local/2026/01/02/tasker-202601020304.sql.gz' \
    'aws s3 cp target must include the s3:// prefix + bucket'

  # Verify --endpoint-url and --region are passed to aws.
  assert_contains "$calls" '--endpoint-url https://fake.example/s3' \
    'endpoint-url flag missing from aws invocation'
  assert_contains "$calls" '--region us-east-1' 'region flag missing'

  # Verify pg_dump was called with the safe flags.
  assert_contains "$calls" '--format=plain' 'pg_dump must use --format=plain'
  assert_contains "$calls" '--clean' 'pg_dump must use --clean for idempotent restore'
  assert_contains "$calls" '--if-exists' 'pg_dump must use --if-exists'
  assert_contains "$calls" '--no-owner' 'pg_dump must use --no-owner for drill compatibility'

  # gzip must run at -9 (docs say so).
  # Because backup.sh calls `gzip -9`, our stub records "gzip -9" in the
  # call log. Assert on that.
  assert_contains "$calls" 'gzip -9' 'gzip must be invoked at -9'
}

# ────────────────────────────────────────────────────────────────────────
# 2. BACKUP_SSE forwards `--sse` to aws
# ────────────────────────────────────────────────────────────────────────
sse_forwarded() {
  prepare_env
  export BACKUP_SSE='AES256'

  make_stub_dynamic date '
    case "$*" in
      *"+%Y%m%d%H%M"*) echo "202601020304" ;;
      *"+%FT%TZ"*)    echo "2026-01-02T03:04:00Z" ;;
      *"+%s"*)         echo "1767326640" ;;
      *)               command /usr/bin/date "$@" ;;
    esac
  '
  make_stub pg_dump 0 '-- fake'
  make_stub_dynamic gzip 'cat'
  make_stub aws 0 ''

  "$BACKUP_SH" > "$STUB_BIN/backup.out" 2>&1
  assert_eq 0 "$?" 'sse-enabled backup should still succeed'

  local calls; calls=$(cat "$CALL_LOG")
  assert_contains "$calls" '--sse AES256' 'BACKUP_SSE must be forwarded to aws s3 cp'
}

# ────────────────────────────────────────────────────────────────────────
# 3. Pushgateway update fires with the correct URL + payload
# ────────────────────────────────────────────────────────────────────────
pushgateway_payload() {
  prepare_env
  export PUSHGATEWAY_URL='http://pushgateway:9091'

  make_stub_dynamic date '
    case "$*" in
      *"+%Y%m%d%H%M"*) echo "202601020304" ;;
      *"+%FT%TZ"*)    echo "2026-01-02T03:04:00Z" ;;
      *"+%s"*)         echo "1767326640" ;;
      *)               command /usr/bin/date "$@" ;;
    esac
  '
  make_stub pg_dump 0 ''
  make_stub_dynamic gzip 'cat'
  make_stub aws 0 ''

  # curl stub captures stdin so we can look at the pushed metric.
  make_stub_dynamic curl '
    for a in "$@"; do
      case "$a" in
        --data-binary) next=data;;
      esac
    done
    if [[ "$next" == "data" ]]; then
      cat > "$STUB_BIN/curl.stdin"
    fi
    exit 0
  '

  "$BACKUP_SH" > "$STUB_BIN/backup.out" 2>&1
  assert_eq 0 "$?" 'happy-path with pushgateway should exit 0'

  local calls; calls=$(cat "$CALL_LOG")
  assert_contains "$calls" 'http://pushgateway:9091/metrics/job/tasker_backup/env/local' \
    'pushgateway URL must carry job=tasker_backup + env label'

  local body; body=$(cat "$STUB_BIN/curl.stdin" 2>/dev/null || echo '')
  assert_contains "$body" 'backup_last_success_timestamp_seconds 1767326640' \
    'pushed metric must include the epoch from date +%s'
  assert_contains "$body" '# TYPE backup_last_success_timestamp_seconds gauge' \
    'pushed payload must include the TYPE line'
}

# ────────────────────────────────────────────────────────────────────────
# 4. Missing required env var fails fast before running pg_dump
# ────────────────────────────────────────────────────────────────────────
missing_bucket_env() {
  prepare_env
  unset BACKUP_BUCKET

  make_stub pg_dump 0 ''
  make_stub gzip 0 ''
  make_stub aws 0 ''

  "$BACKUP_SH" > "$STUB_BIN/backup.out" 2>&1
  local rc=$?
  assert_eq 1 "$rc" 'missing BACKUP_BUCKET should exit 1'

  local calls; calls=$(cat "$CALL_LOG")
  assert_not_contains "$calls" 'pg_dump' 'pg_dump must not run when required env is missing'
}

# ────────────────────────────────────────────────────────────────────────
# 5. Upload failure exits 3
# ────────────────────────────────────────────────────────────────────────
upload_failure() {
  prepare_env

  make_stub_dynamic date '
    case "$*" in
      *"+%Y%m%d%H%M"*) echo "202601020304" ;;
      *"+%FT%TZ"*)    echo "2026-01-02T03:04:00Z" ;;
      *)               command /usr/bin/date "$@" ;;
    esac
  '
  make_stub pg_dump 0 '-- fake'
  make_stub_dynamic gzip 'cat'
  # aws fails.
  make_stub aws 1 ''

  "$BACKUP_SH" > "$STUB_BIN/backup.out" 2>&1
  local rc=$?
  assert_eq 3 "$rc" 'upload failure should exit 3'
}

# ────────────────────────────────────────────────────────────────────────
test_case 'object key format ${env}/${Y}/${M}/${D}/tasker-${YYYYMMDDHHMM}.sql.gz' object_key_format
test_case 'BACKUP_SSE forwards --sse to aws s3 cp' sse_forwarded
test_case 'pushgateway payload includes gauge + env label' pushgateway_payload
test_case 'missing BACKUP_BUCKET fails before pg_dump' missing_bucket_env
test_case 'upload failure exits 3' upload_failure

test_summary
