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

    curl_matrix() {
      docker exec kcdemo-api node -e '
        const mint = async (u) => (await (await fetch("http://localhost:8080/realms/demo/protocol/openid-connect/token",
          {method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},
           body:new URLSearchParams({client_id:"web-app",grant_type:"password",username:u,password:u})})).json()).access_token;
        const want = {anonymous:{public:200,user:401,admin:401}, carol:{public:200,user:403,admin:403},
                      bob:{public:200,user:200,admin:403}, alice:{public:200,user:200,admin:200}};
        (async () => {
          const t = {anonymous:null, carol:await mint("carol"), bob:await mint("bob"), alice:await mint("alice")};
          let bad = 0;
          for (const [p, row] of Object.entries(want))
            for (const [e, code] of Object.entries(row)) {
              const r = await fetch(`http://localhost:3000/api/${e}`, {headers: t[p] ? {authorization:`Bearer ${t[p]}`} : {}});
              if (r.status !== code) { console.log(`  ${p} /api/${e}: got ${r.status}, want ${code}`); bad++; }
            }
          process.exit(bad ? 1 : 0);
        })()'
    }
    run "curl matrix (4 principals x 3 endpoints)" curl_matrix
    run "playwright e2e" docker compose --profile test run --rm e2e
  fi
fi

echo
if [ "$fail" -eq 0 ]; then echo "✓ all checks passed"; else echo "✗ $fail check(s) failed"; exit 1; fi
