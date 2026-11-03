import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Page, TestInfo } from '@playwright/test'
import type { ShortLink } from '../src/entities/short-link/model'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

interface Group { key: string; permissions: string[]; updatedAt: string }
/** Checks real Session and business success without printing private fixture payloads. */
async function success(api: APIRequestContext, path: string, data?: unknown) {
  const response = data === undefined ? await api.get('/api/v1' + path) : await api.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200)
  const value = await response.json(); expect(value.code).toBe(0); return value
}
/** Reads the disposable shared group's current revision for each explicit permission change. */
async function group(api: APIRequestContext): Promise<Group> {
  const groups = (await success(api, '/admin/user-group/list')).data.groups as Group[]
  const current = groups.find(value => value.key === 'user')
  if (!current) throw new Error('Disposable group missing')
  return current
}
async function permissions(api: APIRequestContext, values: string[]) {
  await success(api, '/admin/user-group/update-permissions', { groupKey: 'user', permissions: values, expectedUpdatedAt: (await group(api)).updatedAt })
}
/** Pins every private predicate and verifies an actual matching page, not a cached table. */
function searched(page: Page, prefix: string, body: Record<string, unknown>, total: number) {
  return page.waitForResponse(response => response.url().endsWith('/api/v1' + prefix + '/note/search')
    && response.request().method() === 'POST' && Object.entries(body).every(([key, value]) => response.request().postDataJSON()[key] === value))
    .then(async response => {
      expect(new URL(response.url()).search).toBe('')
      expect(Object.keys(response.request().postDataJSON()).sort()).toEqual(['page', 'pageSize', 'status', 'q', 'tag', 'noteStatus', 'noteQuery'].sort())
      expect(response.request().headers()['x-moeurl-expected-user-id']).toMatch(/^[a-f0-9-]{36}$/)
      const result = await response.json(); expect(result.code).toBe(0)
      expect(result.meta).toEqual({ page: body.page, pageSize: 20, total })
      for (const item of result.data.items) for (const key of ['note', 'noteQuery', 'noteStatus', 'noteUpdatedAt']) expect(item).not.toHaveProperty(key)
      return result.data.items as ShortLink[]
    })
}
/** Keeps notifications visible and checks all five filters for overflow or overlap. */
async function capture(page: Page, info: TestInfo, name: string) {
  const filters = page.locator('.console-page__metadata-filters'); await filters.scrollIntoViewIfNeeded()
  await expectNoHorizontalOverflow(page)
  const boxes = await filters.evaluate(element => Array.from(element.children).map(child => { const b = child.getBoundingClientRect(); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom } }))
  expect(boxes).toHaveLength(5)
  for (const a of boxes) { expect(a.left).toBeGreaterThanOrEqual(-1); expect(a.right).toBeLessThanOrEqual(page.viewportSize()!.width + 1) }
  for (const [i, a] of boxes.entries()) for (const b of boxes.slice(i + 1)) expect(a.right > b.left + 1 && b.right > a.left + 1 && a.bottom > b.top + 1 && b.bottom > a.top + 1).toBe(false)
  const path = info.outputPath(name + '.png'); await page.screenshot({ path, fullPage: true, animations: 'disabled' }); await info.attach(name, { path, contentType: 'image/png' })
}

