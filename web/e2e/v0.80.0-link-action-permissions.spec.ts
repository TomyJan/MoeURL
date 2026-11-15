import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, Browser, BrowserContext, Page, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

interface Link { id: string; slug: string; url: string; targetUrl: string; status: string }
interface Group { key: string; updatedAt: string; permissions: string[] }
interface User { id: string; username: string }
test.describe.configure({ mode: 'serial' })
test.use({ actionTimeout: 10_000 })

/** Requires a real disposable session and a successful business envelope. */
async function api<T>(request: APIRequestContext, path: string, data?: unknown): Promise<T> {
  const response = data === undefined ? await request.get('/api/v1' + path) : await request.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200)
  const payload = await response.json(); expect(payload.code).toBe(0)
  return payload.data as T
}
async function group(request: APIRequestContext, key: string) {
  const result = (await api<{ groups: Group[] }>(request, '/admin/user-group/list')).groups.find(item => item.key === key)
  if (!result) throw new Error('Disposable group missing')
  return result
}
async function grants(request: APIRequestContext, key: string, permissions: string[]) {
  const current = await group(request, key)
  await api(request, '/admin/user-group/update-permissions', { groupKey: key, expectedUpdatedAt: current.updatedAt, permissions })
}
async function dismissFeedback(page: Page) {
  const controls = page.locator('[data-sonner-toast][data-removed="false"] button[data-close-button]')
  while (await controls.count()) {
    const before = await controls.count(); await controls.first().click()
    await expect.poll(() => controls.count()).toBeLessThan(before)
  }
}

/** Restores shared group permissions before deleting owned fixtures and disabling their account. */
async function scenario(browser: Browser, manager: APIRequestContext, info: TestInfo, language: string, width: number, admin: boolean, run: (page: Page, link: Link, keyword: string) => Promise<void>) {
  const baseURL = info.project.use.baseURL
  if (typeof baseURL !== 'string') throw new Error('Disposable Compose baseURL required')
  const keyword = 'row80-' + randomBytes(6).toString('hex'), password = randomBytes(18).toString('hex'), key = admin ? 'admin' : 'user'
  const errors: unknown[] = []
  let original: Group | undefined, actor: User | undefined, context: BrowserContext | undefined, link: Link | undefined
  try {
    await api(manager, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
    original = await group(manager, key)
    actor = (await api<{ user: User }>(manager, '/admin/user/create', { username: keyword, password, nickname: keyword, groupKey: key, status: 'active' })).user
    context = await browser.newContext({ baseURL, viewport: { width, height: width === 320 ? 640 : 900 }, locale: language, colorScheme: language === 'en' ? 'dark' : 'light', hasTouch: width === 320, serviceWorkers: 'block', reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] })
    await context.addInitScript(language => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', language === 'en' ? 'dark' : 'light') }, language)
    await api(context.request, '/auth/login', { username: actor.username, password })
    link = (await api<{ shortLink: Link }>(context.request, '/short-link/create', { targetUrl: 'https://example.com/private-' + keyword, metadata: { title: keyword, tags: [] } })).shortLink
    if (!admin) await grants(manager, key, ['short_link:read_own'])
    const permissions = (await api<{ user: { permissions: string[] } }>(context.request, '/auth/me')).user.permissions
    if (!admin) expect(permissions).toEqual(['short_link:read_own'])
    else for (const permission of ['admin:access', 'short_link:read_all', 'short_link:update_all', 'short_link:delete_all']) expect(permissions).toContain(permission)
    const page = await context.newPage(); await page.bringToFront()
    await page.goto(admin ? '/admin/link' : '/link')
    const path = '/api/v1' + (admin ? '/admin' : '') + '/short-link/list'
    const filtered = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === path && url.searchParams.get('q') === keyword })
    await page.getByRole('textbox', { name: language === 'en' ? 'Keyword' : '关键词搜索', exact: true }).fill(keyword)
    const payload = await (await filtered).json() as { code: number; data: { items: Link[] }; meta: { total: number } }
    expect(payload.code).toBe(0); expect(payload.meta.total).toBe(1); expect(payload.data.items).toHaveLength(1)
    await run(page, link, keyword)
    const output = info.outputPath('runtime.json')
    await writeFile(output, JSON.stringify({ browser: browser.version(), driverNode: process.version, language, width, admin, readOnlyOwn: !admin, nativeClipboardSuccess: true, realQR: true, authorizedStatusAndSettings: admin }, null, 2))
    await info.attach('runtime', { path: output, contentType: 'application/json' })
  } catch (error) { errors.push(error) } finally {
    if (original && !admin) try { await grants(manager, key, original.permissions); expect((await group(manager, key)).permissions).toEqual(original.permissions) } catch (error) { errors.push(error) }
    if (link) try { await api(manager, '/admin/short-link/delete', { id: link.id }) } catch (error) { errors.push(error) }
    if (actor) try { await api(manager, '/admin/user/update', { id: actor.id, nickname: keyword, status: 'disabled' }) } catch (error) { errors.push(error) }
    if (context) await context.close().catch(error => errors.push(error))
  }
  if (errors.length) throw new AggregateError(errors, 'Row authority scenario or fixture restoration failed')
}

