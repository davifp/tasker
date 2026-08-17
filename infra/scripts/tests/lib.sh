#!/usr/bin/env bash
# Tiny test harness for the deploy shell scripts. Zero dependencies (no
# bats, no shellcheck required) so it runs on any developer box and in
# CI without extra installs.
#
# Usage in a test file:
#   source "$(dirname "$0")/lib.sh"
#   test_case "docker pull runs before migrate deploy" some_test_fn
#   test_summary
#
# Each test runs inside a fresh temp dir and gets stubbed binaries on PATH
# so the real docker/ssh/curl are never invoked.

set -uo pipefail
IFS=$'\n\t'

# Colours off when not a TTY.
if [[ -t 1 ]]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[0;33m'; NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; NC=''
fi

declare -i TESTS_RUN=0
declare -i TESTS_FAILED=0
declare -a FAILURES=()

# ── Stub factory ────────────────────────────────────────────────────────
# make_stub NAME EXIT_CODE STDOUT_TEMPLATE
#
# Creates $STUB_BIN/NAME. Any call gets appended (arg-quoted) to
# $CALL_LOG. Prints STDOUT_TEMPLATE (verbatim). Exits with EXIT_CODE.
make_stub() {
  local name="$1"
  local exit_code="${2:-0}"
  local stdout_template="${3:-}"
  local path="$STUB_BIN/$name"
  cat > "$path" <<STUB
#!/usr/bin/env bash
# Stub for $name — appends invocation to \$CALL_LOG.
printf '%s' "$name" >> "$CALL_LOG"
for a in "\$@"; do printf ' %q' "\$a" >> "$CALL_LOG"; done
printf '\n' >> "$CALL_LOG"
if [[ -n "${stdout_template}" ]]; then
  printf '%s\n' "${stdout_template}"
fi
exit ${exit_code}
STUB
  chmod +x "$path"
}

# make_stub_dynamic NAME BODY
# Same as make_stub but the caller supplies a full bash body (still gets
# the CALL_LOG line prepended). Useful when the stub needs to inspect its
# own args or reference $call_count.
make_stub_dynamic() {
  local name="$1"
  local body="$2"
  local path="$STUB_BIN/$name"
  cat > "$path" <<STUB
#!/usr/bin/env bash
printf '%s' "$name" >> "$CALL_LOG"
for a in "\$@"; do printf ' %q' "\$a" >> "$CALL_LOG"; done
printf '\n' >> "$CALL_LOG"
${body}
STUB
  chmod +x "$path"
}

# ── Assertions ──────────────────────────────────────────────────────────
assert_eq() {
  local expected="$1" actual="$2" msg="${3:-values differ}"
  if [[ "$expected" != "$actual" ]]; then
    fail "$msg (expected='$expected' actual='$actual')"
  fi
}

assert_contains() {
  local haystack="$1" needle="$2" msg="${3:-substring not found}"
  if ! printf '%s' "$haystack" | grep -qF -e "$needle"; then
    fail "$msg (needle='$needle')"
  fi
}

assert_not_contains() {
  local haystack="$1" needle="$2" msg="${3:-forbidden substring present}"
  if printf '%s' "$haystack" | grep -qF -e "$needle"; then
    fail "$msg (needle='$needle')"
  fi
}

assert_line_before() {
  local haystack="$1" first="$2" second="$3" msg="${4:-order violated}"
  local first_line second_line
  first_line=$(printf '%s' "$haystack" | grep -nF -e "$first" | head -1 | cut -d: -f1)
  second_line=$(printf '%s' "$haystack" | grep -nF -e "$second" | head -1 | cut -d: -f1)
  if [[ -z "$first_line" || -z "$second_line" ]]; then
    fail "$msg — missing marker (first='$first' second='$second')"
    return
  fi
  if (( first_line >= second_line )); then
    fail "$msg (first@$first_line, second@$second_line)"
  fi
}

fail() {
  FAILURES+=("$CURRENT_TEST: $*")
  TESTS_FAILED=$((TESTS_FAILED + 1))
}

# ── Runner ──────────────────────────────────────────────────────────────
test_case() {
  local name="$1"; shift
  CURRENT_TEST="$name"
  TESTS_RUN=$((TESTS_RUN + 1))

  # Fresh sandbox per test.
  local sandbox
  sandbox=$(mktemp -d)
  export STUB_BIN="$sandbox/bin"
  export CALL_LOG="$sandbox/calls.log"
  mkdir -p "$STUB_BIN"
  : > "$CALL_LOG"

  local prev_failed="$TESTS_FAILED"

  # Isolated PATH so the test's stubs shadow the real docker/ssh/curl,
  # but we still keep coreutils reachable.
  ORIG_PATH="$PATH"
  export PATH="$STUB_BIN:$PATH"

  # Run the test body — trap non-zero without aborting the harness.
  if ! (set +e; "$@"; exit "$TESTS_FAILED"); then
    :  # failure was already recorded via `fail`
  fi

  export PATH="$ORIG_PATH"
  rm -rf "$sandbox"

  if (( TESTS_FAILED > prev_failed )); then
    printf "${RED}✗ %s${NC}\n" "$name"
  else
    printf "${GREEN}✓ %s${NC}\n" "$name"
  fi
}

test_summary() {
  printf '\n'
  if (( TESTS_FAILED > 0 )); then
    printf "${RED}%d failure(s):${NC}\n" "$TESTS_FAILED"
    for msg in "${FAILURES[@]}"; do
      printf "  - %s\n" "$msg"
    done
    printf "${RED}%d/%d tests failed${NC}\n" "$TESTS_FAILED" "$TESTS_RUN"
    exit 1
  fi
  printf "${GREEN}%d/%d tests passed${NC}\n" "$TESTS_RUN" "$TESTS_RUN"
}
