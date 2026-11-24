import express from 'express'
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { bearer, hasRole, isAccessTokenFor, mapAuthError } from './auth.js'

const { KC_ISSUER, KC_JWKS_URL, KC_CLIENT_ID, PORT = 3000 } = process.env
for (const [k, v] of Object.entries({ KC_ISSUER, KC_JWKS_URL, KC_CLIENT_ID })) {
  if (!v) { console.error(`FATAL: ${k} is not set`); process.exit(1) }
}

// ponytail: cacheMaxAge 0 => refetch JWKS per verify, so a Keycloak outage surfaces as 503
// instead of being masked by a 10-minute key cache. Raise it if this ever sees real traffic.
const JWKS = createRemoteJWKSet(new URL(KC_JWKS_URL), { cacheMaxAge: 0, timeoutDuration: 3000 })

const MESSAGES = {
  no_token: 'Missing Bearer token',
  malformed_token: 'Token could not be verified',
  wrong_client: 'Token is not an access token issued to this client',
  expired_token: 'Token expired, refresh and retry',
  bad_issuer: 'Token issued by an unexpected issuer',
  missing_role: 'Insufficient role',
  keycloak_unreachable: 'Identity provider unreachable',
  not_found: 'No such route',
  internal: 'Internal server error',
}
const fail = (res, status, code, message = MESSAGES[code]) => res.status(status).json({ error: code, message })

const requireAuth = (role) => async (req, res, next) => {
  const token = bearer(req.headers.authorization)
  if (!token) return fail(res, 401, 'no_token')
  try {
    const { payload } = await jwtVerify(token, JWKS, { issuer: KC_ISSUER, algorithms: ['RS256'] })
    // No `aud` check (Keycloak issues aud:"account" here); `azp` + `typ` pin the token to our
    // client instead, so other clients' tokens (e.g. admin-cli) and ID tokens are rejected.
    if (!isAccessTokenFor(payload, KC_CLIENT_ID)) return fail(res, 401, 'wrong_client')
    if (!hasRole(payload, role)) return fail(res, 403, 'missing_role', `Requires realm role '${role}'`)
    req.user = payload
    next()
  } catch (err) { next(err) }
}

const hello = (path) => (req, res) => res.json({
  message: `hello from ${path}`,
  user: req.user?.preferred_username ?? null,
  roles: req.user?.realm_access?.roles ?? [],
})

const app = express()
app.get('/api/public', hello('/api/public'))
app.get('/api/user', requireAuth('user'), hello('/api/user'))
app.get('/api/admin', requireAuth('admin'), hello('/api/admin'))
app.use((req, res) => fail(res, 404, 'not_found'))
app.use((err, req, res, _next) => {
  const { status, code } = mapAuthError(err)
  if (status >= 500) console.error(err)   // real error stays server-side
  fail(res, status, code)
})

app.listen(PORT, () => console.log(`api on :${PORT}, issuer ${KC_ISSUER}`))
