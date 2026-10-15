import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

type Link = { id: string; slug: string; url: string; maxVisits: number | null; visitsUsed: number; visitsRemaining: number | null; exhausted: boolean }
const target = 'https://example.com/e2e-max-visits'

test.use({ serviceWorkers: 'block' })
test.beforeEach(async ({ page }) => {
  const response = await page.request.post('/api/v1/auth/login', { data: { username: e2eAdminUsername, password: e2eAdminPassword } })
  expect(await response.json()).toMatchObject({ code: 0 })
})

/** Creates and always removes a scenario-local link, including when an assertion fails. */
async function withQuotaLink(page: Page, input: Record<string, unknown>, run: (link: Link) => Promise<void>) {
  const response = await page.request.post('/api/v1/short-link/create', { data: { targetUrl: target, maxVisits: 1, ...input } })
  const payload = await response.json() as { code: number; data: { shortLink: Link } }
  expect(payload.code).toBe(0)
  try {
    await run(payload.data.shortLink)
  } finally {
    const deleted = await page.request.post('/api/v1/short-link/delete', { data: { id: payload.data.shortLink.id } })
    expect(await deleted.json()).toMatchObject({ code: 0 })
  }
}

/** Reads authoritative quota state without waiting for asynchronous analytics recording. */
async function readQuota(page: Page, id: string): Promise<Link> {
  const response = await page.request.get(`/api/v1/short-link/statistics?id=${encodeURIComponent(id)}`)
  const payload = await response.json() as { code: number; data: { shortLink: Link } }
  expect(payload.code).toBe(0)
  return payload.data.shortLink
}

/** Checks the application's real redirect without depending on an external target's response. */
async function clickFinalRedirect(page: Page, slug: string, button: string) {
  const responsePromise = page.waitForResponse((response) => new URL(response.url()).pathname === `/go/${slug}/continue`)
  await Promise.all([
    page.waitForRequest(target),
    page.getByRole('button', { name: button, exact: true }).click({ noWaitAfter: true }),
  ])
  const response = await responsePromise
  expect(response.status()).toBe(302)
  expect(response.headers().location).toBe(target)
  await page.goto('about:blank')
}

for (const mode of ['direct', 'intermediate', 'confirmation']) {
  for (const protectedLink of [false, true]) {
    test(`${mode} ${protectedLink ? 'protected' : 'public'} consumes only the final redirect`, async ({ page }) => {
      await withQuotaLink(page, {
        redirectMode: mode,
        ...(mode === 'intermediate' ? { intermediateDelaySeconds: 10 } : {}),
        ...(protectedLink ? { password: { mode: 'set', value: 'quota-password' } } : {}),
      }, async (link) => {
        if (mode === 'intermediate') {
          await page.clock.install()
          await page.clock.pauseAt(new Date(Date.now() + 1_000))
        }
        if (mode === 'direct' && !protectedLink) {
          const opened = await page.request.get(`/${link.slug}`, { maxRedirects: 0 })
          expect(opened.status()).toBe(302)
          expect(opened.headers().location).toBe(target)
        } else {
          await page.goto(`/${link.slug}`)
        }
        if (protectedLink) {
          await expect(page.getByLabel('访问密码')).toBeVisible()
          const rejected = await page.request.post(`/go/${link.slug}/unlock`, { data: { password: 'wrong-password' } })
          expect(await rejected.json()).toMatchObject({ code: 200112 })
          expect(await readQuota(page, link.id)).toMatchObject({ visitsUsed: 0, visitsRemaining: 1 })
          await page.getByLabel('访问密码').fill('quota-password')
          if (mode === 'direct') {
            await clickFinalRedirect(page, link.slug, '解锁并继续')
          } else {
            await page.getByRole('button', { name: '解锁并继续' }).click()
          }
        }
        if (mode !== 'direct') {
          const continueButton = page.getByRole('button', { name: mode === 'confirmation' ? '继续访问' : '立即前往', exact: true })
          await expect(continueButton).toBeVisible()
          const preview = await page.request.get(`/go/${link.slug}/preview`)
          const previewPayload = await preview.json()
          expect(previewPayload.code).toBe(0)
          for (const key of ['maxVisits', 'visitsUsed', 'visitsRemaining', 'exhausted']) expect(previewPayload.data).not.toHaveProperty(key)
          expect(await readQuota(page, link.id)).toMatchObject({ visitsUsed: 0, visitsRemaining: 1 })
          await clickFinalRedirect(page, link.slug, mode === 'confirmation' ? '继续访问' : '立即前往')
        }
        expect(await readQuota(page, link.id)).toMatchObject({ visitsUsed: 1, visitsRemaining: 0, exhausted: true })
        await page.goto(`/${link.slug}`)
        await expect(page.getByRole('heading', { name: '访问次数已用完' })).toBeVisible()
        await page.setViewportSize({ width: 390, height: 800 })
        await expectNoHorizontalOverflow(page)
        const denied = await page.request.get(`/go/${link.slug}/preview`)
        expect(await denied.json()).toMatchObject({ code: 200115 })
      })
    })
  }
}

