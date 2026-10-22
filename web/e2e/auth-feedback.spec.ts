import { expect, test } from '@playwright/test'

for (const viewport of ['desktop', 'mobile']) {
  test(`${viewport}: setup validation uses friendly, independently dismissible stacked notifications`, async ({ page }) => {
    if (viewport === 'mobile') await page.setViewportSize({ width: 360, height: 780 })
    await page.route('**/api/v1/init/status', (route) => route.fulfill({ json: {
      code: 0, message: 'OK', data: { initialized: false, setupTokenRequired: false }, meta: {},
    } }))
    let submitted = false
    page.on('request', (request) => { if (new URL(request.url()).pathname === '/api/v1/init/setup') submitted = true })
    await page.goto('/setup')
    await page.getByLabel('管理员账号', { exact: true }).fill('admin')
    await page.getByLabel('管理员密码', { exact: true }).fill('short')
    await page.getByLabel('管理员昵称', { exact: true }).fill('Admin')
    await page.getByTestId('setup-submit').click()
    await expect(page.getByText('密码至少需要 8 个字符', { exact: true })).toBeVisible()
    await page.getByTestId('setup-submit').click()
    const notifications = page.locator('[data-sonner-toast]')
    await expect(notifications).toHaveCount(2)
    await notifications.first().getByRole('button', { name: '关闭提示' }).click()
    await expect(notifications).toHaveCount(1)
    await expect(page.getByText('too_small')).toHaveCount(0)
    expect(submitted).toBe(false)
    const size = page.viewportSize()!
    const bounds = await notifications.first().boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(size.width)
    await expect(notifications).toHaveCount(0, { timeout: 10_000 })
  })
}

test('initialized setup offers navigation and login preserves the exact password', async ({ page }) => {
  await page.route('**/api/v1/init/status', (route) => route.fulfill({ json: {
    code: 0, message: 'OK', data: { initialized: true, setupTokenRequired: false }, meta: {},
  } }))
  await page.route('**/api/v1/auth/methods', (route) => route.fulfill({ json: {
    code: 0, message: 'OK', data: { local: { enabled: true }, oidc: [] }, meta: {},
  } }))
  const password = '  特殊"\\$<>&密码  '
  let submittedPassword: unknown
  await page.route('**/api/v1/auth/login', (route) => {
    submittedPassword = route.request().postDataJSON().password
    return route.fulfill({ json: { code: 110101, message: 'Raw technical error', data: null, meta: {} } })
  })
  await page.goto('/setup')
  await expect(page.getByRole('link', { name: '返回首页' })).toHaveAttribute('href', '/')
  await page.getByRole('link', { name: '前往登录' }).click()
  await page.getByLabel('账号', { exact: true }).fill('admin')
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page.locator('[data-sonner-toast]')).toContainText('登录失败，请检查账号和密码后再试。')
  expect(submittedPassword).toBe(password)
  await expect(page.getByText('Raw technical error')).toHaveCount(0)
})

test('repeats the same settings validation after dismissing its notification', async ({ page }) => {
  await page.route('**/api/v1/init/status', route => route.fulfill({ json: { code: 0, message: 'OK', data: { initialized: true, setupTokenRequired: false }, meta: {} } }))
  await page.route('**/api/v1/auth/me', route => route.fulfill({ json: { code: 0, message: 'OK', data: { user: {
    id: 'admin', username: 'admin', nickname: 'Admin', group: 'admin', permissions: ['admin:access', 'system:manage'],
  } } } }))
  await page.route('**/api/v1/admin/system/settings', route => route.fulfill({ json: { code: 0, message: 'OK', data: {
    siteName: 'MoeURL', defaultLanguage: 'zh-CN', defaultTheme: 'system', footerText: '', showPoweredBy: true,
    localLoginEnabled: true, updatedAt: '2026-10-14T00:00:00Z',
  } } }))
  await page.route('**/api/v1/admin/oidc/provider/list', route => route.fulfill({ json: { code: 0, message: 'OK', data: { providers: [] }, meta: {} } }))
  await page.goto('/admin/setting')
  await page.getByLabel('站点名称', { exact: true }).fill('')
  const save = page.getByRole('button', { name: '保存设置', exact: true })
  await save.click()
  const notification = page.locator('[data-sonner-toast]')
  await expect(notification).toContainText('设置保存失败，请稍后重试。')
  await notification.getByRole('button', { name: '关闭提示' }).click()
  await expect(notification).toHaveCount(0)
  await save.click()
  await expect(notification).toContainText('设置保存失败，请稍后重试。')
})
