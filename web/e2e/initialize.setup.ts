import { expect, test } from '@playwright/test'

const e2ePort = process.env.MOEURL_E2E_PORT ?? '8080'
const e2eHost = `127.0.0.1:${e2ePort}`

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
  await page.getByLabel('管理员账号').fill('admin')
  await page.getByLabel('管理员密码').fill('admin-password')
  await page.getByLabel('管理员昵称').fill('Admin')
  await page.getByLabel('站点名称').fill('MoeURL')
  await page.getByLabel('系统访问域名').fill(e2eHost)
  await page.getByLabel('短链访问域名').fill(e2eHost)
  await page.getByRole('button', { name: '初始化' }).click()
  await expect(page.getByText('已完成初始化')).toBeVisible()
})
