import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test as base } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Page, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

type Language = 'zh-CN' | 'en'
type HintState = 'device' | 'saved' | 'unsupported' | 'unavailable'
interface User { id: string; username: string }
interface Link { id: string; slug: string }
interface Scenario { page: Page; manager: APIRequestContext; user: User; ownLink(id: string): void; revoke(): Promise<void> }
const password = 'precise-time-private-fixture'
const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, page: manager }, use, info) => {
    const accounts: User[] = [], links: string[] = [], contexts: BrowserContext[] = []
    let disabled = false, failed = false, original: unknown
    const errors: unknown[] = []
    try {
      const baseURL = info.project.use.baseURL
      if (typeof baseURL !== 'string') throw Error('Requires isolated Compose baseURL')
      await post(manager.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      const username = 'precisetime-' + randomBytes(7).toString('hex')
      const created = await manager.request.post('/api/v1/admin/user/create', { data: { username, password, nickname: 'Private precise-time fixture', groupKey: 'admin', status: 'active' } })
      const payload = await created.json() as { code: number; data: { user: User } }
      if (payload.code === 0 && payload.data.user.id) accounts.push(payload.data.user)
      expect(payload.code).toBe(0)
      const width = info.title.includes('1280px') ? 1280 : 390
      const language: Language = info.title.includes('en') ? 'en' : 'zh-CN'
      const context = await browser.newContext({ baseURL, viewport: { width, height: 900 }, locale: language, timezoneId: 'Asia/Tokyo', hasTouch: width === 390, serviceWorkers: 'block', colorScheme: 'light', reducedMotion: 'reduce' })
      contexts.push(context)
      await context.addInitScript(language => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', 'light') }, language)
      const page = await context.newPage()
      await post(page.request, '/auth/login', { username, password })
      await attach(info, 'runtime', { browser: browser.version(), driverNode: process.version, width, language, userId: payload.data.user.id, disposableDatabase: true })
      await use({ page, manager: manager.request, user: payload.data.user, ownLink(id) { links.push(id) }, async revoke() { await post(manager.request, '/admin/user/update', { id: payload.data.user.id, nickname: 'Private precise-time fixture', status: 'disabled' }); disabled = true } })
    } catch (error) { failed = true; original = error } finally {
      for (const id of links) { try { await post(manager.request, '/admin/short-link/delete', { id }) } catch (error) { errors.push(error) } }
      for (const account of accounts) { if (!disabled) { try { await post(manager.request, '/admin/user/update', { id: account.id, nickname: 'Private precise-time fixture', status: 'disabled' }) } catch (error) { errors.push(error) } } }
      for (const context of contexts) { try { await context.close() } catch (error) { errors.push(error) } }
    }
    if (failed) { if (errors.length) throw new AggregateError([original, ...errors], 'Precise-time scenario and cleanup failed'); throw original }
    if (errors.length) throw new AggregateError(errors, 'Precise-time cleanup failed')
  }, { timeout: 60_000 }],
})
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const language of ['zh-CN', 'en'] as const) for (const state of ['device', 'saved', 'unsupported', 'unavailable'] as HintState[]) {
  test('v0.37.0 mobile hint ' + state + ' ' + language + ' 390px has workspace-aligned text', async ({ scenario }, info) => {
    const { page } = scenario
    if (state === 'saved' || state === 'unsupported') await post(page.request, '/user/time-zone-preference/update', { timeZone: 'America/New_York', expectedUpdatedAt: null })
    if (state === 'unsupported') await page.addInitScript(() => {
      const Original = Intl.DateTimeFormat
      Intl.DateTimeFormat = new Proxy(Original, { construct(target, args) { if ((args[1] as Intl.DateTimeFormatOptions | undefined)?.timeZone === 'America/New_York') throw new RangeError('Controlled unsupported saved zone'); return Reflect.construct(target, args) } })
    })
    if (state === 'unavailable') await page.route('**/api/v1/user/time-zone-preference', route => route.abort('failed'))
    await page.goto('/profile')
    const hint = page.getByTestId('console-time-zone')
    if (state === 'device') await expect(hint).toHaveText(language === 'en' ? 'Time display: device local time zone' : '时间显示：设备本地时区')
    else if (state === 'saved') await expect(hint).toHaveText(language === 'en' ? 'Time display: America/New_York' : '时间显示：America/New_York')
    else await expect(hint).toContainText(state === 'unsupported' ? (language === 'en' ? 'does not support' : '不支持') : (language === 'en' ? 'is unavailable' : '暂时无法读取'))
    const geometry = await hint.evaluate(element => {
      const workspace = document.querySelector('.console-shell__workspace')!
      const box = workspace.getBoundingClientRect(), style = getComputedStyle(workspace)
      const range = document.createRange(); range.selectNodeContents(element)
      const text = range.getBoundingClientRect()
      return { textLeft: text.left, textRight: text.right, targetLeft: box.left + parseFloat(style.paddingLeft), targetRight: box.right - parseFloat(style.paddingRight), viewport: innerWidth, documentWidth: document.documentElement.scrollWidth }
    })
    await attach(info, 'hint-geometry', { state, language, geometry, controlledFailure: state === 'unsupported' || state === 'unavailable' })
    await capture(info, 'hint-' + state + '-' + language, page)
    expect(geometry.textLeft).toBeGreaterThanOrEqual(geometry.targetLeft - 1)
    expect(geometry.textRight).toBeLessThanOrEqual(geometry.targetRight + 1)
    await expectNoHorizontalOverflow(page)
  })
}

