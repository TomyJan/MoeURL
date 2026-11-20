import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, Browser, BrowserContext, Page, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

interface Link { id: string; slug: string; url: string; targetUrl: string }
interface Group { key: string; updatedAt: string; permissions: string[] }
interface User { id: string; username: string }
test.describe.configure({ mode: 'serial' })
test.use({ actionTimeout: 10_000 })

/** Uses real session transport and checks both infrastructure and business responses. */
async function api<T>(request: APIRequestContext, path: string, data?: unknown): Promise<T> {
  const response = data === undefined ? await request.get('/api/v1' + path) : await request.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200)
  const payload = await response.json(); expect(payload.code).toBe(0)
  return payload.data as T
}
/** Reads the actual group revision before each explicit permission update. */
async function group(request: APIRequestContext, key: string) {
  const found = (await api<{ groups: Group[] }>(request, '/admin/user-group/list')).groups.find(item => item.key === key)
  if (!found) throw new Error('Missing disposable group')
  return found
}
async function grants(request: APIRequestContext, key: string, permissions: string[]) {
  const current = await group(request, key)
  await api(request, '/admin/user-group/update-permissions', { groupKey: key, expectedUpdatedAt: current.updatedAt, permissions })
}
/** Closes existing feedback before interacting with another toolbar or pagination control. */
async function dismissFeedback(page: Page) {
  const controls = page.locator('[data-sonner-toast][data-removed="false"] button[data-close-button]')
  while (await controls.count()) {
    const before = await controls.count(); await controls.first().click()
    await expect.poll(() => controls.count()).toBeLessThan(before)
  }
}
/** Restores group grants, deletes only owned records and disables the disposable account. */
async function scenario(browser: Browser, manager: APIRequestContext, info: TestInfo, language: string, width: number, admin: boolean, run: (page: Page, links: Link[]) => Promise<void>) {
  const baseURL = info.project.use.baseURL
  if (typeof baseURL !== 'string') throw new Error('Disposable Compose baseURL required')
  const keyword = 'copy79-' + randomBytes(6).toString('hex'), password = 'selected-copy-disposable-account', key = admin ? 'admin' : 'user'
  const links: Link[] = [], errors: unknown[] = []
  let original: Group | undefined, actor: User | undefined, context: BrowserContext | undefined
  try {
    await api(manager, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
    original = await group(manager, key)
    actor = (await api<{ user: User }>(manager, '/admin/user/create', { username: keyword, password, nickname: keyword, groupKey: key, status: 'active' })).user
    context = await browser.newContext({ baseURL, viewport: { width, height: width === 320 ? 640 : 900 }, locale: language, colorScheme: language === 'en' ? 'dark' : 'light', hasTouch: width === 320, serviceWorkers: 'block', reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] })
    await context.addInitScript(language => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', language === 'en' ? 'dark' : 'light') }, language)
    await api(context.request, '/auth/login', { username: actor.username, password })
    for (let i = 0; i < 22; i++) links.push((await api<{ shortLink: Link }>(context.request, '/short-link/create', { targetUrl: 'https://example.com/private-' + keyword + '/' + i, metadata: { title: keyword, tags: [] } })).shortLink)
    await grants(manager, key, admin ? original.permissions.filter(value => value !== 'short_link:export') : ['short_link:read_own'])
    const permissions = (await api<{ user: { permissions: string[] } }>(context.request, '/auth/me')).user.permissions
    expect(permissions).not.toContain('short_link:export')
    if (!admin) expect(permissions).toEqual(['short_link:read_own'])
    const page = await context.newPage(); await page.bringToFront()
    await page.goto(admin ? '/admin/link' : '/link')
    const listPath = '/api/v1' + (admin ? '/admin' : '') + '/short-link/list'
    const filtered = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === listPath && url.searchParams.get('q') === keyword })
    await page.getByRole('textbox', { name: language === 'en' ? 'Keyword' : '关键词搜索', exact: true }).fill(keyword)
    const payload = await (await filtered).json() as { code: number; data: { items: Link[] }; meta: { total: number } }
    expect(payload.code).toBe(0); expect(payload.meta.total).toBe(22); expect(payload.data.items).toHaveLength(20)
    await run(page, links)
    const output = info.outputPath('runtime.json')
    await writeFile(output, JSON.stringify({ browser: browser.version(), driverNode: process.version, language, width, admin, withoutExport: true, readOnlyOwn: !admin, ownedLinks: links.length, realClipboardSuccess: true, controlledRejectedPromise: true, realOSPermissionDenied: false }, null, 2))
    await info.attach('runtime', { path: output, contentType: 'application/json' })
  } catch (error) { errors.push(error) } finally {
    if (original) try { await grants(manager, key, original.permissions); expect((await group(manager, key)).permissions).toEqual(original.permissions) } catch (error) { errors.push(error) }
    for (const link of links) try { await api(manager, '/admin/short-link/delete', { id: link.id }) } catch (error) { errors.push(error) }
    if (actor) try { await api(manager, '/admin/user/update', { id: actor.id, nickname: keyword, status: 'disabled' }) } catch (error) { errors.push(error) }
    if (context) await context.close().catch(error => errors.push(error))
  }
  if (errors.length) throw new AggregateError(errors, 'Selected copy scenario or owned cleanup failed')
}

