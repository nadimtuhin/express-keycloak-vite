import { expect } from '@playwright/test'

export async function login(page, user) {
  await page.getByTestId('login').click()
  // generous: right after a Keycloak restart the first login page render is slow to warm up
  await expect(page.locator('#kc-form-login')).toBeVisible({ timeout: 30_000 })
  await page.fill('#username', user)
  await page.fill('#password', user)
  await page.click('#kc-login')
  await expect(page.getByTestId('whoami')).toHaveText(user)
}

export const call = async (page, endpoint) => {
  await page.getByTestId(`call-${endpoint}`).click()
  return page.getByTestId(`${endpoint}-result`)
}
