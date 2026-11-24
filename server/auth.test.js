import test from 'node:test'
import assert from 'node:assert/strict'
import { bearer, hasRole, isAccessTokenFor, mapAuthError } from './auth.js'

test('bearer', () => {
  assert.equal(bearer(undefined), null)
  assert.equal(bearer(''), null)
  assert.equal(bearer('Basic xyz'), null)
  assert.equal(bearer('Bearer'), null)
  assert.equal(bearer('Bearer abc'), 'abc')
  assert.equal(bearer('bearer abc'), 'abc')
})

test('hasRole', () => {
  assert.equal(hasRole({}, 'user'), false)                       // must not throw
  assert.equal(hasRole({ realm_access: {} }, 'user'), false)
  assert.equal(hasRole({ realm_access: { roles: ['user'] } }, 'user'), true)
  assert.equal(hasRole({ realm_access: { roles: ['user'] } }, 'admin'), false)
  assert.equal(hasRole(null, 'user'), false)
})

test('mapAuthError', () => {
  const e = (code, extra = {}) => Object.assign(new Error(code), { code, ...extra })
  assert.deepEqual(mapAuthError(e('ERR_JWT_EXPIRED')), { status: 401, code: 'expired_token' })
  assert.deepEqual(mapAuthError(e('ERR_JWT_CLAIM_VALIDATION_FAILED', { claim: 'iss' })),
    { status: 401, code: 'bad_issuer' })
  assert.deepEqual(mapAuthError(e('ERR_JWT_CLAIM_VALIDATION_FAILED', { claim: 'sub' })),
    { status: 401, code: 'malformed_token' })
  assert.deepEqual(mapAuthError(e('ERR_JWS_SIGNATURE_VERIFICATION_FAILED')),
    { status: 401, code: 'malformed_token' })
  assert.deepEqual(mapAuthError(e('ERR_JWT_INVALID')), { status: 401, code: 'malformed_token' })
  assert.deepEqual(mapAuthError(e('ERR_JWKS_NO_MATCHING_KEY')),
    { status: 401, code: 'malformed_token' })

  // an IdP outage must NOT look like a bad token, or users re-login forever against a corpse
  assert.deepEqual(mapAuthError(e('ERR_JWKS_TIMEOUT')), { status: 503, code: 'keycloak_unreachable' })
  assert.deepEqual(mapAuthError(Object.assign(new TypeError('fetch failed'),
    { cause: { code: 'ECONNREFUSED' } })), { status: 503, code: 'keycloak_unreachable' })
  assert.deepEqual(mapAuthError(e('ECONNREFUSED')), { status: 503, code: 'keycloak_unreachable' })

  assert.deepEqual(mapAuthError(new Error('boom')), { status: 500, code: 'internal' })
  assert.deepEqual(mapAuthError(null), { status: 500, code: 'internal' })
})

test('mapAuthError: JWKS endpoint up but not serving keys is an outage, not a bad token', () => {
  // jose throws a generic JOSEError when the JWKS answers non-200 (e.g. Keycloak 502/503 while
  // booting, or the realm is missing) or returns something that isn't JSON.
  const generic = (msg) => Object.assign(new Error(msg), { code: 'ERR_JOSE_GENERIC' })
  assert.deepEqual(mapAuthError(generic('Expected 200 OK from the JSON Web Key Set HTTP response')),
    { status: 503, code: 'keycloak_unreachable' })
  assert.deepEqual(mapAuthError(generic('Failed to parse the JSON Web Key Set HTTP response as JSON')),
    { status: 503, code: 'keycloak_unreachable' })
})

test('isAccessTokenFor: only access tokens issued to our client are accepted', () => {
  assert.equal(isAccessTokenFor({ typ: 'Bearer', azp: 'web-app' }, 'web-app'), true)
  // same realm, different client (e.g. admin-cli password grant) — must not pass
  assert.equal(isAccessTokenFor({ typ: 'Bearer', azp: 'admin-cli' }, 'web-app'), false)
  // ID tokens are RS256-signed by the same realm key with the same `iss`
  assert.equal(isAccessTokenFor({ typ: 'ID', azp: 'web-app' }, 'web-app'), false)
  assert.equal(isAccessTokenFor({ azp: 'web-app' }, 'web-app'), false)
  assert.equal(isAccessTokenFor({ typ: 'Bearer' }, 'web-app'), false)
  assert.equal(isAccessTokenFor(null, 'web-app'), false)
  assert.equal(isAccessTokenFor({ typ: 'Bearer', azp: undefined }, undefined), false)
})
