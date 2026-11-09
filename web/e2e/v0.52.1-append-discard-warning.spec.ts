import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, BrowserContext } from '@playwright/test'
import { e2eAdminUsername, e2eAdminPassword, expectNoHorizontalOverflow } from './support'
import { captureAppendDiscard } from './batch-note-append-support'

/** Calls the real disposable application without including private request bodies in errors. */
async function success(api: APIRequestContext, path: string, data?: unknown) {
  const response = data === undefined ? await api.get('/api/v1' + path) : await api.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200)
  const value = await response.json(); expect(value.code).toBe(0); return value.data
}

test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })
// A clipped decision, changed retry key/body, or a discard that cancels an actual write breaks this flow.
for (const scope of ['own', 'admin'] as const) for (const en of [false, true]) {
  test('v0.52.1 ' + scope + (en ? ' en' : ' zh-CN') + ' 320x568 exposes the discard risk and keeps or retires only the local retry', async ({ browser, page: manager }, info) => {
    test.setTimeout(120_000)
    const keyword = 'discard521-' + randomBytes(6).toString('hex'), password = 'discard-append-owned-fixture'
    const prefix = scope === 'own' ? '/short-link' : '/admin/short-link', language = en ? 'en' : 'zh-CN'
    const links: string[] = [], failures: unknown[] = []
    let context: BrowserContext | undefined, userId: string | undefined
    try {
      const baseURL = info.project.use.baseURL; if (typeof baseURL !== 'string') throw new Error('Disposable baseURL required')
      await success(manager.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      userId = (await success(manager.request, '/admin/user/create', { username: keyword, password, nickname: 'Discard warning fixture', groupKey: 'user', status: 'active' })).user.id
      context = await browser.newContext({ baseURL, viewport: { width: 320, height: 568 }, locale: language, serviceWorkers: 'block', reducedMotion: 'reduce', colorScheme: en ? 'dark' : 'light' })
      await context.addInitScript(({ language, en }) => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', en ? 'dark' : 'light') }, { language, en })
      const page = await context.newPage()
      await success(page.request, '/auth/login', { username: keyword, password })
      for (let i = 0; i < 2; i++) links.push((await success(page.request, '/short-link/create', { targetUrl: 'https://example.com/' + keyword + '/' + i })).shortLink.id)
      if (scope === 'admin') {
        await success(page.request, '/auth/logout', {})
        await success(page.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      }
      const load = async () => {
        await page.goto(scope === 'own' ? '/link' : '/admin/link')
        const pending = page.waitForResponse(response => {
          const url = new URL(response.url()); return url.pathname === '/api/v1' + prefix + '/list' && url.searchParams.get('q') === keyword
        })
        await page.getByRole('textbox', { name: en ? 'Keyword' : '关键词搜索', exact: true }).fill(keyword)
        expect((await (await pending).json()).meta.total).toBe(2)
        await expect(page.getByTestId('console-link-row')).toHaveCount(2)
        await page.getByRole('checkbox').first().check()
      }
      const open = async (note: string) => {
        await page.getByTestId('batch-note-append').click()
        const textarea = page.getByRole('dialog').getByRole('textbox'); await expect(textarea).toBeFocused(); await textarea.fill(note)
        await page.getByTestId('batch-note-append-preview').click(); await expect(page.getByTestId('batch-note-append-confirm')).toBeEnabled()
      }
      const path = '**/api/v1' + prefix + '/note/batch-append', bodies: string[] = [], committed: unknown[] = [], postPaths: string[] = []
      page.on('request', request => { if (request.method() === 'POST') postPaths.push(new URL(request.url()).pathname) })
      await page.route(path, async route => {
        const body = route.request().postData()!; bodies.push(body)
        const response = await route.fetch(); expect(response.status()).toBe(200)
        const value = await response.json(); expect(value.code).toBe(0); committed.push(value.data)
        if (bodies.length === 2) { expect(body).toBe(bodies[0]); await route.fulfill({ response }) }
        else await route.abort('failed')
      })
      await load(); await open('first <b>literal</b> 🙂')
      await page.getByTestId('batch-note-append-confirm').click(); await expect(page.getByTestId('batch-note-append-unknown')).toBeVisible()
      const first = JSON.parse(bodies[0]!), notes = await Promise.all(links.map(id => success(manager.request, '/admin/short-link/note?id=' + id)))
      for (const note of notes) expect(note.note).toBe('first <b>literal</b> 🙂')
      await page.getByTestId('batch-note-append-cancel').click()
      await captureAppendDiscard(page, info, 'discard-keep-' + scope + '-' + language, first.requestId)
      await page.getByTestId('batch-note-append-keep').click()
      await expect(page.getByRole('dialog').getByRole('textbox')).toHaveValue(first.note)
      await expect(page.getByRole('dialog').getByRole('textbox')).toHaveAttribute('readonly', '')
      // Returning and immediately closing again must expose the same decision and frozen request.
      await page.getByTestId('batch-note-append-cancel').click()
      await captureAppendDiscard(page, info, 'discard-again-' + scope + '-' + language, first.requestId)
      await page.getByTestId('batch-note-append-keep').click(); expect(bodies).toHaveLength(1)
      await page.getByTestId('batch-note-append-retry').click(); await expect(page.getByTestId('batch-note-append-dialog')).toHaveCount(0)
      expect(bodies).toHaveLength(2); expect(committed[1]).toEqual(committed[0])
      expect(await Promise.all(links.map(id => success(manager.request, '/admin/short-link/note?id=' + id)))).toEqual(notes)
      await load(); await open('second')
      await page.getByTestId('batch-note-append-confirm').click(); await expect(page.getByTestId('batch-note-append-unknown')).toBeVisible()
      expect(bodies).toHaveLength(3); const second = JSON.parse(bodies[2]!)
      expect(second.requestId).not.toBe(first.requestId)
      await page.getByTestId('batch-note-append-cancel').click()
      await captureAppendDiscard(page, info, 'discard-retire-' + scope + '-' + language, second.requestId)
      const beforeDiscard = [...postPaths]
      await page.getByTestId('batch-note-append-discard').click(); await expect(page.getByTestId('batch-note-append-dialog')).toHaveCount(0)
      await expectNoHorizontalOverflow(page)
      for (const id of links) expect((await success(manager.request, '/admin/short-link/note?id=' + id)).note).toBe('first <b>literal</b> 🙂\nsecond')
      expect(postPaths).toEqual(beforeDiscard); expect(bodies).toHaveLength(3)
      expect(await page.evaluate(keyword => [...Object.values(localStorage), ...Object.values(sessionStorage)].some(value => String(value).includes(keyword)), first.note)).toBe(false)
      await page.unroute(path)
      const proof = info.outputPath('discard-proof.json')
      await writeFile(proof, JSON.stringify({ scope, language, width: 320, height: 568, browser: browser.version(), node: process.version, targets: 2, attempts: bodies.length, committedLostResponses: 2, identicalRetryBodyAndKey: true, replayPreservesBothNotesAndRevisions: true, discardDoesNotCancelServerWrite: true, discardSendsNoPost: true }, null, 2))
      await info.attach('discard-proof', { path: proof, contentType: 'application/json' })
    } catch (error) { failures.push(error) } finally {
      for (const id of links) { try { await success(manager.request, '/admin/short-link/delete', { id }) } catch (error) { failures.push(error) } }
      if (userId) { try { await success(manager.request, '/admin/user/update', { id: userId, nickname: 'Discard warning fixture', status: 'disabled' }) } catch (error) { failures.push(error) } }
      try { await context?.close() } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, 'Discard warning or exact owned cleanup failed')
  })
}
