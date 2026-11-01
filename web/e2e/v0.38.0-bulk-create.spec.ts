import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test as base } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Page, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

type Language = 'zh-CN' | 'en'
interface User { id: string; username: string }
interface Link { id: string; slug: string; url: string; targetUrl: string; status: string; redirectMode: string; intermediateDelaySeconds: number; title: string; tags: string[]; passwordEnabled: boolean; expiresAt: string | null; maxVisits: number | null }
interface Scenario { page: Page; user: User }
const password = 'bulk-create-private-fixture'
const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, page: manager }, use, info) => {
    let account: User | undefined, context: BrowserContext | undefined, page: Page | undefined
    const failures: unknown[] = []
    try {
      const baseURL = info.project.use.baseURL
      if (typeof baseURL !== 'string') throw new Error('Requires disposable Compose baseURL')
      await post(manager.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      const username = 'bulkcreate-' + randomBytes(7).toString('hex')
      const created = await manager.request.post('/api/v1/admin/user/create', { data: { username, password, nickname: 'Private bulk-create fixture', groupKey: 'admin', status: 'active' } })
      const payload = await created.json() as { code: number; data: { user: User } }
      if (payload.code === 0 && payload.data.user.id) account = payload.data.user
      expect(payload.code).toBe(0)
      if (!account) throw new Error('Disposable account was not created')
      const width = info.title.includes('1280px') ? 1280 : 390
      const language: Language = info.title.includes(' en ') ? 'en' : 'zh-CN'
      context = await browser.newContext({ baseURL, viewport: { width, height: 900 }, locale: language, hasTouch: width === 390, serviceWorkers: 'block', colorScheme: 'light', reducedMotion: 'reduce' })
      await context.addInitScript(language => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', 'light') }, language)
      page = await context.newPage()
      await post(page.request, '/auth/login', { username, password })
      await attach(info, 'runtime', { browser: browser.version(), driverNode: process.version, width, language, userId: account.id, disposableDatabase: true })
      await use({ page, user: account })
    } catch (error) { failures.push(error) } finally {
      // The fresh account belongs only to this scenario; discover links even when their response was lost.
      if (page) {
        try { for (const link of await links(page.request)) await post(manager.request, '/admin/short-link/delete', { id: link.id }) } catch (error) { failures.push(error) }
      }
      if (account) { try { await post(manager.request, '/admin/user/update', { id: account.id, nickname: 'Private bulk-create fixture', status: 'disabled' }) } catch (error) { failures.push(error) } }
      if (context) { try { await context.close() } catch (error) { failures.push(error) } }
    }
    if (failures.length) throw new AggregateError(failures, 'Bulk-create scenario or exact owned fixture cleanup failed')
  }, { timeout: 60_000 }],
})
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const language of ['zh-CN', 'en'] as const) for (const width of [1280, 390]) {
  test('v0.38.0 ' + language + ' ' + width + 'px creates once after a committed response is lost', async ({ scenario }, info) => {
    const { page } = scenario
    const availableResponse = await page.request.get('/api/v1/domain/available')
    const available = await availableResponse.json() as { code: number; data: { items: { host: string; isDefault: boolean }[] } }
    expect(available.code).toBe(0)
    const defaultDomain = available.data.items.find(domain => domain.isDefault)
    expect(defaultDomain).toBeTruthy()
    const nonce = randomBytes(7).toString('hex'), prefix = 'https://example.com/bulk-' + nonce + '-'
    const targets = [prefix + 'a'.repeat(2048 - prefix.length), 'https://example.org/bulk/' + nonce]
    expect(Buffer.byteLength(targets[0]!)).toBe(2048)
    expect(await links(page.request)).toEqual([])
    await page.goto('/link')
    const open = page.getByTestId('bulk-create-open')
    await expect(open).toHaveText(language === 'en' ? 'Create in bulk' : '批量创建')
    await open.focus(); await open.press('Enter')
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByRole('textbox').fill(' ' + targets[0] + ' \r\n\t' + targets[1] + '\t\n\n')
    const preview = page.getByTestId('bulk-create-preview')
    await preview.focus(); await preview.press('Enter')
    const list = page.getByTestId('bulk-create-preview-list')
    await expect(list.locator('li')).toHaveText(targets)
    const requestId = await page.getByTestId('bulk-create-request-id').innerText()
    expect(requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/)
    await expectNoHorizontalOverflow(page)
    await expect.poll(() => dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0)
    const geometry = await dialog.evaluate(element => { const box = element.getBoundingClientRect(); return { left: box.left, right: box.right, viewport: innerWidth } })
    expect(geometry.left).toBeGreaterThanOrEqual(0); expect(geometry.right).toBeLessThanOrEqual(geometry.viewport)
    await capture(info, 'preview-' + language + '-' + width, page)
    await expectReadableAlerts(dialog)
    const writes: unknown[] = []
    await page.route('**/api/v1/short-link/batch-create', async route => {
      writes.push(route.request().postDataJSON())
      if (writes.length === 1) {
        // The real server commits first; only this attempt's response is deliberately lost.
        const committed = await route.fetch()
        expect(await committed.json()).toMatchObject({ code: 0, data: { requestId, createdCount: 2 } })
        await route.abort('failed')
      } else await route.continue()
    })
    const submit = page.getByTestId('bulk-create-submit')
    await submit.focus(); await submit.press('Enter')
    await expect(page.getByTestId('bulk-create-error')).toContainText(language === 'en' ? 'result is unknown' : '结果未确认')
    expect(writes).toHaveLength(1)
    const committedLinks = await links(page.request)
    expect(committedLinks).toHaveLength(2)
    await expect(page.getByTestId('bulk-create-edit')).toBeDisabled()
    await page.getByTestId('bulk-create-close').click()
    await expect(page.getByTestId('bulk-create-close-warning')).toBeVisible()
    await expect(submit).toBeDisabled()
    await page.getByTestId('bulk-create-close-warning').scrollIntoViewIfNeeded()
    await capture(info, 'unknown-' + language + '-' + width, page)
    await expectReadableAlerts(dialog)
    await page.getByTestId('bulk-create-keep').click()
    await expect(page.getByTestId('bulk-create-request-id')).toHaveText(requestId)
    await submit.focus(); await submit.press('Enter')
    await expect(dialog).toBeHidden()
    expect(writes).toHaveLength(2); expect(writes[0]).toEqual(writes[1])
    expect(writes[0]).toEqual({ requestId, targetUrls: targets })
    const createdLinks = await links(page.request)
    expect(createdLinks).toHaveLength(2)
    expect(createdLinks.map(link => link.targetUrl).sort()).toEqual([...targets].sort())
    const host = new URL(defaultDomain!.host.includes('://') ? defaultDomain!.host : 'https://' + defaultDomain!.host).host
    for (const link of createdLinks) {
      expect(link).toMatchObject({ status: 'active', redirectMode: 'direct', intermediateDelaySeconds: 5, title: '', tags: [], passwordEnabled: false, expiresAt: null, maxVisits: null })
      expect(new URL(link.url).host).toBe(host)
      await expect(page.getByTestId('console-link-row').filter({ hasText: link.slug })).toBeVisible()
    }
    await attach(info, 'batch-proof', { requestId, attempts: writes.length, createdLinkIds: createdLinks.map(link => link.id), countBeforeRetry: committedLinks.length, countAfterRetry: createdLinks.length, geometry, actualCommitResponseLost: true })
    if (language === 'en' && width === 1280) {
      await page.goto('/')
      const target = page.getByLabel('Enter link', { exact: true })
      await target.fill('https://example.net/bulk-legacy-' + nonce); await target.focus(); await page.keyboard.press('Tab')
      await expect(page.getByRole('button', { name: 'Create short link', exact: true })).toBeFocused()
      const response = page.waitForResponse(result => result.url().endsWith('/short-link/create'))
      await page.keyboard.press('Enter')
      expect(await (await response).json()).toMatchObject({ code: 0 })
      await expect(page.getByTestId('short-link-create-result')).toBeVisible()
      expect(await links(page.request)).toHaveLength(3)
    }
  })
}

