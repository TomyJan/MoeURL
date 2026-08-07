import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  attachScreenshot,
  escapeRegExp,
  expectPasswordLayout,
  findShortLink,
  readVisitCount,
} from './support'

const e2ePort = process.env.MOEURL_E2E_PORT ?? '8080'
const e2eHost = `127.0.0.1:${e2ePort}`
const e2eHostPattern = escapeRegExp(e2eHost)

test('v0.3.0 protected short-link access flow', async ({ page }, testInfo) => {
  testInfo.setTimeout(120_000)
  page.setDefaultTimeout(10_000)
  await ensureInitialized(page)

  await page.goto('/login')
  await page.getByLabel('账号').fill('admin')
  await page.getByLabel('密码').fill('admin-password')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByRole('button', { name: 'Admin' })).toBeVisible()

  const protectedTarget = 'https://example.com/e2e-protected'
  await page.goto('/')
  await page.getByRole('button', { name: '高级设置' }).click()
  await page.getByLabel('设置访问密码', { exact: true }).click()
  await page.getByLabel('访问密码', { exact: true }).fill('correct horse')
  await page.getByLabel('输入链接').fill(protectedTarget)
  const protectedCreateResponsePromise = page.waitForResponse('**/api/v1/short-link/create')
  await page.getByRole('button', { name: '创建短链' }).click()
  const protectedCreateResponse = await protectedCreateResponsePromise
  expect(protectedCreateResponse.status()).toBe(200)
  expect(protectedCreateResponse.request().postDataJSON()).toMatchObject({
    targetUrl: protectedTarget,
    password: { mode: 'set', value: 'correct horse' },
  })
  expect(await protectedCreateResponse.json()).toMatchObject({ code: 0 })
  const protectedCreatedLink = page.getByRole('link', { name: new RegExp(`${e2eHostPattern}\\/[a-z0-9]{6}`) })
  await expect(protectedCreatedLink).toBeVisible()
  const protectedUrl = await protectedCreatedLink.getAttribute('href')
  expect(protectedUrl).toMatch(new RegExp(`^https?:\\/\\/${e2eHostPattern}\\/[a-z0-9]{6}$`))
  const protectedSlug = new URL(protectedUrl ?? '').pathname.slice(1)
  const protectedLink = await findShortLink(page, protectedSlug)
  expect(protectedLink).toBeDefined()
  if (!protectedLink) {
    throw new Error('protected short link was not returned by the personal list')
  }
  const protectedLinkId = protectedLink.id
  expect(await readVisitCount(page, protectedLinkId)).toBe(0)

  const rateLimitedCreate = await page.request.post('/api/v1/short-link/create', {
    data: {
      targetUrl: 'https://example.com/e2e-rate-limited',
      password: { mode: 'set', value: 'another correct horse' },
    },
  })
  await expect(rateLimitedCreate).toBeOK()
  const rateLimitedPayload = await rateLimitedCreate.json() as {
    code: number
    data: { shortLink: { slug: string } }
  }
  expect(rateLimitedPayload.code).toBe(0)
  const rateLimitedSlug = rateLimitedPayload.data.shortLink.slug

  const protectedOpen = await page.request.get(`/${protectedSlug}`, { maxRedirects: 0 })
  expect(protectedOpen.status()).toBe(302)
  expect(protectedOpen.headers().location).toBe(`/go/${protectedSlug}?reason=password`)

  await page.route(protectedTarget, (route) => route.fulfill({ status: 200, body: 'protected target reached' }))
  await page.goto(protectedOpen.headers().location!)
  await expect(page.getByRole('heading', { name: '输入密码后继续访问' })).toBeVisible()
  await expectPasswordLayout(page)
  await attachScreenshot(testInfo, 'password-desktop', page)
  await page.setViewportSize({ width: 390, height: 800 })
  await expectPasswordLayout(page)
  await attachScreenshot(testInfo, 'password-mobile', page)
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.getByLabel('访问密码').fill('wrong-pass')
  await page.getByRole('button', { name: '解锁并继续' }).click()
  await expect(page.getByText('密码错误，请重试。')).toBeVisible()

  await page.getByLabel('访问密码').fill('correct horse')
  await Promise.all([
    page.waitForURL(protectedTarget),
    page.getByRole('button', { name: '解锁并继续' }).click(),
  ])
  await expect.poll(
    () => readVisitCount(page, protectedLinkId),
    { intervals: [250, 500, 1_000], timeout: 30_000 },
  ).toBe(1)

  await page.goto(`/${protectedSlug}`)
  await expect(page).toHaveURL(protectedTarget)
  await expect.poll(
    () => readVisitCount(page, protectedLinkId),
    { intervals: [250, 500, 1_000], timeout: 30_000 },
  ).toBe(2)

  await page.goto('/link')
  const protectedRow = page.getByTestId('console-link-row').filter({ hasText: protectedUrl ?? '' })
  await expect(protectedRow).toBeVisible()
  await protectedRow.getByRole('button', { name: '更多操作' }).click()
  await protectedRow.getByRole('menuitem', { name: '访问配置' }).click()
  let protectedSettingsDialog = page.getByRole('dialog')
  await expect(protectedSettingsDialog.getByLabel('设置访问密码', { exact: true })).toBeChecked()
  const preservedPasswordRequestPromise = page.waitForRequest('**/api/v1/short-link/update')
  const preservedPasswordResponsePromise = page.waitForResponse('**/api/v1/short-link/update')
  await protectedSettingsDialog.getByRole('button', { name: '保存' }).click()
  const [preservedPasswordRequest, preservedPasswordResponse] = await Promise.all([
    preservedPasswordRequestPromise,
    preservedPasswordResponsePromise,
  ])
  expect(preservedPasswordResponse.status()).toBe(200)
  expect(await preservedPasswordResponse.json()).toMatchObject({ code: 0 })
  expect(preservedPasswordRequest.postDataJSON()).not.toHaveProperty('password')
  await expect(protectedSettingsDialog).toBeHidden()
  expect((await findShortLink(page, protectedSlug))?.passwordEnabled).toBe(true)

  await protectedRow.getByRole('button', { name: '更多操作' }).click()
  await protectedRow.getByRole('menuitem', { name: '访问配置' }).click()
  protectedSettingsDialog = page.getByRole('dialog')
  await protectedSettingsDialog.getByRole('button', { name: '中间页', exact: true }).click()
  await protectedSettingsDialog.getByLabel('新访问密码', { exact: true }).fill('new correct horse')
  const passwordUpdateRequestPromise = page.waitForRequest('**/api/v1/short-link/update')
  const passwordUpdateResponsePromise = page.waitForResponse('**/api/v1/short-link/update')
  await protectedSettingsDialog.getByRole('button', { name: '保存' }).click()
  const [passwordUpdateRequest, passwordUpdateResponse] = await Promise.all([
    passwordUpdateRequestPromise,
    passwordUpdateResponsePromise,
  ])
  expect(passwordUpdateResponse.status()).toBe(200)
  expect(await passwordUpdateResponse.json()).toMatchObject({ code: 0 })
  expect(passwordUpdateRequest.postDataJSON()).toMatchObject({
    redirectMode: 'intermediate',
    password: { mode: 'set', value: 'new correct horse' },
  })
  await expect(protectedSettingsDialog).toBeHidden()

  await page.goto(`/${protectedSlug}`)
  await expect(page.getByRole('heading', { name: '输入密码后继续访问' })).toBeVisible()
  await page.getByLabel('访问密码').fill('new correct horse')
  await page.getByRole('button', { name: '解锁并继续' }).click()
  await expect(page.getByRole('heading', { name: '即将前往外部网站' })).toBeVisible()
  await expect(page.getByRole('button', { name: '立即前往' })).toBeVisible()
  await Promise.all([page.waitForURL(protectedTarget), page.getByRole('button', { name: '立即前往' }).click()])
  await expect.poll(
    () => readVisitCount(page, protectedLinkId),
    { intervals: [250, 500, 1_000], timeout: 30_000 },
  ).toBe(3)

  await page.goto('/link')
  await protectedRow.getByRole('button', { name: '更多操作' }).click()
  await protectedRow.getByRole('menuitem', { name: '访问配置' }).click()
  protectedSettingsDialog = page.getByRole('dialog')
  await protectedSettingsDialog.getByLabel('设置访问密码', { exact: true }).click()
  await expect(protectedSettingsDialog.getByLabel('新访问密码', { exact: true })).toHaveCount(0)
  const clearPasswordRequestPromise = page.waitForRequest('**/api/v1/short-link/update')
  const clearPasswordResponsePromise = page.waitForResponse('**/api/v1/short-link/update')
  await protectedSettingsDialog.getByRole('button', { name: '保存' }).click()
  const [clearPasswordRequest, clearPasswordResponse] = await Promise.all([
    clearPasswordRequestPromise,
    clearPasswordResponsePromise,
  ])
  expect(clearPasswordResponse.status()).toBe(200)
  expect(await clearPasswordResponse.json()).toMatchObject({ code: 0 })
  expect(clearPasswordRequest.postDataJSON()).toMatchObject({
    password: { mode: 'never' },
  })
  await expect(protectedSettingsDialog).toBeHidden()

  await page.goto(`/${protectedSlug}`)
  await expect(page.getByRole('heading', { name: '即将前往外部网站' })).toBeVisible()
  await expect(page.getByLabel('访问密码')).toHaveCount(0)
  await Promise.all([page.waitForURL(protectedTarget), page.getByRole('button', { name: '立即前往' }).click()])
  await expect.poll(
    () => readVisitCount(page, protectedLinkId),
    { intervals: [250, 500, 1_000], timeout: 30_000 },
  ).toBe(4)

  await page.goto(`/${rateLimitedSlug}`)
  await expect(page.getByRole('heading', { name: '输入密码后继续访问' })).toBeVisible()
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    await page.getByLabel('访问密码').fill('wrong-pass')
    const unlockResponsePromise = page.waitForResponse((response) => (
      response.url().endsWith('/api/v1/public/short-link/unlock')
      && response.request().method() === 'POST'
    ))
    await page.getByRole('button', { name: '解锁并继续' }).click()
    const unlockResponse = await unlockResponsePromise
    expect(await unlockResponse.json()).toMatchObject({ code: attempt === 5 ? 200113 : 200112 })
    await expect(page.getByText(
      attempt === 5 ? '尝试次数过多，请在 15 分钟后重试。' : '密码错误，请重试。',
    )).toBeVisible()
  }
})

async function ensureInitialized(page: Page) {
  const status = await page.request.get('/api/v1/init/status')
  await expect(status).toBeOK()
  const statusPayload = await status.json() as { code: number; data: { initialized: boolean } }
  expect(statusPayload.code).toBe(0)
  if (statusPayload.data.initialized) {
    return
  }

  const setup = await page.request.post('/api/v1/init/setup', {
    data: {
      adminUsername: 'admin',
      adminPassword: 'admin-password',
      adminNickname: 'Admin',
      siteName: 'MoeURL',
      systemDomain: e2eHost,
      shortLinkDomain: e2eHost,
      defaultLanguage: 'zh-CN',
      defaultTheme: 'system',
    },
  })
  await expect(setup).toBeOK()
  expect(await setup.json()).toMatchObject({ code: 0, data: { initialized: true } })
}
