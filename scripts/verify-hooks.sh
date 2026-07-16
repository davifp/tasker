#!/usr/bin/env bash
# Smoke-test each Git hook failure path.
# Runs from the monorepo root; does not require an active git commit context.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PASS=0
FAIL=0
SKIP=0

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC} $1"; PASS=$((PASS + 1)); }
fail() { echo -e "  ${RED}✗${NC} $1"; FAIL=$((FAIL + 1)); }
skip() { echo -e "  ${YELLOW}–${NC} $1 (skipped)"; SKIP=$((SKIP + 1)); }
section() { echo -e "\n${YELLOW}══${NC} $1"; }

# Fixtures must live inside the project root so ESLint flat config picks them up.
# Use a single temp directory so EXIT trap can delete it atomically (subshell
# assignments in $(...) would not propagate back to the parent array).
TMP_DIR="$(mktemp -d "${ROOT}/.verify-hook-XXXXXX")"
cleanup() { rm -rf "$TMP_DIR" 2>/dev/null || true; }
trap cleanup EXIT

tmp_file() {
  mktemp "${TMP_DIR}/fixture-XXXXXX.${1:-ts}"
}

# ── 1. Commitlint: bad messages must be rejected ──────────────────────────────
section "1. Commitlint — bad messages"

BAD_MSGS=(
  "wip"
  "Update stuff"
  "fix"
  "added feature"
  "HOTFIX: urgent thing"
)
for msg in "${BAD_MSGS[@]}"; do
  if echo "$msg" | pnpm commitlint --quiet 2>/dev/null; then
    fail "should reject: '$msg'"
  else
    ok "rejects: '$msg'"
  fi
done

# ── 2. Commitlint: valid Conventional Commits must pass ───────────────────────
section "2. Commitlint — valid messages"

GOOD_MSGS=(
  "feat: add login page"
  "fix(auth): handle token expiry"
  "chore: update deps"
  "docs: clarify README"
  "refactor(api): extract health helper"
  "test: cover error filter edge cases"
)
for msg in "${GOOD_MSGS[@]}"; do
  if echo "$msg" | pnpm commitlint --quiet 2>/dev/null; then
    ok "accepts: '$msg'"
  else
    fail "incorrectly rejects: '$msg'"
  fi
done

# ── 3. ESLint: bad TypeScript must be flagged ─────────────────────────────────
section "3. ESLint — bad TypeScript flagged"

BAD_TS="$(tmp_file ts)"
cat > "$BAD_TS" <<'TSEOF'
const unused = 42;
export {};
TSEOF

if pnpm eslint "$BAD_TS" --quiet 2>/dev/null; then
  fail "ESLint did not flag unused variable"
else
  ok "ESLint flags unused variable"
fi

GOOD_TS="$(tmp_file ts)"
cat > "$GOOD_TS" <<'TSEOF'
export const greeting = "hello";
TSEOF

if pnpm eslint "$GOOD_TS" --quiet 2>/dev/null; then
  ok "ESLint passes clean TypeScript"
else
  fail "ESLint incorrectly rejected clean TypeScript"
fi

# ── 4. Prettier: malformed file must require formatting ───────────────────────
section "4. Prettier — format check"

UNFORMATTED="$(tmp_file ts)"
printf 'const x=1\nexport {x}' > "$UNFORMATTED"

if pnpm prettier --check --ignore-path /dev/null "$UNFORMATTED" 2>/dev/null; then
  fail "Prettier did not flag unformatted file"
else
  ok "Prettier flags unformatted file"
fi

FORMATTED="$(tmp_file ts)"
printf 'const x = 1;\nexport { x };\n' > "$FORMATTED"

if pnpm prettier --check --ignore-path /dev/null "$FORMATTED" 2>/dev/null; then
  ok "Prettier passes formatted file"
else
  fail "Prettier incorrectly rejected formatted file"
fi

# ── 5. Coverage gate ──────────────────────────────────────────────────────────
section "5. Coverage gate script"

if [ -f backend/coverage/coverage-summary.json ] || [ -f frontend/coverage/coverage-summary.json ]; then
  if node scripts/check-coverage.mjs; then
    ok "coverage thresholds met"
  else
    fail "coverage below threshold (run: pnpm test:cov)"
  fi
else
  skip "no coverage data — run 'pnpm test:cov' first, then re-run this script"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "Results: ${GREEN}${PASS} passed${NC}  ${RED}${FAIL} failed${NC}  ${YELLOW}${SKIP} skipped${NC}"

[ "$FAIL" -eq 0 ] || exit 1