test('only one simultaneous visitor receives the last redirect', async ({ page }) => {
  await withQuotaLink(page, {}, async (link) => {
    const responses = await Promise.all(Array.from({ length: 8 }, () => page.request.get(`/${link.slug}`, { maxRedirects: 0 })))
    expect(responses.every((response) => response.status() === 302)).toBe(true)
    expect(responses.filter((response) => response.headers().location === target)).toHaveLength(1)
    expect(responses.filter((response) => response.headers().location === `/go/${link.slug}?reason=exhausted`)).toHaveLength(7)
    expect(await readQuota(page, link.id)).toMatchObject({ visitsUsed: 1, exhausted: true })
  })
})

test('creates a limited link from the shared form', async ({ page }) => {
  await page.goto('/')
  await page.getByLabel('输入链接', { exact: true }).fill(target)
  await page.getByRole('button', { name: '高级设置' }).click()
  await page.getByLabel('设置最大访问次数', { exact: true }).check()
  await page.getByLabel('最大访问次数', { exact: true }).fill('2')
  const created = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/short-link/create')
  await page.getByRole('button', { name: '创建短链', exact: true }).click()
  const payload = await (await created).json() as { code: number; data: { shortLink: Link } }
  expect(payload.code).toBe(0)
  try {
    expect(payload.data.shortLink).toMatchObject({ maxVisits: 2, visitsUsed: 0, visitsRemaining: 2, exhausted: false })
    await expect(page.getByTestId('short-link-create-result')).toBeVisible()
    await expect(page.getByLabel('设置最大访问次数', { exact: true })).not.toBeChecked()
  } finally {
    const deleted = await page.request.post('/api/v1/short-link/delete', { data: { id: payload.data.shortLink.id } })
    expect(await deleted.json()).toMatchObject({ code: 0 })
  }
})

test('the editor preserves usage when raising the limit and resets it only on clearing', async ({ page }) => {
  await withQuotaLink(page, {}, async (link) => {
    const opened = await page.request.get(`/${link.slug}`, { maxRedirects: 0 })
    expect(opened.status()).toBe(302)
    expect(opened.headers().location).toBe(target)
    await page.goto('/link')
    const row = page.getByTestId('console-link-row').filter({ hasText: link.url })
    await expect(row.getByTestId('visit-limit')).toContainText('已用 1 / 1')
    await row.getByRole('button', { name: '更多操作' }).click()
    await page.getByRole('menu').getByRole('menuitem', { name: '访问配置' }).click()
    let dialog = page.getByRole('dialog')
    await dialog.getByLabel('最大访问次数', { exact: true }).fill('2')
    await page.setViewportSize({ width: 390, height: 800 })
    await expectNoHorizontalOverflow(page)
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    expect(await readQuota(page, link.id)).toMatchObject({ maxVisits: 2, visitsUsed: 1, visitsRemaining: 1 })
    await row.getByRole('button', { name: '更多操作' }).click()
    await page.getByRole('menu').getByRole('menuitem', { name: '访问配置' }).click()
    dialog = page.getByRole('dialog')
    await dialog.getByLabel('设置最大访问次数', { exact: true }).uncheck()
    await expect(dialog.getByText('取消上限会清空当前额度用量；以后重新设置将从零开始。')).toBeVisible()
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    await expect(dialog).not.toBeVisible()
    expect(await readQuota(page, link.id)).toMatchObject({ maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false })
  })
})
