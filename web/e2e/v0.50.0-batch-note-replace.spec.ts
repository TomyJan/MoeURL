import { randomBytes, randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Page, TestInfo } from '@playwright/test'
import type { ShortLink } from '../src/entities/short-link/model'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

interface Note { note: string; updatedAt: string }
interface Preview { items: { id: string; expectedUpdatedAt: string; expectedNoteUpdatedAt: string; willChange: boolean }[]; changedCount: number; unchangedCount: number }
/** Uses the real API without printing private fixture bodies on failure. */
async function success(api: APIRequestContext, path: string, data?: unknown) {
  const response = data === undefined ? await api.get('/api/v1' + path) : await api.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200)
  const value = await response.json(); expect(value.code).toBe(0); return value
}
/** Writes against the independently read note revision, never the list's main revision. */
async function saveNote(api: APIRequestContext, id: string, note: string) {
  const before: Note = (await success(api, '/admin/short-link/note?id=' + id)).data
  return (await success(api, '/admin/short-link/note/update', { id, note, expectedUpdatedAt: before.updatedAt })).data as Note
}
/** Waits for the actual current fixture family and chooses the upper current-page bound. */
async function loadList(page: Page, prefix: string, keyword: string, en: boolean) {
  await page.goto(prefix === '/short-link' ? '/link' : '/admin/link')
  const loaded = page.waitForResponse(response => {
    const url = new URL(response.url())
    return url.pathname === '/api/v1' + prefix + '/list' && url.searchParams.get('q') === keyword && url.searchParams.get('pageSize') === '20'
  })
  await page.getByRole('textbox', { name: en ? 'Keyword' : '关键词搜索', exact: true }).fill(keyword)
  const response = await loaded, value = await response.json()
  expect(response.status()).toBe(200); expect(value.code).toBe(0); expect(value.meta.total).toBe(100)
  const size = page.getByRole('combobox', { name: en ? 'Rows per page' : '每页条数', exact: true })
  await expect(size).toBeEnabled(); await size.press('Enter'); await page.getByRole('option', { name: '100', exact: true }).click()
  await selectPage(page, 100)
  return size
}
/** Uses the actual successful list selection rather than constructing hidden controller state. */
async function selectPage(page: Page, count: number) {
  await expect(page.getByTestId('console-link-row')).toHaveCount(count)
  const all = page.getByRole('checkbox').first(); await expect(all).toBeEnabled(); await all.check()
  await expect(page.getByTestId('batch-note-replace')).toBeEnabled()
}
/** Opening focuses the editable draft and sends no request; only explicit preview dispatches. */
async function open(page: Page, note: string) {
  await page.getByTestId('batch-note-replace').focus(); await page.keyboard.press('Enter')
  const textbox = page.getByRole('dialog').getByRole('textbox'); await expect(textbox).toBeFocused()
  await expect(textbox).toHaveValue(''); await expect(page.getByTestId('batch-note-replace-preview')).toBeDisabled()
  await textbox.fill(note)
  return textbox
}
/** Checks complete metadata and exact counts without accepting or displaying old private content. */
async function preview(page: Page, prefix: string, changed: number, unchanged: number) {
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + prefix + '/note/batch-replace/preview')
  await page.getByTestId('batch-note-replace-preview').click()
  const response = await pending, body = await response.json()
  expect(response.status()).toBe(200); expect(body.code).toBe(0); expect(response.headers()['cache-control']).toContain('no-store')
  expect(response.request().method()).toBe('POST'); expect(response.request().headers()['x-moeurl-expected-user-id']).toMatch(/^[a-f0-9-]{36}$/)
  const value = body.data as Preview
  expect(Object.keys(value).sort()).toEqual(['items', 'changedCount', 'unchangedCount'].sort())
  expect(value.items).toHaveLength(changed + unchanged); expect(value.changedCount).toBe(changed); expect(value.unchangedCount).toBe(unchanged)
  for (const item of value.items) expect(Object.keys(item).sort()).toEqual(['id', 'expectedUpdatedAt', 'expectedNoteUpdatedAt', 'willChange'].sort())
  await expect(page.getByTestId('batch-note-replace-summary')).toBeVisible()
  return value
}
/** Confirms the exact approved main/note revisions and text once, without automatic retries. */
async function replace(page: Page, prefix: string, note: string, snapshot: Preview, code = 0) {
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + prefix + '/note/batch-replace')
  await page.getByTestId('batch-note-replace-confirm').focus(); await page.keyboard.press('Enter')
  const response = await pending, body = await response.json()
  expect(response.status()).toBe(200); expect(body.code).toBe(code)
  expect(response.request().postDataJSON()).toEqual({ items: snapshot.items.map(({ id, expectedUpdatedAt, expectedNoteUpdatedAt }) => ({ id, expectedUpdatedAt, expectedNoteUpdatedAt })), note })
  await expect(page.getByTestId('batch-note-replace-dialog')).toHaveCount(0)
  if (code === 0) await expect(page.getByTestId(prefix.startsWith('/admin/') ? 'console-page-admin-links' : 'console-page-links')).toBeFocused()
  return body.data
}
/** Measures visible hit targets and saves the unaltered page, including notifications. */
async function capture(page: Page, info: TestInfo, name: string) {
  await expectNoHorizontalOverflow(page)
  const geometry = () => page.getByTestId('batch-note-replace-dialog').evaluate(element => {
    const r = element.getBoundingClientRect()
    return { left: r.left, right: r.right, overflow: element.scrollWidth - element.clientWidth, width: innerWidth, height: innerHeight,
      buttons: Array.from(element.querySelectorAll('button')).map(button => {
        const b = button.getBoundingClientRect(), hit = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2)
        return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, hit: hit !== null && button.contains(hit) }
      }) }
  })
  await expect.poll(async () => (await geometry()).buttons.every(button => button.hit)).toBe(true)
  const boxes = await geometry(); expect(boxes.left).toBeGreaterThanOrEqual(-1); expect(boxes.right).toBeLessThanOrEqual(boxes.width + 1); expect(boxes.overflow).toBeLessThanOrEqual(1)
  for (const a of boxes.buttons) { expect(a.top).toBeGreaterThanOrEqual(0); expect(a.bottom).toBeLessThanOrEqual(boxes.height + 1) }
  for (const [i, a] of boxes.buttons.entries()) for (const b of boxes.buttons.slice(i + 1)) expect(a.right > b.left + 1 && b.right > a.left + 1 && a.bottom > b.top + 1 && b.bottom > a.top + 1).toBe(false)
  const data = info.outputPath(name + '-geometry.json'); await writeFile(data, JSON.stringify(boxes, null, 2)); await info.attach(name + '-geometry', { path: data, contentType: 'application/json' })
  const path = info.outputPath(name + '.png'); await page.screenshot({ path, animations: 'disabled' }); await info.attach(name, { path, contentType: 'image/png' })
}

