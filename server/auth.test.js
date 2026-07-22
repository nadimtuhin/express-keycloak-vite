import test from 'node:test'
import assert from 'node:assert/strict'
import { bearer, hasRole, mapAuthError } from './auth.js'

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
