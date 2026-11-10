import { randomBytes, randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, Page, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

const endpoint = '/api/v1/short-link/batch-create-with-custom-slugs'
interface Link { id: string; slug: string; targetUrl: string }
interface Batch { requestId: string; items: { targetUrl: string; title: string; tags: string[]; customSlug: string }[] }

for (const language of ['zh-CN', 'en'] as const) for (const width of [1280, 390]) {
  test('v0.56.1 ' + language + ' ' + width + 'px explains definite refusals, allows corrections and preserves unknown retries', async ({ page: manager, browser }, info) => {
    const nonce = randomBytes(7).toString('hex'), username = 'csvfeedback-' + nonce, password = 'disposable-feedback-fixture-password'
    const failures: unknown[] = []
    let account: { id: string } | undefined, page: Page | undefined
    const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width, height: width === 1280 ? 900 : 800 }, locale: language, colorScheme: language === 'en' ? 'dark' : 'light', hasTouch: width === 390, serviceWorkers: 'block', reducedMotion: 'reduce' })
    try {
      await post(manager.request, '/api/v1/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      const created = await post(manager.request, '/api/v1/admin/user/create', { username, password, nickname: 'Disposable CSV feedback fixture', groupKey: 'admin', status: 'active' })
      account = created.data.user as { id: string }
      await context.addInitScript(({ language }) => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', language === 'en' ? 'dark' : 'light') }, { language })
      page = await context.newPage(); await post(page.request, '/api/v1/auth/login', { username, password })
      const occupied = 'Taken' + nonce
      await post(page.request, endpoint, { requestId: randomUUID(), items: [{ targetUrl: 'https://example.org/occupied/' + nonce, title: '', tags: [], customSlug: occupied }] })
      const writes: Batch[] = []
      page.on('request', request => { if (new URL(request.url()).pathname === endpoint) writes.push(request.postDataJSON() as Batch) })
      await page.goto('/link'); await enter(page.getByTestId('bulk-create-open'))
      const dialog = page.getByRole('dialog'), error = page.getByTestId('bulk-create-error'), id = page.getByTestId('bulk-create-request-id')
      await expect(dialog).toContainText(language === 'en' ? 'four fixed formats' : '四种固定格式')
      await expect(dialog).toContainText('custom_slug')
      await capture(info, 'feedback-help', page)
      const proof: { code: number; requestId: string; correctedId: string; countBefore: number; countAfter: number }[] = []
      for (const [code, slug, reason] of [
        [200101, occupied.toUpperCase(), language === 'en' ? 'already in use' : '已被占用'],
        [200102, 'ADMIN', language === 'en' ? 'reserved by the system' : '系统保留字'],
      ] as const) {
        const before = await links(page.request), target = 'https://example.org/correct/' + nonce + '/' + code
        await upload(page, language, target, slug); await enter(page.getByTestId('bulk-create-preview'))
        const originalId = await id.innerText()
        const response = page.waitForResponse(r => new URL(r.url()).pathname === endpoint)
        await enter(page.getByTestId('bulk-create-submit'))
        expect(await (await response).json()).toMatchObject({ code })
        await expect(error).toContainText(reason)
        await expect(error).toContainText(language === 'en' ? 'No links were created' : '整批未创建')
        await expect(id).toHaveText(originalId)
        await expect(page.getByTestId('bulk-create-preview-list')).toContainText(target)
        await expect(page.getByTestId('bulk-create-edit')).toBeEnabled()
        expect(await links(page.request)).toEqual(before)
        await capture(info, 'feedback-refused-' + code, page)
        await enter(page.getByTestId('bulk-create-edit'))
        await expect(page.getByTestId('bulk-create-imported-list')).toContainText(target)
        await upload(page, language, target, ''); await enter(page.getByTestId('bulk-create-preview'))
        const correctedId = await id.innerText(); expect(correctedId).not.toBe(originalId)
        await enter(page.getByTestId('bulk-create-submit')); await expect(dialog).toBeHidden()
        const after = await links(page.request)
        expect(after).toHaveLength(before.length + 1)
        const saved = after.find(row => row.targetUrl === target); expect(saved?.slug).toMatch(/^[a-z0-9]+$/)
        const redirected = await page.request.get('/' + saved!.slug, { maxRedirects: 0 })
        expect(redirected.status()).toBe(302); expect(redirected.headers().location).toBe(target)
        proof.push({ code, requestId: originalId, correctedId, countBefore: before.length, countAfter: after.length })
        await enter(page.getByTestId('bulk-create-open'))
      }
      const beforeUnknown = await links(page.request)
      await upload(page, language, 'https://example.net/unknown/' + nonce, 'ADMIN')
      await enter(page.getByTestId('bulk-create-preview'))
      const unknownId = await id.innerText()
      // Deliberately lose the first network attempt. The UI cannot infer whether it committed.
      await page.route('**' + endpoint, route => route.abort('failed'), { times: 1 })
      await enter(page.getByTestId('bulk-create-submit'))
      await expect(error).toContainText(language === 'en' ? 'result is unknown' : '结果未确认')
      await expect(page.getByTestId('bulk-create-edit')).toBeDisabled()
      const refusal = page.waitForResponse(r => new URL(r.url()).pathname === endpoint)
      await enter(page.getByTestId('bulk-create-submit'))
      expect(await (await refusal).json()).toMatchObject({ code: 200102 })
      await expect(page.getByTestId('bulk-create-submit')).toBeEnabled()
      await expect(error).toContainText(language === 'en' ? 'result is unknown' : '结果未确认')
      await expect(error).not.toContainText(language === 'en' ? 'No links were created' : '整批未创建')
      await expect(id).toHaveText(unknownId); await expect(page.getByTestId('bulk-create-edit')).toBeDisabled()
      const attempts = writes.filter(batch => batch.requestId === unknownId)
      expect(attempts).toHaveLength(2); expect(attempts[1]).toEqual(attempts[0])
      expect(await links(page.request)).toEqual(beforeUnknown)
      await capture(info, 'feedback-unknown-after-refusal', page)
      const path = info.outputPath('feedback-proof.json')
      await writeFile(path, JSON.stringify({ language, width, runtime: { browser: browser.version(), node: process.version }, proof, unknownId, attempts, unknownStayedImmutable: true, realBackendRefusal: 200102 }, null, 2))
      await info.attach('feedback-proof', { path, contentType: 'application/json' })
    } catch (error) { failures.push(error) } finally {
      if (page) { try { for (const row of await links(page.request)) await post(manager.request, '/api/v1/admin/short-link/delete', { id: row.id }) } catch (error) { failures.push(error) } }
      if (account) { try { await post(manager.request, '/api/v1/admin/user/update', { id: account.id, nickname: 'Disposable CSV feedback fixture', status: 'disabled' }) } catch (error) { failures.push(error) } }
      try { await context.close() } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, 'CSV feedback scenario or exact owned cleanup failed')
  })
}

