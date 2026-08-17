#!/usr/bin/env bash
# Runs every *.test.sh in this directory. Bails on the first failure.
# Used by hand and by CI (see .github/workflows/ci.yml). Zero deps: pure
# bash, no bats/shellcheck required.

set -euo pipefail
IFS=$'\n\t'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exit_code=0
for test in "$SCRIPT_DIR"/*.test.sh; do
  printf '\n── %s ──\n' "$(basename "$test")"
  if ! bash "$test"; then
    exit_code=1
  fi
done

exit "$exit_code"
