import Keycloak from 'keycloak-js'

const $ = (id) => document.querySelector(`[data-testid="${id}"]`)
const banner = (text) => { const b = $('banner'); b.textContent = text; b.hidden = !text }

const keycloak = new Keycloak({
  url: import.meta.env.VITE_KC_URL,
  realm: import.meta.env.VITE_KC_REALM,
  clientId: import.meta.env.VITE_KC_CLIENT,
})

// Rejects with {timedOut: true} if the promise hasn't settled in time.
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(Object.assign(new Error('timed out'), { timedOut: true })), ms)),
  ])
}

async function callApi(path, resultId) {
  const btn = $(`call-${resultId}`)
  const out = $(`${resultId}-result`)
  btn.disabled = true
  try {
    const headers = {}
    if (keycloak.authenticated) {
      try {
        // keycloak-js has no request timeout: a hung IdP would leave the button disabled
        // forever, so cap the wait ourselves rather than spin.
        await withTimeout(keycloak.updateToken(30), 5000)
      } catch (err) {
        // refresh token dead (expired, IdP restarted) or the IdP never answered —
        // either way, don't fire a doomed request
        if (err?.timedOut) {
          // the IdP never answered; the session may still be fine, so keep showing who we are
          render(out, '', 'auth unavailable, try again')
        } else {
          render(out, '', 'session expired, log in again')
          clearIdentity()
        }
        return
      }
      headers.Authorization = `Bearer ${keycloak.token}`
    }

    let res
    try {
      res = await fetch(path, { headers })
    } catch {
      render(out, '', 'API unreachable')
      return
    }

    const body = await res.text()
    let json = null
    try {
      json = JSON.parse(body)
    } catch {
      // not JSON: never throw inside .json()
    }

    if (!json) {
      // The dev proxy answers 500 with an empty body when the API is down, so a dead API
      // arrives as a normal response rather than a failed fetch. Treat it as unreachable.
      render(out, '', res.status >= 500 ? 'API unreachable' : res.statusText || 'non-JSON response')
      return
    }
    render(out, res.status, json.error ? `${json.error}: ${json.message}` : JSON.stringify(json))
  } finally {
    btn.disabled = false
  }
}

const render = (el, status, text) => { el.textContent = `${status} ${text}`.trim() }

function clearIdentity() {
  $('whoami').textContent = 'anonymous'
  $('roles').textContent = '[]'
}

function renderIdentity() {
  if (!keycloak.authenticated) return clearIdentity()
  $('whoami').textContent = keycloak.tokenParsed?.preferred_username ?? 'unknown'
  $('roles').textContent = JSON.stringify(keycloak.tokenParsed?.realm_access?.roles ?? [])
}

const clearResults = () => ['public', 'user', 'admin'].forEach((k) => { $(`${k}-result`).textContent = '' })

$('call-public').onclick = () => callApi('/api/public', 'public')
$('call-user').onclick = () => callApi('/api/user', 'user')
$('call-admin').onclick = () => callApi('/api/admin', 'admin')
$('login').onclick = () => keycloak.login()
$('logout').onclick = () => { clearResults(); keycloak.logout() }

// check-sso, not login-required: the public page must render logged out
keycloak
  .init({
    onLoad: 'check-sso',
    pkceMethod: 'S256',
    silentCheckSsoRedirectUri: `${location.origin}/silent-check-sso.html`,
    // updateToken() otherwise polls a hidden Keycloak iframe first, which simply never answers
    // when Keycloak is down — the request hangs instead of surfacing the API's 503.
    // Ceiling: no cross-tab logout detection. Re-enable if you need it, with a timeout.
    checkLoginIframe: false,
  })
  .then(() => { $('login').disabled = false; renderIdentity() })
  .catch(() => {
    // Keycloak down or misconfigured: say so, keep the public page usable
    banner('auth unavailable — public endpoint still works')
    clearIdentity()
  })
