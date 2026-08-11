import { expect, test } from '@playwright/test'
import { e2eHost } from './support'

test('initialization', async ({ page }) => {
  page.setDefaultTimeout(10_000)
  const status = await page.request.get('/api/v1/init/status')
  await expect(status).toBeOK()
  const statusPayload = await status.json() as { code: number; data: { initialized: boolean } }
  expect(statusPayload).toMatchObject({ code: 0 })

  if (statusPayload.data.initialized) {
    return
  }

  await page.goto('/setup')
  await page.getByTestId('setup-admin-username').locator('input').fill('admin')
  await page.getByTestId('setup-admin-password').locator('input').fill('admin-password')
  await page.getByTestId('setup-admin-nickname').locator('input').fill('Admin')
  await page.getByTestId('setup-site-name').locator('input').fill('MoeURL')
  await page.getByTestId('setup-system-domain').locator('input').fill(e2eHost)
  await page.getByTestId('setup-short-link-domain').locator('input').fill(e2eHost)
  await page.getByTestId('setup-submit').click()
  await expect(page.getByTestId('setup-completion')).toBeVisible()
})
