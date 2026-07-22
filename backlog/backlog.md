# Backlog

- TASK-01 [infra] Keycloak + docker-compose network, realm-export.json (demo realm, web-app client, roles, users) — done
- TASK-02 [server] Express API: jose JWT verify, role guards, error shape — done
- TASK-03 [web] Vite SPA: login/logout, PKCE, calls to /public /user /admin — done
- TASK-04 [e2e] Playwright tests covering anon/carol/bob/alice x 3 endpoints — done

## Execution order

TASK-01 first (network + realm must exist before anything else can run).
TASK-02, TASK-03, TASK-04 touch disjoint files (server/, web/, e2e/) and can run in parallel after TASK-01.

## Gate

```
bash backlog/checks.sh              # fast: server unit tests only
CHECKS_FULL=1 bash backlog/checks.sh # + compose up, curl matrix, playwright e2e
```

Use CHECKS_FULL=1 for any task touching docker-compose.yml, realm-export.json, or cross-service contracts.

## Status

All four tasks are done. Verified from a clean slate (`docker compose down -v`):
`CHECKS_FULL=1 bash backlog/checks.sh` passes every step — unit tests, compose up --wait,
the 4x3 curl matrix, and the full 23/23 Playwright e2e suite.