/** Reads a real four-column CSV, retaining the original URL and code. */
async function upload(page: Page, language: string, target: string, slug: string) {
  await page.getByRole('dialog').getByLabel(language === 'en' ? 'Read URLs from CSV' : '从 CSV 读入网址', { exact: true }).setInputFiles({ name: 'feedback.csv', mimeType: 'text/csv', buffer: Buffer.from('target_url,title,tags,custom_slug\n' + target + ',,[],' + slug) })
  await expect(page.getByTestId('bulk-create-imported-list')).toContainText(target)
}
/** Uses the real keyboard activation path. */
async function enter(locator: ReturnType<Page['getByTestId']>) { await locator.focus(); await locator.press('Enter') }
/** Reads only this disposable account's persisted links. */
async function links(api: APIRequestContext): Promise<Link[]> {
  const response = await api.get('/api/v1/short-link/list?page=1&pageSize=100'); expect(response.status()).toBe(200)
  const body = await response.json(); expect(body.code).toBe(0); return body.data.items as Link[]
}
/** Requires actual business success before continuing a fixture write. */
async function post(api: APIRequestContext, path: string, data: unknown) {
  const response = await api.post(path, { data }); expect(response.status()).toBe(200)
  const body = await response.json(); expect(body.code).toBe(0); return body
}
/** Captures visible guidance and checks the real viewport and dialog for overflow. */
async function capture(info: TestInfo, name: string, page: Page) {
  await expectNoHorizontalOverflow(page)
  await expect.poll(() => page.getByRole('dialog').evaluate(el => el.scrollWidth - el.clientWidth)).toBe(0)
  const path = info.outputPath(name + '.png'); await page.screenshot({ path, animations: 'disabled' }); await info.attach(name, { path, contentType: 'image/png' })
}
