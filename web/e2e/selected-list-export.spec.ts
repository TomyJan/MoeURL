import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, Browser, BrowserContext, Download, Page, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

interface Link { id: string; slug: string; url: string; title: string }
interface Group { key: string; updatedAt: string; permissions: string[] }
interface User { id: string; username: string }
const header = '\uFEFFid,short_url,slug,target_url,title,tags,status,redirect_mode,intermediate_delay_seconds,expires_at,password_enabled,max_visits,visits_used,created_at,updated_at,owner_id,owner_username\r\n'
test.describe.configure({ mode: 'serial' })
test.use({ actionTimeout: 10_000 })

/** Checks real session transport and business status without replacing any product layer. */
async function api<T>(request: APIRequestContext, path: string, data?: unknown): Promise<T> {
  const response = data === undefined ? await request.get('/api/v1' + path) : await request.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200)
  const payload = await response.json(); expect(payload.code).toBe(0)
  return payload.data as T
}
/** Reads the actual revision before changing disposable-environment group grants. */
async function group(request: APIRequestContext, key: string) {
  const result = (await api<{ groups: Group[] }>(request, '/admin/user-group/list')).groups.find(value => value.key === key)
  if (!result) throw new Error('Missing disposable group')
  return result
}
/** Preserves optimistic concurrency even for temporary permission fixtures. */
async function grants(request: APIRequestContext, key: string, permissions: string[]) {
  const current = await group(request, key)
  await api(request, '/admin/user-group/update-permissions', { groupKey: key, expectedUpdatedAt: current.updatedAt, permissions })
}
/** Confirms that the browser produced a real downloadable file, without claiming user-disk persistence. */
async function content(download: Download, fileName: string, info: TestInfo, label: string) {
  expect(download.suggestedFilename()).toBe(fileName)
  expect(await download.failure()).toBeNull()
  const path = await download.path()
  if (!path) throw new Error('Browser download file unavailable')
  const bytes = await readFile(path), text = bytes.toString('utf8')
  expect(bytes.subarray(0, 3)).toEqual(Buffer.from([239, 187, 191]))
  expect(text.startsWith(header)).toBe(true)
  await info.attach(label, { path, contentType: 'text/csv' })
  return text
}
/** Closes actual feedback before operating another control in the narrow viewport. */
async function dismissFeedback(page: Page) {
  const buttons = page.locator('[data-sonner-toast][data-removed="false"] button[data-close-button]')
  while (await buttons.count()) {
    const count = await buttons.count(); await buttons.first().click()
    await expect.poll(() => buttons.count()).toBeLessThan(count)
  }
}
/** Restores grants, soft-deletes owned links and disables only the account created here. */
async function scenario(browser: Browser, manager: APIRequestContext, info: TestInfo, language: string, width: number, admin: boolean, run: (page: Page, links: Link[], keyword: string) => Promise<void>) {
  const baseURL = info.project.use.baseURL
  if (typeof baseURL !== 'string') throw new Error('Disposable product baseURL required')
  const keyword = 'selected85-' + randomBytes(6).toString('hex'), password = 'selected-csv-disposable-account', key = admin ? 'admin' : 'user'
  const links: Link[] = [], errors: unknown[] = []
  let original: Group | undefined, actor: User | undefined, context: BrowserContext | undefined
  try {
    await api(manager, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
    original = await group(manager, key)
    actor = (await api<{ user: User }>(manager, '/admin/user/create', { username: keyword, password, nickname: keyword, groupKey: key, status: 'active' })).user
    context = await browser.newContext({ baseURL, viewport: { width, height: width === 320 ? 640 : 900 }, locale: language, colorScheme: language === 'en' ? 'dark' : 'light', hasTouch: width === 320, serviceWorkers: 'block', reducedMotion: 'reduce', acceptDownloads: true })
    await context.addInitScript(language => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', language === 'en' ? 'dark' : 'light') }, language)
    await api(context.request, '/auth/login', { username: actor.username, password })
    for (let index = 0; index < 22; index++) links.push((await api<{ shortLink: Link }>(context.request, '/short-link/create', {
      targetUrl: 'https://example.com/' + keyword + '/' + index, metadata: { title: keyword + '-' + index, tags: [] },
    })).shortLink)
    if (!admin) await grants(manager, key, ['short_link:read_own', 'short_link:export'])
    const page = await context.newPage()
    await page.goto(admin ? '/admin/link' : '/link')
    const listPath = '/api/v1' + (admin ? '/admin' : '') + '/short-link/list'
    const filtered = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === listPath && url.searchParams.get('q') === keyword })
    await page.getByRole('textbox', { name: language === 'en' ? 'Keyword' : '关键词搜索', exact: true }).fill(keyword)
    const payload = await (await filtered).json() as { code: number; data: { items: Link[] }; meta: { total: number } }
    expect(payload.code).toBe(0); expect(payload.meta.total).toBe(22); expect(payload.data.items).toHaveLength(20)
    await run(page, payload.data.items, keyword)
    const output = info.outputPath('runtime.json')
    await writeFile(output, JSON.stringify({ browser: browser.version(), driverNode: process.version, language, width, admin, ownedLinks: links.length, nativeBrowserDownload: true, controlledNetworkRejection: true, userDiskSaveVerified: false }, null, 2))
    await info.attach('runtime', { path: output, contentType: 'application/json' })
  } catch (error) { errors.push(error) } finally {
    if (original) try { await grants(manager, key, original.permissions); expect((await group(manager, key)).permissions).toEqual(original.permissions) } catch (error) { errors.push(error) }
    for (const link of links) try { await api(manager, '/admin/short-link/delete', { id: link.id }) } catch (error) { errors.push(error) }
    if (actor) try { await api(manager, '/admin/user/update', { id: actor.id, nickname: keyword, status: 'disabled' }) } catch (error) { errors.push(error) }
    if (context) try { await context.close() } catch (error) { errors.push(error) }
  }
  if (errors.length) throw new AggregateError(errors, 'Selected export scenario or owned cleanup failed')
}

