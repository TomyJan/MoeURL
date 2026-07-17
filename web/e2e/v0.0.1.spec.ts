import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const e2ePort = process.env.MOEURL_E2E_PORT ?? '8080'
const e2eHost = `127.0.0.1:${e2ePort}`
const e2eHostPattern = escapeRegExp(e2eHost)

test('v0.0.1 initialization login short link and disabled redirect flow', async ({ page }) => {
  const status = await page.request.get('/api/v1/init/status')
  await expect(status).toBeOK()
  expect(await status.json()).toMatchObject({
    code: 0,
    data: { initialized: false },
  })

  await page.goto('/setup')
  await page.getByLabel('管理员账号').fill('admin')
  await page.getByLabel('管理员密码').fill('admin-password')
  await page.getByLabel('管理员昵称').fill('Admin')
  await page.getByLabel('站点名称').fill('MoeURL')
  await page.getByLabel('系统访问域名').fill(e2eHost)
  await page.getByLabel('短链访问域名').fill(e2eHost)
  await page.getByRole('button', { name: '初始化' }).click()
  await expect(page.getByText('已完成初始化')).toBeVisible()

  await page.goto('/login')
  await page.getByLabel('账号').fill('admin')
  await page.getByLabel('密码').fill('wrong-password')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByText('登录失败，请检查账号和密码后再试。')).toBeVisible()
  await page.getByLabel('密码').fill('admin-password')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByRole('button', { name: 'Admin' })).toBeVisible()

  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Admin' })).toBeVisible()
  await page.getByRole('button', { name: 'Admin' }).click()
  await expect(page).toHaveURL(/\/link$/)
  await expect(page.getByRole('heading', { name: '我的短链' })).toBeVisible()

  await page.goto('/admin/user/new')
  await page.getByRole('textbox', { name: '账号' }).fill('alice')
  await page.getByLabel('密码').fill('alice-password')
  await page.getByLabel('昵称').fill('Alice')
  await page.getByRole('button', { name: '创建用户' }).click()
  await expect(page.getByText('alice')).toBeVisible()

  await page.goto('/admin/user')
  await expect(page.getByText('alice')).toBeVisible()
  const disableUser = page.waitForResponse('**/api/v1/admin/user/update')
  const aliceRow = page.getByTestId('console-user-row').filter({ hasText: 'alice' })
  await aliceRow.getByRole('button', { name: '更多操作' }).click()
  await aliceRow.getByRole('button', { name: '禁用' }).click()
  expect((await disableUser).status()).toBe(200)
  const disabledLogin = await page.request.post('/api/v1/auth/login', {
    data: { username: 'alice', password: 'alice-password' },
  })
  await expect(disabledLogin).toBeOK()
  expect(await disabledLogin.json()).toMatchObject({
    code: 110102,
    message: 'User disabled',
  })

  await page.goto('/')
  await page.getByLabel('输入链接').fill('https://example.com/e2e-target')
  await page.getByRole('button', { name: '创建短链' }).click()
  const createdLink = page.getByRole('link', { name: new RegExp(`${e2eHostPattern}\\/[a-z0-9]{6}`) })
  await expect(createdLink).toBeVisible()
  const createdUrl = await createdLink.getAttribute('href')
  expect(createdUrl).toMatch(new RegExp(`^https?:\\/\\/${e2eHostPattern}\\/[a-z0-9]{6}$`))
  await expect(page.getByRole('button', { name: '复制短链' })).toBeVisible()
  await expect(page.getByRole('link', { name: '打开短链' })).toHaveAttribute('href', createdUrl ?? '')
  await expect(page.getByRole('button', { name: '继续创建' })).toBeVisible()

  const slug = new URL(createdUrl ?? '').pathname.slice(1)

  await page.goto('/link')
  await page.getByRole('button', { name: '新建短链' }).first().click()
  const createDialog = page.getByRole('dialog')
  await expect(createDialog.getByRole('heading', { name: '创建短链' })).toBeVisible()
  await createDialog.getByLabel('输入链接').fill('https://example.com/e2e-console-target')
  await createDialog.getByRole('button', { name: '创建短链' }).click()
  const consoleCreatedLink = createDialog.getByRole('link', { name: new RegExp(`${e2eHostPattern}\\/[a-z0-9]{6}`) })
  await expect(consoleCreatedLink).toBeVisible()

  await page.setViewportSize({ width: 390, height: 800 })
  await page.goto('/link')
  await page.getByLabel('打开控制台菜单').click()
  await expect(page.getByTestId('console-mobile-nav')).toBeVisible()
  await expect(page.getByTestId('console-mobile-nav').getByText('我的短链')).toBeVisible()
  await page.setViewportSize({ width: 1280, height: 720 })

  const activeRedirect = await page.request.get(`/${slug}`, { maxRedirects: 0 })
  expect(activeRedirect.status()).toBe(302)
  expect(activeRedirect.headers().location).toBe('https://example.com/e2e-target')

  const linksResponse = await page.request.get('/api/v1/short-link/list?page=1&pageSize=20')
  await expect(linksResponse).toBeOK()
  const linksPayload = await linksResponse.json() as { data: { items: Array<{ id: string; slug: string }> } }
  const analyticsLink = linksPayload.data.items.find((link) => link.slug === slug)
  expect(analyticsLink).toBeDefined()
  await page.goto(`/analytics?shortLinkId=${analyticsLink?.id}`)
  await expect(page.getByTestId('analytics-trend-chart')).toBeVisible()

  await page.goto('/admin/link')
  await page.getByLabel('关键词搜索').fill(slug)
  await expect(page.getByRole('link', { name: createdUrl ?? '' })).toBeVisible()
  const disableLink = page.waitForResponse('**/api/v1/admin/short-link/update')
  const createdLinkRow = page.getByTestId('console-link-row').filter({ hasText: slug })
  await createdLinkRow.getByRole('button', { name: '更多操作' }).click()
  await createdLinkRow.getByRole('button', { name: '禁用' }).click()
  expect((await disableLink).status()).toBe(200)

  const blocked = await page.request.get(`/${slug}`)
  await expect(blocked).toBeOK()
  expect(await blocked.text()).toContain('Short link disabled')

  await page.goto('/link')
  await selectVuetifyOption(page, '状态筛选', '禁用')
  await expect(page.getByRole('link', { name: createdUrl ?? '' })).toBeVisible()
  await expect(page.getByRole('button', { name: '复制' })).toBeVisible()
  await expect(page.getByRole('link', { name: '打开' })).toHaveAttribute('href', createdUrl ?? '')

  await page.goto('/admin/link')
  await selectVuetifyOption(page, '状态筛选', '禁用')
  await page.getByLabel('关键词搜索').fill(slug)
  await expect(page.getByRole('link', { name: createdUrl ?? '' })).toBeVisible()
  await page.getByLabel('关键词搜索').fill('no-such-short-link')
  await expect(page.getByText('暂无短链')).toBeVisible()

  await page.goto('/link')
  await page.getByRole('button', { name: '退出登录' }).click()

  await page.goto('/')
  await expect(page.getByText('请登录后创建短链')).toBeVisible()
  await expect(page.getByRole('button', { name: '创建短链' })).toBeDisabled()
})

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function selectVuetifyOption(page: Page, label: string, option: string) {
  await page.getByLabel(label).locator('xpath=ancestor::*[contains(@class, "v-input")][1]').click()
  await page.getByRole('option', { name: option }).click()
}