// Whole-page, click-order, destination or stale-selection copying breaks the native clipboard checks.
for (const language of ['zh-CN', 'en']) for (const width of [1280, 320]) for (const admin of [false, true]) {
  test('v0.79.0 ' + language + ' ' + width + 'px ' + (admin ? 'admin' : 'read-only own') + ' copies selected public links and preserves whole-page copy', async ({ browser, request }, info) => {
    test.setTimeout(150_000)
    await scenario(browser, request, info, language, width, admin, async (page, links) => {
      const en = language === 'en', selected = page.getByTestId('short-link-selected-copy'), whole = page.getByTestId('short-link-page-copy')
      await expect(whole).toBeEnabled()
      await expect(selected).toBeDisabled()
      const rows = page.getByTestId('console-link-row')
      await expect(rows).toHaveCount(20)
      const urls = await rows.locator('a.link-table__url:not(.link-table__target)').allTextContents()
      const choose = async (index: number) => { await rows.nth(index).getByRole('checkbox').check() }
      await choose(2); await choose(0)
      await expect(selected).toBeEnabled()
      await page.evaluate(() => {
        const values: string[] = [], native = navigator.clipboard.writeText.bind(navigator.clipboard)
        Object.defineProperty(window, '__selectedCopyPayloads', { configurable: true, value: values })
        Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: (text: string) => { values.push(text); return native(text) } })
      })
      let reads = 0
      page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/short-link/list')) reads++ })
      await selected.focus(); await selected.press('Enter')
      const expected = urls[0] + '\n' + urls[2]
      expect(await page.evaluate(() => (window as unknown as { __selectedCopyPayloads: string[] }).__selectedCopyPayloads)).toEqual([expected])
      await expect.poll(() => page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, '\n'))).toBe(expected)
      await expect(page.getByText(en ? 'Copied 2 selected links' : '已复制 2 条所选短链', { exact: true })).toBeVisible()
      for (const link of links) expect(expected).not.toContain(link.targetUrl)
      expect(reads).toBe(0)
      if (!admin) for (const id of ['batch-enable', 'batch-disable', 'batch-delete', 'batch-tags']) await expect(page.getByTestId(id)).toHaveCount(0)
      await expectNoHorizontalOverflow(page)
      await selected.scrollIntoViewIfNeeded(); await expect(selected).toBeInViewport({ ratio: 1 })
      const image = info.outputPath('selected-links-copy.png'); await page.screenshot({ path: image, animations: 'disabled' }); await info.attach('selected-links-copy', { path: image, contentType: 'image/png' })
      await dismissFeedback(page)
      await whole.click()
      await expect.poll(() => page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, '\n'))).toBe(urls.join('\n'))
      await expect(page.getByText(en ? 'Copied 20 links from this page' : '已复制 20 条本页短链', { exact: true })).toBeVisible()
      expect(reads).toBe(0)
      await dismissFeedback(page)
      await page.getByRole('button', { name: en ? 'Next page' : '下一页', exact: true }).click()
      await expect(rows).toHaveCount(2); await expect(whole).toBeEnabled(); await expect(selected).toBeEnabled()
      await choose(1)
      const last = await rows.nth(1).locator('a.link-table__url:not(.link-table__target)').textContent()
      if (width === 320) await selected.tap(); else await selected.click()
      const crossPageExpected = urls[2] + '\n' + urls[0] + '\n' + last
      await expect.poll(() => page.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, '\n'))).toBe(crossPageExpected)
      await expect(page.getByText(en ? 'Copied 3 selected links' : '已复制 3 条所选短链', { exact: true })).toBeVisible()
      expect(reads).toBe(1)
      await dismissFeedback(page)
      // Only substitutes the OS rejection boundary, never claims actual OS permission denial.
      await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('private OS diagnostic')) } }) })
      await selected.click()
      await expect(page.getByText(en ? 'Copy failed. Check browser clipboard permissions and try again.' : '复制失败，请检查浏览器剪贴板权限后重试。', { exact: true })).toBeVisible()
      await expect(selected).toBeEnabled(); expect(reads).toBe(1)
    })
  })
}
