# TASK-01 [infra] — compose, one URL scheme, realm seed

Owner: <you> · Wave: rev.1 · Deps: none

<context>
Keycloak, the API, and the SPA need to agree on one issuer/redirect URL scheme or token
validation and PKCE redirects break. This task is the docker-compose + .env + realm seed that
makes that true, plus a README describing it. Out of scope: API route logic, SPA auth code,
e2e tests (later tasks).
</context>

<decisions>
- Seam: a dedicated `net` service (alpine, `sleep infinity`, container_name `kcdemo-net`)
  publishes 8080/3000/5173 and owns the shared network namespace; keycloak/api/web/e2e all
  join it via `network_mode: "service:net"`. Keycloak is deliberately NOT the namespace owner
  anymore. Locked because compose recreating keycloak previously stranded every dependent
  container on the OLD, dead network namespace — they could still reach each other, but the
  published ports had moved to keycloak's new sandbox, so the host (and any freshly started
  container) saw nothing on 3000/5173. The e2e outage specs stop keycloak on purpose, so the
  namespace owner has to be something that never restarts. Rejected: a normal compose bridge
  network with service names (`http://keycloak:8080`) — works container-to-container but the
  host browser can never resolve `keycloak`, so the SPA and issuer strings would diverge.
  Rejected (superseded): keycloak itself as namespace owner — see failure above.
  Cost accepted: only `net` may publish ports; services cannot address each other by
  container name.
- Healthcheck for keycloak uses `bash /dev/tcp` against `/realms/demo`, not `wget`/`curl` (image
  ships neither) and not `/health/ready` (`--import-realm` can finish after health goes ready).
  Matching `"realm":"demo"` in the response body is the actual signal the realm import landed.
- Users need `firstName`/`lastName` and `requiredActions: []` in the realm export, otherwise
  Keycloak's `VERIFY_PROFILE` required action fires and direct grant fails with "Account is not
  fully set up" — hit for real during the build, fixed by setting both fields. Trap: it's easy
  to add a user with just username/password and forget these two, and the failure only shows
  up as a cryptic direct-grant error, not a schema/import error.
- Contract: realm `demo`, public client `web-app` (PKCE S256, direct grant enabled), realm
  roles `admin` + `user`. Users: alice/alice (admin+user), bob/bob (user), carol/carol (no
  demo roles). `accessTokenLifespan: 300` (seconds) — raised from an initial 60, which raced
  keycloak-js's `updateToken()` during the e2e outage specs. The expired-token path was proven
  once by hand at 60s; lower it temporarily if that path needs re-testing.
</decisions>

<preflight>
```bash
# before this task: no compose file, no running stack
test -f docker-compose.yml && echo "compose exists" || echo "0 compose file"
docker ps --filter name=kcdemo-keycloak --format '{{.Names}}'   # 0 matches before
```
</preflight>

<tdd>
No pure unit logic here — this is infra/config. The check is behavioral: bring the stack up,
hit the running Keycloak realm endpoint, confirm the seeded realm/client/users/roles exist as
declared.
Behavior: `curl -s http://localhost:8080/realms/demo | grep '"realm":"demo"'` and a direct-grant
token request for alice/bob/carol against `web-app` asserts the realm import applied.
</tdd>

<dod>
- [x] real thing exercised (stack brought up, Keycloak hit directly), output pasted below
- [x] ceilings named, not gold-plated
- [ ] pure logic unit-tested (red→green) — n/a, no pure logic in this task
- [ ] typecheck clean, lint clean — n/a, no app code touched
- [ ] README.md written — not yet present in the repo; still to be authored

</dod>

<ac>
- ac(workspace): `bash backlog/checks.sh` green. Run tests on the runtime the repo pins, not the shell default.
- ac(behavior): `docker compose up -d keycloak && curl -s http://localhost:8080/realms/demo` → realm JSON containing `"realm":"demo"` appears once the healthcheck reports healthy.
- ac(gates): `bash backlog/checks.sh` → 0 failures (`CHECKS_FULL=1` when a boundary/packaging/flow was touched).
</ac>

<changelog>
- docker-compose.yml: added a dedicated `net` service (alpine, sleep infinity, kcdemo-net) that
  owns the shared network namespace and publishes 8080/3000/5173; keycloak/api/web/e2e all use
  `network_mode: "service:net"` instead of joining keycloak's namespace. Per-service
  healthchecks, named volumes for node_modules unchanged.
- .env: KC_BOOTSTRAP_ADMIN_USERNAME/PASSWORD, KC_HOSTNAME=http://localhost:8080, KC_HEALTH_ENABLED, KC_ISSUER, VITE_KC_URL/REALM/CLIENT, COMPOSE_PROJECT_NAME.
- keycloak/realm-export.json: realm `demo`, client `web-app` (PKCE S256, direct grant), roles
  admin/user, users alice/bob/carol with firstName/lastName/requiredActions:[] set,
  accessTokenLifespan 300 (raised from 60 — see decisions).
- README.md: not yet written.

Behavior/AC proof (pasted, not described):
```
anon   /public=200 hello  /user=401 no_token      /admin=401 no_token
carol  /public=200 hello  /user=403 missing_role  /admin=403 missing_role
bob    /public=200 hello  /user=200 hello/bob     /admin=403 missing_role
alice  /public=200 hello  /user=200 hello/alice   /admin=200 hello/alice
```
alice token `iss` = `http://localhost:8080/realms/demo`, roles `[admin, user]` — confirms the
one-URL-scheme decision and the realm seed both work as declared.

Ceilings (named): ephemeral H2 (state lost on container recreate) — fine for a demo, upgrade
path is a postgres service + `KC_DB=postgres` env if persistence is ever needed. No TLS
(`sslRequired: none`) — fine for localhost-only demo, would need `KC_HOSTNAME` scheme change +
real certs for anything beyond localhost. README.md does not exist yet in this repo; still
needs to be authored to close this task's DoD fully.
</changelog>
