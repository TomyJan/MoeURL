import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, BrowserContext } from '@playwright/test'
import type { ShortLink } from '../src/entities/short-link/model'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

/** Uses real Session requests while keeping a malformed response out of diagnostic output. */
async function success(api: APIRequestContext, path: string, data?: unknown) {
  const response = data === undefined ? await api.get('/api/v1' + path) : await api.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200)
  const result = await response.json()
  expect(result.code).toBe(0)
  return result
}

test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })
for (const scope of ['own', 'admin'] as const) {
  test('v0.43.1 ' + scope + ' rejects lossy versions and saves through the real editor', async ({ page: manager, browser }, info) => {
    const failures: unknown[] = []
    let context: BrowserContext | undefined, userID: string | undefined, link: ShortLink | undefined
    try {
      const baseURL = info.project.use.baseURL
      if (typeof baseURL !== 'string') throw new Error('Requires disposable Compose baseURL')
      await success(manager.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      const username = 'note431-' + randomBytes(6).toString('hex'), password = 'note-version-disposable-fixture'
      const created = await success(manager.request, '/admin/user/create', { username, password, nickname: 'Note version fixture', groupKey: 'user', status: 'active' })
      userID = created.data.user.id
      const language = scope === 'own' ? 'zh-CN' : 'en', width = scope === 'own' ? 390 : 1280
      context = await browser.newContext({ baseURL, viewport: { width, height: width === 390 ? 844 : 900 }, locale: language, serviceWorkers: 'block', reducedMotion: 'reduce' })
      await context.addInitScript(({ language }) => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', 'light') }, { language })
      const owner = await context.newPage()
      await success(owner.request, '/auth/login', { username, password })
      link = (await success(owner.request, '/short-link/create', { targetUrl: 'https://example.com/' + username, metadata: { title: username, tags: [] } })).data.shortLink as ShortLink
      const active = scope === 'own' ? owner : manager
      await active.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      if (scope === 'admin') await manager.addInitScript(() => { localStorage.setItem('moeurl.language', 'en'); localStorage.setItem('moeurl.theme', 'light') })
      const prefix = scope === 'own' ? '/short-link' : '/admin/short-link'
      const original = (await success(active.request, prefix + '/note?id=' + link.id)).data as { id: string; note: string; updatedAt: string }
      expect(original.updatedAt).toMatch(/Z$/)
      const lossy = original.updatedAt.replace(/(?:\.(\d+))?Z$/, (_match: string, fraction: string | undefined) => '.' + (fraction ?? '').padEnd(9, '0') + '1Z')
      const listEntry = async () => {
        const list = await success(owner.request, '/short-link/list')
        const item = (list.data.items as ShortLink[]).find(item => item.id === link!.id)
        expect(item).toBeDefined()
        return item
      }
      const before = await listEntry()
      const rejected = await active.request.post('/api/v1' + prefix + '/note/update', { data: { id: link.id, note: 'Must not be saved', expectedUpdatedAt: lossy } })
      expect(rejected.status()).toBe(200)
      expect((await rejected.json()).code).toBe(100001)
      expect((await success(active.request, prefix + '/note?id=' + link.id)).data).toEqual(original)
      expect(await listEntry()).toEqual(before)
      await active.goto(scope === 'own' ? '/link' : '/admin/link')
      const en = scope === 'admin'
      const row = active.getByTestId('console-link-row').filter({ hasText: link.slug })
      await row.getByRole('button', { name: en ? 'More actions' : '更多操作', exact: true }).press('Enter')
      await active.getByRole('menuitem', { name: en ? 'Note' : '备注', exact: true }).press('Enter')
      const dialog = active.getByTestId('note-dialog'), field = dialog.getByRole('textbox', { name: en ? 'Note text' : '备注内容', exact: true })
      await expect(field).toHaveValue(original.note)
      const changed = 'Version boundary ' + scope + ' 🙂'
      await field.fill(changed)
      const saved = active.waitForResponse('**/api/v1' + prefix + '/note/update')
      await dialog.getByRole('button', { name: en ? 'Save note' : '保存备注', exact: true }).press('Enter')
      const response = await saved
      expect(response.request().postDataJSON().expectedUpdatedAt).toBe(original.updatedAt)
      expect(await response.json()).toMatchObject({ code: 0, data: { note: changed } })
      await expect(dialog.getByRole('button', { name: en ? 'Save note' : '保存备注', exact: true })).toBeDisabled()
      const current = (await success(active.request, prefix + '/note?id=' + link.id)).data
      expect(current.note).toBe(changed)
      expect(current.updatedAt).not.toBe(original.updatedAt)
      expect(await listEntry()).toEqual(before)
      await expectNoHorizontalOverflow(active)
      const image = info.outputPath('note-version-' + scope + '.png')
      await active.screenshot({ path: image, animations: 'disabled' })
      await info.attach('note-version-' + scope, { path: image, contentType: 'image/png' })
      const proof = info.outputPath('version-protocol-proof.json')
      await writeFile(proof, JSON.stringify({ scope, browser: browser.version(), driverNode: process.version, language, width, malformedVersion: lossy, actualVersion: original.updatedAt, invalidRejected: true, noteUnchangedAfterRejection: true, legacyListEntryUnchanged: true, uiSavedExactOriginalVersion: true, normalSaveConfirmed: true, disposableDatabase: true }, null, 2))
      await info.attach('version-protocol-proof', { path: proof, contentType: 'application/json' })
    } catch (error) { failures.push(error) } finally {
      if (link) { try { await success(manager.request, '/admin/short-link/delete', { id: link.id }) } catch (error) { failures.push(error) } }
      if (userID) { try { await success(manager.request, '/admin/user/update', { id: userID, nickname: 'Note version fixture', status: 'disabled' }) } catch (error) { failures.push(error) } }
      if (context) { try { await context.close() } catch (error) { failures.push(error) } }
    }
    if (failures.length) throw new AggregateError(failures, 'Version scenario or owned cleanup failed')
  })
}
