import { test, expect } from '@playwright/test'
import { login, call } from './helpers.js'

// The whole grid, generated: adding a role or route forces its cell to be filled in,
// rather than silently uncovered.
const PRINCIPALS = ['anonymous', 'carol', 'bob', 'alice']
const ENDPOINTS = ['public', 'user', 'admin']

const EXPECTED = {
  anonymous: { public: [200, 'hello'], user: [401, 'no_token'], admin: [401, 'no_token'] },
  carol: { public: [200, 'hello'], user: [403, 'missing_role'], admin: [403, 'missing_role'] },
  bob: { public: [200, 'hello'], user: [200, 'bob'], admin: [403, 'missing_role'] },
  alice: { public: [200, 'hello'], user: [200, 'alice'], admin: [200, 'alice'] },
}

// Keycloak also grants default-roles-demo / offline_access, so assert on the two demo roles only
const DEMO_ROLES = { alice: ['admin', 'user'], bob: ['user'], carol: [] }

for (const principal of PRINCIPALS) {
  test.describe(`principal: ${principal}`, () => {
    test.use({ storageState: { cookies: [], origins: [] } })   // no SSO cookie leaks between specs

    for (const endpoint of ENDPOINTS) {
      const [status, marker] = EXPECTED[principal][endpoint]
      test(`${principal} GET /api/${endpoint} -> ${status} ${marker}`, async ({ page }) => {
        await page.goto('/')
        await expect(page.getByTestId('whoami')).toHaveText('anonymous')
        if (principal !== 'anonymous') await login(page, principal)

        const result = await call(page, endpoint)
        await expect(result).toContainText(String(status))
        await expect(result).toContainText(marker)
      })
    }

    if (principal !== 'anonymous') {
      test(`${principal} shows their realm roles`, async ({ page }) => {
        await page.goto('/')
        await login(page, principal)
        const roles = page.getByTestId('roles')
        for (const role of ['admin', 'user']) {
          const want = DEMO_ROLES[principal].includes(role)
          await (want ? expect(roles).toContainText(`"${role}"`)
                      : expect(roles).not.toContainText(`"${role}"`))
        }
      })
    }
  })
}
