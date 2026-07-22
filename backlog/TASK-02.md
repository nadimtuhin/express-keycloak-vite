# TASK-02 [api] — JWT verify + role gate + error surface (TDD)

Owner: <you> · Wave: rev.N · Deps: TASK-01

<context>
Express 5 API sits behind Keycloak. Needs to verify RS256 access tokens against the realm JWKS,
gate two protected routes by realm role, and turn every failure mode (missing token, malformed
token, expired token, wrong issuer, missing role, Keycloak down) into a stable JSON error shape.
Pure verification/mapping logic is isolated in auth.js so it can be unit-tested without a network
or a running Keycloak. Wiring (express app, JWKS fetch, route handlers) lives in index.js.
Out of scope: audience (`aud`) validation — single public client, not needed yet.
</context>

<decisions>
- Seam: auth.js holds pure functions (bearer, hasRole, mapAuthError) with zero express/network
  imports; index.js does all I/O (JWKS fetch, jwtVerify, req/res). This is the expensive-to-move
  boundary — keeping auth.js pure is what makes it unit-testable without Docker/Keycloak.
- createRemoteJWKSet uses cacheMaxAge: 0 (refetch JWKS every verify) so a Keycloak outage surfaces
  as 503 keycloak_unreachable instead of being masked by the default 10-minute key cache. Rejected
  the default cache — correctness for outage-visibility over per-request latency.
- No `aud` claim check — only jwtVerify(issuer, algorithms:['RS256']). Contract: single public
  client "web-app", Keycloak issues aud:"account" for it. Add `audience` before multi-client use.
- Error contract: `{error: <code>, message: <string>}` on every failure, codes fixed to
  no_token(401), malformed_token(401), expired_token(401), bad_issuer(401), missing_role(403),
  keycloak_unreachable(503), not_found(404), internal(500).
- requireAuth(role) is an express middleware factory returning an async handler; unknown/500-class
  errors are logged server-side only, never leaked into the JSON message.
</decisions>

<preflight>
```bash
# before this task, auth.js did not exist — no pure JWT/role logic to unit-test
test -f server/auth.js && echo "exists" || echo "missing"   # missing, before
```
</preflight>

<tdd>
`server/auth.test.js` — bearer(): valid "Bearer x" → token, "Basic x"/"" /undefined/"Bearer" (no
token) → null, case-insensitive scheme. hasRole(): missing realm_access/roles/null payload → false
(must not throw), role present/absent → true/false. mapAuthError(): ERR_JWT_EXPIRED → expired_token,
ERR_JWT_CLAIM_VALIDATION_FAILED(claim=iss) → bad_issuer, same error with claim=sub → malformed_token,
generic JOSE/JWS/JWT/JWK codes → malformed_token, ERR_JWKS_TIMEOUT / ECONNREFUSED / cause.code
ECONNREFUSED → keycloak_unreachable (503, not 401 — an IdP outage must not look like a bad token),
unknown error / null → internal. Red (right reason: functions didn't exist) → green.
Behavior: real running stack, curl'd as anon/carol/bob/alice against /api/public, /api/user,
/api/admin — asserts exact status code + error code per user/route pairing.
</tdd>

<dod>
- [x] pure logic unit-tested (red→green), no framework/I/O import in the tested module — auth.js
      imports nothing from express or jose; auth.test.js only imports auth.js
- [x] real thing exercised (e2e / request / CLI run), output pasted below — curl matrix against a
      running docker-compose stack for anon/carol/bob/alice
- [ ] typecheck clean, lint clean — no tsc/eslint config wired for server/ in this repo; not run
- [x] ceilings named, not gold-plated — see below
</dod>

<ac>
- ac(workspace): `bash backlog/checks.sh` green. Run tests on the runtime the repo pins, not the shell default.
- ac(behavior): `node --test server/` → all auth.test.js cases pass; curl matrix below shows the
  live status/error-code behavior per user/route.
- ac(gates): `bash backlog/checks.sh` → 0 failures (`CHECKS_FULL=1` when a boundary/packaging/flow was touched).
</ac>

<changelog>
- server/auth.js — pure bearer(), hasRole(), mapAuthError() (new)
- server/auth.test.js — node:test unit coverage for the three pure functions (new)
- server/index.js — express app: /api/public, /api/user (role user), /api/admin (role admin),
  requireAuth middleware factory, JWKS via createRemoteJWKSet(cacheMaxAge: 0), fail() JSON error
  helper, 404 handler, error-mapping middleware (new)
- server/package.json — express ^5.1.0, jose ^6.1.0 deps, `test` script → `node --test` (new)

Behavior/AC proof (pasted, not described), measured against the running stack:
```
anon   /public=200 hello  /user=401 no_token      /admin=401 no_token
carol  /public=200 hello  /user=403 missing_role  /admin=403 missing_role
bob    /public=200 hello  /user=200 hello/bob     /admin=403 missing_role
alice  /public=200 hello  /user=200 hello/alice   /admin=200 hello/alice

alice token iss = http://localhost:8080/realms/demo, roles [admin, user]

real expired token:
401 {"error":"expired_token","message":"Token expired, refresh and retry"}

unknown route:
404 {"error":"not_found","message":"No such route"}

keycloak stopped + valid token:
503 {"error":"keycloak_unreachable","message":"Identity provider unreachable"}
```

Ceilings (named): no `aud` claim check (single public client only — add `audience` option before
multi-client use); no typecheck/lint pass wired for server/ (not run, not verified in this task);
no rate limiting or brute-force protection on the auth routes; JWKS cacheMaxAge:0 trades latency
for outage-visibility — raise it if this ever sees real traffic.
</changelog>