for (const width of [1280, 390]) for (const language of ['zh-CN', 'en'] as const) {
  test('v0.37.0 native exact-time disclosures ' + width + 'px ' + language, async ({ scenario }, info) => {
    const { page } = scenario
    await post(page.request, '/user/time-zone-preference/update', { timeZone: 'America/New_York', expectedUpdatedAt: null })
    const created = await page.request.post('/api/v1/short-link/create', { data: { targetUrl: 'https://example.com/precisetime-' + scenario.user.username } })
    const payload = await created.json() as { code: number; data: { shortLink: Link } }
    if (payload.code === 0 && payload.data.shortLink.id) scenario.ownLink(payload.data.shortLink.id)
    expect(payload.code).toBe(0)
    const link = payload.data.shortLink
    for (let index = 0; index < 2; index++) expect((await page.request.get('/' + link.slug, { maxRedirects: 0 })).status()).toBe(302)
    await expect.poll(async () => {
      const response = await page.request.get('/api/v1/short-link/visits?id=' + link.id + '&days=7')
      const result = await response.json() as { code: number; data: { items: unknown[] } }
      expect(result.code).toBe(0)
      return result.data.items.length
    }).toBe(2)
    const originalTimes: Record<string, string> = {}
    for (const kind of ['visits', 'audit'] as const) {
      const api = kind === 'visits' ? '/api/v1/short-link/visits' : '/api/v1/admin/audit/list'
      const pending = page.waitForResponse(response => new URL(response.url()).pathname === api)
      await page.goto(kind === 'visits' ? '/link/' + link.id + '/analytics' : '/admin/audit')
      const data = await (await pending).json() as { code: number; data: { items: { occurredAt: string }[] } }
      expect(data.code).toBe(0)
      const raw = data.data.items[0]!.occurredAt
      originalTimes[kind] = raw
      const details = page.locator(kind === 'visits' ? '.visit-records details' : '.audit-page details').first()
      const summary = details.locator('summary')
      await expect(summary.locator('time')).toHaveAttribute('datetime', raw)
      await expect(details).not.toHaveAttribute('open')
      await expect(summary).toContainText(language === 'en' ? 'Exact time' : '精确时间')
      await summary.focus()
      await summary.press('Enter')
      await expect(details).toHaveAttribute('open', '')
      await expect(summary).toBeFocused()
      await expect(details.locator('p')).toHaveText(raw)
      await summary.press('Space')
      await expect(details).not.toHaveAttribute('open')
      await expect(summary).toBeFocused()
      if (width === 390) await summary.tap(); else await summary.click()
      await expect(details).toHaveAttribute('open', '')
      await expect(details.locator('p')).toHaveText(raw)
      await capture(info, kind + '-exact-' + width + '-' + language, page)
      await expectNoHorizontalOverflow(page)
    }
    await attach(info, 'original-record-instants', originalTimes)
    await scenario.revoke()
    await page.reload()
    await expect(page.locator('.audit-page details, .visit-records details')).toHaveCount(0)
  })
}

/** Writes original observed values, without normalizing timestamp precision. */
async function attach(info: TestInfo, name: string, value: unknown) {
  const path = info.outputPath(name + '.json')
  await writeFile(path, JSON.stringify(value, null, 2))
  await info.attach(name, { path, contentType: 'application/json' })
}
/** Keeps the original viewport and all product notifications visible. */
async function capture(info: TestInfo, name: string, page: Page) {
  const path = info.outputPath(name + '.png')
  await page.screenshot({ path, animations: 'disabled' })
  await info.attach(name, { path, contentType: 'image/png' })
}
/** Validates business success for authenticated writes inside the disposable database. */
async function post(api: APIRequestContext, path: string, data: unknown) {
  const response = await api.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200)
  expect(await response.json()).toMatchObject({ code: 0 })
}