/** Rejects clipped recovery guidance even when the dialog itself has no horizontal overflow. */
async function expectReadableAlerts(dialog: ReturnType<Page['getByRole']>) {
  const alerts = dialog.locator('.v-alert')
  for (let index = 0; index < await alerts.count(); index += 1) {
    await expect.poll(() => alerts.nth(index).evaluate(element => {
      const alert = element.getBoundingClientRect()
      const content = element.querySelector('.v-alert__content')!
      const text = content.getBoundingClientRect()
      return text.top >= alert.top - 1 && text.bottom <= alert.bottom + 1
        && content.scrollHeight <= content.clientHeight + 1
    }), { message: 'Recovery and unknown-result guidance must not be vertically clipped' }).toBe(true)
  }
}

/** Reads only this fresh scenario account's current links, including a committed lost response. */
async function links(api: APIRequestContext): Promise<Link[]> {
  const response = await api.get('/api/v1/short-link/list?page=1&pageSize=100')
  expect(response.status()).toBe(200)
  const payload = await response.json() as { code: number; data: { items: Link[] } }
  expect(payload.code).toBe(0)
  return payload.data.items
}
/** Validates authenticated business success in the disposable database. */
async function post(api: APIRequestContext, path: string, data: unknown) {
  const response = await api.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200); expect(await response.json()).toMatchObject({ code: 0 })
}
/** Captures the original viewport without removing or hiding product notifications. */
async function capture(info: TestInfo, name: string, page: Page) {
  const path = info.outputPath(name + '.png')
  await page.screenshot({ path, animations: 'disabled' }); await info.attach(name, { path, contentType: 'image/png' })
}
/** Preserves observed browser and persistence evidence without claiming unobserved state. */
async function attach(info: TestInfo, name: string, value: unknown) {
  const path = info.outputPath(name + '.json')
  await writeFile(path, JSON.stringify(value, null, 2)); await info.attach(name, { path, contentType: 'application/json' })
}