test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })
// Omitting the independent POST filter, paging CSV, stale note membership or write-only filtering fails these real flows.
for (const scope of ['own', 'admin'] as const) {
  test('v0.46.0 ' + scope + ' privately filters notes and exports all pages', async ({ browser, page: manager }, info) => {
    test.setTimeout(120_000)
    const contexts: BrowserContext[] = [], links: ShortLink[] = [], failures: unknown[] = []
    let original: Group | undefined, userID: string | undefined, keyword: string | undefined
    const en = scope === 'admin', language = en ? 'en' : 'zh-CN', width = en ? 390 : 1280
    try {
      const baseURL = info.project.use.baseURL
      if (typeof baseURL !== 'string') throw new Error('Requires disposable Compose baseURL')
      await success(manager.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      original = await group(manager.request)
      keyword = 'note46-' + randomBytes(6).toString('hex')
      const term = 'private46-' + randomBytes(6).toString('hex'), secret = 'Literal %_\\ ' + term, password = 'private-note-owned-fixture'
      userID = (await success(manager.request, '/admin/user/create', { username: keyword, password, nickname: 'Note search fixture', groupKey: 'user', status: 'active' })).data.user.id
      const context = await browser.newContext({ baseURL, viewport: { width, height: en ? 844 : 900 }, locale: language, serviceWorkers: 'block', reducedMotion: 'reduce', colorScheme: en ? 'dark' : 'light' })
      contexts.push(context)
      await context.addInitScript(({ language, en }) => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', en ? 'dark' : 'light') }, { language, en })
      const owner = await context.newPage(); await success(owner.request, '/auth/login', { username: keyword, password })
      for (let index = 0; index < 22; index++) {
        const link = (await success(owner.request, '/short-link/create', { targetUrl: 'https://example.com/' + keyword + '/' + index, metadata: { title: keyword + '-' + index, tags: ['release46'] } })).data.shortLink as ShortLink
        links.push(link)
        const note = (await success(owner.request, '/short-link/note?id=' + link.id)).data
        await success(owner.request, '/short-link/note/update', { id: link.id, note: index < 21 ? secret : 'different note', expectedUpdatedAt: note.updatedAt })
      }
      expect((await success(owner.request, '/short-link/list?q=' + term)).meta.total).toBe(0)
      const page = scope === 'own' ? owner : await context.newPage(), prefix = scope === 'own' ? '/short-link' : '/admin/short-link'
      if (scope === 'admin') await success(page.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      await page.goto(scope === 'own' ? '/link' : '/admin/link')
      await page.getByRole('textbox', { name: en ? 'Keyword' : '关键词搜索', exact: true }).fill(keyword)
      await page.getByRole('textbox', { name: en ? 'Tag' : '标签', exact: true }).fill('release46')
      const body = { page: 1, pageSize: 20, status: '', q: keyword, tag: 'release46', noteStatus: '', noteQuery: term }
      const first = searched(page, prefix, body, 21)
      await page.getByRole('textbox', { name: en ? 'Note keyword' : '备注关键词', exact: true }).fill(term)
      const firstRows = await first; expect(firstRows).toHaveLength(20)
      await expect(page.getByTestId('console-link-row')).toHaveCount(20)
      const second = searched(page, prefix, { ...body, page: 2 }, 21)
      await page.getByRole('button', { name: en ? 'Next page' : '下一页', exact: true }).press('Enter')
      const secondRows = await second; expect(secondRows).toHaveLength(1)
      expect([...firstRows, ...secondRows].map(r => r.id).sort()).toEqual(links.slice(0, 21).map(r => r.id).sort())
      const exported = page.waitForResponse(response => response.url().endsWith('/api/v1' + prefix + '/note/search/export')), downloaded = page.waitForEvent('download')
      await page.getByTestId('short-link-list-export').click()
      const response = await exported
      expect(response.request().method()).toBe('POST'); expect(new URL(response.url()).search).toBe('')
      expect(response.request().postDataJSON()).toEqual({ status: '', q: keyword, tag: 'release46', noteStatus: '', noteQuery: term })
      const descriptor = await response.json(); expect(descriptor.code).toBe(0)
      const download = await downloaded, csvPath = info.outputPath('note-search-all.csv'); await download.saveAs(csvPath)
      expect(await download.failure()).toBeNull(); expect(download.suggestedFilename()).toBe(scope === 'own' ? 'moeurl-links-own.csv' : 'moeurl-links-all.csv')
      const bytes = await readFile(csvPath); expect(bytes.equals(Buffer.from(descriptor.data.content, 'utf8'))).toBe(true)
      const records = bytes.toString('utf8').slice(1).trimEnd().split('\r\n')
      expect(records).toHaveLength(22); expect(records[0]!.split(',')).toHaveLength(17)
      expect(records.slice(1).map(r => r.split(',')[0]).sort()).toEqual(links.slice(0, 21).map(r => r.id).sort())
      expect(bytes.toString('utf8')).not.toContain(term); expect(bytes.toString('utf8')).not.toContain(secret)
      expect(page.url()).not.toContain(term)
      expect(await page.evaluate(term => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(v => String(v).includes(term)), term)).toBe(false)
      await expect(page.getByText(en ? 'CSV download started. Confirm saving in your browser.' : '已发起 CSV 下载，请在浏览器中确认保存。', { exact: true })).toBeVisible()
      await capture(page, info, 'note-search-export-' + scope)

      const removed = secondRows[0]!
      await page.getByTestId('console-link-row').filter({ hasText: removed.slug }).getByRole('button', { name: en ? 'More actions' : '更多操作', exact: true }).press('Enter')
      await page.getByRole('menuitem', { name: en ? 'Note' : '备注', exact: true }).press('Enter')
      const dialog = page.getByTestId('note-dialog'); await expect(dialog.getByRole('textbox')).toHaveValue(secret)
      await expect(page.getByRole('textbox', { name: en ? 'Note keyword' : '备注关键词', exact: true })).toBeDisabled()
      await dialog.getByRole('button', { name: en ? 'Clear draft' : '清空草稿', exact: true }).click()
      const refreshed = searched(page, prefix, { ...body, page: 1 }, 20)
      await dialog.getByRole('button', { name: en ? 'Save note' : '保存备注', exact: true }).press('Enter')
      const remaining = await refreshed; expect(remaining.map(r => r.id).sort()).toEqual(links.slice(0, 21).filter(r => r.id !== removed.id).map(r => r.id).sort())
      await dialog.getByRole('button', { name: en ? 'Close' : '关闭', exact: true }).press('Enter')
      await expect(page.getByTestId('console-link-row')).toHaveCount(20)
      await capture(page, info, 'note-search-write-membership-' + scope)
      if (scope === 'own') {
        await permissions(manager.request, original.permissions.filter(p => !['short_link:set_metadata', 'short_link:update_own'].includes(p)))
        await page.reload()
        const readonly = searched(page, prefix, body, 20)
        await page.getByRole('textbox', { name: '关键词搜索', exact: true }).fill(keyword)
        await page.getByRole('textbox', { name: '标签', exact: true }).fill('release46')
        await page.getByRole('textbox', { name: '备注关键词', exact: true }).fill(term); await readonly
        const selected = remaining[0]!
        await page.getByTestId('console-link-row').filter({ hasText: selected.slug }).getByRole('button', { name: '更多操作', exact: true }).click()
        await page.getByRole('menuitem', { name: '备注', exact: true }).click()
        await expect(dialog.getByRole('textbox')).toHaveAttribute('readonly', '')
        await expect(dialog.getByRole('button', { name: '保存备注', exact: true })).toHaveCount(0)
        await dialog.getByRole('button', { name: '关闭', exact: true }).click()
        await permissions(manager.request, original.permissions.filter(p => p !== 'short_link:read_own'))
        const denied = await page.request.post('/api/v1/short-link/note/search', { data: body })
        expect(denied.status()).toBe(200); expect((await denied.json()).code).toBe(120001)
      }
      const proofPath = info.outputPath('note-search-proof.json')
      await writeFile(proofPath, JSON.stringify({ scope, language, width, browser: browser.version(), driverNode: process.version, fixedPost: true, exactAllPagesCSV: true, columns: 17, noPrivateURLOrStorage: true, noteWriteRemovesMembership: true, readonlyAndDenied: scope === 'own', fixtureIDs: links.map(r => r.id), disposableDatabase: true }, null, 2))
      await info.attach('note-search-proof', { path: proofPath, contentType: 'application/json' })
    } catch (error) { failures.push(error) } finally {
      if (original) { try { if (JSON.stringify((await group(manager.request)).permissions) !== JSON.stringify(original.permissions)) await permissions(manager.request, original.permissions); expect((await group(manager.request)).permissions).toEqual(original.permissions) } catch (error) { failures.push(error) } }
      for (const link of links) { try { await success(manager.request, '/admin/short-link/delete', { id: link.id }) } catch (error) { failures.push(error) } }
      if (keyword) { try { expect((await success(manager.request, '/admin/short-link/list?q=' + keyword)).meta.total).toBe(0) } catch (error) { failures.push(error) } }
      if (userID) { try { await success(manager.request, '/admin/user/update', { id: userID, nickname: 'Retired note search fixture', status: 'disabled' }) } catch (error) { failures.push(error) } }
      for (const context of contexts) { try { await context.close() } catch (error) { failures.push(error) } }
    }
    if (failures.length) throw new AggregateError(failures, 'Note search scenario or owned cleanup failed')
  })
}
