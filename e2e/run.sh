#!/usr/bin/env bash
# Runs the local E2E scenarios against a fresh stack (see README.md).
#   V3_DIR=../../deeptalk-api-v3 E2E_DATABASE_URL=postgresql://localhost/deeptalk_ai_dev ./run.sh [scenario…]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
export E2E_STATE="${E2E_STATE:-$HERE/.state}"
scenarios=("$@")
[ $# -eq 0 ] && scenarios=(phase2-3 limits resilience phase4-5 phase8 phase9)
status=0
for scenario in "${scenarios[@]}"; do
  case "$scenario" in
    phase2-3) export GW_EXTRA="" ;;
    limits) export GW_EXTRA="SESSION_IDLE_TIMEOUT_SECONDS=12 SESSION_ACTIVE_LIMIT_SECONDS=20 SESSION_WARNING_AT_SECONDS=10 SESSION_GRACE_SECONDS=3" ;;
    resilience) export GW_EXTRA="SESSION_IDLE_TIMEOUT_SECONDS=12" ;;
    phase4-5) export GW_EXTRA="SESSION_QUOTA_PER_MONTH=5" ;;
    phase8) export GW_EXTRA="" ;;
    phase9) export GW_EXTRA="SESSION_QUOTA_PER_MONTH=10" ;;
    load) export GW_EXTRA="SESSION_QUOTA_PER_MONTH=1000 RATE_LIMIT_MESSAGES_PER_MINUTE=120" LOAD_USERS="${LOAD_USERS:-50}" ;;
    *) echo "unknown scenario: $scenario" >&2; exit 2 ;;
  esac
  echo "== $scenario"
  "$HERE/stack.sh" up
  node "$HERE/$scenario.mjs" || status=1
done
"$HERE/stack.sh" down
exit $status
