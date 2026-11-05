import { randomBytes, randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test, type APIRequestContext, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import type { ShortLink } from '../src/entities/short-link/model'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

/** Exercises real disposable API boundaries without printing private fixture bodies. */
async function success(api: APIRequestContext, path: string, data?: unknown) {
  const response = data === undefined ? await api.get('/api/v1' + path) : await api.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200); const value = await response.json(); expect(value.code).toBe(0); return value
}
/** Pins the selected records to the actual successful browser list response. */
async function loadList(page: Page, prefix: string, keyword: string, en: boolean) {
  await page.goto(prefix === '/short-link' ? '/link' : '/admin/link')
  const pending = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === '/api/v1' + prefix + '/list' && url.searchParams.get('q') === keyword && url.searchParams.get('pageSize') === '20' })
  await page.getByRole('textbox', { name: en ? 'Keyword' : '关键词搜索', exact: true }).fill(keyword)
  expect((await (await pending).json()).meta.total).toBe(100)
  const size = page.getByRole('combobox', { name: en ? 'Rows per page' : '每页条数', exact: true }); await expect(size).toBeEnabled()
  const all = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === '/api/v1' + prefix + '/list' && url.searchParams.get('q') === keyword && url.searchParams.get('pageSize') === '100' })
  await size.press('Enter'); await page.getByRole('option', { name: '100', exact: true }).click()
  const body = await (await all).json(); expect(body.code).toBe(0); expect(body.data.items).toHaveLength(100)
  await selectPage(page, 100); return body.data.items as ShortLink[]
}
/** Uses only current, enabled list selection controls. */
async function selectPage(page: Page, count: number) {
  await expect(page.getByTestId('console-link-row')).toHaveCount(count)
  const all = page.getByRole('checkbox').first(); await expect(all).toBeEnabled(); await all.check()
  await expect(page.getByTestId('batch-tag-rename')).toBeEnabled()
}
/** Editing and Enter cannot implicitly approve or submit a rename. */
async function open(page: Page, old: string, replacement: string, en: boolean) {
  await page.getByTestId('batch-tag-rename').focus(); await page.keyboard.press('Enter')
  const from = page.getByRole('textbox', { name: en ? 'Current tag' : '原标签', exact: true }), to = page.getByRole('textbox', { name: en ? 'New tag' : '新标签', exact: true })
  await expect(from).toBeFocused(); await expect(from).toHaveValue(''); await expect(to).toHaveValue('')
  await from.fill(old); await to.fill(replacement); await to.press('Enter')
  await expect(page.getByTestId('batch-tag-rename-confirm')).toHaveCount(0)
  return { from, to }
}
/** Requires an explicit preview approval before the separate save action. */
async function approve(page: Page, changed: number, unchanged: number, en: boolean) {
  const preview = page.getByTestId('batch-tag-rename-preview'); await expect(preview).toBeVisible()
  await expect(preview).toContainText(en ? `${changed} ${changed === 1 ? 'link' : 'links'} will change.` : `预计 ${changed} 条短链变化。`)
  await expect(preview).toContainText(en ? `${unchanged} ${unchanged === 1 ? 'link does' : 'links do'} not contain the current tag.` : `${unchanged} 条短链不含原标签。`)
  await page.getByTestId('batch-tag-rename-approve').focus(); await page.keyboard.press('Enter')
  await expect(page.getByTestId('batch-tag-rename-confirm')).toBeEnabled()
}
/** Confirms the exact browser snapshot once; response status alone never proves the actual tags. */
async function rename(page: Page, prefix: string, rows: ShortLink[], fromTag: string, toTag: string, code = 0) {
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + prefix + '/batch-tag-rename')
  await page.getByTestId('batch-tag-rename-confirm').focus(); await page.keyboard.press('Enter')
  const response = await pending, value = await response.json()
  expect(response.status()).toBe(200); expect(value.code).toBe(code); expect(response.headers()['cache-control']).toContain('no-store')
  expect(response.request().postDataJSON()).toEqual({ items: rows.map(({ id, updatedAt }) => ({ id, expectedUpdatedAt: updatedAt })), fromTag, toTag })
  expect(response.request().headers()['x-moeurl-expected-user-id']).toMatch(/^[a-f0-9-]{36}$/)
  return value.data
}
/** Saves unaltered visible UI and independently measures dialog and action hit targets. */
async function capture(page: Page, info: TestInfo, name: string) {
  await expectNoHorizontalOverflow(page)
  const geometry = () => page.getByTestId('batch-tag-rename-dialog').evaluate(element => {
    const r = element.getBoundingClientRect()
    return { left: r.left, right: r.right, overflow: element.scrollWidth - element.clientWidth, width: innerWidth, height: innerHeight,
      buttons: Array.from(element.querySelectorAll('button')).filter(button => !button.disabled).map(button => { const b = button.getBoundingClientRect(), hit = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2); return { left: b.left, right: b.right, top: b.top, bottom: b.bottom, hit: hit !== null && button.contains(hit) } }) }
  })
  await expect.poll(async () => (await geometry()).buttons.every(button => button.hit)).toBe(true)
  const boxes = await geometry(); expect(boxes.left).toBeGreaterThanOrEqual(-1); expect(boxes.right).toBeLessThanOrEqual(boxes.width + 1); expect(boxes.overflow).toBeLessThanOrEqual(1)
  for (const a of boxes.buttons) { expect(a.top).toBeGreaterThanOrEqual(0); expect(a.bottom).toBeLessThanOrEqual(boxes.height + 1) }
  for (const [i, a] of boxes.buttons.entries()) for (const b of boxes.buttons.slice(i + 1)) expect(a.right > b.left + 1 && b.right > a.left + 1 && a.bottom > b.top + 1 && b.bottom > a.top + 1).toBe(false)
  const data = info.outputPath(name + '-geometry.json'); await writeFile(data, JSON.stringify(boxes, null, 2)); await info.attach(name + '-geometry', { path: data, contentType: 'application/json' })
  const path = info.outputPath(name + '.png'); await page.screenshot({ path, animations: 'disabled' }); await info.attach(name, { path, contentType: 'image/png' })
}
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })
for (const scope of ['own', 'admin'] as const) for (const en of [false, true]) {
  test('v0.51.0 ' + scope + (en ? ' en 390px' : ' zh-CN 1280px') + ' atomically renames 100 selected tags with conflict and actual lost-response readback', async ({ browser, page: manager }, info) => {
    test.setTimeout(180_000)
    const contexts: BrowserContext[] = [], links = new Map<string, ShortLink>(), users: string[] = [], failures: unknown[] = []
    const keyword = 'rename51-' + randomBytes(6).toString('hex'), password = 'tag-rename-owned-fixture', old = 'Old-' + keyword, replacement = '😀'.repeat(32)
    const prefix = scope === 'own' ? '/short-link' : '/admin/short-link', language = en ? 'en' : 'zh-CN', width = en ? 390 : 1280
    const readAll = async () => (await success(manager.request, '/admin/short-link/list?q=' + keyword + '&page=1&pageSize=100')).data.items as ShortLink[]
    /** Sets known fixture groups through the existing production versioned tag API. */
    const setTags = async (rows: ShortLink[], tags: string[]) => success(manager.request, '/admin/short-link/batch-tags', { items: rows.map(({ id, updatedAt }) => ({ id, expectedUpdatedAt: updatedAt })), operation: 'replace', tags })
    try {
      const baseURL = info.project.use.baseURL; if (typeof baseURL !== 'string') throw new Error('Requires disposable Compose baseURL')
      await success(manager.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      const username = keyword + '-owner'; users.push((await success(manager.request, '/admin/user/create', { username, password, nickname: 'Tag rename fixture', groupKey: 'user', status: 'active' })).data.user.id)
      const makePage = async () => {
        const context = await browser.newContext({ baseURL, viewport: { width, height: en ? 844 : 900 }, locale: language, serviceWorkers: 'block', reducedMotion: 'reduce', colorScheme: en ? 'dark' : 'light' }); contexts.push(context)
        await context.addInitScript(({ language, en }) => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', en ? 'dark' : 'light') }, { language, en }); return context.newPage()
      }
      const owner = await makePage(); await success(owner.request, '/auth/login', { username, password })
      for (let offset = 0; offset < 100; offset += 20) await success(owner.request, '/short-link/batch-create', { requestId: randomUUID(), targetUrls: Array.from({ length: 20 }, (_, i) => 'https://example.com/' + keyword + '/' + (offset + i)) })
      const initial = await readAll(); expect(initial).toHaveLength(100); for (const row of initial) links.set(row.id, row)
      const first = initial.slice(0, 33), both = initial.slice(33, 66), absent = initial.slice(66)
      await setTags(first, [old, 'keep']); await setTags(both, [old, 'keep', replacement]); await setTags(absent, ['keep'])
      const a = initial[0]!, b = initial[1]!
      const noteVersion = (await success(manager.request, '/admin/short-link/note?id=' + b.id)).data.updatedAt
      const noteBefore = (await success(manager.request, '/admin/short-link/note/update', { id: b.id, note: 'Preserved private note ' + keyword, expectedUpdatedAt: noteVersion })).data
      const page = scope === 'own' ? owner : await makePage(); if (scope === 'admin') await success(page.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      let rows = await loadList(page, prefix, keyword, en)
      const cancelBefore = await readAll(), controls = await open(page, old, replacement, en)
      await approve(page, 66, 34, en)
      await controls.to.fill('B'); await controls.to.fill(replacement)
      await expect(page.getByTestId('batch-tag-rename-confirm')).toHaveCount(0)
      await approve(page, 66, 34, en)
      await capture(page, info, 'tag-rename-mixed100-' + scope + '-' + language)
      await page.getByRole('button', { name: en ? 'Cancel' : '取消', exact: true }).press('Enter')
      expect(await readAll()).toEqual(cancelBefore)

      rows = await loadList(page, prefix, keyword, en); await open(page, old, replacement, en); await approve(page, 66, 34, en)
      await success(manager.request, '/admin/short-link/update', { id: b.id, title: 'Preserved title ' + keyword })
      const conflictBefore = await readAll(); await rename(page, prefix, rows, old, replacement, 200116)
      await expect(page.getByRole('dialog')).toContainText(en ? 'Selected links changed' : '所选短链已变化')
      await expect(page.getByRole('textbox', { name: en ? 'New tag' : '新标签', exact: true })).toHaveAttribute('readonly', '')
      expect(await readAll()).toEqual(conflictBefore)
      const readback = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + prefix + '/list')
      await page.getByTestId('batch-tag-rename-reload').click(); expect((await (await readback).json()).code).toBe(0)
      await expect(page.getByRole('dialog')).toHaveCount(0)

      rows = await loadList(page, prefix, keyword, en); await open(page, old, replacement, en); await approve(page, 66, 34, en)
      const successBefore = await readAll()
      await expect(page.getByRole('combobox', { name: en ? 'Rows per page' : '每页条数', exact: true })).toBeDisabled()
      expect(await rename(page, prefix, rows, old, replacement)).toEqual({ changedCount: 66, unchangedCount: 34 })
      await expect(page.getByRole('dialog')).toHaveCount(0)
      const changed = new Set([...first, ...both].map(row => row.id)), firstIds = new Set(first.map(row => row.id)), beforeById = new Map(successBefore.map(row => [row.id, row]))
      for (const row of await readAll()) {
        const before = beforeById.get(row.id)!, { tags: beforeTags, updatedAt: beforeVersion, ...beforeFields } = before, { tags, updatedAt, ...fields } = row
        expect(fields).toEqual(beforeFields); expect(tags).toEqual(firstIds.has(row.id) ? [replacement, 'keep'] : changed.has(row.id) ? ['keep', replacement] : ['keep'])
        if (changed.has(row.id)) expect(updatedAt).not.toBe(beforeVersion); else { expect(updatedAt).toBe(beforeVersion); expect(tags).toEqual(beforeTags) }
      }
      expect((await success(manager.request, '/admin/short-link/note?id=' + b.id)).data).toEqual(noteBefore)
      await selectPage(page, 100); await open(page, old, replacement, en)
      await expect(page.getByTestId('batch-tag-rename-approve')).toBeDisabled()
      await capture(page, info, 'tag-rename-noop100-' + scope + '-' + language)
      await page.getByRole('button', { name: en ? 'Cancel' : '取消', exact: true }).press('Enter')

      await setTags((await readAll()).filter(row => row.id === a.id || row.id === b.id), [old, 'keep'])
      const filtered = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === '/api/v1' + prefix + '/list' && url.searchParams.get('tag') === old })
      await page.getByRole('textbox', { name: en ? 'Tag' : '标签', exact: true }).fill(old)
      const selected = (await (await filtered).json()).data.items as ShortLink[]; expect(selected).toHaveLength(2)
      await selectPage(page, 2); await open(page, old, replacement, en); await approve(page, 2, 0, en)
      expect(await rename(page, prefix, selected, old, replacement)).toEqual({ changedCount: 2, unchangedCount: 0 })
      await expect(page.getByTestId('console-link-row')).toHaveCount(0)
      await expect(page.getByRole('textbox', { name: en ? 'Tag' : '标签', exact: true })).toHaveValue(old)

      await setTags(await readAll(), [old, 'keep']); await loadList(page, prefix, keyword, en); await open(page, old, replacement, en); await approve(page, 100, 0, en)
      let lostWrites = 0
      const routePath = '**/api/v1' + prefix + '/batch-tag-rename'
      await page.route(routePath, async route => { lostWrites++; const committed = await route.fetch(); expect(committed.status()).toBe(200); expect((await committed.json()).data).toEqual({ changedCount: 100, unchangedCount: 0 }); await route.abort('failed') })
      await page.getByTestId('batch-tag-rename-confirm').click()
      await expect(page.getByRole('dialog')).toContainText(en ? 'The save result is unknown' : '保存结果未确认')
      await expect(page.getByRole('button', { name: en ? 'Cancel' : '取消', exact: true })).toBeDisabled()
      await expect(page.getByTestId('batch-tag-rename-confirm')).toHaveCount(0)
      await capture(page, info, 'tag-rename-unknown100-' + scope + '-' + language); await page.unroute(routePath)
      const reloaded = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === '/api/v1' + prefix + '/list' && url.searchParams.get('q') === keyword })
      await page.getByTestId('batch-tag-rename-reload').focus(); await page.keyboard.press('Enter')
      const actual = await (await reloaded).json(); expect(actual.code).toBe(0); expect(actual.data.items).toHaveLength(100)
      for (const row of actual.data.items) expect(row.tags).toEqual([replacement, 'keep'])
      await expect(page.getByRole('dialog')).toHaveCount(0); expect(lostWrites).toBe(1)
      await expect(page.getByTestId('batch-tag-rename')).toBeDisabled()
      const proof = info.outputPath('tag-rename-proof.json')
      await writeFile(proof, JSON.stringify({ browser: browser.version(), driverNode: process.version, scope, language, width, targets: 100, replacementCodePoints: 32, changed: 66, unchanged: 34, actualMetadataRead: 100, conflict: 200116, exactTagsAndOrder: true, noOpVersionUnchanged: true, unrelatedFieldsAndNoteUnchanged: true, editABARequiresApproval: true, keyboardEnterNeverWrites: true, oldTagFilterExit: true, committedLostResponseActualListReadback: true, lostWrites }, null, 2)); await info.attach('tag-rename-proof', { path: proof, contentType: 'application/json' })
    } catch (error) { failures.push(error) } finally {
      try { for (const row of await readAll()) links.set(row.id, row) } catch (error) { failures.push(error) }
      for (const row of links.values()) { try { await success(manager.request, '/admin/short-link/delete', { id: row.id }) } catch (error) { failures.push(error) } }
      for (const id of users) { try { await success(manager.request, '/admin/user/update', { id, nickname: 'Tag rename fixture', status: 'disabled' }) } catch (error) { failures.push(error) } }
      for (const context of contexts) { try { await context.close() } catch (error) { failures.push(error) } }
    }
    if (failures.length) throw new AggregateError(failures, 'Tag rename scenario or exact owned cleanup failed')
  })
}
