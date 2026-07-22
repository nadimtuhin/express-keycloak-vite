# TASK-03 [web] — Vite SPA with PKCE login and full FE error handling

Owner: <you> · Wave: rev.1 · Deps: TASK-01

<context>
web/ is a Vite SPA that talks to the API through `/api` (proxied to `http://localhost:3000` since
all services attach to the dedicated `net` container's namespace, not keycloak's). It uses
keycloak-js for PKCE login and calls /api/public, /api/user, /api/admin, rendering status + body
for each. Out of scope: any server code, realm config.
</context>

<decisions>
- `onLoad: 'check-sso'` (not `login-required`): the page must render logged-out state and prove the
  anonymous 401 path works, so it can't force a redirect on load.
- `silentCheckSsoRedirectUri` -> `web/public/silent-check-sso.html`, a static page that just does
  `parent.postMessage(location.href, location.origin)` — avoids a full page reload for the SSO
  check iframe.
- `checkLoginIframe: false` in `keycloak.init()`. Cause: with it on, `updateToken()` waits on a
  hidden Keycloak iframe that never answers once Keycloak is down (proven by the outage e2e specs
  that stop keycloak mid-session), so the request hung forever instead of surfacing the API's 503.
  Ceiling: no cross-tab logout detection.
- `updateToken()` is wrapped in a `withTimeout()` helper capping it at 5s. Cause: keycloak-js has no
  built-in request timeout, so a hung IdP (same outage scenario) would otherwise leave the calling
  button disabled forever. On timeout the call renders "auth unavailable, try again" instead of
  spinning.
- The "Log in" button starts `disabled` in index.html and is enabled only in the `.then()` of
  `keycloak.init()`. Cause: previously it was clickable while init was still in flight and no-opped
  silently. The user/admin API buttons are deliberately NOT gated this way — they stay enabled
  while logged out (only disabled mid-request) so the anonymous 401 fail-closed response stays
  visible in the UI.
- Auth failure at init (Keycloak down/misconfigured) shows a banner ("auth unavailable — public
  endpoint still works") but does not block the public button.
- Token refresh: `keycloak.updateToken(30)` (wrapped in the 5s timeout above) is attempted before
  every authed call; if it fails (refresh token dead) or times out, the button call bails out with
  "session expired, log in again" / "auth unavailable, try again" and clears identity instead of
  firing a request doomed to 401.
- Response parsing: always try JSON first (`{error, message}` shape from the API); fall back to
  `res.statusText` if the body isn't JSON. A non-JSON 5xx (`res.status >= 500` with an unparseable
  body) is treated as "API unreachable" too. Cause: Vite's dev proxy answers a dead API with an
  empty-body 500, so `fetch` resolves instead of throwing and the network-error `catch` branch
  never ran — this had to be special-cased or a dead API rendered as a bare non-JSON status.
</decisions>

<preflight>
```bash
grep -rn "check-sso" web/src/main.js   # 0 before this task existed
```
</preflight>

<tdd>
No pure-logic unit under test here — `main.js` is DOM wiring + keycloak-js glue, not extractable
pure logic worth isolating for this task.
Behavior: e2e via Playwright (`e2e/*.js`) and manual browser runs against the real stack, asserting
the visible `data-testid` markers (`whoami`, `roles`, `public-result`, `user-result`,
`admin-result`, `banner`) match expected status/body per auth state.
</tdd>

<dod>
- [ ] pure logic unit-tested (red→green), no framework/I/O import in the tested module
- [x] real thing exercised (e2e / request / CLI run), output pasted below
- [ ] typecheck clean, lint clean — no typecheck/lint configured in web/package.json (ceiling, see below)
- [x] ceilings named, not gold-plated

</dod>

<ac>
- ac(workspace): `bash backlog/checks.sh` green. Run tests on the runtime the repo pins, not the shell default.
- ac(behavior): drive the running SPA as alice/bob/carol/anon and click GET /public, /user, /admin →
  `*-result` panels show the matching status/body below.
- ac(gates): `bash backlog/checks.sh` → 0 failures (`CHECKS_FULL=1` when a boundary/packaging/flow was touched).
</ac>

<changelog>
- web/index.html — page markup, data-testid markers for banner/whoami/roles/login/logout/results.
- web/src/main.js — keycloak-js init (check-sso, PKCE S256), callApi() with token refresh + error
  rendering, identity rendering.
- web/vite.config.js — dev server proxies /api to localhost:3000.
- web/public/silent-check-sso.html — silent SSO check iframe target.
- web/package.json — keycloak-js + vite deps, dev/build scripts.

Behavior/AC proof (pasted, not described — measured against the running stack through the SPA's
own API paths):
```
anon   /public=200 hello  /user=401 no_token      /admin=401 no_token
carol  /public=200 hello  /user=403 missing_role  /admin=403 missing_role
bob    /public=200 hello  /user=200 hello/bob     /admin=403 missing_role
alice  /public=200 hello  /user=200 hello/alice   /admin=200 hello/alice
```
alice token iss = http://localhost:8080/realms/demo, roles [admin, user] — confirms `roles` panel
renders the real realm_access.roles claim.

Ceilings (named):
- No typecheck/lint in web/package.json — plain JS, no ESLint/TS config wired up. Upgrade path: add
  `tsc --checkJs` or an ESLint config if the SPA grows past this hello-world scope.
- No unit tests for main.js — it's thin DOM/keycloak-js wiring, not pure logic; correctness is
  proven by e2e against the real stack instead.
- keycloak.init() failure path (auth unavailable banner) verified by code reading + Keycloak-stopped
  503 proof at the API layer, not separately re-run against the SPA in this pass.
</changelog>
</content>
