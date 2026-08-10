import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import {
  attachScreenshot,
  escapeRegExp,
  expectNoHorizontalOverflow,
  findShortLink,
  readVisitCount,
} from './support'

const e2ePort = process.env.MOEURL_E2E_PORT ?? '8080'
const e2eHost = `127.0.0.1:${e2ePort}`
const e2eHostPattern = escapeRegExp(e2eHost)

test('v0.2.0 intermediate-page, expiry, QR-code, and logout flows', async ({ page }, testInfo) => {
  testInfo.setTimeout(120_000)
  page.setDefaultTimeout(10_000)

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
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.getByRole('heading', { name: '个人设置' })).toBeVisible()

  await page.goto('/link')
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

  await page.goto('/')
  await page.getByRole('button', { name: '高级设置' }).click()
  await page.getByRole('button', { name: '中间页', exact: true }).click()
  const delaySlider = page.locator('.short-link-create-panel__advanced-controls').getByRole('slider')
  await expect(delaySlider).toHaveCount(1)
  await delaySlider.press('End')
  await expect(delaySlider).toHaveAttribute('aria-valuenow', '10')
  const intermediateTarget = 'https://example.com/e2e-intermediate?source=intermediate'
  await page.getByLabel('输入链接').fill(intermediateTarget)
  await page.getByRole('button', { name: '创建短链' }).click()
  const intermediateCreatedLink = page.getByRole('link', { name: new RegExp(`${e2eHostPattern}/[a-z0-9]{6}`) })
  await expect(intermediateCreatedLink).toBeVisible()
  const intermediateUrl = await intermediateCreatedLink.getAttribute('href')
  expect(intermediateUrl).toMatch(new RegExp(`^https?://${e2eHostPattern}/[a-z0-9]{6}$`))
  const intermediateSlug = new URL(intermediateUrl ?? '').pathname.slice(1)
  const intermediateLink = await findShortLink(page, intermediateSlug)
  expect(intermediateLink).toBeDefined()
  if (!intermediateLink) {
    throw new Error('intermediate short link was not returned by the personal list')
  }
  const intermediateLinkId = intermediateLink.id
  expect(await readVisitCount(page, intermediateLinkId)).toBe(0)

  await page.getByRole('button', { name: '二维码' }).click()
  const qrDialog = page.getByRole('dialog')
  const qrImage = qrDialog.getByRole('img', { name: '短链二维码' })
  await expect(qrDialog.getByText(intermediateUrl ?? '', { exact: true })).toBeVisible()
  await expect.poll(() => qrImage.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0)
  await expectQrDialogLayout(page, qrDialog, qrImage)
  await attachScreenshot(testInfo, 'qr-desktop', page)

  await page.setViewportSize({ width: 390, height: 800 })
  await expectQrDialogLayout(page, qrDialog, qrImage)
  await attachScreenshot(testInfo, 'qr-mobile', page)
  await qrDialog.getByRole('button', { name: '关闭' }).click()
  await page.setViewportSize({ width: 1280, height: 720 })

  const intermediateOpen = await page.request.get(`/${intermediateSlug}`, { maxRedirects: 0 })
  expect(intermediateOpen.status()).toBe(302)
  expect(intermediateOpen.headers().location).toBe(`/go/${intermediateSlug}`)
  expect(await readVisitCount(page, intermediateLinkId)).toBe(0)

  const continueProbeTarget = 'https://example.net/e2e-continue-probe'
  const continueProbeCreate = await page.request.post('/api/v1/short-link/create', {
    data: { targetUrl: continueProbeTarget, redirectMode: 'intermediate', intermediateDelaySeconds: 3 },
  })
  await expect(continueProbeCreate).toBeOK()
  const continueProbePayload = await continueProbeCreate.json() as {
    code: number
    data: { shortLink: { slug: string } }
  }
  expect(continueProbePayload.code).toBe(0)
  const continueProbe = await page.request.get(`/go/${continueProbePayload.data.shortLink.slug}/continue`, {
    maxRedirects: 0,
  })
  expect(continueProbe.status()).toBe(302)
  expect(continueProbe.headers().location).toBe(continueProbeTarget)

  const previewResponsePromise = page.waitForResponse((response) =>
    response.url().endsWith(`/go/${intermediateSlug}/preview`),
  )
  await page.route(intermediateTarget, (route) => route.fulfill({ status: 200, body: 'target reached' }))
  await page.goto(`/go/${intermediateSlug}`)
  const previewResponse = await previewResponsePromise
  expect(previewResponse.status()).toBe(200)
  const previewPayload = await previewResponse.json() as {
    code: number
    data: Record<string, unknown>
  }
  expect(previewPayload).toMatchObject({
    code: 0,
    data: {
      slug: intermediateSlug,
      targetHost: 'example.com',
      redirectMode: 'intermediate',
      intermediateDelaySeconds: 10,
    },
  })
  expect(previewPayload.data).not.toHaveProperty('targetUrl')
  expect(JSON.stringify(previewPayload)).not.toContain(intermediateTarget)
  await expect(page.getByText('example.com', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '立即前往' })).toBeVisible()
  await expect(page.locator('.redirect-page__countdown strong')).toHaveText(/^(?:[1-9]|10)$/)
  await expectIntermediateLayout(page)
  await attachScreenshot(testInfo, 'intermediate-desktop', page)

  await page.setViewportSize({ width: 390, height: 800 })
  await expectIntermediateLayout(page)
  await attachScreenshot(testInfo, 'intermediate-mobile', page)
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.reload()
  await expect(page.getByRole('button', { name: '立即前往' })).toBeVisible()

  await Promise.all([
    page.waitForURL(intermediateTarget),
    page.getByRole('button', { name: '立即前往' }).click(),
  ])
  await expect.poll(
    () => readVisitCount(page, intermediateLinkId),
    { intervals: [250, 500, 1_000], timeout: 30_000 },
  ).toBe(1)

  await page.goto('/link')
  const intermediateRow = page.getByTestId('console-link-row').filter({ hasText: intermediateUrl ?? '' })
  await expect(intermediateRow).toBeVisible()
  await intermediateRow.getByRole('button', { name: '更多操作' }).click()
  await intermediateRow.getByRole('menuitem', { name: '访问配置' }).click()
  const settingsDialog = page.getByRole('dialog')
  const updatedIntermediateTarget = 'https://example.org/e2e-expired'
  await settingsDialog.getByLabel('目标链接').fill(updatedIntermediateTarget)
  await settingsDialog.getByLabel('设置过期时间', { exact: true }).click()
  await expectSettingsDialogLayout(page, settingsDialog)
  await attachScreenshot(testInfo, 'settings-desktop', page)

  await page.setViewportSize({ width: 390, height: 800 })
  await expectSettingsDialogLayout(page, settingsDialog)
  await attachScreenshot(testInfo, 'settings-mobile', page)
  await page.setViewportSize({ width: 1280, height: 720 })

  const expiresAt = toLocalDateTimeValue(new Date(Date.now() + 20_000))
  const expirationInput = settingsDialog.getByLabel('过期时间（本地时间）', { exact: true })
  await setDateTimeLocalValue(expirationInput, expiresAt)
  const updateResponsePromise = page.waitForResponse('**/api/v1/short-link/update')
  await settingsDialog.getByRole('button', { name: '保存' }).click()
  const updateResponse = await updateResponsePromise
  expect(updateResponse.status()).toBe(200)
  expect(await updateResponse.json()).toMatchObject({ code: 0 })
  await expect(settingsDialog).toBeHidden()
  await expect(intermediateRow.getByText(updatedIntermediateTarget, { exact: true })).toBeVisible()

  await expect.poll(
    () => readPublicPreviewCode(page, intermediateSlug),
    { intervals: [250, 500, 1_000], timeout: 30_000 },
  ).toBe(200109)
  const expiredRedirect = await page.request.get(`/${intermediateSlug}`, { maxRedirects: 0 })
  expect(expiredRedirect.status()).toBe(302)
  expect(expiredRedirect.headers().location).toBe(`/go/${intermediateSlug}?reason=expired`)
  expect(await readVisitCount(page, intermediateLinkId)).toBe(1)

  await page.goto(expiredRedirect.headers().location!)
  await expect(page.getByRole('heading', { name: '该短链已过期。' })).toBeVisible()
  await expect(page.getByRole('button', { name: '重试' })).toHaveCount(0)
  await expectNoHorizontalOverflow(page)

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
  const disableLink = await page.request.post('/api/v1/admin/short-link/update', {
    data: { id: analyticsLink?.id, status: 'disabled' },
  })
  await expect(disableLink).toBeOK()
  expect(await disableLink.json()).toMatchObject({ code: 0 })

  const blocked = await page.request.get(`/${slug}`, { maxRedirects: 0 })
  expect(blocked.status()).toBe(302)
  expect(blocked.headers().location).toBe(`/go/${slug}?reason=disabled`)

  await page.goto(blocked.headers().location!)
  await expect(page.getByRole('heading', { name: '该短链已被停用。' })).toBeVisible()
  await expect(page.getByRole('button', { name: '重试' })).toHaveCount(0)
  await expectNoHorizontalOverflow(page)

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
  await Promise.all([
    page.waitForURL(/\/login(?:\?|$)/),
    page.getByRole('button', { name: '退出登录' }).click(),
  ])

  await page.goto('/')
  await expect(page.getByText('请登录后创建短链')).toBeVisible()
  await expect(page.getByRole('button', { name: '创建短链' })).toBeDisabled()
})

