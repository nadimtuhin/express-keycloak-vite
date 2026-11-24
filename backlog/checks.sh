#!/usr/bin/env bash
# Repo gate — 0 failures required before "done".
#   bash backlog/checks.sh              # fast: unit tests only, no docker
#   CHECKS_FULL=1 bash backlog/checks.sh # + compose up, curl matrix, playwright
set -uo pipefail
cd "$(dirname "$0")/.."   # ponytail: not a git repo, so anchor on this script's location

fail=0
run() { local name="$1"; shift; echo "▶ $name"; if "$@"; then echo "  ✓ $name"; else echo "  ✗ FAIL: $name"; fail=$((fail+1)); fi; }

# --- inner loop ---
run "unit tests (server)" npm test --prefix server
# lint/typecheck: skipped, vanilla JS demo with no build step. Add when a framework arrives.

# --- slow tier: boundary-touching tasks only ---
if [ "${CHECKS_FULL:-0}" = "1" ]; then
  if [ ! -f docker-compose.yml ]; then
    echo "▶ full tier: SKIPPED (no docker-compose.yml yet — TASK-01 not done)"
  else
    run "compose up --wait" docker compose up -d --wait

    run "curl matrix (5 principals x 3 endpoints)" bash backlog/curl-matrix.sh
    run "playwright e2e" docker compose --profile test run --rm e2e
  fi
fi

echo
if [ "$fail" -eq 0 ]; then echo "✓ all checks passed"; else echo "✗ $fail check(s) failed"; exit 1; fi
