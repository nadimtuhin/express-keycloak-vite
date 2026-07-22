# express-keycloack-vite

Hello-world demo of Keycloak-protected routes: a Vite SPA gets tokens via PKCE from Keycloak,
an Express API verifies them statelessly with `jose`, and role checks gate three endpoints
(`public`, `user`, `admin`). Everything runs from one `docker compose up`.

## Quick start

```bash
docker compose up -d --wait
```

Open http://localhost:5173. Log in as one of:

- `alice` / `alice` — realm roles `admin`, `user`
- `bob` / `bob` — realm role `user`
- `carol` / `carol` — no demo roles

## What to click, what you should see

- **Not logged in**: "Log in" starts disabled and enables only once `keycloak.init()` resolves —
  it used to no-op silently while init was still in flight. Click "Public" → `hello from
  /api/public`. The "User" and "Admin" buttons stay enabled (deliberately — see below) but return
  `401 no_token` when clicked.
- **carol**: Public works. User and Admin both return `403 missing_role`.
- **bob**: Public and User work (`hello from /api/user`, user `bob`). Admin returns `403 missing_role`.
- **alice**: All three work. Admin returns `hello from /api/admin`, user `alice`.

The SPA keeps the authed buttons enabled while logged out instead of disabling them. That's on
purpose: it makes the anonymous 401 fail-closed path visible in the UI. Buttons only disable
while a request is in flight.

Access tokens expire in 300s (`accessTokenLifespan: 300` in the realm). It was 60s during
development, which raced `keycloak-js`'s `updateToken()` during the outage e2e specs; the
`expired_token` path was verified by hand at 60s once, and you can lower it again temporarily to
re-test. You won't see `expired_token` in the UI, because the SPA calls
`keycloak.updateToken(30)` before each authed request and silently refreshes (capped at 5s — see
below). To see it, hold a raw token past its expiry and curl the API yourself.

## Endpoint / role table

| Endpoint      | Role required | anonymous | carol | bob | alice |
|---------------|---------------|-----------|-------|-----|-------|
| `/api/public` | none          | 200       | 200   | 200 | 200   |
| `/api/user`   | `user`        | 401       | 403   | 200 | 200   |
| `/api/admin`  | `admin`       | 401       | 403   | 403 | 200   |

Measured directly against the running stack, not inferred.

## Error codes

| code                   | HTTP | when |
|------------------------|------|------|
| `no_token`             | 401  | no `Authorization: Bearer` header |
| `malformed_token`      | 401  | signature/claims invalid, not expired |
| `expired_token`        | 401  | token past `exp` |
| `bad_issuer`           | 401  | `iss` doesn't match `KC_ISSUER` |
| `missing_role`         | 403  | valid token, lacks the required realm role |
| `keycloak_unreachable` | 503  | JWKS fetch fails (network error or timeout) |
| `not_found`            | 404  | unknown route |
| `internal`             | 500  | anything unclassified |

Every response is `{"error": <code>, "message": <human string>}`.

## Running tests

```bash
bash backlog/checks.sh              # fast: server unit tests only, no docker
CHECKS_FULL=1 bash backlog/checks.sh  # + compose up --wait, a curl matrix over 4 principals x 3 endpoints, and the e2e suite
```

Or run just the e2e suite (Playwright, in its own container):

```bash
docker compose --profile test run --rm e2e
```

## Architecture decisions

**Shared network namespace, owned by a dedicated `net` service** (`network_mode: "service:net"`
on `keycloak`, `api`, `web`, `e2e`). `localhost:8080` / `:3000` / `:5173` mean the same thing on
the host and inside every container, so the SPA's redirect URIs and the e2e browser's URLs don't
need per-environment rewriting. `net` is a bare `alpine` container running `sleep infinity` that
does nothing but hold the namespace and publish the ports. Keycloak must not own it: when compose
recreated `keycloak`, every dependent container stayed attached to the old, dead namespace — they
could still reach each other, but the published ports had moved to the new sandbox, so the host
and any new container saw nothing on 3000/5173. The e2e outage specs also stop Keycloak on
purpose, so the namespace owner has to be something that never gets recreated. Cost: only `net`
may publish ports, and services can't reach each other by container name — everything talks over
`localhost`, which is unusual for compose and will confuse anyone expecting DNS-based service
discovery.

