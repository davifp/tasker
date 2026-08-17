#!/usr/bin/env bash
# Unit tests for infra/scripts/deploy.sh.
#
# Runs the real script inside a sandbox with stubbed docker/curl on PATH,
# then asserts on the recorded call log. No real docker daemon required.
#
# Run: bash infra/scripts/tests/deploy.test.sh

set -uo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_SH="$(cd "$SCRIPT_DIR/.." && pwd)/deploy.sh"

# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

# Common env every test needs. Overrides go inside each test_case body.
prepare_env() {
  export TAG='v9.9.9'
  export READINESS_URL='http://localhost/api/v1/health/readiness'
  export COMPOSE_FILE='fake-compose.yml'
  export READINESS_TIMEOUT_SECS='5'
  export READINESS_POLL_SECS='1'
}

# ────────────────────────────────────────────────────────────────────────
# 1. Happy path: pull → migrate → up → readiness OK → prune
# ────────────────────────────────────────────────────────────────────────
happy_path() {
  prepare_env

  # docker stub — records every subcommand; always exits 0.
  make_stub docker 0 ''
  # curl stub — always returns 200 (readiness passes on the first poll).
  make_stub_dynamic curl '
    for a in "$@"; do
      if [[ "$a" == "-o" ]]; then next=path; continue; fi
      if [[ "$next" == "path" ]]; then next=; touch "$a" 2>/dev/null || true; fi
    done
    printf "200"
    exit 0
  '

  "$DEPLOY_SH" > "$STUB_BIN/deploy.out" 2>&1
  local rc=$?
  local calls; calls=$(cat "$CALL_LOG")

  assert_eq 0 "$rc" 'deploy.sh should exit 0 on happy path'
  assert_contains "$calls" 'docker compose -f fake-compose.yml pull api worker web' \
    'compose pull step missing'
  assert_contains "$calls" 'prisma migrate deploy' 'migrate step missing'
  assert_contains "$calls" 'compose -f fake-compose.yml up -d --no-deps --pull always api worker web' \
    'compose up step missing'
  assert_contains "$calls" 'image prune -f' 'prune step missing'

  # Ordering guarantees — this is the whole point of the migrate-first
  # contract. If any of these lines slip, deployment will silently break
  # in ways nobody notices until the next migration.
  assert_line_before "$calls" 'compose -f fake-compose.yml pull' 'prisma migrate deploy' \
    'pull must run before migrate'
  assert_line_before "$calls" 'prisma migrate deploy' 'up -d --no-deps --pull always' \
    'migrate must run before compose up (FR-6.3)'
  assert_line_before "$calls" 'up -d --no-deps --pull always' 'image prune -f' \
    'prune must run last, after readiness'
}

# ────────────────────────────────────────────────────────────────────────
# 2. Missing TAG env var — hard fail before touching anything
# ────────────────────────────────────────────────────────────────────────
missing_tag_env() {
  prepare_env
  unset TAG
  make_stub docker 0 ''
  make_stub curl 0 '200'

  "$DEPLOY_SH" > "$STUB_BIN/deploy.out" 2>&1
  local rc=$?
  assert_eq 1 "$rc" 'missing TAG should exit 1'

  local calls; calls=$(cat "$CALL_LOG")
  assert_not_contains "$calls" 'docker' 'no docker call should occur when TAG is unset'
}

# ────────────────────────────────────────────────────────────────────────
# 3. Migration failure blocks the traffic switch (FR-6.3 verification)
# ────────────────────────────────────────────────────────────────────────
migration_failure_blocks_switch() {
  prepare_env

  # Custom docker stub: `pull` succeeds, `run --rm` (the migrate call)
  # exits 1 so we can prove `up -d` is never reached.
  make_stub_dynamic docker '
    case "$*" in
      *"pull api worker web"*) exit 0 ;;
      *"run --rm"*"prisma migrate deploy"*) exit 1 ;;
      *"up -d"*) exit 0 ;;
      *"image prune"*) exit 0 ;;
      *) exit 0 ;;
    esac
  '
  make_stub curl 0 '200'

  "$DEPLOY_SH" > "$STUB_BIN/deploy.out" 2>&1
  local rc=$?
  assert_eq 3 "$rc" 'migration failure should exit 3'

  local calls; calls=$(cat "$CALL_LOG")
  assert_contains "$calls" 'prisma migrate deploy' 'migrate step must have been attempted'
  assert_not_contains "$calls" 'up -d --no-deps' \
    'traffic switch must NOT run when migration fails (FR-6.3)'
  assert_not_contains "$calls" 'image prune' \
    'cleanup must not run when deploy short-circuits'
}

# ────────────────────────────────────────────────────────────────────────
# 4. Readiness gate timeout: exit 4, previous containers untouched
# ────────────────────────────────────────────────────────────────────────
readiness_timeout() {
  prepare_env
  export READINESS_TIMEOUT_SECS='2'
  export READINESS_POLL_SECS='1'

  make_stub docker 0 ''
  # curl always returns 503 → gate never opens.
  make_stub_dynamic curl '
    for a in "$@"; do
      if [[ "$a" == "-o" ]]; then next=path; continue; fi
      if [[ "$next" == "path" ]]; then next=; touch "$a" 2>/dev/null || true; fi
    done
    printf "503"
    exit 0
  '

  "$DEPLOY_SH" > "$STUB_BIN/deploy.out" 2>&1
  local rc=$?
  assert_eq 4 "$rc" 'readiness timeout should exit 4'

  local calls; calls=$(cat "$CALL_LOG")
  # `up -d` did run, but prune should not have.
  assert_contains "$calls" 'up -d --no-deps' 'compose up should still have executed'
  assert_not_contains "$calls" 'image prune' \
    'cleanup must be skipped when readiness gate fails'
}

# ────────────────────────────────────────────────────────────────────────
# 5. Pull failure: exit 2, no migrate attempted
# ────────────────────────────────────────────────────────────────────────
pull_failure() {
  prepare_env

  make_stub_dynamic docker '
    case "$*" in
      *"pull api worker web"*) exit 1 ;;
      *) exit 0 ;;
    esac
  '
  make_stub curl 0 '200'

  "$DEPLOY_SH" > "$STUB_BIN/deploy.out" 2>&1
  local rc=$?
  assert_eq 2 "$rc" 'pull failure should exit 2'

  local calls; calls=$(cat "$CALL_LOG")
  assert_not_contains "$calls" 'prisma migrate deploy' \
    'migration must not run when pull fails'
  assert_not_contains "$calls" 'up -d --no-deps' \
    'traffic switch must not run when pull fails'
}

# ────────────────────────────────────────────────────────────────────────
# Runner
# ────────────────────────────────────────────────────────────────────────
test_case 'happy path: migrate-first, readiness OK, prune' happy_path
test_case 'missing TAG env var is a hard error before docker runs' missing_tag_env
test_case 'migration failure blocks traffic switch (FR-6.3)' migration_failure_blocks_switch
test_case 'readiness timeout skips cleanup, exits 4' readiness_timeout
test_case 'GHCR pull failure exits 2 before migration' pull_failure

test_summary
