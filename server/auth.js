// Pure auth core — no express, no network. Everything here is unit-tested.

export function bearer(header) {
  const [scheme, token] = String(header ?? '').split(' ')
  return scheme?.toLowerCase() === 'bearer' && token ? token : null
}

export function hasRole(payload, role) {
  return payload?.realm_access?.roles?.includes(role) ?? false
}

const NETWORK = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT'])

export function mapAuthError(err) {
  const code = err?.code
  if (code === 'ERR_JWT_EXPIRED') return { status: 401, code: 'expired_token' }
  if (code === 'ERR_JWT_CLAIM_VALIDATION_FAILED')
    return { status: 401, code: err.claim === 'iss' ? 'bad_issuer' : 'malformed_token' }
  // ERR_JOSE_GENERIC is only thrown by jose's remote JWKS fetch: non-200 or non-JSON response.
  if (code === 'ERR_JWKS_TIMEOUT' || code === 'ERR_JOSE_GENERIC' ||
      NETWORK.has(code) || NETWORK.has(err?.cause?.code))
    return { status: 503, code: 'keycloak_unreachable' }
  if (typeof code === 'string' && /^ERR_(JWT|JWS|JWK|JOSE)/.test(code))
    return { status: 401, code: 'malformed_token' }
  return { status: 500, code: 'internal' }
}

// Keycloak signs access tokens, ID tokens and other clients' tokens with the same realm key and
// `iss`, so signature + issuer alone accept all of them. Require an access token (`typ: Bearer`)
// whose authorized party is our client.
export function isAccessTokenFor(payload, clientId) {
  return Boolean(clientId) && payload?.typ === 'Bearer' && payload?.azp === clientId
}
