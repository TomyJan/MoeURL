import { randomBytes, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Page, TestInfo } from '@playwright/test'
import type { ShortLink } from '../src/entities/short-link/model'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

/** Requires real Session transport and business success without logging fixture secrets. */
async function success(api: APIRequestContext, path: string, data?: unknown) {
  const response = data === undefined ? await api.get('/api/v1' + path) : await api.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200)
  const value = await response.json(); expect(value.code).toBe(0); return value
}

/** Pins the actual request size and checks both the public envelope and private POST boundary. */
function listed(page: Page, prefix: string, keyword: string, number: number, size: number, term = '') {
  return page.waitForResponse(response => {
    const url = new URL(response.url()), request = response.request()
    if (term) {
      if (url.pathname !== '/api/v1' + prefix + '/note/search' || request.method() !== 'POST') return false
      const body = request.postDataJSON()
      return body.q === keyword && body.noteQuery === term && body.page === number && body.pageSize === size
    }
    return url.pathname === '/api/v1' + prefix + '/list' && url.searchParams.get('q') === keyword
      && url.searchParams.get('page') === String(number) && url.searchParams.get('pageSize') === String(size)
  }).then(async response => {
    expect(response.status()).toBe(200)
    if (term) {
      expect(new URL(response.url()).search).toBe('')
      expect(response.request().postDataJSON()).toEqual({ page: number, pageSize: size, status: '', q: keyword, tag: '', noteStatus: '', noteQuery: term })
      expect(response.request().headers()['x-moeurl-expected-user-id']).toMatch(/^[a-f0-9-]{36}$/)
    }
    const value = await response.json(); expect(value.code).toBe(0)
    expect(value.meta).toEqual({ page: number, pageSize: size, total: 61 })
    const items = value.data.items as ShortLink[]
    expect(items).toHaveLength(Math.min(size, 61 - (number - 1) * size))
    for (const item of items) for (const key of ['note', 'noteQuery', 'noteStatus', 'noteUpdatedAt']) expect(item).not.toHaveProperty(key)
    return items
  })
}

/** Matches the confirmed collection and requires every current-page selection to be clear. */
async function visible(page: Page, items: ShortLink[]) {
  await expect(page.getByTestId('console-link-row')).toHaveCount(items.length)
  for (const item of items) await expect(page.getByTestId('console-link-row').filter({ hasText: item.slug })).toHaveCount(1)
  for (const checkbox of await page.getByRole('checkbox').all()) await expect(checkbox).not.toBeChecked()
}

/** Saves the unmodified page and checks the size control and navigation fit the viewport. */
async function capture(page: Page, info: TestInfo, name: string) {
  const nav = page.getByRole('navigation', { name: /短链列表分页|Short link list pages/ })
  await nav.scrollIntoViewIfNeeded(); await expectNoHorizontalOverflow(page)
  for (const control of await nav.locator('.short-link-pagination__size, button').all()) {
    const box = await control.boundingBox(); expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(-1)
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1)
  }
  const path = info.outputPath(name + '.png')
  await page.screenshot({ path, fullPage: true, animations: 'disabled' })
  await info.attach(name, { path, contentType: 'image/png' })
}

