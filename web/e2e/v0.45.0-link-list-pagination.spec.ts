import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Page, TestInfo } from '@playwright/test'
import type { ShortLink } from '../src/entities/short-link/model'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

/** Requires genuine Session transport and business success without printing fixture credentials. */
async function success(api: APIRequestContext, path: string, data?: unknown) {
  const response = data === undefined ? await api.get('/api/v1' + path) : await api.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200)
  const value = await response.json(); expect(value.code).toBe(0); return value
}

/** Waits for the exact page request and validates its complete public list envelope. */
function listed(page: Page, prefix: string, keyword: string, number: number, status = '') {
  return page.waitForResponse(response => {
    const url = new URL(response.url())
    return url.pathname === '/api/v1' + prefix + '/list' && url.searchParams.get('q') === keyword
      && url.searchParams.get('page') === String(number) && url.searchParams.get('pageSize') === '20'
      && url.searchParams.get('status') === (status || null)
  }).then(async response => {
    expect(response.status()).toBe(200)
    const value = await response.json(); expect(value.code).toBe(0)
    expect(value.meta).toEqual({ page: number, pageSize: 20, total: 21 })
    const items = value.data.items as ShortLink[]
    expect(items).toHaveLength(number === 1 ? 20 : 1)
    for (const item of items) for (const key of ['note', 'noteStatus', 'noteUpdatedAt']) expect(item).not.toHaveProperty(key)
    return items
  })
}

/** Checks that only the confirmed page is visible and all current-page selections are clear. */
async function visible(page: Page, items: ShortLink[]) {
  await expect(page.getByTestId('console-link-row')).toHaveCount(items.length)
  for (const item of items) await expect(page.getByTestId('console-link-row').filter({ hasText: item.slug })).toHaveCount(1)
  for (const checkbox of await page.getByRole('checkbox').all()) await expect(checkbox).not.toBeChecked()
}

/** Captures the original page with notifications and requires pagination to fit the viewport. */
async function capture(page: Page, info: TestInfo, name: string) {
  const nav = page.getByRole('navigation', { name: /短链列表分页|Short link list pages/ })
  await nav.scrollIntoViewIfNeeded(); await expectNoHorizontalOverflow(page)
  for (const button of await nav.getByRole('button').all()) {
    const box = await button.boundingBox(); expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  }
  const path = info.outputPath(name + '.png')
  await page.screenshot({ path, fullPage: true, animations: 'disabled' })
  await info.attach(name, { path, contentType: 'image/png' })
}

