#!/usr/bin/env bash
# Rollback wrapper — re-runs deploy.sh with a caller-supplied previous tag.
# Exists as a thin shim so `deploy.sh` stays single-purpose (deploy one
# specific tag, in one specific order) and the rollback contract is
# explicit: rollback == "deploy the last-known-good tag again".
#
# Usage on the box (as the deploy user):
#   ./infra/scripts/rollback.sh v1.4.1
#
# Usage via CI:
#   .github/workflows/deploy.yml auto-invokes this path on readiness
#   failure by dispatching itself with `tag=<previous>` — no separate
#   rollback workflow needed.
#
# Contract: identical to deploy.sh, plus TAG is read from $1. All other
# env vars pass through untouched (READINESS_URL, COMPOSE_FILE, timeouts).

set -euo pipefail
IFS=$'\n\t'

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <previous-tag>" >&2
  exit 1
fi

previous="$1"
if [[ -z "$previous" ]]; then
  echo "ERROR: previous tag is empty" >&2
  exit 1
fi

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

echo "[rollback] Redeploying previous tag: ${previous}"
TAG="$previous" exec "${script_dir}/deploy.sh"
