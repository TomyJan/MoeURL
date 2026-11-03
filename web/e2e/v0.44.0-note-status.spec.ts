import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Page, TestInfo } from '@playwright/test'
import type { ShortLink } from '../src/entities/short-link/model'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

interface Group { key: string; permissions: string[]; updatedAt: string }
/** Verifies actual Session transport and business success without logging private payloads. */
async function success(api: APIRequestContext, path: string, data?: unknown) {
  const response = data === undefined ? await api.get('/api/v1' + path) : await api.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200)
  const value = await response.json(); expect(value.code).toBe(0); return value
}
/** Reads the disposable shared group's live CAS version before changing permissions. */
async function group(api: APIRequestContext): Promise<Group> {
  const groups = (await success(api, '/admin/user-group/list')).data.groups as Group[]
  const value = groups.find(value => value.key === 'user')
  if (!value) throw new Error('Disposable user group missing')
  return value
}
/** Updates only disposable group permissions, never replaying a failed write. */
async function permissions(api: APIRequestContext, values: string[]) {
  await success(api, '/admin/user-group/update-permissions', { groupKey: 'user', permissions: values, expectedUpdatedAt: (await group(api)).updatedAt })
}
/** Pins the actual applied search and note predicate, then independently checks its returned set. */
function listed(page: Page, prefix: string, keyword: string, state: string, ids: string[]) {
  return page.waitForResponse(response => {
    const url = new URL(response.url())
    return url.pathname === '/api/v1' + prefix + '/list' && url.searchParams.get('q') === keyword && url.searchParams.get('noteStatus') === (state || null)
  }).then(async response => {
    expect(response.status()).toBe(200)
    const value = await response.json(); expect(value.code).toBe(0)
    expect(value.data.total).toBe(ids.length)
    expect(value.data.items.map((item: ShortLink) => item.id).sort()).toEqual([...ids].sort())
    for (const item of value.data.items) for (const key of ['note', 'noteStatus', 'noteUpdatedAt']) expect(item).not.toHaveProperty(key)
  })
}
/** Selects through the real Vuetify control and requires a matching network result. */
async function choose(page: Page, prefix: string, keyword: string, state: string, ids: string[], en: boolean) {
  const checked = listed(page, prefix, keyword, state, ids)
  await page.getByRole('combobox', { name: en ? 'Note status' : '备注状态', exact: true }).click()
  const name = state === 'present' ? (en ? 'With note' : '有备注') : state === 'absent' ? (en ? 'Without note' : '无备注') : (en ? 'All' : '全部')
  await page.getByRole('option', { name, exact: true }).click()
  await checked
  await expect(page.getByTestId('console-link-row')).toHaveCount(ids.length)
}
/** Opens the visible row's genuine note action using the keyboard. */
async function open(page: Page, slug: string, en: boolean) {
  await page.getByTestId('console-link-row').filter({ hasText: slug }).getByRole('button', { name: en ? 'More actions' : '更多操作', exact: true }).press('Enter')
  await page.getByRole('menuitem', { name: en ? 'Note' : '备注', exact: true }).press('Enter')
  await expect(page.getByTestId('note-dialog').getByRole('textbox')).toBeEnabled()
}
/** Captures the unmodified page, retaining notifications and checking responsive filter geometry. */
async function capture(page: Page, info: TestInfo, name: string) {
  await expectNoHorizontalOverflow(page)
  const filters = page.locator('.console-page__metadata-filters')
  await filters.scrollIntoViewIfNeeded()
  const geometry = await filters.evaluate(element => Array.from(element.children).map(child => {
    const box = child.getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom }
  }))
  expect(geometry).toHaveLength(4)
  for (const box of geometry) { expect(box.left).toBeGreaterThanOrEqual(-1); expect(box.right).toBeLessThanOrEqual((page.viewportSize()?.width ?? 0) + 1) }
  for (const [index, a] of geometry.entries()) for (const b of geometry.slice(index + 1)) expect(a.right > b.left + 1 && b.right > a.left + 1 && a.bottom > b.top + 1 && b.bottom > a.top + 1).toBe(false)
  const path = info.outputPath(name + '.png'); await page.screenshot({ path, fullPage: true, animations: 'disabled' }); await info.attach(name, { path, contentType: 'image/png' })
}