async function selectVuetifyOption(page: Page, label: string, option: string) {
  await page.getByLabel(label).locator('xpath=ancestor::*[contains(@class, "v-input")][1]').click()
  await page.getByRole('option', { name: option }).click()
}

/** Reads the public preview business code without exposing target details. */
async function readPublicPreviewCode(page: Page, slug: string) {
  const response = await page.request.get(`/go/${encodeURIComponent(slug)}/preview`)
  await expect(response).toBeOK()
  const payload = await response.json() as { code: number }
  return payload.code
}

async function setDateTimeLocalValue(locator: Locator, value: string) {
  await locator.evaluate((element, dateTime) => {
    const input = element as HTMLInputElement
    input.value = dateTime
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }, value)
}

function toLocalDateTimeValue(value: Date) {
  const pad = (part: number) => String(part).padStart(2, '0')
  return [
    value.getFullYear(),
    '-',
    pad(value.getMonth() + 1),
    '-',
    pad(value.getDate()),
    'T',
    pad(value.getHours()),
    ':',
    pad(value.getMinutes()),
    ':',
    pad(value.getSeconds()),
  ].join('')
}

async function expectQrDialogLayout(page: Page, dialog: Locator, image: Locator) {
  await expectNoHorizontalOverflow(page)
  const [dialogBox, imageBox, urlBox, actionsBox] = await Promise.all([
    dialog.boundingBox(),
    image.boundingBox(),
    dialog.locator('.short-link-qr-dialog__url').boundingBox(),
    dialog.locator('.short-link-qr-dialog__actions').boundingBox(),
  ])
  expect(dialogBox).not.toBeNull()
  expect(imageBox).not.toBeNull()
  expect(urlBox).not.toBeNull()
  expect(actionsBox).not.toBeNull()
  if (!dialogBox || !imageBox || !urlBox || !actionsBox) {
    return
  }
  expect(imageBox.x).toBeGreaterThanOrEqual(dialogBox.x)
  expect(imageBox.x + imageBox.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width + 1)
  expect(imageBox.y + imageBox.height).toBeLessThanOrEqual(urlBox.y + 1)
  expect(urlBox.y + urlBox.height).toBeLessThanOrEqual(actionsBox.y + 1)
}