test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })
// A fixed request size, cross-page selection, paged CSV or private predicate in URLs fails these real flows.
for (const scope of ['own', 'admin'] as const) for (const en of [false, true]) {
  test('v0.48.0 ' + scope + (en ? ' en 390px' : ' zh-CN 1280px') + ' changes exact page sizes for public and private lists', async ({ browser, page: manager }, info) => {
    test.setTimeout(180_000)
    const contexts: BrowserContext[] = [], links = new Map<string, ShortLink>(), failures: unknown[] = []
    let userID: string | undefined, keyword: string | undefined
    try {
      const baseURL = info.project.use.baseURL
      if (typeof baseURL !== 'string') throw new Error('Requires disposable Compose baseURL')
      await success(manager.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      keyword = 'size48-' + randomBytes(6).toString('hex')
      const password = 'page-size-owned-fixture', language = en ? 'en' : 'zh-CN', width = en ? 390 : 1280
      const term = 'private48-' + randomBytes(6).toString('hex')
      userID = (await success(manager.request, '/admin/user/create', { username: keyword, password, nickname: 'Page size fixture', groupKey: 'user', status: 'active' })).data.user.id
      const context = await browser.newContext({ baseURL, viewport: { width, height: en ? 844 : 900 }, locale: language, serviceWorkers: 'block', reducedMotion: 'reduce', colorScheme: en ? 'dark' : 'light' })
      contexts.push(context)
      await context.addInitScript(({ language, en }) => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', en ? 'dark' : 'light') }, { language, en })
      const owner = await context.newPage()
      await success(owner.request, '/auth/login', { username: keyword, password })
      for (let offset = 0; offset < 61; offset += 20) {
        const count = Math.min(20, 61 - offset)
        await success(owner.request, '/short-link/batch-create', { requestId: randomUUID(), targetUrls: Array.from({ length: count }, (_, index) => 'https://example.com/' + keyword + '/' + (offset + index)) })
        // Each successful atomic batch is registered before starting the next batch or another assertion.
        const current = await success(owner.request, '/short-link/list?q=' + keyword + '&page=1&pageSize=100')
        for (const link of current.data.items as ShortLink[]) links.set(link.id, link)
        expect(links.size).toBe(offset + count)
      }
      for (const link of links.values()) {
        const note = (await success(owner.request, '/short-link/note?id=' + link.id)).data
        await success(owner.request, '/short-link/note/update', { id: link.id, note: term, expectedUpdatedAt: note.updatedAt })
      }
      const page = scope === 'own' ? owner : await context.newPage(), prefix = scope === 'own' ? '/short-link' : '/admin/short-link'
      if (scope === 'admin') await success(page.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      await page.goto(scope === 'own' ? '/link' : '/admin/link')
      const initial = listed(page, prefix, keyword, 1, 20)
      await page.getByRole('textbox', { name: en ? 'Keyword' : '关键词搜索', exact: true }).fill(keyword)
      await visible(page, await initial)
      const size = page.getByRole('combobox', { name: en ? 'Rows per page' : '每页条数', exact: true })
      await page.getByTestId('console-link-row').first().getByRole('checkbox').check()
      const fifty = listed(page, prefix, keyword, 1, 50)
      await size.press('Enter'); await page.getByRole('option', { name: '50', exact: true }).click()
      const first = await fifty; await visible(page, first)
      const secondRead = listed(page, prefix, keyword, 2, 50)
      await page.getByRole('button', { name: en ? 'Next page' : '下一页', exact: true }).press('Enter')
      const second = await secondRead; await visible(page, second)
      expect([...first, ...second].map(link => link.id).sort()).toEqual([...links.keys()].sort())
      await expect(page.getByTestId('short-link-pagination-summary')).toHaveText(en ? 'Page 2 of 2, 61 links' : '第 2 / 2 页，共 61 条')

      // A private filter must keep size 50, return to page 1, and use only a POST body.
      const privateFirst = listed(page, prefix, keyword, 1, 50, term)
      await page.getByRole('textbox', { name: en ? 'Note keyword' : '备注关键词', exact: true }).fill(term)
      await visible(page, await privateFirst)
      const privateSecond = listed(page, prefix, keyword, 2, 50, term)
      await page.getByRole('button', { name: en ? 'Next page' : '下一页', exact: true }).press('Enter')
      await visible(page, await privateSecond)
      const exported = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + prefix + '/note/search/export'), downloaded = page.waitForEvent('download')
      await page.getByTestId('short-link-list-export').click()
      const response = await exported
      expect(new URL(response.url()).search).toBe('')
      expect(response.request().method()).toBe('POST')
      expect(response.request().postDataJSON()).toEqual({ status: '', q: keyword, tag: '', noteStatus: '', noteQuery: term })
      const descriptor = await response.json(); expect(descriptor.code).toBe(0)
      const download = await downloaded, csvPath = info.outputPath('page-size-all-matches.csv'); await download.saveAs(csvPath)
      expect(await download.failure()).toBeNull()
      const bytes = await readFile(csvPath); expect(bytes.equals(Buffer.from(descriptor.data.content, 'utf8'))).toBe(true)
      expect([...bytes.subarray(0, 3)]).toEqual([239, 187, 191])
      const records = bytes.toString('utf8').slice(1).trimEnd().split('\r\n')
      expect(records).toHaveLength(62); expect(records[0]!.split(',')).toHaveLength(17)
      expect(records.slice(1).map(record => record.split(',')[0]).sort()).toEqual([...links.keys()].sort())
      expect(bytes.toString('utf8')).not.toContain(term)
      expect(page.url()).not.toContain(term)
      await expect(page.getByText(en ? 'CSV download started. Confirm saving in your browser.' : '已发起 CSV 下载，请在浏览器中确认保存。', { exact: true })).toBeVisible()
      await capture(page, info, 'size-50-second-export-' + scope + '-' + language)

      const hundred = listed(page, prefix, keyword, 1, 100, term)
      await size.press('Enter'); await page.getByRole('option', { name: '100', exact: true }).click()
      await visible(page, await hundred)
      await expect(page.getByRole('button', { name: en ? 'Next page' : '下一页', exact: true })).toBeDisabled()
      await expect(page.getByTestId('short-link-pagination-summary')).toHaveText(en ? 'Page 1 of 1, 61 links' : '第 1 / 1 页，共 61 条')
      await capture(page, info, 'size-100-private-' + scope + '-' + language)
      const proofPath = info.outputPath('page-size-proof.json')
      await writeFile(proofPath, JSON.stringify({ scope, language, width, browser: browser.version(), driverNode: process.version, fixtureIDs: [...links.keys()], pageOneIDs: first.map(link => link.id), pageTwoIDs: second.map(link => link.id), defaultSize: 20, supportedSizes: [20, 50, 100], exactAllMatchesCSV: true, originalColumns: 17, privatePOST: true, disposableDatabase: true }, null, 2))
      await info.attach('page-size-proof', { path: proofPath, contentType: 'application/json' })
    } catch (error) { failures.push(error) } finally {
      // Recover exact fixture IDs if a post-batch read failed; never delete unknown rows.
      if (keyword && userID) { try {
        const remaining = await success(manager.request, '/admin/short-link/list?q=' + keyword + '&page=1&pageSize=100')
        for (const link of remaining.data.items as (ShortLink & { owner: { id: string } })[]) {
          expect(link.owner.id).toBe(userID)
          links.set(link.id, link)
        }
      } catch (error) { failures.push(error) } }
      for (const link of links.values()) { try { await success(manager.request, '/admin/short-link/delete', { id: link.id }) } catch (error) { failures.push(error) } }
      if (keyword) { try { expect((await success(manager.request, '/admin/short-link/list?q=' + keyword)).meta.total).toBe(0) } catch (error) { failures.push(error) } }
      if (userID) { try { await success(manager.request, '/admin/user/update', { id: userID, nickname: 'Retired page size fixture', status: 'disabled' }) } catch (error) { failures.push(error) } }
      for (const context of contexts) { try { await context.close() } catch (error) { failures.push(error) } }
    }
    if (failures.length) throw new AggregateError(failures, 'Page-size scenario or exact owned cleanup failed')
  })
}
