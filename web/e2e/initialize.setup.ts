import { expect, test } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, e2eHost } from './support'

test('initialization', async ({ page }) => {
  page.setDefaultTimeout(10_000)
  const status = await page.request.get('/api/v1/init/status')
  await expect(status).toBeOK()
  const statusPayload = await status.json() as { code: number; data: { initialized: boolean } }
  expect(statusPayload).toMatchObject({ code: 0 })

  if (statusPayload.data.initialized) {
    const login = await page.request.post('/api/v1/auth/login', {
      data: { username: e2eAdminUsername, password: e2eAdminPassword },
    })
    await expect(login).toBeOK()
    const loginPayload = await login.json() as { code: number }
    expect(loginPayload.code).toBe(0)
    return
  }

  await page.goto('/setup')
  await page.getByTestId('setup-admin-username').locator('input').fill(e2eAdminUsername)
  await page.getByTestId('setup-admin-password').locator('input').fill(e2eAdminPassword)
  await page.getByTestId('setup-admin-nickname').locator('input').fill('Admin')
  await page.getByTestId('setup-site-name').locator('input').fill('MoeURL')
  await page.getByTestId('setup-system-domain').locator('input').fill(e2eHost)
  await page.getByTestId('setup-short-link-domain').locator('input').fill(e2eHost)
  await page.getByTestId('setup-submit').click()
  await expect(page.getByTestId('setup-completion')).toBeVisible()
})
