import { randomBytes, randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test, type APIRequestContext } from '@playwright/test'
import type { ShortLink } from '../src/entities/short-link/model'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

/** Uses the real disposable application without logging private fixture bodies. */
async function success(api: APIRequestContext, path: string, data?: unknown) {
  const response = data === undefined ? await api.get('/api/v1' + path) : await api.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200)
  const value = await response.json(); expect(value.code).toBe(0); return value
}
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })
for (const scope of ['own', 'admin'] as const) for (const en of [false, true]) {
  test(`v0.51.1 ${scope} ${en ? 'en 390px' : 'zh-CN 1280px'} shows saving for a real 100-link write`, async ({ browser, page: manager }, info) => {
    test.setTimeout(150_000)
    const keyword = 'saving511-' + randomBytes(6).toString('hex'), password = 'saving-owned-fixture'
    const prefix = scope === 'own' ? '/short-link' : '/admin/short-link', language = en ? 'en' : 'zh-CN'
    const contexts: Awaited<ReturnType<typeof browser.newContext>>[] = [], links = new Map<string, ShortLink>(), failures: unknown[] = []
    let userId = '', release!: () => void, writes = 0, committed = false
    const hold = new Promise<void>(resolve => { release = resolve })
    const readAll = async () => (await success(manager.request, '/admin/short-link/list?q=' + keyword + '&pageSize=100&page=1')).data.items as ShortLink[]
    try {
      const baseURL = info.project.use.baseURL; if (typeof baseURL !== 'string') throw new Error('Requires the isolated application baseURL')
      await success(manager.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      userId = (await success(manager.request, '/admin/user/create', { username: keyword, password, nickname: 'Saving progress fixture', groupKey: 'user', status: 'active' })).data.user.id
      const context = await browser.newContext({ baseURL, viewport: { width: en ? 390 : 1280, height: en ? 844 : 900 }, locale: language, serviceWorkers: 'block', reducedMotion: 'reduce', colorScheme: en ? 'dark' : 'light' })
      contexts.push(context)
      await context.addInitScript(({ language, en }) => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', en ? 'dark' : 'light') }, { language, en })
      const page = await context.newPage()
      await success(page.request, '/auth/login', { username: keyword, password })
      for (let offset = 0; offset < 100; offset += 20) await success(page.request, '/short-link/batch-create', { requestId: randomUUID(), targetUrls: Array.from({ length: 20 }, (_, i) => `https://example.com/${keyword}/${offset + i}`) })
      const initial = await readAll(); expect(initial).toHaveLength(100); for (const row of initial) links.set(row.id, row)
      await success(manager.request, '/admin/short-link/batch-tags', { items: initial.map(({ id, updatedAt }) => ({ id, expectedUpdatedAt: updatedAt })), operation: 'replace', tags: ['old', 'keep'] })
      if (scope === 'admin') await success(page.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      await page.goto(scope === 'own' ? '/link' : '/admin/link')
      const filtered = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === '/api/v1' + prefix + '/list' && url.searchParams.get('q') === keyword })
      await page.getByRole('textbox', { name: en ? 'Keyword' : '关键词搜索', exact: true }).fill(keyword)
      expect((await (await filtered).json()).meta.total).toBe(100)
      const all = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === '/api/v1' + prefix + '/list' && url.searchParams.get('pageSize') === '100' && url.searchParams.get('q') === keyword })
      await page.getByRole('combobox', { name: en ? 'Rows per page' : '每页条数', exact: true }).press('Enter')
      await page.getByRole('option', { name: '100', exact: true }).click()
      expect((await (await all).json()).data.items).toHaveLength(100)
      await expect(page.getByTestId('console-link-row')).toHaveCount(100)
      await page.getByRole('checkbox').first().check()
      await page.getByTestId('batch-tag-rename').click()
      await page.getByRole('textbox', { name: en ? 'Current tag' : '原标签', exact: true }).fill('old')
      await page.getByRole('textbox', { name: en ? 'New tag' : '新标签', exact: true }).fill('new')
      await page.getByTestId('batch-tag-rename-approve').click()
      await page.route('**/api/v1' + prefix + '/batch-tag-rename', async route => {
        writes++
        const response = await route.fetch()
        expect(response.status()).toBe(200)
        expect((await response.json()).data).toEqual({ changedCount: 100, unchangedCount: 0 })
        committed = true
        await hold
        await route.fulfill({ response })
      })
      await page.getByTestId('batch-tag-rename-confirm').press('Enter')
      await expect.poll(() => committed).toBe(true)
      const save = page.getByRole('button', { name: en ? 'Saving…' : '正在保存…', exact: true })
      await expect(save).toBeVisible(); await expect(save).toBeDisabled(); await expect(save).toHaveAttribute('aria-busy', 'true')
      await expect(save).toHaveCSS('opacity', '1')
      await expect(save.locator('.v-btn__loader')).toContainText(en ? 'Saving…' : '正在保存…')
      await expect(save.locator('.v-progress-circular--indeterminate svg')).toBeVisible()
      await expect(page.getByTestId('batch-tag-rename-approve')).toHaveCount(0)
      await expect(page.getByRole('button', { name: en ? 'Cancel' : '取消', exact: true })).toBeDisabled()
      await expect(page.getByRole('textbox', { name: en ? 'New tag' : '新标签', exact: true })).toHaveAttribute('readonly', '')
      const actual = await readAll(); expect(actual).toHaveLength(100); for (const row of actual) expect(row.tags).toEqual(['new', 'keep'])
      await expectNoHorizontalOverflow(page)
      const geometry = await page.getByTestId('batch-tag-rename-dialog').evaluate(element => ({
        viewport: { width: innerWidth, height: innerHeight },
        buttons: Array.from(element.querySelectorAll('.v-card-actions button')).map(button => { const rect = button.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height, disabled: (button as HTMLButtonElement).disabled } }),
      }))
      expect(geometry.buttons).toHaveLength(2)
      for (const box of geometry.buttons) {
        expect(box.disabled).toBe(true); expect(box.width).toBeGreaterThan(0); expect(box.height).toBeGreaterThan(0)
        if (en) expect(box.height).toBeGreaterThanOrEqual(40)
        expect(box.left).toBeGreaterThanOrEqual(0); expect(box.right).toBeLessThanOrEqual(geometry.viewport.width + 1)
        expect(box.top).toBeGreaterThanOrEqual(0); expect(box.bottom).toBeLessThanOrEqual(geometry.viewport.height + 1)
      }
      const [a, b] = geometry.buttons
      expect(a!.right > b!.left + 1 && b!.right > a!.left + 1 && a!.bottom > b!.top + 1 && b!.bottom > a!.top + 1).toBe(false)
      const image = info.outputPath('saving-' + scope + '-' + language + '.png')
      await page.screenshot({ path: image, animations: 'disabled' }); await info.attach('saving-progress', { path: image, contentType: 'image/png' })
      const proof = info.outputPath('saving-proof.json')
      await writeFile(proof, JSON.stringify({ scope, language, browser: browser.version(), node: process.version, geometry, savingOpacity: await save.evaluate(element => getComputedStyle(element).opacity), writes, committed: true, actualTagsRead: 100 }, null, 2))
      await info.attach('saving-proof', { path: proof, contentType: 'application/json' })
      expect(writes).toBe(1)
      release()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      expect(writes).toBe(1)
    } catch (error) { failures.push(error) } finally {
      release()
      try { for (const row of await readAll()) links.set(row.id, row) } catch (error) { failures.push(error) }
      for (const row of links.values()) { try { await success(manager.request, '/admin/short-link/delete', { id: row.id }) } catch (error) { failures.push(error) } }
      if (userId) { try { await success(manager.request, '/admin/user/update', { id: userId, nickname: 'Saving progress fixture', status: 'disabled' }) } catch (error) { failures.push(error) } }
      for (const context of contexts) { try { await context.close() } catch (error) { failures.push(error) } }
    }
    if (failures.length) throw new AggregateError(failures, 'Saving progress scenario or exact owned cleanup failed')
  })
}
