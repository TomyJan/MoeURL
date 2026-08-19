import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import {
  attachScreenshot,
  e2eAdminPassword,
  e2eAdminUsername,
  e2eHost,
  escapeRegExp,
  expectNoHorizontalOverflow,
  expectPasswordLayout,
  findShortLink,
  readVisitCount,
} from './support'

const e2eHostPattern = escapeRegExp(e2eHost)

test.describe.configure({ mode: 'serial' })
test.use({ serviceWorkers: 'block' })

test('v0.4.0 confirmation-page access flow', async ({ page }, testInfo) => {
  testInfo.setTimeout(150_000)
  page.setDefaultTimeout(10_000)

  await page.goto('/login')
  await page.getByLabel('账号').fill(e2eAdminUsername)
  await page.getByLabel('密码').fill(e2eAdminPassword)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByRole('button', { name: 'Admin' })).toBeVisible()

  let confirmationUrl = ''
  let confirmationSlug = ''
  let confirmationLinkId = ''

  await test.step('创建无密码确认页短链', async () => {
    const created = await createConfirmationLink(page, 'https://example.com/e2e-confirmation')
    confirmationUrl = created.url
    confirmationSlug = created.slug
    confirmationLinkId = created.id
    expect(created.requestBody).toMatchObject({
      redirectMode: 'confirmation',
      targetUrl: 'https://example.com/e2e-confirmation',
    })
    expect(created.requestBody).not.toHaveProperty('intermediateDelaySeconds')
    expect(await readVisitCount(page, confirmationLinkId)).toBe(0)
  })

  await test.step('验证确认页设置与响应式布局', async () => {
    await page.goto('/link')
    const row = page.getByTestId('console-link-row').filter({ hasText: confirmationUrl })
    await expect(row.getByText('确认页', { exact: true })).toBeVisible()
    await row.getByRole('button', { name: '更多操作' }).click()
    await row.getByRole('menuitem', { name: '访问配置' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('button', { name: '确认页', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(dialog.getByRole('slider')).toHaveCount(0)
    await expectSettingsDialogLayout(page, dialog)
    await attachScreenshot(testInfo, 'confirmation-settings-desktop', page)

    await page.setViewportSize({ width: 390, height: 800 })
    await expectSettingsDialogLayout(page, dialog)
    await attachScreenshot(testInfo, 'confirmation-settings-mobile', page)
    await dialog.getByRole('button', { name: '取消' }).click()
    await page.setViewportSize({ width: 1280, height: 720 })
  })

  await test.step('确认后才跳转并记录一次访问', async () => {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString()
    const expirationUpdate = await page.request.post('/api/v1/short-link/update', {
      data: { id: confirmationLinkId, expiration: { mode: 'at', expiresAt } },
    })
    await expect(expirationUpdate).toBeOK()
    expect(await expirationUpdate.json()).toMatchObject({ code: 0 })
    const previewResponsePromise = page.waitForResponse((response) => (
      new URL(response.url()).pathname === `/go/${confirmationSlug}/preview`
      && response.request().method() === 'GET'
    ))
    await page.route('https://example.com/e2e-confirmation', (route) => route.fulfill({
      body: 'confirmation target reached',
      status: 200,
    }))
    const readContinueAttempts = await interceptFirstContinueFailure(page, confirmationSlug)
    await page.goto(`/${confirmationSlug}`)
    const previewResponse = await previewResponsePromise
    expect(previewResponse.status()).toBe(200)
    const previewPayload = await previewResponse.json() as {
      code: number
      data: Record<string, unknown>
    }
    expect(previewPayload).toMatchObject({
      code: 0,
      data: {
        intermediateDelaySeconds: null,
        redirectMode: 'confirmation',
        slug: confirmationSlug,
        targetHost: 'example.com',
      },
    })
    const previewExpiresAt = String(previewPayload.data.expiresAt)
    expect(Date.parse(previewExpiresAt)).toBe(Date.parse(expiresAt))
    expect(previewPayload.data).not.toHaveProperty('targetUrl')
    expect(JSON.stringify(previewPayload)).not.toContain('https://example.com/e2e-confirmation')
    await expect(page).toHaveURL(new RegExp(`/go/${confirmationSlug}$`))
    await expect(page.getByRole('heading', { name: '确认访问外部网站' })).toBeVisible()
    await expect(page.getByText('短码')).toBeVisible()
    await expect(page.getByText(confirmationSlug, { exact: true })).toBeVisible()
    await expect(page.getByText('有效期至')).toBeVisible()
    await expect(page.locator(`time[datetime="${previewExpiresAt}"]`)).toBeVisible()
    await expect(page.getByRole('button', { name: '继续访问' })).toBeVisible()
    await expect(page.locator('.redirect-page__countdown')).toHaveCount(0)
    expect(await readVisitCount(page, confirmationLinkId)).toBe(0)
    await expectConfirmationLayout(page)
    await attachScreenshot(testInfo, 'confirmation-desktop', page)

    await page.setViewportSize({ width: 390, height: 800 })
    await expectConfirmationLayout(page)
    await attachScreenshot(testInfo, 'confirmation-mobile', page)
    await page.setViewportSize({ width: 1280, height: 720 })

    const failedContinueRequest = page.waitForRequest((request) => (
      new URL(request.url()).pathname === `/go/${confirmationSlug}/continue`
      && request.method() === 'GET'
    ))
    await page.getByRole('button', { name: '继续访问' }).click()
    await failedContinueRequest
    expect(readContinueAttempts()).toBe(1)
    await expect(page).toHaveURL(new RegExp(`/go/${confirmationSlug}[?]reason=continue-failed$`))
    await expect(page.getByText('暂时无法继续访问，请重试。')).toBeVisible()
    expect(await readVisitCount(page, confirmationLinkId)).toBe(0)

    const continueRequestPromise = page.waitForRequest((request) => (
      new URL(request.url()).pathname === `/go/${confirmationSlug}/continue`
      && request.method() === 'GET'
    ))
    await Promise.all([
      page.waitForURL('https://example.com/e2e-confirmation'),
      page.getByRole('button', { name: '继续访问' }).click(),
    ])
    await continueRequestPromise
    expect(readContinueAttempts()).toBe(2)
    await expect.poll(
      () => readVisitCount(page, confirmationLinkId),
      { intervals: [250, 500, 1_000], timeout: 30_000 },
    ).toBe(1)
  })

  await test.step('受保护确认页解锁后仍等待点击', async () => {
    const target = 'https://example.net/e2e-protected-confirmation'
    const password = 'confirmation horse'
    const created = await createConfirmationLink(page, target, password)
    expect(created.requestBody).toMatchObject({
      password: { mode: 'set', value: password },
      redirectMode: 'confirmation',
      targetUrl: target,
    })
    expect(created.requestBody).not.toHaveProperty('intermediateDelaySeconds')
    expect(await readVisitCount(page, created.id)).toBe(0)

    const open = await page.request.get(`/${created.slug}`, { maxRedirects: 0 })
    expect(open.status()).toBe(302)
    expect(open.headers().location).toBe(`/go/${created.slug}?reason=password`)
    await page.route(target, (route) => route.fulfill({ body: 'protected confirmation reached', status: 200 }))
    await page.goto(open.headers().location!)
    await expect(page.getByRole('heading', { name: '输入密码后继续访问' })).toBeVisible()
    await expectPasswordLayout(page)
    await page.getByLabel('访问密码').fill('wrong password')
    await page.getByRole('button', { name: '解锁并继续' }).click()
    await expect(page.getByText('密码错误，请重试。')).toBeVisible()
    expect(await readVisitCount(page, created.id)).toBe(0)

    await page.getByLabel('访问密码').fill(password)
    await page.getByRole('button', { name: '解锁并继续' }).click()
    await expect(page.getByRole('heading', { name: '确认访问外部网站' })).toBeVisible()
    await expect(page).toHaveURL(new RegExp(`/go/${created.slug}[?]reason=password$`))
    expect(await readVisitCount(page, created.id)).toBe(0)

    await Promise.all([
      page.waitForURL(target),
      page.getByRole('button', { name: '继续访问' }).click(),
    ])
    await expect.poll(
      () => readVisitCount(page, created.id),
      { intervals: [250, 500, 1_000], timeout: 30_000 },
    ).toBe(1)
  })

  await test.step('受保护直达失败后等待手动重试', async () => {
    const target = 'https://example.net/e2e-protected-direct-retry'
    const password = 'direct retry horse'
    const response = await page.request.post('/api/v1/short-link/create', {
      data: {
        password: { mode: 'set', value: password },
        redirectMode: 'direct',
        targetUrl: target,
      },
    })
    await expect(response).toBeOK()
    const payload = await response.json() as {
      code: number
      data: { shortLink: { id: string; slug: string } }
    }
    expect(payload.code).toBe(0)
    const created = payload.data.shortLink
    expect(await readVisitCount(page, created.id)).toBe(0)

    await page.route(target, (route) => route.fulfill({ body: 'protected direct reached', status: 200 }))
    const readContinueAttempts = await interceptFirstContinueFailure(page, created.slug)

    const open = await page.request.get(`/${created.slug}`, { maxRedirects: 0 })
    expect(open.status()).toBe(302)
    expect(open.headers().location).toBe(`/go/${created.slug}?reason=password`)
    await page.goto(open.headers().location!)
    await page.getByLabel('访问密码').fill(password)
    const retryPreview = page.waitForResponse((previewResponse) => (
      new URL(previewResponse.url()).pathname === `/go/${created.slug}/preview`
      && previewResponse.request().method() === 'GET'
    ))
    await page.getByRole('button', { name: '解锁并继续' }).click()
    await retryPreview

    await expect(page).toHaveURL(new RegExp(`/go/${created.slug}[?]reason=continue-failed$`))
    await expect(page.getByText('暂时无法继续访问，请重试。')).toBeVisible()
    expect(readContinueAttempts()).toBe(1)
    expect(await readVisitCount(page, created.id)).toBe(0)

    await Promise.all([
      page.waitForURL(target),
      page.getByRole('button', { name: '立即前往' }).click(),
    ])
    expect(readContinueAttempts()).toBe(2)
    await expect.poll(
      () => readVisitCount(page, created.id),
      { intervals: [250, 500, 1_000], timeout: 30_000 },
    ).toBe(1)
  })

  await test.step('继续前停用会阻止跳转', async () => {
    const target = 'https://example.org/e2e-disabled-confirmation'
    const created = await createConfirmationFixture(page, { targetUrl: target })
    await page.goto(`/${created.slug}`)
    await expect(page.getByRole('heading', { name: '确认访问外部网站' })).toBeVisible()

    const disable = await page.request.post('/api/v1/short-link/update', {
      data: { id: created.id, status: 'disabled' },
    })
    await expect(disable).toBeOK()
    expect(await disable.json()).toMatchObject({ code: 0 })
    await page.getByRole('button', { name: '继续访问' }).click()
    await expect(page).toHaveURL(new RegExp(`/go/${created.slug}[?]reason=disabled$`))
    await expect(page.getByRole('heading', { name: '该短链已被停用。' })).toBeVisible()
    expect(await readVisitCount(page, created.id)).toBe(0)
  })

  await test.step('继续前过期会阻止跳转', async () => {
    const target = 'https://example.edu/e2e-expired-confirmation'
    const created = await createConfirmationFixture(page, { targetUrl: target })
    await page.goto(`/${created.slug}`)
    await expect(page.getByRole('heading', { name: '确认访问外部网站' })).toBeVisible()

    const expiresAt = new Date(Date.now() + 8_000).toISOString()
    const update = await page.request.post('/api/v1/short-link/update', {
      data: { id: created.id, expiration: { mode: 'at', expiresAt } },
    })
    await expect(update).toBeOK()
    expect(await update.json()).toMatchObject({ code: 0 })
    await expect.poll(
      () => readScopedPreviewCode(page, created.slug),
      { intervals: [250, 500], timeout: 15_000 },
    ).toBe(200109)

    await page.getByRole('button', { name: '继续访问' }).click()
    await expect(page).toHaveURL(new RegExp(`/go/${created.slug}[?]reason=expired$`))
    await expect(page.getByRole('heading', { name: '该短链已过期。' })).toBeVisible()
    expect(await readVisitCount(page, created.id)).toBe(0)
  })
})

/** Fails the first continue request and reports how many attempts were intercepted. */
async function interceptFirstContinueFailure(page: Page, slug: string) {
  let attempts = 0
  await page.route(`**/go/${slug}/continue`, async (route) => {
    attempts += 1
    if (attempts === 1) {
      await route.fulfill({
        headers: { location: `/go/${slug}?reason=continue-failed` },
        status: 302,
      })
      return
    }
    await route.continue()
  })
  return () => attempts
}

/** Creates a confirmation link through the public creation UI. */
async function createConfirmationLink(page: Page, targetUrl: string, password?: string) {
  await page.goto('/')
  await page.getByRole('button', { name: '高级设置' }).click()
  await page.getByRole('button', { name: '确认页', exact: true }).click()
  await expect(page.locator('.short-link-create-panel__advanced-controls').getByRole('slider')).toHaveCount(0)
  if (password) {
    await page.getByLabel('设置访问密码', { exact: true }).click()
    await page.getByLabel('访问密码', { exact: true }).fill(password)
  }
  await page.getByLabel('输入链接').fill(targetUrl)
  const responsePromise = page.waitForResponse('**/api/v1/short-link/create')
  await page.getByRole('button', { name: '创建短链' }).click()
  const response = await responsePromise
  expect(response.status()).toBe(200)
  const payload = await response.json() as {
    code: number
    data: { shortLink: { slug: string; url: string } }
  }
  expect(payload.code).toBe(0)
  const result = page.getByTestId('short-link-create-result')
  const createdLink = result.getByRole('link', { name: new RegExp(`${e2eHostPattern}/[a-z0-9]{6}`) })
  await expect(createdLink).toBeVisible()
  const url = await createdLink.getAttribute('href') ?? ''
  expect(url).toBe(payload.data.shortLink.url)
  const link = await findShortLink(page, payload.data.shortLink.slug)
  expect(link).toBeDefined()
  if (!link) {
    throw new Error('confirmation short link was not returned by the personal list')
  }
  return {
    id: link.id,
    requestBody: response.request().postDataJSON() as Record<string, unknown>,
    slug: payload.data.shortLink.slug,
    url,
  }
}

/** Creates a confirmation-link fixture through the authenticated API. */
async function createConfirmationFixture(page: Page, input: { targetUrl: string }) {
  const response = await page.request.post('/api/v1/short-link/create', {
    data: { ...input, redirectMode: 'confirmation' },
  })
  await expect(response).toBeOK()
  const payload = await response.json() as {
    code: number
    data: { shortLink: { id: string; slug: string } }
  }
  expect(payload.code).toBe(0)
  return payload.data.shortLink
}

/** Reads the business code returned by a scoped public preview. */
async function readScopedPreviewCode(page: Page, slug: string) {
  const response = await page.request.get(`/go/${encodeURIComponent(slug)}/preview`)
  await expect(response).toBeOK()
  const payload = await response.json() as { code: number }
  return payload.code
}

/** Verifies the confirmation page remains usable in the active viewport. */
async function expectConfirmationLayout(page: Page) {
  await expectNoHorizontalOverflow(page)
  const elements = [
    page.locator('.redirect-page__description'),
    page.locator('.redirect-page__metadata'),
    page.locator('.redirect-page__target'),
    page.locator('.redirect-page__actions'),
  ]
  const boxes = await Promise.all(elements.map((element) => element.boundingBox()))
  expect(boxes.every(Boolean)).toBe(true)
  const [descriptionBox, metadataBox, targetBox, actionsBox] = boxes
  if (!descriptionBox || !metadataBox || !targetBox || !actionsBox) {
    return
  }
  expect(descriptionBox.y + descriptionBox.height).toBeLessThanOrEqual(metadataBox.y + 1)
  expect(metadataBox.y + metadataBox.height).toBeLessThanOrEqual(targetBox.y + 1)
  expect(targetBox.y + targetBox.height).toBeLessThanOrEqual(actionsBox.y + 1)
  const viewport = page.viewportSize()
  expect(viewport).not.toBeNull()
  if (viewport) {
    expect(actionsBox.x).toBeGreaterThanOrEqual(0)
    expect(actionsBox.x + actionsBox.width).toBeLessThanOrEqual(viewport.width)
  }
}

/** Verifies the confirmation settings dialog remains usable in the active viewport. */
async function expectSettingsDialogLayout(page: Page, dialog: Locator) {
  await expectNoHorizontalOverflow(page)
  await Promise.all([
    expect(dialog.getByLabel('目标链接')).toBeVisible(),
    expect(dialog.getByLabel('跳转方式')).toBeVisible(),
    expect(dialog.getByLabel('设置过期时间', { exact: true })).toBeVisible(),
    expect(dialog.getByLabel('设置访问密码', { exact: true })).toBeVisible(),
  ])
  const controls = dialog.locator('.short-link-settings-dialog__body > *')
  const [dialogBox, actionsBox, controlBoxes] = await Promise.all([
    dialog.locator('.short-link-settings-dialog').boundingBox(),
    dialog.locator('.short-link-settings-dialog__actions').boundingBox(),
    controls.evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect()
      return { height: box.height, width: box.width, x: box.x, y: box.y }
    })),
  ])
  expect(dialogBox).not.toBeNull()
  expect(actionsBox).not.toBeNull()
  const viewport = page.viewportSize()
  expect(viewport).not.toBeNull()
  if (!dialogBox || !actionsBox || !viewport) {
    return
  }
  expect(dialogBox.x).toBeGreaterThanOrEqual(0)
  expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(viewport.width)
  for (let index = 0; index < controlBoxes.length - 1; index += 1) {
    const current = controlBoxes[index]
    const next = controlBoxes[index + 1]
    expect(current.y + current.height).toBeLessThanOrEqual(next.y + 1)
  }
  expect(controlBoxes.at(-1)?.y).toBeLessThan(actionsBox.y)
}
