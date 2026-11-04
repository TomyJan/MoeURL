import { randomBytes, randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

/** Makes one real fixture request; failed writes are never automatically retried. */
async function success(api: APIRequestContext, path: string, data?: unknown) {
  const response = data === undefined ? await api.get('/api/v1' + path) : await api.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200)
  const body = await response.json()
  expect(body.code).toBe(0)
  return body
}

test.use({ serviceWorkers: 'block' })
// A fixed toast covering the reopened title must fail even when every business request succeeds.
for (const width of [1280, 390]) {
  test('feedback keeps a real success notification clear of the reopened title at ' + width + 'px', async ({ browser }, info) => {
    const baseURL = info.project.use.baseURL
    if (typeof baseURL !== 'string') throw new Error('Requires disposable Compose baseURL')
    const context = await browser.newContext({ baseURL, viewport: { width, height: width === 390 ? 844 : 900 }, locale: 'zh-CN', serviceWorkers: 'block', reducedMotion: 'reduce' })
    const page = await context.newPage(), keyword = 'feedback491-' + randomBytes(6).toString('hex')
    const links = new Set<string>(), failures: unknown[] = []
    try {
      await context.addInitScript(() => { localStorage.setItem('moeurl.language', 'zh-CN'); localStorage.setItem('moeurl.theme', 'light') })
      await success(page.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      await success(page.request, '/short-link/batch-create', { requestId: randomUUID(), targetUrls: ['https://example.com/' + keyword] })
      const found = await success(page.request, '/admin/short-link/list?q=' + keyword + '&page=1&pageSize=20')
      expect(found.data.items).toHaveLength(1)
      const id: string = found.data.items[0].id
      links.add(id)
      const note = (await success(page.request, '/admin/short-link/note?id=' + id)).data
      await success(page.request, '/admin/short-link/note/update', { id, note: 'Disposable notification fixture', expectedUpdatedAt: note.updatedAt })
      await page.goto('/admin/link')
      const listed = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/admin/short-link/list' && new URL(r.url()).searchParams.get('q') === keyword)
      await page.getByRole('textbox', { name: '关键词搜索', exact: true }).fill(keyword)
      expect((await (await listed).json()).code).toBe(0)
      await expect(page.getByTestId('console-link-row')).toHaveCount(1)
      await page.getByRole('checkbox').first().check()
      await page.getByTestId('batch-note-clear').click()
      await expect(page.getByTestId('batch-note-clear-confirm')).toBeEnabled()
      const cleared = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/admin/short-link/note/batch-clear')
      await page.getByTestId('batch-note-clear-confirm').click()
      expect((await (await cleared).json()).code).toBe(0)
      await expect(page.getByTestId('batch-note-clear-dialog')).toHaveCount(0)
      await page.getByRole('checkbox').first().check()
      await page.getByTestId('batch-note-clear').click()
      await expect(page.getByTestId('batch-note-clear-summary')).toBeVisible()
      await expect(page.getByTestId('batch-note-clear-cancel')).toBeFocused()
      await expect(page.locator('[data-sonner-toast]:visible')).toHaveCount(1)
      await expectNoHorizontalOverflow(page)
      const geometry = await page.getByTestId('batch-note-clear-dialog').evaluate(card => {
        const rect = (element: Element) => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom } }
        return { title: rect(card.querySelector('.v-card-title')!), toasts: Array.from(document.querySelectorAll('[data-sonner-toast]')).map(rect) }
      })
      const proof = info.outputPath('notification-title-geometry.json')
      await writeFile(proof, JSON.stringify(geometry, null, 2))
      await info.attach('notification-title-geometry', { path: proof, contentType: 'application/json' })
      const image = info.outputPath('notification-title.png')
      await page.screenshot({ path: image, animations: 'disabled' })
      await info.attach('notification-title', { path: image, contentType: 'image/png' })
      for (const toast of geometry.toasts) {
        const title = geometry.title
        expect(toast.right > title.left && title.right > toast.left && toast.bottom > title.top && title.bottom > toast.top, 'Notification overlaps the real reopened dialog title').toBe(false)
      }
    } catch (error) { failures.push(error) } finally {
      try {
        const found = await success(page.request, '/admin/short-link/list?q=' + keyword + '&page=1&pageSize=20')
        for (const link of found.data.items) links.add(link.id)
      } catch (error) { failures.push(error) }
      for (const id of links) { try { await success(page.request, '/admin/short-link/delete', { id }) } catch (error) { failures.push(error) } }
      try { await context.close() } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, 'Notification scenario or exact fixture cleanup failed')
  })
}