async function expectIntermediateLayout(page: Page) {
  await expectNoHorizontalOverflow(page)
  const elements = [
    page.locator('.redirect-page__target'),
    page.locator('.redirect-page__countdown'),
    page.locator('.redirect-page__actions'),
  ]
  const boxes = await Promise.all(elements.map((element) => element.boundingBox()))
  expect(boxes.every(Boolean)).toBe(true)
  const [targetBox, countdownBox, actionsBox] = boxes
  if (!targetBox || !countdownBox || !actionsBox) {
    return
  }
  expect(targetBox.y + targetBox.height).toBeLessThanOrEqual(countdownBox.y + 1)
  expect(countdownBox.y + countdownBox.height).toBeLessThanOrEqual(actionsBox.y + 1)
}

/** Verifies the settings dialog remains visible and contained at the active viewport. */
async function expectSettingsDialogLayout(page: Page, dialog: Locator) {
  await expectNoHorizontalOverflow(page)
  const controls = dialog.locator('.short-link-settings-dialog__body > *')
  await Promise.all([
    expect(dialog.getByLabel('目标链接')).toBeVisible(),
    expect(dialog.getByLabel('跳转方式')).toBeVisible(),
    expect(dialog.getByLabel('设置过期时间', { exact: true })).toBeVisible(),
    expect(dialog.getByLabel('设置访问密码', { exact: true })).toBeVisible(),
  ])
  const [dialogBox, actionsBox, cancelBox, saveBox, controlBoxes] = await Promise.all([
    dialog.locator('.short-link-settings-dialog').boundingBox(),
    dialog.locator('.short-link-settings-dialog__actions').boundingBox(),
    dialog.getByRole('button', { name: '取消' }).boundingBox(),
    dialog.getByRole('button', { name: '保存' }).boundingBox(),
    controls.evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect()
      return { x: box.x, y: box.y, width: box.width, height: box.height }
    })),
  ])
  expect(dialogBox).not.toBeNull()
  expect(actionsBox).not.toBeNull()
  expect(cancelBox).not.toBeNull()
  expect(saveBox).not.toBeNull()
  if (!dialogBox || !actionsBox || !cancelBox || !saveBox) {
    return
  }
  expect(dialogBox.x).toBeGreaterThanOrEqual(0)
  const viewport = page.viewportSize()
  expect(viewport).not.toBeNull()
  if (!viewport) {
    return
  }
  expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(viewport.width)
  for (let index = 0; index < controlBoxes.length - 1; index += 1) {
    const current = controlBoxes[index]
    const next = controlBoxes[index + 1]
    expect(current.y + current.height).toBeLessThanOrEqual(next.y + 1)
  }
  expect(controlBoxes.at(-1)?.y).toBeLessThan(actionsBox.y)
  expect(cancelBox.x + cancelBox.width).toBeLessThanOrEqual(saveBox.x + 1)
}
