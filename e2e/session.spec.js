import { test, expect } from '@playwright/test'
import { login, call } from './helpers.js'

test.use({ storageState: { cookies: [], origins: [] } })

test('login survives a reload (silent SSO really works)', async ({ page }) => {
  await page.goto('/')
  await login(page, 'alice')
  await page.reload()
  await expect(page.getByTestId('whoami')).toHaveText('alice')
  await expect(await call(page, 'admin')).toContainText('200')
})

test('logout clears rendered results', async ({ page }) => {
  await page.goto('/')
  await login(page, 'alice')
  await expect(await call(page, 'admin')).toContainText('alice')

  await page.getByTestId('logout').click()
  await expect(page.getByTestId('whoami')).toHaveText('anonymous')
  // stale admin output must not linger and read as a leak
  await expect(page.getByTestId('admin-result')).toHaveText('')
})

test('back button after logout does not restore an authenticated view', async ({ page }) => {
  await page.goto('/')
  await login(page, 'alice')
  await page.getByTestId('logout').click()
  await expect(page.getByTestId('whoami')).toHaveText('anonymous')

  // Back lands on Keycloak's logout redirect, not the app, so there is no whoami to read.
  // What matters is that no authenticated view is restored from the bfcache.
  await page.goBack()
  await expect(page.locator('body')).not.toContainText('alice')

  await page.goto('/')
  await expect(page.getByTestId('whoami')).toHaveText('anonymous')
  await expect(await call(page, 'admin')).toContainText('401')
})
