import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { login, call } from './helpers.js'

// The docker socket is bind-mounted, so these stop the REAL containers.
// Cost: this container has root-equivalent control of the daemon. Local only, never CI.
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' })

test.describe.configure({ mode: 'serial' })
test.use({ storageState: { cookies: [], origins: [] } })

test('api down -> "API unreachable", and it recovers', async ({ page }) => {
  await page.goto('/')
  docker('stop', 'kcdemo-api')
  try {
    await expect(await call(page, 'public')).toContainText('API unreachable')
  } finally {
    docker('start', 'kcdemo-api')
  }
  // npm i on restart takes tens of seconds — wait deterministically, never sleep(n)
  await expect.poll(async () => {
    const r = await page.request.get('/api/public').catch(() => null)
    return r?.status() ?? 0
  }, { timeout: 120_000, intervals: [2000] }).toBe(200)

  await expect(await call(page, 'public')).toContainText('200')
})

test('keycloak down with a valid token -> 503, not a re-login prompt', async ({ page }) => {
  await page.goto('/')
  await login(page, 'alice')
  docker('stop', 'kcdemo-keycloak')
  try {
    const result = await call(page, 'admin')
    await expect(result).toContainText('503')
    await expect(result).toContainText('keycloak_unreachable')
    await expect(page).toHaveURL(/localhost:5173/)   // NOT bounced to the login page
  } finally {
    docker('start', 'kcdemo-keycloak')
  }
  // restart re-runs the realm import (20-40s)
  await expect.poll(async () => {
    const r = await page.request.get('http://localhost:8080/realms/demo').catch(() => null)
    return r?.status() ?? 0
  }, { timeout: 180_000, intervals: [2000] }).toBe(200)
})

test('tampered Authorization header -> 401 malformed_token', async ({ page }) => {
  await page.goto('/')
  await login(page, 'alice')
  // keycloak-js keeps tokens in memory, so there is no storage to tamper with —
  // rewrite the header on the wire instead.
  await page.route('**/api/admin', (route) =>
    route.continue({ headers: { ...route.request().headers(), authorization: 'Bearer garbage' } }))

  const result = await call(page, 'admin')
  await expect(result).toContainText('401')
  await expect(result).toContainText('malformed_token')
})

test('unknown api route returns JSON 404, not express HTML', async ({ page }) => {
  const res = await page.request.get('/api/nope')
  expect(res.status()).toBe(404)
  expect(await res.json()).toMatchObject({ error: 'not_found' })
})

test('double click in flight fires exactly one request', async ({ page }) => {
  await page.goto('/')
  let requests = 0
  page.on('request', (r) => { if (r.url().includes('/api/public')) requests++ })

  // localhost answers in ~5ms, so without this the button is already re-enabled by the second
  // click and the test proves nothing. Hold the response open to make "in flight" real.
  await page.route('**/api/public', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    await route.continue()
  })

  const btn = page.getByTestId('call-public')
  await btn.click()
  // force: skip Playwright's own enabled-check so a REAL mouse event lands on the now-disabled
  // button. dispatchEvent would fire the handler directly and prove nothing.
  await btn.click({ force: true })
  await expect(page.getByTestId('public-result')).toContainText('200')
  expect(requests).toBe(1)
})
