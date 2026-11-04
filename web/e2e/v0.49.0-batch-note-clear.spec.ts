import { randomBytes, randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Page, TestInfo } from '@playwright/test'
import type { ShortLink } from '../src/entities/short-link/model'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

interface Note { note: string; updatedAt: string }
interface Preview { items: { id: string; expectedUpdatedAt: string; expectedNoteUpdatedAt: string; hasNote: boolean }[]; nonemptyCount: number; emptyCount: number }
/** Requires real transport and business success; fixture bodies never become diagnostics. */
async function success(api: APIRequestContext, path: string, data?: unknown) {
  const response = data === undefined ? await api.get('/api/v1' + path) : await api.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200)
  const value = await response.json(); expect(value.code).toBe(0); return value
}
/** Saves exactly once using the current independent note revision. */
async function saveNote(api: APIRequestContext, id: string, note: string) {
  const before: Note = (await success(api, '/admin/short-link/note?id=' + id)).data
  return (await success(api, '/admin/short-link/note/update', { id, note, expectedUpdatedAt: before.updatedAt })).data as Note
}
/** Waits for this fixture's actual filtered response before interacting with guarded paging. */
async function loadList(page: Page, prefix: string, keyword: string, en: boolean) {
  await page.goto(prefix === '/short-link' ? '/link' : '/admin/link')
  const loaded = page.waitForResponse(response => {
    const url = new URL(response.url())
    return url.pathname === '/api/v1' + prefix + '/list' && url.searchParams.get('q') === keyword && url.searchParams.get('pageSize') === '20'
  })
  await page.getByRole('textbox', { name: en ? 'Keyword' : '关键词搜索', exact: true }).fill(keyword)
  const response = await loaded, result = await response.json()
  expect(response.status()).toBe(200); expect(result.code).toBe(0); expect(result.meta.total).toBe(100)
  await expect(page.getByTestId('console-link-row')).toHaveCount(20)
  const size = page.getByRole('combobox', { name: en ? 'Rows per page' : '每页条数', exact: true })
  await expect(size).toBeEnabled()
  await size.press('Enter'); await page.getByRole('option', { name: '100', exact: true }).click()
  await selectPage(page, 100)
  return size
}
/** Selects only the current successful page, including the 100-row upper bound. */
async function selectPage(page: Page, count: number) {
  await expect(page.getByTestId('console-link-row')).toHaveCount(count)
  const all = page.getByRole('checkbox').first(); await expect(all).toBeEnabled(); await all.check()
  await expect(page.getByTestId('batch-note-clear')).toBeEnabled()
}
/** Opens by keyboard and inspects the actual preview before allowing any write. */
async function preview(page: Page, prefix: string, count: number, nonempty: number) {
  const request = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + prefix + '/note/batch-clear/preview')
  await page.getByTestId('batch-note-clear').focus(); await page.keyboard.press('Enter')
  const response = await request, body = await response.json()
  expect(response.status()).toBe(200); expect(body.code).toBe(0)
  expect(response.request().method()).toBe('POST'); expect(response.headers()['cache-control']).toContain('no-store')
  expect(response.request().headers()['x-moeurl-expected-user-id']).toMatch(/^[a-f0-9-]{36}$/)
  const result = body.data as Preview
  expect(Object.keys(result).sort()).toEqual(['items', 'nonemptyCount', 'emptyCount'].sort())
  expect(result.items).toHaveLength(count); expect(result.nonemptyCount).toBe(nonempty); expect(result.emptyCount).toBe(count - nonempty)
  for (const item of result.items) expect(Object.keys(item).sort()).toEqual(['id', 'expectedUpdatedAt', 'expectedNoteUpdatedAt', 'hasNote'].sort())
  await expect(page.getByTestId('batch-note-clear-summary')).toBeVisible()
  await expect(page.getByTestId('batch-note-clear-cancel')).toBeFocused()
  return result
}
/** Confirms one actual request; errors are observed without replaying the write. */
async function clear(page: Page, prefix: string, expectedCode: number, snapshot: Preview) {
  const request = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + prefix + '/note/batch-clear')
  await page.getByTestId('batch-note-clear-confirm').focus(); await page.keyboard.press('Enter')
  const response = await request, body = await response.json()
  expect(response.status()).toBe(200); expect(body.code).toBe(expectedCode)
  expect(response.request().postDataJSON()).toEqual({ items: snapshot.items.map(({ id, expectedUpdatedAt, expectedNoteUpdatedAt }) => ({ id, expectedUpdatedAt, expectedNoteUpdatedAt })) })
  await expect(page.getByTestId('batch-note-clear-dialog')).toHaveCount(0)
  return body
}
/** Keeps notifications visible and measures the real dialog and hit targets before saving the original image. */
async function capture(page: Page, info: TestInfo, name: string) {
  await expectNoHorizontalOverflow(page)
  const dialog = page.getByTestId('batch-note-clear-dialog')
  const geometry = () => dialog.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const buttons = Array.from(element.querySelectorAll('button')).map(button => {
      const b = button.getBoundingClientRect(), hit = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2)
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, hit: hit !== null && button.contains(hit) }
    })
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, overflow: element.scrollWidth - element.clientWidth, buttons, width: innerWidth, height: innerHeight }
  })
  await expect.poll(async () => (await geometry()).buttons.every(button => button.hit)).toBe(true)
  const boxes = await geometry()
  expect(boxes.left).toBeGreaterThanOrEqual(-1); expect(boxes.right).toBeLessThanOrEqual(boxes.width + 1)
  expect(boxes.overflow).toBeLessThanOrEqual(1)
  for (const a of boxes.buttons) { expect(a.top).toBeGreaterThanOrEqual(0); expect(a.bottom).toBeLessThanOrEqual(boxes.height + 1) }
  for (const [i, a] of boxes.buttons.entries()) for (const b of boxes.buttons.slice(i + 1)) expect(a.right > b.left + 1 && b.right > a.left + 1 && a.bottom > b.top + 1 && b.bottom > a.top + 1).toBe(false)
  const dataPath = info.outputPath(name + '-geometry.json'); await writeFile(dataPath, JSON.stringify(boxes, null, 2)); await info.attach(name + '-geometry', { path: dataPath, contentType: 'application/json' })
  const path = info.outputPath(name + '.png'); await page.screenshot({ path, animations: 'disabled' }); await info.attach(name, { path, contentType: 'image/png' })
}

