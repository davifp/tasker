#!/usr/bin/env bash
# Unit tests for infra/scripts/rollback.sh.
#
# Run: bash infra/scripts/tests/rollback.test.sh

set -uo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROLLBACK_SH="$(cd "$SCRIPT_DIR/.." && pwd)/rollback.sh"

# shellcheck source=./lib.sh
source "$SCRIPT_DIR/lib.sh"

# ────────────────────────────────────────────────────────────────────────
# 1. Rollback delegates to deploy.sh with TAG=<previous>
# ────────────────────────────────────────────────────────────────────────
delegates_to_deploy() {
  # Shadow deploy.sh with a stub that echoes its env — proves the tag was
  # forwarded correctly.
  local script_root; script_root="$(cd "$SCRIPT_DIR/.." && pwd)"
  local real_deploy="$script_root/deploy.sh"
  local backup="$STUB_BIN/deploy.sh.real"
  cp "$real_deploy" "$backup"
  cat > "$real_deploy" <<'STUB'
#!/usr/bin/env bash
printf 'deploy-stub TAG=%s\n' "${TAG:-<unset>}" >> "$CALL_LOG"
exit 0
STUB
  chmod +x "$real_deploy"

  "$ROLLBACK_SH" v1.2.3 > "$STUB_BIN/rollback.out" 2>&1
  local rc=$?

  # Restore before asserting so a failing assertion doesn't leave the repo
  # in a broken state.
  cp "$backup" "$real_deploy"

  assert_eq 0 "$rc" 'rollback should exit 0 when the wrapped deploy succeeds'
  local calls; calls=$(cat "$CALL_LOG")
  assert_contains "$calls" 'deploy-stub TAG=v1.2.3' \
    'rollback must invoke deploy.sh with the previous tag'
}

# ────────────────────────────────────────────────────────────────────────
# 2. Missing argument fails fast (exit 1)
# ────────────────────────────────────────────────────────────────────────
missing_argument() {
  "$ROLLBACK_SH" > "$STUB_BIN/rollback.out" 2>&1
  local rc=$?
  assert_eq 1 "$rc" 'no-arg invocation should exit 1'

  local out; out=$(cat "$STUB_BIN/rollback.out")
  assert_contains "$out" 'Usage:' 'usage line must be printed'
}

# ────────────────────────────────────────────────────────────────────────
# 3. Empty argument fails fast (exit 1)
# ────────────────────────────────────────────────────────────────────────
empty_argument() {
  "$ROLLBACK_SH" '' > "$STUB_BIN/rollback.out" 2>&1
  local rc=$?
  assert_eq 1 "$rc" 'empty-string argument should exit 1'
}

# ────────────────────────────────────────────────────────────────────────
test_case 'rollback delegates to deploy.sh with the supplied tag' delegates_to_deploy
test_case 'rollback without a tag exits 1 with usage' missing_argument
test_case 'rollback with empty tag exits 1' empty_argument

test_summary