test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })
// Missing page parameters, cross-page selection, paged CSV or private-note disclosure fail these real UI flows.
for (const scope of ['own', 'admin'] as const) for (const en of [false, true]) {
  test('v0.45.0 ' + scope + (en ? ' en 390px' : ' zh-CN 1280px') + ' paginates exact owned links and exports every applied match', async ({ browser, page: manager }, info) => {
    test.setTimeout(90_000)
    const contexts: BrowserContext[] = [], links: ShortLink[] = [], failures: unknown[] = []
    let userID: string | undefined, keyword: string | undefined
    try {
      const baseURL = info.project.use.baseURL
      if (typeof baseURL !== 'string') throw new Error('Requires disposable Compose baseURL')
      await success(manager.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      keyword = 'page45-' + randomBytes(6).toString('hex')
      const password = 'pagination-owned-fixture', width = en ? 390 : 1280, language = en ? 'en' : 'zh-CN'
      userID = (await success(manager.request, '/admin/user/create', { username: keyword, password, nickname: 'Pagination fixture', groupKey: 'user', status: 'active' })).data.user.id
      const context = await browser.newContext({ baseURL, viewport: { width, height: en ? 844 : 900 }, locale: language, serviceWorkers: 'block', reducedMotion: 'reduce', colorScheme: en ? 'dark' : 'light' })
      contexts.push(context)
      await context.addInitScript(({ language, en }) => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', en ? 'dark' : 'light') }, { language, en })
      const owner = await context.newPage()
      await success(owner.request, '/auth/login', { username: keyword, password })
      for (let index = 0; index < 21; index++) links.push((await success(owner.request, '/short-link/create', { targetUrl: 'https://example.com/' + keyword + '/' + index, metadata: { title: keyword + '-' + index, tags: [] } })).data.shortLink as ShortLink)
      const secret = 'Private pagination note ' + keyword, first = links[0]!
      const initial = (await success(owner.request, '/short-link/note?id=' + first.id)).data
      await success(owner.request, '/short-link/note/update', { id: first.id, note: secret, expectedUpdatedAt: initial.updatedAt })
      // Owner-only setup finishes before this context optionally switches to the administrator Session.
      const page = scope === 'own' ? owner : await context.newPage(), prefix = scope === 'own' ? '/short-link' : '/admin/short-link'
      if (scope === 'admin') await success(page.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      await page.goto(scope === 'own' ? '/link' : '/admin/link')
      const firstRead = listed(page, prefix, keyword, 1)
      await page.getByRole('textbox', { name: en ? 'Keyword' : '关键词搜索', exact: true }).fill(keyword)
      const firstPage = await firstRead; await visible(page, firstPage)
      await expect(page.getByTestId('short-link-pagination-summary')).toHaveText(en ? 'Page 1 of 2, 21 links' : '第 1 / 2 页，共 21 条')
      await page.getByTestId('console-link-row').first().getByRole('checkbox').check()
      const secondRead = listed(page, prefix, keyword, 2)
      await page.getByRole('button', { name: en ? 'Next page' : '下一页', exact: true }).press('Enter')
      const secondPage = await secondRead; await visible(page, secondPage)
      expect([...firstPage, ...secondPage].map(item => item.id).sort()).toEqual(links.map(item => item.id).sort())
      await expect(page.getByTestId('short-link-pagination-summary')).toHaveText(en ? 'Page 2 of 2, 21 links' : '第 2 / 2 页，共 21 条')
      await expect(page.getByRole('button', { name: en ? 'Next page' : '下一页', exact: true })).toBeDisabled()

      const exported = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + prefix + '/export'), downloaded = page.waitForEvent('download')
      await page.getByTestId('short-link-list-export').click()
      const response = await exported
      expect(Object.fromEntries(new URL(response.url()).searchParams)).toEqual({ q: keyword })
      const descriptor = await response.json(); expect(descriptor.code).toBe(0)
      const download = await downloaded, csvPath = info.outputPath('pagination-all-matches.csv'); await download.saveAs(csvPath)
      expect(await download.failure()).toBeNull()
      const bytes = await readFile(csvPath); expect(bytes.equals(Buffer.from(descriptor.data.content, 'utf8'))).toBe(true)
      expect([...bytes.subarray(0, 3)]).toEqual([239, 187, 191])
      const rows = bytes.toString('utf8').slice(1).trimEnd().split('\r\n')
      expect(rows).toHaveLength(22); expect(rows[0]!.split(',')).toHaveLength(17)
      expect(rows.slice(1).map(row => row.split(',')[0]).sort()).toEqual(links.map(item => item.id).sort())
      expect(bytes.toString('utf8')).not.toContain(secret); expect(rows[0]).not.toContain('note')
      await info.attach('actual-all-matches-csv', { path: csvPath, contentType: 'text/csv' })
      await expect(page.getByText(en ? 'CSV download started. Confirm saving in your browser.' : '已发起 CSV 下载，请在浏览器中确认保存。', { exact: true })).toBeVisible()
      await capture(page, info, 'pagination-second-export-' + scope + '-' + language)

      const returned = listed(page, prefix, keyword, 1)
      await page.getByRole('button', { name: en ? 'Previous page' : '上一页', exact: true }).press('Enter')
      expect((await returned).map(item => item.id)).toEqual(firstPage.map(item => item.id)); await visible(page, firstPage)
      const secondAgain = listed(page, prefix, keyword, 2)
      await page.getByRole('button', { name: en ? 'Next page' : '下一页', exact: true }).press('Enter'); await secondAgain
      await visible(page, secondPage)
      const filtered = listed(page, prefix, keyword, 1, 'active')
      await page.getByRole('combobox', { name: en ? 'Status' : '状态筛选', exact: true }).press('Enter')
      await page.getByRole('option', { name: en ? 'Active' : '启用', exact: true }).click()
      await filtered; await visible(page, firstPage)
      await expect(page.getByRole('button', { name: en ? 'Previous page' : '上一页', exact: true })).toBeDisabled()
      await capture(page, info, 'pagination-filter-reset-' + scope + '-' + language)
      const proofPath = info.outputPath('pagination-proof.json')
      await writeFile(proofPath, JSON.stringify({ scope, language, width, browser: browser.version(), driverNode: process.version, fixtureIDs: links.map(item => item.id), pageOneIDs: firstPage.map(item => item.id), pageTwoIDs: secondPage.map(item => item.id), fixedPageSize: 20, clearsSelection: true, filterResetsPage: true, exactAllMatchesCSV: true, originalColumns: 17, noteExcluded: true, disposableDatabase: true }, null, 2))
      await info.attach('pagination-proof', { path: proofPath, contentType: 'application/json' })
    } catch (error) { failures.push(error) } finally {
      for (const link of links) { try { await success(manager.request, '/admin/short-link/delete', { id: link.id }) } catch (error) { failures.push(error) } }
      if (keyword) { try { expect((await success(manager.request, '/admin/short-link/list?q=' + encodeURIComponent(keyword))).meta.total).toBe(0) } catch (error) { failures.push(error) } }
      if (userID) { try { await success(manager.request, '/admin/user/update', { id: userID, nickname: 'Retired pagination fixture', status: 'disabled' }) } catch (error) { failures.push(error) } }
      for (const context of contexts) { try { await context.close() } catch (error) { failures.push(error) } }
    }
    if (failures.length) throw new AggregateError(failures, 'Pagination scenario or exact owned cleanup failed')
  })
}