test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })
// Dropping noteStatus from list/export, keeping stale membership after a write, or requiring write permission to filter must fail these real UI scenarios.
for (const scope of ['own', 'admin'] as const) for (const en of [false, true]) {
  test('v0.44.0 ' + scope + (en ? ' en 390px' : ' zh-CN 1280px') + ' filters and exports note membership and refreshes after writes', async ({ browser, page: manager }, info) => {
    const contexts: BrowserContext[] = [], links: ShortLink[] = [], failures: unknown[] = []
    let userID: string | undefined, original: Group | undefined
    try {
      const baseURL = info.project.use.baseURL
      if (typeof baseURL !== 'string') throw new Error('Requires disposable Compose baseURL')
      await success(manager.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      original = await group(manager.request)
      const keyword = 'note44-' + randomBytes(6).toString('hex'), password = 'note-status-owned-fixture', width = en ? 390 : 1280, language = en ? 'en' : 'zh-CN'
      userID = (await success(manager.request, '/admin/user/create', { username: keyword, password, nickname: 'Note status fixture', groupKey: 'user', status: 'active' })).data.user.id
      const context = await browser.newContext({ baseURL, viewport: { width, height: en ? 844 : 900 }, locale: language, serviceWorkers: 'block', reducedMotion: 'reduce', colorScheme: en ? 'dark' : 'light' })
      contexts.push(context)
      await context.addInitScript(({ language, en }) => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', en ? 'dark' : 'light') }, { language, en })
      const owner = await context.newPage()
      await success(owner.request, '/auth/login', { username: keyword, password })
      for (const suffix of ['present', 'absent']) links.push((await success(owner.request, '/short-link/create', { targetUrl: 'https://example.com/' + keyword + '/' + suffix, metadata: { title: keyword + '-' + suffix, tags: [] } })).data.shortLink as ShortLink)
      const first = links[0]!, second = links[1]!, secret = 'Private note must stay outside CSV ' + keyword
      const initial = (await success(owner.request, '/short-link/note?id=' + first.id)).data
      await success(owner.request, '/short-link/note/update', { id: first.id, note: secret, expectedUpdatedAt: initial.updatedAt })
      const page = scope === 'own' ? owner : await context.newPage(), prefix = scope === 'own' ? '/short-link' : '/admin/short-link'
      if (scope === 'admin') await success(page.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      await page.goto(scope === 'own' ? '/link' : '/admin/link')
      const all = listed(page, prefix, keyword, '', [first.id, second.id])
      await page.getByRole('textbox', { name: en ? 'Keyword' : '关键词搜索', exact: true }).fill(keyword); await all
      await expect(page.getByTestId('console-link-row')).toHaveCount(2)
      await choose(page, prefix, keyword, 'present', [first.id], en)
      const exported = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + prefix + '/export'), downloaded = page.waitForEvent('download')
      await page.getByTestId('short-link-list-export').click()
      const response = await exported
      expect(Object.fromEntries(new URL(response.url()).searchParams)).toEqual({ q: keyword, noteStatus: 'present' })
      const descriptor = await response.json(); expect(descriptor.code).toBe(0)
      const download = await downloaded, csvPath = info.outputPath('note-status-' + scope + '.csv'); await download.saveAs(csvPath)
      expect(await download.failure()).toBeNull()
      const bytes = await readFile(csvPath); expect(bytes.equals(Buffer.from(descriptor.data.content, 'utf8'))).toBe(true)
      expect([...bytes.subarray(0, 3)]).toEqual([239, 187, 191])
      const rows = bytes.toString('utf8').slice(1).trimEnd().split('\r\n')
      expect(rows).toHaveLength(2); expect(rows[0]!.split(',')).toHaveLength(17); expect(rows[1]!.split(',')[0]).toBe(first.id)
      expect(bytes.toString('utf8')).not.toContain(secret); expect(rows[0]).not.toContain('note')
      await info.attach('actual-filtered-csv', { path: csvPath, contentType: 'text/csv' })
      await expect(page.getByText(en ? 'CSV download started. Confirm saving in your browser.' : '已发起 CSV 下载，请在浏览器中确认保存。', { exact: true })).toBeVisible()
      await capture(page, info, 'note-status-export-' + scope + '-' + language)

      await choose(page, prefix, keyword, 'absent', [second.id], en)
      await open(page, second.slug, en)
      const dialog = page.getByTestId('note-dialog'), field = dialog.getByRole('textbox', { name: en ? 'Note text' : '备注内容', exact: true })
      await expect(field).toHaveValue(''); await field.fill('Saved through real editor ' + keyword)
      const updated = page.waitForResponse('**/api/v1' + prefix + '/note/update'), absent = listed(page, prefix, keyword, 'absent', [])
      await dialog.getByRole('button', { name: en ? 'Save note' : '保存备注', exact: true }).press('Enter')
      expect(await (await updated).json()).toMatchObject({ code: 0 }); await absent
      await dialog.getByRole('button', { name: en ? 'Close' : '关闭', exact: true }).press('Enter'); await expect(dialog).toHaveCount(0)
      await expect(page.getByTestId('console-link-row')).toHaveCount(0)
      await choose(page, prefix, keyword, 'present', [first.id, second.id], en)
      await open(page, first.slug, en); await expect(field).toHaveValue(secret)
      await dialog.getByRole('button', { name: en ? 'Clear draft' : '清空草稿', exact: true }).click(); await expect(field).toHaveValue('')
      const cleared = page.waitForResponse('**/api/v1' + prefix + '/note/update'), present = listed(page, prefix, keyword, 'present', [second.id])
      await dialog.getByRole('button', { name: en ? 'Save note' : '保存备注', exact: true }).press('Enter')
      expect(await (await cleared).json()).toMatchObject({ code: 0 }); await present
      await dialog.getByRole('button', { name: en ? 'Close' : '关闭', exact: true }).press('Enter')
      await expect(page.getByTestId('console-link-row')).toHaveCount(1)
      await capture(page, info, 'note-status-cleared-' + scope + '-' + language)
      if (scope === 'own') {
        await permissions(manager.request, original.permissions.filter(value => value !== 'short_link:set_metadata'))
        await page.reload()
        const absent = listed(page, prefix, keyword, '', [first.id, second.id])
        await page.getByRole('textbox', { name: en ? 'Keyword' : '关键词搜索', exact: true }).fill(keyword); await absent
        await choose(page, prefix, keyword, 'absent', [first.id], en)
        await open(page, first.slug, en); await expect(field).toHaveAttribute('readonly', '')
        await expect(dialog.getByRole('button', { name: en ? 'Save note' : '保存备注', exact: true })).toHaveCount(0)
      }
      const proofPath = info.outputPath('note-status-proof.json')
      await writeFile(proofPath, JSON.stringify({ scope, language, width, browser: browser.version(), driverNode: process.version, exactPresentCSV: true, originalColumns: 17, savedLeavesAbsent: true, clearedLeavesPresent: true, readonlyFilter: scope === 'own', disposableDatabase: true }, null, 2))
      await info.attach('note-status-proof', { path: proofPath, contentType: 'application/json' })
    } catch (error) { failures.push(error) } finally {
      if (original) { try { const current = await group(manager.request); if (JSON.stringify(current.permissions) !== JSON.stringify(original.permissions)) await permissions(manager.request, original.permissions); expect((await group(manager.request)).permissions).toEqual(original.permissions) } catch (error) { failures.push(error) } }
      for (const link of links) { try { await success(manager.request, '/admin/short-link/delete', { id: link.id }) } catch (error) { failures.push(error) } }
      if (userID) { try { await success(manager.request, '/admin/user/update', { id: userID, nickname: 'Retired note status fixture', status: 'disabled' }) } catch (error) { failures.push(error) } }
      for (const context of contexts) { try { await context.close() } catch (error) { failures.push(error) } }
    }
    if (failures.length) throw new AggregateError(failures, 'Note status scenario or exact owned cleanup failed')
  })
}
