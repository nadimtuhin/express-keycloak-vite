#!/usr/bin/env bash
# Endpoint x principal status matrix against the running compose stack (needs `kcdemo-api` up).
# Used by backlog/checks.sh (CHECKS_FULL=1) and CI.
set -euo pipefail
docker exec kcdemo-api node -e '
  const mint = async (u, client = "web-app") => (await (await fetch("http://localhost:8080/realms/demo/protocol/openid-connect/token",
    {method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},
     body:new URLSearchParams({client_id:client,grant_type:"password",username:u,password:u})})).json()).access_token;
  const want = {anonymous:{public:200,user:401,admin:401}, carol:{public:200,user:403,admin:403},
                bob:{public:200,user:200,admin:403}, alice:{public:200,user:200,admin:200},
                // same realm, same user, wrong client: must not be accepted by the API
                "alice@admin-cli":{public:200,user:401,admin:401}};
  (async () => {
    const t = {anonymous:null, carol:await mint("carol"), bob:await mint("bob"), alice:await mint("alice"),
               "alice@admin-cli":await mint("alice", "admin-cli")};
    if (!t["alice@admin-cli"]) { console.log("  could not mint an admin-cli token"); process.exit(1) }
    let bad = 0;
    for (const [p, row] of Object.entries(want))
      for (const [e, code] of Object.entries(row)) {
        const r = await fetch(`http://localhost:3000/api/${e}`, {headers: t[p] ? {authorization:`Bearer ${t[p]}`} : {}});
        if (r.status !== code) { console.log(`  ${p} /api/${e}: got ${r.status}, want ${code}`); bad++; }
      }
    process.exit(bad ? 1 : 0);
  })()'
