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
  if (code === 'ERR_JWKS_TIMEOUT' || NETWORK.has(code) || NETWORK.has(err?.cause?.code))
    return { status: 503, code: 'keycloak_unreachable' }
  if (typeof code === 'string' && /^ERR_(JWT|JWS|JWK|JOSE)/.test(code))
    return { status: 401, code: 'malformed_token' }
  return { status: 500, code: 'internal' }
}