**Stateless JWT verification** (`jose`, `createRemoteJWKSet`, no session, no server-side token
store). The API never touches Keycloak except to fetch signing keys. Cost: revocation is not
instant — a token stays valid until it expires, since there's no server-side check against
Keycloak's session state. `cacheMaxAge: 0` means the JWKS is refetched on every verify (so an
outage surfaces as `503 keycloak_unreachable` instead of a silently stale key), but that also
means every request costs one round trip to Keycloak — fine for a demo, not for production
request volume.

**Realm imported from JSON** (`keycloak/realm-export.json`, `start-dev --import-realm`, ephemeral
H2 database). Reproducible from a clean `docker compose down -v`. Cost: no persistence — restart
with the volume dropped and every user/session is gone. Also: Keycloak's `--import-realm` skips
the import if a realm with that name already exists, which bites people who add a Postgres volume
without also handling re-import (see Troubleshooting).

**No `aud` check**. `jwtVerify` checks `issuer` and `algorithms: ['RS256']` only, not audience.
Cost: this is only safe because there is exactly one public client (`web-app`) and Keycloak's
default `aud` is `"account"` for it. Add an `audience` option to `jwtVerify` before introducing a
second client — otherwise a token minted for a different client would still pass verification here.

**`checkLoginIframe: false`** in `keycloak.init()`. Without it, `updateToken()` waits on a hidden
Keycloak iframe that never answers when Keycloak is down, so the request hung forever instead of
surfacing the API's `503`. The SPA also caps `updateToken()` itself with a 5s timeout
(`withTimeout` helper) so a hung IdP can never leave a button disabled forever — on timeout it
renders "auth unavailable, try again". Ceiling: no cross-tab logout detection.

## Troubleshooting

**Stale network namespace after `keycloak` is recreated/restarted.** If anything other than
`net` owned the shared namespace, recreating `keycloak` would leave `api`/`web`/`e2e` attached to
the old, dead namespace: they could still reach each other, but the published ports moved to
the new sandbox, so the host and any new container saw nothing on `3000`/`5173`. This is why
`net` is a separate, never-recreated service — if you ever see ports "go dark" after a partial
`docker compose up`, check which service actually owns `network_mode: "service:..."`.

**Port 8080 already in use / wrong server answers on localhost:8080.** A stray unrelated
process on the host can already be bound to 8080, shadowing Docker's port mapping. Check with
`lsof -i :8080` before assuming Keycloak is broken; kill or reassign the other process, not
Keycloak's port mapping.

**Import skipped if the realm already exists.** `--import-realm` only imports on a realm that
doesn't yet exist. If you add a volume for Keycloak's own database (e.g. switching off the
ephemeral H2 store), a stale `demo` realm from a previous run will silently block re-import of
`keycloak/realm-export.json`. Drop the volume (`docker compose down -v`) to force a clean import.

## Not for production

This is a hello-world demo. Deliberately missing:

- **Postgres** — Keycloak runs on ephemeral H2. No persistence across restarts.
- **HTTPS** — everything is plain HTTP on `localhost`.
- **Real secrets** — `.env` ships an admin password of `admin` and demo user passwords equal to
  their usernames, committed in the repo.
- **`aud` validation** — see above; required once there's more than one client.
- **Production Keycloak start mode** — `start-dev`, not `start` (dev mode disables some hardening
  and is explicitly unsupported for production by Keycloak).
- **`docker.sock` mounted into the `e2e` service** — grants that container root-equivalent
  control of the host's Docker daemon. Acceptable for a local, trusted dev machine. Must never
  run in CI or any shared environment.
