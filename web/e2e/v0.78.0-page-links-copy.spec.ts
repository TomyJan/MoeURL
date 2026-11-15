import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, Browser, BrowserContext, Page, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

interface Link { id: string; url: string; targetUrl: string }
interface Group { key: string; updatedAt: string; permissions: string[] }
interface User { id: string; username: string }
test.describe.configure({ mode: 'serial' })

/** Uses real Cookie Session transport and rejects both HTTP and business failures. */
async function api<T>(request: APIRequestContext, path: string, data?: unknown): Promise<T> {
  const response = data === undefined ? await request.get('/api/v1' + path) : await request.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200)
  const payload = await response.json(); expect(payload.code).toBe(0)
  return payload.data as T
}
async function group(request: APIRequestContext, key: string) {
  const value = (await api<{ groups: Group[] }>(request, '/admin/user-group/list')).groups.find(item => item.key === key)
  if (!value) throw new Error('Missing disposable group')
  return value
}
async function grants(request: APIRequestContext, key: string, permissions: string[]) {
  const current = await group(request, key)
  await api(request, '/admin/user-group/update-permissions', { groupKey: key, expectedUpdatedAt: current.updatedAt, permissions })
}

/** Restores exact group permissions, deletes only owned links and disables the disposable account. */
async function scenario(browser: Browser, manager: APIRequestContext, info: TestInfo, language: string, width: number, admin: boolean, run: (page: Page, context: BrowserContext, keyword: string, links: Link[]) => Promise<void>) {
  const baseURL = info.project.use.baseURL
  if (typeof baseURL !== 'string') throw new Error('Requires disposable Compose baseURL')
  const keyword = 'copy78-' + randomBytes(6).toString('hex'), password = 'page-copy-disposable-account', key = admin ? 'admin' : 'user'
  const links: Link[] = [], errors: unknown[] = []
  let context: BrowserContext | undefined, original: Group | undefined, actor: User | undefined
  try {
    await api(manager, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
    original = await group(manager, key)
    actor = (await api<{ user: User }>(manager, '/admin/user/create', { username: keyword, password, nickname: keyword, groupKey: key, status: 'active' })).user
    context = await browser.newContext({ baseURL, viewport: { width, height: width === 320 ? 640 : 900 }, locale: language, colorScheme: language === 'en' ? 'dark' : 'light', hasTouch: width === 320, serviceWorkers: 'block', reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] })
    await context.addInitScript(language => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', language === 'en' ? 'dark' : 'light') }, language)
    await api(context.request, '/auth/login', { username: actor.username, password })
    for (let i = 0; i < 22; i++) links.push((await api<{ shortLink: Link }>(context.request, '/short-link/create', { targetUrl: 'https://example.com/private-' + keyword + '/' + i, metadata: { title: keyword, tags: [] } })).shortLink)
    await grants(manager, key, admin ? original.permissions.filter(value => value !== 'short_link:export') : ['short_link:read_own'])
    const me = await api<{ user: { permissions: string[] } }>(context.request, '/auth/me')
    expect(me.user.permissions).not.toContain('short_link:export')
    const page = await context.newPage(); await page.bringToFront()
    await run(page, context, keyword, links)
    const data = { browser: browser.version(), driverNode: process.version, language, width, admin, withoutExport: true, ownedLinkCount: links.length, realClipboardSuccess: true }
    const output = info.outputPath('runtime.json'); await writeFile(output, JSON.stringify(data, null, 2)); await info.attach('runtime', { path: output, contentType: 'application/json' })
  } catch (error) { errors.push(error) } finally {
    if (original) try { await grants(manager, key, original.permissions); expect((await group(manager, key)).permissions).toEqual(original.permissions) } catch (error) { errors.push(error) }
    for (const link of links) try { await api(manager, '/admin/short-link/delete', { id: link.id }) } catch (error) { errors.push(error) }
    if (actor) try { await api(manager, '/admin/user/update', { id: actor.id, nickname: keyword, status: 'disabled' }) } catch (error) { errors.push(error) }
    if (context) await context.close().catch(error => errors.push(error))
  }
  if (errors.length) throw new AggregateError(errors, 'Page copy scenario or owned cleanup failed')
}

// Copying destination URLs, all matches or stale page one breaks the real OS clipboard assertions.
for (const language of ['zh-CN', 'en']) for (const width of [1280, 320]) for (const admin of [false, true]) {
  test('v0.78.0 ' + language + ' ' + width + 'px ' + (admin ? 'admin' : 'own') + ' copies only the filtered current page without export permission', async ({ browser, request }, info) => {
    test.setTimeout(150_000)
    await scenario(browser, request, info, language, width, admin, async (page, context, keyword, links) => {
      const path = '/api/v1' + (admin ? '/admin' : '') + '/short-link/list'
      const copy = page.getByTestId('short-link-page-copy')
      await page.goto(admin ? '/admin/link' : '/link')
      const keywordField = page.getByRole('textbox', { name: language === 'en' ? 'Keyword' : '关键词搜索', exact: true })
      const filtered = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === path && url.searchParams.get('q') === keyword })
      await keywordField.fill(keyword)
      const first = await (await filtered).json() as { data: { items: Link[] }; meta: { total: number } }
      expect(first.meta.total).toBe(22); expect(first.data.items).toHaveLength(20)
      await expect(copy).toBeEnabled(); await expect(copy).toHaveAccessibleName(language === 'en' ? 'Copy links on this page' : '复制本页短链')
      let listReads = 0; page.on('request', request => { if (new URL(request.url()).pathname === path) listReads++ })
      await copy.focus(); await copy.press('Enter')
      const expected = first.data.items.map(item => item.url).join('\n')
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expected)
      await expect(page.getByText(language === 'en' ? 'Copied 20 links from this page' : '已复制 20 条本页短链', { exact: true })).toBeVisible()
      expect(expected.split('\n')).toHaveLength(20); expect(expected.endsWith('\n')).toBe(false)
      for (const link of links) expect(expected).not.toContain(link.targetUrl)
      expect(listReads).toBe(0)
      await expectNoHorizontalOverflow(page)
      await copy.scrollIntoViewIfNeeded(); await expect(copy).toBeInViewport({ ratio: 1 })
      const image = info.outputPath('current-page-copy.png'); await page.screenshot({ path: image, animations: 'disabled' }); await info.attach('current-page-copy', { path: image, contentType: 'image/png' })
      const secondResponse = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === path && url.searchParams.get('q') === keyword && url.searchParams.get('page') === '2' })
      await page.getByRole('button', { name: language === 'en' ? 'Next page' : '下一页', exact: true }).click()
      const second = await (await secondResponse).json() as { data: { items: Link[] } }
      expect(second.data.items).toHaveLength(2); await expect(copy).toBeEnabled()
      if (width === 320) await copy.tap(); else await copy.click()
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(second.data.items.map(item => item.url).join('\n'))
      expect(first.data.items.map(item => item.id)).not.toContain(second.data.items[0]!.id)
      expect(listReads).toBe(1)
      // Only the OS failure boundary is replaced; real page/cache/feedback remain intact.
      await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('private OS diagnostic')) } }) })
      await copy.click()
      await expect(page.getByText(language === 'en' ? 'Copy failed. Check browser clipboard permissions and try again.' : '复制失败，请检查浏览器剪贴板权限后重试。', { exact: true })).toBeVisible()
      await expect(copy).toBeEnabled(); expect(listReads).toBe(1)
      await context.clearPermissions()
    })
  })
}
