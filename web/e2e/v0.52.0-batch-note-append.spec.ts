import { randomBytes, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Page, TestInfo } from '@playwright/test'
import type { ShortLink } from '../src/entities/short-link/model'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

interface Note { note: string; updatedAt: string }
interface Preview { items: { id: string; expectedUpdatedAt: string; expectedNoteUpdatedAt: string }[]; appendableCount: number; overflowCount: number }
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
  await expect(page.getByTestId('batch-note-append')).toBeEnabled()
}
/** Opening focuses the editable draft and sends no request; only explicit preview dispatches. */
async function open(page: Page, note: string) {
  await page.getByTestId('batch-note-append').focus(); await page.keyboard.press('Enter')
  const textbox = page.getByRole('dialog').getByRole('textbox'); await expect(textbox).toBeFocused()
  await expect(textbox).toHaveValue(''); await expect(page.getByTestId('batch-note-append-preview')).toBeDisabled()
  await textbox.fill(note)
  return textbox
}
/** Checks only exact ordered metadata and aggregate counts, never old private text. */
async function preview(page: Page, prefix: string, appendable: number, overflow: number) {
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + prefix + '/note/batch-append/preview')
  await page.getByTestId('batch-note-append-preview').click()
  const response = await pending, body = await response.json()
  expect(response.status()).toBe(200); expect(body.code).toBe(0); expect(response.headers()['cache-control']).toContain('no-store')
  expect(response.request().method()).toBe('POST'); expect(response.request().headers()['x-moeurl-expected-user-id']).toMatch(/^[a-f0-9-]{36}$/)
  const value = body.data as Preview
  expect(Object.keys(value).sort()).toEqual(['items', 'appendableCount', 'overflowCount'].sort())
  expect(value.items).toHaveLength(appendable + overflow); expect(value.appendableCount).toBe(appendable); expect(value.overflowCount).toBe(overflow)
  for (const item of value.items) expect(Object.keys(item).sort()).toEqual(['id', 'expectedUpdatedAt', 'expectedNoteUpdatedAt'].sort())
  await expect(page.getByTestId('batch-note-append-summary')).toBeVisible()
  return value
}
/** Confirms one explicit snapshot with a secure key, without retrying definite conflicts. */
async function append(page: Page, prefix: string, note: string, snapshot: Preview, code = 0) {
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + prefix + '/note/batch-append')
  await page.getByTestId('batch-note-append-confirm').focus(); await page.keyboard.press('Enter')
  const response = await pending, body = await response.json(), input = response.request().postDataJSON()
  expect(response.status()).toBe(200); expect(body.code).toBe(code)
  expect(input).toEqual({ requestId: expect.stringMatching(/^[a-f0-9-]{36}$/), items: snapshot.items, note })
  await expect(page.getByTestId('batch-note-append-dialog')).toHaveCount(0)
  if (code === 0) await expect(page.getByTestId(prefix.startsWith('/admin/') ? 'console-page-admin-links' : 'console-page-links')).toBeFocused()
  return body.data
}
/** Reads audit totals only from the exact disposable Compose database, never a daily database. */
function auditState(ids: string[], requestId: string) {
  const project = process.env.MOEURL_E2E_COMPOSE_PROJECT
  if (!project || !/^moeurl-e2e-[a-z0-9_-]+$/.test(project) || [...ids, requestId].some(id => !/^[a-f0-9-]{36}$/.test(id))) throw new Error('Unsafe E2E database identity')
  const containers = execFileSync('docker', ['ps', '-q', '--filter', 'label=com.docker.compose.project=' + project, '--filter', 'label=com.docker.compose.service=postgres'], { encoding: 'utf8', timeout: 10_000 }).trim().split(/\s+/)
  if (containers.length !== 1 || !/^[a-f0-9]+$/.test(containers[0]!)) throw new Error('Expected one owned postgres')
  const sql = "select json_build_object('audits',(select count(*) from audit_log where resource_type='short_link' and resource_id in (" + ids.map(id => "'" + id + "'").join(',') + ") and changed_fields=array['note']),'receipts',(select count(*) from short_link_note_append_batch where request_id='" + requestId + "'))::text"
  return JSON.parse(execFileSync('docker', ['exec', containers[0]!, 'psql', '-U', 'moeurl', '-d', 'moeurl', '-v', 'ON_ERROR_STOP=1', '-Atc', sql], { encoding: 'utf8', timeout: 10_000 }).trim()) as { audits: number; receipts: number }
}
/** Measures visible hit targets and saves the unaltered page, including notifications. */
async function capture(page: Page, info: TestInfo, name: string) {
  await expectNoHorizontalOverflow(page)
  const geometry = () => page.getByTestId('batch-note-append-dialog').evaluate(element => {
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
// Partial writes, stale CAS approval, repeated committed requests or leaked drafts break these real flows.
for (const scope of ['own', 'admin'] as const) for (const en of [false, true]) {
  test('v0.52.0 ' + scope + (en ? ' en 390px' : ' zh-CN 1280px') + ' appends 100 notes atomically and replays the committed request exactly once', async ({ browser, page: manager }, info) => {
    test.setTimeout(240_000)
    const contexts: BrowserContext[] = [], links = new Map<string, ShortLink>(), users: string[] = [], failures: unknown[] = []
    const keyword = 'append52-' + randomBytes(6).toString('hex'), term = 'private52-' + randomBytes(6).toString('hex')
    const password = 'batch-note-append-owned-fixture', prefix = scope === 'own' ? '/short-link' : '/admin/short-link'
    const header = 'Literal <b>🙂</b>\n', suffix = header + '😀'.repeat(993 - [...header].length)
    try {
      const baseURL = info.project.use.baseURL; if (typeof baseURL !== 'string') throw new Error('Requires disposable Compose baseURL')
      await success(manager.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      const ownerName = keyword + '-owner', recipientName = keyword + '-recipient'
      for (const username of [ownerName, recipientName]) users.push((await success(manager.request, '/admin/user/create', { username, password, nickname: 'Batch note append fixture', groupKey: 'user', status: 'active' })).data.user.id)
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
      const aOverflow = await saveNote(manager.request, a.id, '😀'.repeat(1000)), bBefore = await saveNote(manager.request, b.id, term)
      const page = scope === 'own' ? owner : await makePage(); if (scope === 'admin') await success(page.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      const size = await loadList(page, prefix, keyword, en), textbox = await open(page, 'x')
      await textbox.press('Enter'); await expect(page.getByTestId('batch-note-append-confirm')).toHaveCount(0)
      await textbox.fill('x'); await preview(page, prefix, 99, 1)
      await expect(page.getByTestId('batch-note-append-confirm')).toHaveCount(0)
      await capture(page, info, 'batch-append-overflow100-' + scope + '-' + language)
      await page.getByTestId('batch-note-append-cancel').press('Enter')
      expect((await success(manager.request, '/admin/short-link/note?id=' + a.id)).data).toEqual(aOverflow)
      expect((await success(manager.request, '/admin/short-link/note?id=' + b.id)).data).toEqual(bBefore)
      const aBefore = await saveNote(manager.request, a.id, 'base-a'); await saveNote(manager.request, b.id, 'base-b')
      await open(page, suffix); await preview(page, prefix, 100, 0)
      await page.getByRole('dialog').getByRole('textbox').fill('B'); await page.getByRole('dialog').getByRole('textbox').fill(suffix)
      await expect(page.getByTestId('batch-note-append-confirm')).toHaveCount(0)
      const staleNote = await preview(page, prefix, 100, 0), edited = await saveNote(manager.request, b.id, 'edited')
      await append(page, prefix, suffix, staleNote, 200116)
      expect((await success(manager.request, '/admin/short-link/note?id=' + a.id)).data).toEqual(aBefore)
      expect((await success(manager.request, '/admin/short-link/note?id=' + b.id)).data).toEqual(edited)
      await saveNote(manager.request, b.id, 'base-b')
      await loadList(page, prefix, keyword, en); await open(page, suffix); const staleMain = await preview(page, prefix, 100, 0)
      const transferred = (await success(manager.request, '/admin/short-link/transfer', { id: a.id, newOwnerUsername: recipientName, expectedUpdatedAt: staleMain.items.find(item => item.id === a.id)!.expectedUpdatedAt })).data
      await append(page, prefix, suffix, staleMain, scope === 'own' ? 200104 : 200116)
      expect((await success(manager.request, '/admin/short-link/note?id=' + a.id)).data).toEqual(aBefore)
      await success(manager.request, '/admin/short-link/transfer', { id: a.id, newOwnerUsername: ownerName, expectedUpdatedAt: transferred.updatedAt })
      await loadList(page, prefix, keyword, en); await open(page, suffix); const current = await preview(page, prefix, 100, 0)
      await expect(size).toBeDisabled(); await expect(page.getByTestId('batch-note-clear')).toBeDisabled(); await expect(page.getByTestId('batch-note-replace')).toBeDisabled()
      await capture(page, info, 'batch-append-ready100-' + scope + '-' + language)
      const saved = await append(page, prefix, suffix, current); expect(saved.appendedCount).toBe(100)
      for (const link of links.values()) {
        const note: Note = (await success(manager.request, '/admin/short-link/note?id=' + link.id)).data
        expect(note.note).toBe(link.id === a.id ? 'base-a\n' + suffix : link.id === b.id ? 'base-b\n' + suffix : suffix)
        expect([...note.note].length).toBe(link.id === a.id || link.id === b.id ? 1000 : 993)
      }
      const fresh = (await success(manager.request, '/admin/short-link/list?q=' + keyword + '&page=1&pageSize=100')).data.items as ShortLink[]
      const clear = (await success(manager.request, '/admin/short-link/note/batch-clear/preview', { items: fresh.map(link => ({ id: link.id, expectedUpdatedAt: link.updatedAt })) })).data
      await success(manager.request, '/admin/short-link/note/batch-clear', { items: clear.items.map(({ id, expectedUpdatedAt, expectedNoteUpdatedAt }: Preview['items'][number]) => ({ id, expectedUpdatedAt, expectedNoteUpdatedAt })) })
      await loadList(page, prefix, keyword, en)
      await page.getByRole('combobox', { name: en ? 'Note status' : '备注状态', exact: true }).press('Enter')
      await page.getByRole('option', { name: en ? 'Without note' : '无备注', exact: true }).click()
      await selectPage(page, 100); await open(page, '  ' + term + '\r\nadded  '); await preview(page, prefix, 100, 0)
      let attempts = 0, firstBody = '', beforeAudit: ReturnType<typeof auditState> | undefined, committedAudit: ReturnType<typeof auditState> | undefined
      const routePath = '**/api/v1' + prefix + '/note/batch-append', ids = [...links.keys()]
      await page.route(routePath, async route => {
        attempts++; const raw = route.request().postData()!, input = route.request().postDataJSON()
        if (attempts === 1) {
          firstBody = raw; beforeAudit = auditState(ids, input.requestId)
          expect(input.note).toBe(term + '\nadded')
          const committed = await route.fetch(); expect(committed.status()).toBe(200); expect((await committed.json()).code).toBe(0)
          committedAudit = auditState(ids, input.requestId); expect(committedAudit.audits - beforeAudit.audits).toBe(100); expect(committedAudit.receipts).toBe(1)
          await route.abort('failed')
        } else { expect(attempts).toBe(2); expect(raw).toBe(firstBody); await route.continue() }
      })
      await page.getByTestId('batch-note-append-confirm').click()
      await expect(page.getByTestId('batch-note-append-unknown')).toBeVisible()
      await expect(page.getByRole('dialog').getByRole('textbox')).toHaveAttribute('readonly', '')
      await expect(page.getByTestId('batch-note-append-preview')).toHaveCount(0); await expect(page.getByTestId('batch-note-append-confirm')).toHaveCount(0)
      await page.getByTestId('batch-note-append-cancel').click(); await expect(page.getByTestId('batch-note-append-discard-warning')).toBeVisible()
      await expect(page.getByTestId('batch-note-append-keep')).toBeFocused(); await capture(page, info, 'batch-append-unknown-warning-' + scope + '-' + language)
      await page.getByTestId('batch-note-append-keep').click(); await capture(page, info, 'batch-append-unknown-retry-' + scope + '-' + language)
      const committedNotes = new Map<string, Note>()
      for (const id of ids) { const note: Note = (await success(manager.request, '/admin/short-link/note?id=' + id)).data; expect(note.note).toBe(term + '\nadded'); committedNotes.set(id, note) }
      expect(attempts).toBe(1)
      const retried = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + prefix + '/note/batch-append')
      await page.getByTestId('batch-note-append-retry').press('Enter')
      expect((await (await retried).json()).data).toEqual({ requestId: JSON.parse(firstBody).requestId, appendedCount: 100 })
      await expect(page.getByTestId('batch-note-append-dialog')).toHaveCount(0); expect(attempts).toBe(2)
      expect(auditState(ids, JSON.parse(firstBody).requestId)).toEqual(committedAudit)
      for (const id of ids) expect((await success(manager.request, '/admin/short-link/note?id=' + id)).data).toEqual(committedNotes.get(id))
      await expect(page.getByTestId('console-link-row')).toHaveCount(0)
      await expect(page.getByRole('combobox', { name: en ? 'Note status' : '备注状态', exact: true })).toHaveValue(en ? 'Without note' : '无备注')
      expect(page.url()).not.toContain(term); expect(await page.evaluate(term => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => String(value).includes(term)), term)).toBe(false)
      await page.unroute(routePath)
      const proof = info.outputPath('batch-append-proof.json')
      await writeFile(proof, JSON.stringify({ browser: browser.version(), driverNode: process.version, scope, language, width, targets: 100, maximumFinalCodePoints: 1000, overflowBlocksWholeBatch: true, noteConflict: 200116, mainConflict: scope === 'own' ? 200104 : 200116, editABARetiresPreview: true, actualCommittedLostResponse: true, identicalBodyAndKeyRetry: true, attempts, auditsBefore: beforeAudit, auditsAfterCommit: committedAudit, auditsAfterRetry: auditState(ids, JSON.parse(firstBody).requestId), notesAndRevisionsUnchangedByReplay: 100, privateFilterExit: true }, null, 2))
      await info.attach('batch-append-proof', { path: proof, contentType: 'application/json' })
    } catch (error) { failures.push(error) } finally {
      try { for (const link of (await success(manager.request, '/admin/short-link/list?q=' + keyword + '&page=1&pageSize=100')).data.items as ShortLink[]) links.set(link.id, link) } catch (error) { failures.push(error) }
      for (const link of links.values()) { try { await success(manager.request, '/admin/short-link/delete', { id: link.id }) } catch (error) { failures.push(error) } }
      for (const id of users) { try { await success(manager.request, '/admin/user/update', { id, nickname: 'Batch note append fixture', status: 'disabled' }) } catch (error) { failures.push(error) } }
      for (const context of contexts) { try { await context.close() } catch (error) { failures.push(error) } }
    }
    if (failures.length) throw new AggregateError(failures, 'Batch note append scenario or exact owned cleanup failed')
  })
}
