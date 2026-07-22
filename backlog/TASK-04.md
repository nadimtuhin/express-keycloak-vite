# TASK-04 [e2e] — full Playwright grid + outage + session coverage

Owner: <you> · Wave: rev.N · Deps: TASK-01, TASK-02, TASK-03

<context>
Server, API, and SPA are implemented and manually verified (curl matrix, real token
expiry, real Keycloak outage). This task is the Playwright layer that drives the
actual SPA in a browser against the actual docker-compose stack instead of curl,
covering the same 4-principal x 3-endpoint grid plus the outage and session-expiry
paths. Runs via `docker compose --profile test run --rm e2e` from `backlog/checks.sh`
under `CHECKS_FULL=1`. Out of scope: unit tests (TASK server work), CI wiring beyond
the compose profile.
</context>

<decisions>
- e2e runs as its own compose service/profile (`test`), not folded into api/web,
  so `docker compose up` for normal dev doesn't drag Playwright's Chromium image in.
- Everything (keycloak, api, web, e2e) shares the dedicated `net` service's network
  namespace (`network_mode: "service:net"`), so the e2e container hits `localhost:8080`,
  `:3000`, `:5173` the same way a host browser would — no service-name DNS. `net` is a
  bare alpine `sleep infinity` container that never gets recreated, so the namespace
  survives keycloak being stopped/restarted mid-test (errors.spec.js does exactly that);
  pinning the namespace to keycloak itself left every dependent container attached to a
  dead namespace after a restart.
- Login is driven through the real Keycloak login form (not direct-grant token
  injection) so the PKCE + redirect flow is what's actually exercised.
</decisions>

<preflight>
```bash
ls e2e/*.spec.js   # 0 before this task; should list auth/errors/session after
```
</preflight>

<tdd>
No pure-logic unit under test here — this is browser-driven e2e, not unit-testable
logic. `helpers.js` provides a `login(page, user, pass)` used by all three specs.
Behavior: Playwright drives the real SPA in Chromium against the real compose
stack; assertions are on rendered DOM text (`hello`, `hello/<user>`, error codes)
and, in `errors.spec.js`, on stopping/restarting the keycloak container mid-test.
</tdd>

<dod>
- [ ] pure logic unit-tested (red→green), no framework/I/O import in the tested module — N/A, no pure logic in this task (all three specs are browser-driven)
- [x] real thing exercised (e2e / request / CLI run), output pasted below
- [ ] typecheck clean, lint clean — no lint config wired for e2e/, not run
- [x] ceilings named, not gold-plated
</dod>

<ac>
- ac(workspace): `bash backlog/checks.sh` green (fast tier; full tier requires `CHECKS_FULL=1` and docker).
- ac(behavior): `docker compose --profile test run --rm e2e` → auth.spec.js asserts alice/bob/carol/anonymous see the right hello/error text per endpoint; errors.spec.js asserts expired-token and keycloak-outage error codes render; session.spec.js asserts session persists across reload and clears on logout.
- ac(gates): `CHECKS_FULL=1 bash backlog/checks.sh` → 0 failures.
</ac>

<changelog>
- e2e/Dockerfile — Playwright container for the test profile
- e2e/package.json — e2e-only deps/scripts
- e2e/playwright.config.js — baseURL http://localhost:5173, points at the shared-namespace ports
- e2e/helpers.js — shared `login(page, user, pass)` helper
- e2e/auth.spec.js — 4-principal x 3-endpoint grid via the real SPA
- e2e/errors.spec.js — expired-token and keycloak-outage paths
- e2e/session.spec.js — session persistence across reload, clears on logout

Behavior/AC proof (pasted, not described):

`docker compose --profile test run --rm e2e` → 23/23 passed. From a clean slate
(`docker compose down -v`), `CHECKS_FULL=1 bash backlog/checks.sh` also passes every
step: unit tests, `compose up --wait`, the 4x3 curl matrix, and this 23-test e2e suite.

```
anon   /public=200 hello  /user=401 no_token      /admin=401 no_token
carol  /public=200 hello  /user=403 missing_role  /admin=403 missing_role
bob    /public=200 hello  /user=200 hello/bob     /admin=403 missing_role
alice  /public=200 hello  /user=200 hello/alice   /admin=200 hello/alice
```

Real expired token -> `401 {"error":"expired_token",...}`; unknown route -> `404 not_found`
JSON; keycloak stopped + valid token -> `503 {"error":"keycloak_unreachable",...}` — the
exact scenarios errors.spec.js reproduces through the browser.

Two specs needed a technique change once run against the real browser:
- The disabled-button assertion in errors.spec.js can't use `dispatchEvent` — Playwright's
  `dispatchEvent` fires the click handler directly even when the button is disabled,
  proving nothing. It now does a real forced mouse click (`btn.click({ force: true })`)
  so the click actually has to hit a disabled element to be a valid check.
- The double-click spec in errors.spec.js holds the mocked response open for ~1.5s
  before resolving. Against localhost the API answers in ~5ms, so a naive double-click
  landed after the button had already re-enabled between clicks and the second click was
  never actually testing the disabled state.
- The back-button spec in session.spec.js lands on Keycloak's own logout redirect page,
  not the SPA, after logout — there is no `whoami` text to read there. It asserts that no
  authenticated view is restored (no username/hello text visible) rather than trying to
  read a `whoami` value that no longer exists on that page.

Ceilings (named): no lint/typecheck step exists for `e2e/` — add one only if this
directory grows past a few spec files. `accessTokenLifespan` in the realm export is 300s
for this run; the 60s value that raced `updateToken()` was reproduced and fixed once by
hand and is not re-tested on every run — lower it temporarily if the expired-token path
needs re-verifying end-to-end.
</changelog>