// All-results wiring, click-order CSV, stale browser data or omitted actor binding break these real downloads.
for (const language of ['zh-CN', 'en']) for (const width of [1280, 320]) for (const admin of [false, true]) {
  test('v0.85.0 ' + language + ' ' + width + 'px ' + (admin ? 'admin' : 'read-only own') + ' selected CSV is complete, fresh and independent', async ({ browser, request }, info) => {
    test.setTimeout(180_000)
    await scenario(browser, request, info, language, width, admin, async (page, links, keyword) => {
      const en = language === 'en', selected = page.getByTestId('short-link-selected-export'), whole = page.getByTestId('short-link-list-export')
      await expect(selected).toHaveText(en ? 'Export selected CSV' : '导出所选 CSV')
      await expect(selected).toBeDisabled(); await expect(whole).toBeEnabled()
      const rows = page.getByTestId('console-link-row')
      await expect(rows).toHaveCount(20)
      await rows.nth(1).getByRole('checkbox').check(); await rows.nth(0).getByRole('checkbox').check()
      await expect(selected).toBeEnabled()
      const freshTitle = keyword + '-server-fresh'
      await api(request, '/admin/short-link/update', { id: links[0]!.id, metadata: { title: freshTitle, tags: [] } })
      const path = '/api/v1/' + (admin ? 'admin/' : '') + 'short-link/export/selected'
      const sent = page.waitForRequest(value => new URL(value.url()).pathname === path)
      const downloaded = page.waitForEvent('download')
      await selected.focus(); await page.keyboard.press('Enter')
      const actualRequest = await sent
      expect(actualRequest.method()).toBe('POST')
      expect(new URL(actualRequest.url()).search).toBe('')
      // Selection order is the explicit click order (row 1, then row 0), and
      // v0.91 keeps that order stable while selection crosses pages.
      expect(actualRequest.postDataJSON()).toEqual({ ids: [links[1]!.id, links[0]!.id] })
      const identity = await api<{ user: User }>(page.request, '/auth/me')
      expect(actualRequest.headers()['x-moeurl-expected-user-id']).toBe(identity.user.id)
      const text = await content(await downloaded, admin ? 'moeurl-links-all-selected.csv' : 'moeurl-links-own-selected.csv', info, 'selected.csv')
      // The API orders CSV rows canonically even though the request preserves
      // the user's click order.
      expect(text.slice(header.length).trimEnd().split('\r\n').map(line => line.split(',')[0])).toEqual([links[0]!.id, links[1]!.id])
      expect(text).toContain(freshTitle)
      expect(text).not.toContain('password_hash'); expect(text).not.toContain('note_content')
      await expect(selected).toBeEnabled()
      await expectNoHorizontalOverflow(page)
      await selected.scrollIntoViewIfNeeded(); await expect(selected).toBeInViewport({ ratio: 1 })
      const image = info.outputPath('selected-csv.png'); await page.screenshot({ path: image, animations: 'disabled' }); await info.attach('selected-csv', { path: image, contentType: 'image/png' })
      await dismissFeedback(page)
      // Rejects only the request boundary, proving explicit retry without claiming a real OS failure.
      await page.route('**' + path, route => route.abort('failed'), { times: 1 })
      await selected.click()
      await expect(page.getByText(en ? 'Export failed. Please try again.' : '导出失败，请重试。', { exact: true })).toBeVisible()
      await expect(selected).toBeEnabled(); await expect(whole).toBeEnabled()
      await dismissFeedback(page)
      const retried = page.waitForEvent('download'); await selected.click()
      expect(await content(await retried, admin ? 'moeurl-links-all-selected.csv' : 'moeurl-links-own-selected.csv', info, 'retried.csv')).toBe(text)
      await dismissFeedback(page)
      const fullDownload = page.waitForEvent('download'); await whole.click()
      const full = await content(await fullDownload, admin ? 'moeurl-links-all.csv' : 'moeurl-links-own.csv', info, 'all-filtered.csv')
      expect(full.slice(header.length).trimEnd().split('\r\n')).toHaveLength(22)
      await dismissFeedback(page)
      await page.getByRole('button', { name: en ? 'Next page' : '下一页', exact: true }).click()
      await expect(rows).toHaveCount(2); await expect(selected).toBeEnabled()
      const current = await group(request, admin ? 'admin' : 'user')
      await grants(request, current.key, current.permissions.filter(value => value !== 'short_link:export'))
      await page.reload()
      await expect(page.getByTestId('console-link-list')).toBeVisible()
      await expect(selected).toHaveCount(0); await expect(whole).toHaveCount(0)
    })
  })
}