// Unconditional write entries break read-only cases; overblocking breaks real authorized writes.
for (const language of ['zh-CN', 'en']) for (const width of [1280, 320]) for (const admin of [false, true]) {
  test('v0.80.0 ' + language + ' ' + width + 'px ' + (admin ? 'admin writes' : 'read-only own menu'), async ({ browser, request }, info) => {
    test.setTimeout(150_000)
    await scenario(browser, request, info, language, width, admin, async (page, link, keyword) => {
      const en = language === 'en', row = page.getByTestId('console-link-row')
      const writes: string[] = []
      page.on('request', request => { if (request.method() === 'POST' && /\/short-link\/(update|delete)$/.test(new URL(request.url()).pathname)) writes.push(request.url()) })
      await expect(row).toHaveCount(1)
      await row.getByRole('button', { name: en ? 'Copy' : '复制', exact: true }).click()
      await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(link.url)
      const more = row.getByRole('button', { name: en ? 'More actions' : '更多操作', exact: true })
      await more.click()
      for (const name of [en ? 'Access settings' : '访问配置', en ? 'Disable' : '禁用', en ? 'Delete' : '删除']) {
        const item = page.getByRole('menuitem', { name, exact: true })
        if (admin) await expect(item).toBeVisible(); else await expect(item).toHaveCount(0)
      }
      await expect(page.getByRole('menuitem', { name: en ? 'Open' : '打开', exact: true })).toHaveAttribute('href', link.url)
      await expectNoHorizontalOverflow(page)
      const image = info.outputPath('row-action-menu.png'); await page.screenshot({ path: image, animations: 'disabled' }); await info.attach('row-action-menu', { path: image, contentType: 'image/png' })
      await page.getByRole('menuitem', { name: en ? 'QR code' : '二维码', exact: true }).click()
      const qr = page.getByRole('dialog', { name: en ? 'Short-link QR code' : '短链二维码' })
      await expect(qr.getByRole('img')).toBeVisible()
      await expect(qr.getByText(link.url, { exact: true })).toBeVisible()
      await qr.getByRole('button', { name: en ? 'Close' : '关闭', exact: true }).click()
      await expect(qr).toHaveCount(0)
      if (admin) {
        for (const [label, status] of [[en ? 'Disable' : '禁用', 'disabled'], [en ? 'Enable' : '启用', 'active']] as const) {
          await dismissFeedback(page); await more.click()
          const updated = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/admin/short-link/update')
          const listed = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/v1/admin/short-link/list')
          await page.getByRole('menuitem', { name: label, exact: true }).click()
          const response = await updated; expect(response.request().postDataJSON()).toEqual({ id: link.id, status }); expect((await response.json()).code).toBe(0)
          const result = await (await listed).json() as { code: number; data: { items: Link[] } }
          expect(result.code).toBe(0); expect(result.data.items.find(item => item.id === link.id)?.status).toBe(status)
        }
        await dismissFeedback(page); await more.click()
        await page.getByRole('menuitem', { name: en ? 'Access settings' : '访问配置', exact: true }).click()
        const settings = page.getByRole('dialog'), target = 'https://example.com/updated-' + keyword
        await settings.getByRole('textbox', { name: en ? 'Target URL' : '目标链接', exact: true }).fill(target)
        const saved = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/admin/short-link/update')
        await settings.getByRole('button', { name: en ? 'Save' : '保存', exact: true }).click()
        const response = await saved; expect(response.request().postDataJSON()).toMatchObject({ id: link.id, targetUrl: target }); expect((await response.json()).code).toBe(0)
        await expect(settings).toHaveCount(0); await expect(row.locator('a.link-table__target')).toHaveAttribute('href', target)
      }
      expect(writes).toHaveLength(admin ? 3 : 0)
    })
  })
}