test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })
// Dropping either CAS version, clearing only a prefix, returning note text or bypassing explicit confirmation breaks these real flows.
for (const scope of ['own', 'admin'] as const) for (const en of [false, true]) {
  test('v0.49.0 ' + scope + (en ? ' en 390px' : ' zh-CN 1280px') + ' atomically clears 100 notes with real conflicts and private filters', async ({ browser, page: manager }, info) => {
    test.setTimeout(180_000)
    const contexts: BrowserContext[] = [], links = new Map<string, ShortLink>(), users: string[] = [], failures: unknown[] = []
    const keyword = 'clear49-' + randomBytes(6).toString('hex'), term = 'private49-' + randomBytes(6).toString('hex')
    const password = 'batch-note-clear-owned-fixture', prefix = scope === 'own' ? '/short-link' : '/admin/short-link'
    try {
      const baseURL = info.project.use.baseURL
      if (typeof baseURL !== 'string') throw new Error('Requires disposable Compose baseURL')
      await success(manager.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      const ownerName = keyword + '-owner', recipientName = keyword + '-recipient'
      for (const username of [ownerName, recipientName]) users.push((await success(manager.request, '/admin/user/create', { username, password, nickname: 'Batch note clear fixture', groupKey: 'user', status: 'active' })).data.user.id)
      const language = en ? 'en' : 'zh-CN', width = en ? 390 : 1280
      const makePage = async () => {
        const context = await browser.newContext({ baseURL, viewport: { width, height: en ? 844 : 900 }, locale: language, serviceWorkers: 'block', reducedMotion: 'reduce', colorScheme: en ? 'dark' : 'light' })
        contexts.push(context)
        await context.addInitScript(({ language, en }) => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', en ? 'dark' : 'light') }, { language, en })
        return context.newPage()
      }
      const owner = await makePage(); await success(owner.request, '/auth/login', { username: ownerName, password })
      for (let offset = 0; offset < 100; offset += 20) {
        await success(owner.request, '/short-link/batch-create', { requestId: randomUUID(), targetUrls: Array.from({ length: 20 }, (_, index) => 'https://example.com/' + keyword + '/' + (offset + index)) })
        const found = await success(owner.request, '/short-link/list?q=' + keyword + '&page=1&pageSize=100')
        for (const link of found.data.items as ShortLink[]) links.set(link.id, link)
        expect(links.size).toBe(offset + 20)
      }
      const [a, b, empty] = [...links.values()] as [ShortLink, ShortLink, ShortLink, ...ShortLink[]]
      const aNote = await saveNote(manager.request, a.id, term + '\nLiteral <b>🙂</b>'), bNote = await saveNote(manager.request, b.id, '\uFEFF' + term)
      const emptyBefore: Note = (await success(manager.request, '/admin/short-link/note?id=' + empty.id)).data
      const page = scope === 'own' ? owner : await makePage()
      if (scope === 'admin') await success(page.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      const size = await loadList(page, prefix, keyword, en)
      const first = await preview(page, prefix, 100, 2)
      expect(JSON.stringify(first)).not.toContain(term)
      await capture(page, info, 'batch-clear-mixed100-' + scope + '-' + language)
      await page.keyboard.press('Enter') // The default safe action cancels without writing.
      await expect(page.getByTestId('batch-note-clear-dialog')).toHaveCount(0)
      await expect(page.getByTestId('batch-note-clear')).toBeFocused()
      expect((await success(manager.request, '/admin/short-link/note?id=' + a.id)).data).toEqual(aNote)

      const staleNote = await preview(page, prefix, 100, 2)
      const edited = await saveNote(manager.request, b.id, term + '-changed')
      await clear(page, prefix, 200116, staleNote)
      expect((await success(manager.request, '/admin/short-link/note?id=' + a.id)).data).toEqual(aNote)
      expect((await success(manager.request, '/admin/short-link/note?id=' + b.id)).data).toEqual(edited)

      await loadList(page, prefix, keyword, en)
      const staleMain = await preview(page, prefix, 100, 2), pinned = staleMain.items.find(item => item.id === a.id)!
      const transfer = (await success(manager.request, '/admin/short-link/transfer', { id: a.id, newOwnerUsername: recipientName, expectedUpdatedAt: pinned.expectedUpdatedAt })).data
      await clear(page, prefix, scope === 'own' ? 200104 : 200116, staleMain)
      expect((await success(manager.request, '/admin/short-link/note?id=' + a.id)).data).toEqual(aNote)
      expect((await success(manager.request, '/admin/short-link/note?id=' + b.id)).data).toEqual(edited)
      await success(manager.request, '/admin/short-link/transfer', { id: a.id, newOwnerUsername: ownerName, expectedUpdatedAt: transfer.updatedAt })

      await loadList(page, prefix, keyword, en)
      const current = await preview(page, prefix, 100, 2)
      await expect(page.getByRole('textbox', { name: en ? 'Note keyword' : '备注关键词', exact: true })).toBeDisabled()
      await expect(size).toBeDisabled()
      expect((await clear(page, prefix, 0, current)).data).toEqual({ changedCount: 2, unchangedCount: 98 })
      for (const link of links.values()) {
        const note: Note = (await success(manager.request, '/admin/short-link/note?id=' + link.id)).data
        expect(note.note).toBe('')
        if (link.id === a.id) expect(note.updatedAt).not.toBe(aNote.updatedAt)
        if (link.id === b.id) expect(note.updatedAt).not.toBe(edited.updatedAt)
        if (link.id === empty.id) expect(note).toEqual(emptyBefore)
      }
      await selectPage(page, 100); await preview(page, prefix, 100, 0)
      await expect(page.getByTestId('batch-note-clear-confirm')).toHaveCount(0)
      await capture(page, info, 'batch-clear-empty100-' + scope + '-' + language)
      await page.getByTestId('batch-note-clear-cancel').press('Enter')

      await saveNote(manager.request, a.id, term); await saveNote(manager.request, b.id, term)
      await page.getByRole('combobox', { name: en ? 'Note status' : '备注状态', exact: true }).press('Enter')
      await page.getByRole('option', { name: en ? 'With note' : '有备注', exact: true }).click()
      await expect(page.getByTestId('console-link-row')).toHaveCount(2)
      await page.getByRole('textbox', { name: en ? 'Note keyword' : '备注关键词', exact: true }).fill(term)
      await selectPage(page, 2)
      const filtered = await preview(page, prefix, 2, 2)
      await capture(page, info, 'batch-clear-filtered-' + scope + '-' + language)
      expect((await clear(page, prefix, 0, filtered)).data).toEqual({ changedCount: 2, unchangedCount: 0 })
      await expect(page.getByTestId('console-link-row')).toHaveCount(0)
      await expect(page.getByRole('textbox', { name: en ? 'Note keyword' : '备注关键词', exact: true })).toHaveValue(term)
      await expect(page.getByRole('combobox', { name: en ? 'Note status' : '备注状态', exact: true })).toHaveValue(en ? 'With note' : '有备注')
      expect(page.url()).not.toContain(term)
      expect(await page.evaluate(term => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => String(value).includes(term)), term)).toBe(false)
      const proofPath = info.outputPath('batch-clear-proof.json')
      await writeFile(proofPath, JSON.stringify({ browser: browser.version(), driverNode: process.version, scope, language, width, selectedCount: 100, changedCount: 2, unchangedCount: 98, noteConflict: 200116, transferConflict: scope === 'own' ? 200104 : 200116, actualNotesRead: 100, emptyRevisionPreserved: true, keyboardCancelAndConfirm: true, privateFilterExit: true, originalBOMNoteVersion: bNote.updatedAt }, null, 2))
      await info.attach('batch-clear-proof', { path: proofPath, contentType: 'application/json' })
    } catch (error) { failures.push(error) } finally {
      // Discover only this unique fixture family if an atomic create response was lost.
      try {
        const found = await success(manager.request, '/admin/short-link/list?q=' + keyword + '&page=1&pageSize=100')
        for (const link of found.data.items as ShortLink[]) links.set(link.id, link)
      } catch (error) { failures.push(error) }
      for (const link of links.values()) { try { await success(manager.request, '/admin/short-link/delete', { id: link.id }) } catch (error) { failures.push(error) } }
      for (const id of users) { try { await success(manager.request, '/admin/user/update', { id, nickname: 'Batch note clear fixture', status: 'disabled' }) } catch (error) { failures.push(error) } }
      for (const context of contexts) { try { await context.close() } catch (error) { failures.push(error) } }
    }
    if (failures.length) throw new AggregateError(failures, 'Batch note clear scenario or exact owned cleanup failed')
  })
}