test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })
// A stale approval, partial overwrite, lost-response retry or leaked old text breaks these real user flows.
for (const scope of ['own', 'admin'] as const) for (const en of [false, true]) {
  test('v0.50.0 ' + scope + (en ? ' en 390px' : ' zh-CN 1280px') + ' safely replaces 100 notes with conflicts and unknown-result readback', async ({ browser, page: manager }, info) => {
    test.setTimeout(180_000)
    const contexts: BrowserContext[] = [], links = new Map<string, ShortLink>(), users: string[] = [], failures: unknown[] = []
    const keyword = 'replace50-' + randomBytes(6).toString('hex'), term = 'private50-' + randomBytes(6).toString('hex')
    const password = 'batch-note-replace-owned-fixture', prefix = scope === 'own' ? '/short-link' : '/admin/short-link'
    const header = 'Literal <b>🙂</b>\n', replacement = header + '😀'.repeat(1000 - [...header].length)
    try {
      const baseURL = info.project.use.baseURL; if (typeof baseURL !== 'string') throw new Error('Requires disposable Compose baseURL')
      await success(manager.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      const ownerName = keyword + '-owner', recipientName = keyword + '-recipient'
      for (const username of [ownerName, recipientName]) users.push((await success(manager.request, '/admin/user/create', { username, password, nickname: 'Batch note replace fixture', groupKey: 'user', status: 'active' })).data.user.id)
      const language = en ? 'en' : 'zh-CN', width = en ? 390 : 1280
      const makePage = async () => {
        const context = await browser.newContext({ baseURL, viewport: { width, height: en ? 844 : 900 }, locale: language, serviceWorkers: 'block', reducedMotion: 'reduce', colorScheme: en ? 'dark' : 'light' }); contexts.push(context)
        await context.addInitScript(({ language, en }) => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', en ? 'dark' : 'light') }, { language, en })
        return context.newPage()
      }
      const owner = await makePage(); await success(owner.request, '/auth/login', { username: ownerName, password })
      for (let offset = 0; offset < 100; offset += 20) {
        await success(owner.request, '/short-link/batch-create', { requestId: randomUUID(), targetUrls: Array.from({ length: 20 }, (_, i) => 'https://example.com/' + keyword + '/' + (offset + i)) })
        for (const link of (await success(owner.request, '/short-link/list?q=' + keyword + '&page=1&pageSize=100')).data.items as ShortLink[]) links.set(link.id, link)
        expect(links.size).toBe(offset + 20)
      }
      const [a, b] = [...links.values()] as [ShortLink, ShortLink, ...ShortLink[]]
      const aBefore = await saveNote(manager.request, a.id, replacement), bBefore = await saveNote(manager.request, b.id, term + '-old')
      const page = scope === 'own' ? owner : await makePage(); if (scope === 'admin') await success(page.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      const size = await loadList(page, prefix, keyword, en), textbox = await open(page, replacement)
      await textbox.press('Enter'); await expect(page.getByTestId('batch-note-replace-confirm')).toHaveCount(0)
      await textbox.fill(replacement); await preview(page, prefix, 99, 1)
      await textbox.fill('B'); await textbox.fill(replacement); await expect(page.getByTestId('batch-note-replace-confirm')).toHaveCount(0)
      await preview(page, prefix, 99, 1); await capture(page, info, 'batch-replace-mixed100-' + scope + '-' + language)
      await page.getByTestId('batch-note-replace-cancel').press('Enter')
      expect((await success(manager.request, '/admin/short-link/note?id=' + b.id)).data).toEqual(bBefore)

      await open(page, replacement); const staleNote = await preview(page, prefix, 99, 1)
      const edited = await saveNote(manager.request, b.id, term + '-edited')
      await replace(page, prefix, replacement, staleNote, 200116)
      expect((await success(manager.request, '/admin/short-link/note?id=' + a.id)).data).toEqual(aBefore)
      expect((await success(manager.request, '/admin/short-link/note?id=' + b.id)).data).toEqual(edited)

      await loadList(page, prefix, keyword, en); await open(page, replacement); const staleMain = await preview(page, prefix, 99, 1)
      const transferred = (await success(manager.request, '/admin/short-link/transfer', { id: a.id, newOwnerUsername: recipientName, expectedUpdatedAt: staleMain.items.find(item => item.id === a.id)!.expectedUpdatedAt })).data
      await replace(page, prefix, replacement, staleMain, scope === 'own' ? 200104 : 200116)
      expect((await success(manager.request, '/admin/short-link/note?id=' + b.id)).data).toEqual(edited)
      await success(manager.request, '/admin/short-link/transfer', { id: a.id, newOwnerUsername: ownerName, expectedUpdatedAt: transferred.updatedAt })

      await loadList(page, prefix, keyword, en); await open(page, replacement); const current = await preview(page, prefix, 99, 1)
      await expect(size).toBeDisabled(); await expect(page.getByTestId('batch-note-clear')).toBeDisabled()
      expect(await replace(page, prefix, replacement, current)).toEqual({ changedCount: 99, unchangedCount: 1 })
      for (const link of links.values()) {
        const note: Note = (await success(manager.request, '/admin/short-link/note?id=' + link.id)).data
        expect(note.note).toBe(replacement); if (link.id === a.id) expect(note).toEqual(aBefore)
      }
      await selectPage(page, 100); await open(page, replacement); await preview(page, prefix, 0, 100)
      await expect(page.getByTestId('batch-note-replace-confirm')).toHaveCount(0)
      await capture(page, info, 'batch-replace-noop100-' + scope + '-' + language); await page.getByTestId('batch-note-replace-cancel').press('Enter')

      await saveNote(manager.request, a.id, term); await saveNote(manager.request, b.id, term)
      await page.getByRole('combobox', { name: en ? 'Note status' : '备注状态', exact: true }).press('Enter')
      await page.getByRole('option', { name: en ? 'With note' : '有备注', exact: true }).click()
      await page.getByRole('textbox', { name: en ? 'Note keyword' : '备注关键词', exact: true }).fill(term)
      await selectPage(page, 2); await open(page, 'filtered replacement'); const filtered = await preview(page, prefix, 2, 0)
      expect(await replace(page, prefix, 'filtered replacement', filtered)).toEqual({ changedCount: 2, unchangedCount: 0 })
      await expect(page.getByTestId('console-link-row')).toHaveCount(0)
      await expect(page.getByRole('textbox', { name: en ? 'Note keyword' : '备注关键词', exact: true })).toHaveValue(term)
      expect(page.url()).not.toContain(term); expect(await page.evaluate(term => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => String(value).includes(term)), term)).toBe(false)

      await loadList(page, prefix, keyword, en); await open(page, 'uncertain-' + keyword); await preview(page, prefix, 100, 0)
      let lostWrites = 0
      const routePath = '**/api/v1' + prefix + '/note/batch-replace'
      await page.route(routePath, async route => {
        lostWrites++; const committed = await route.fetch(); expect(committed.status()).toBe(200); expect((await committed.json()).code).toBe(0)
        await route.abort('failed')
      })
      await page.getByTestId('batch-note-replace-confirm').click()
      await expect(page.getByRole('dialog').getByRole('textbox')).toHaveAttribute('readonly', '')
      await expect(page.getByTestId('batch-note-replace-confirm')).toHaveCount(0)
      await page.unroute(routePath)
      const readback = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + prefix + '/note/batch-replace/preview')
      await page.getByTestId('batch-note-replace-preview').click(); const result = (await (await readback).json()).data
      expect(result.changedCount).toBe(0); expect(result.unchangedCount).toBe(100); expect(lostWrites).toBe(1)
      await expect(page.getByTestId('batch-note-replace-summary')).toBeVisible(); await expect(page.getByTestId('batch-note-replace-confirm')).toHaveCount(0)
      await capture(page, info, 'batch-replace-readback100-' + scope + '-' + language)
      expect((await success(manager.request, '/admin/short-link/note?id=' + b.id)).data.note).toBe('uncertain-' + keyword)
      const proof = info.outputPath('batch-replace-proof.json')
      await writeFile(proof, JSON.stringify({ browser: browser.version(), driverNode: process.version, scope, language, width, targets: 100, replacementCodePoints: [...replacement].length, changed: 99, unchanged: 1, actualNotesRead: 100, noteConflict: 200116, mainConflict: scope === 'own' ? 200104 : 200116, editABARequiresPreview: true, keyboardEnterNeverWrites: true, noOpNoWriteAction: true, privateFilterExit: true, committedLostResponseActualReadback: true, lostWrites }, null, 2))
      await info.attach('batch-replace-proof', { path: proof, contentType: 'application/json' })
    } catch (error) { failures.push(error) } finally {
      try { for (const link of (await success(manager.request, '/admin/short-link/list?q=' + keyword + '&page=1&pageSize=100')).data.items as ShortLink[]) links.set(link.id, link) } catch (error) { failures.push(error) }
      for (const link of links.values()) { try { await success(manager.request, '/admin/short-link/delete', { id: link.id }) } catch (error) { failures.push(error) } }
      for (const id of users) { try { await success(manager.request, '/admin/user/update', { id, nickname: 'Batch note replace fixture', status: 'disabled' }) } catch (error) { failures.push(error) } }
      for (const context of contexts) { try { await context.close() } catch (error) { failures.push(error) } }
    }
    if (failures.length) throw new AggregateError(failures, 'Batch note replacement scenario or exact owned cleanup failed')
  })
}
