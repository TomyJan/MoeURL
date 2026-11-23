import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test as base } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Locator, Page, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

interface User { id: string; username: string }
interface Item { targetUrl: string; title: string; tags: string[]; customSlug: string; redirectMode: string; expiresAt: string; maxVisits: string; intermediateDelaySeconds: string }
interface Link { id: string; slug: string; targetUrl: string; title: string; tags: string[]; redirectMode: string; expiresAt: string | null; maxVisits: number | null; intermediateDelaySeconds: number }
interface Scenario { page: Page; user: User }
const endpoint = '/api/v1/short-link/batch-create-with-countdowns', touchPages = new WeakSet<Page>()
const password = 'csv-column-order-disposable-account'
const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, page: manager }, use, info) => {
    let context: BrowserContext | undefined, user: User | undefined
    const failures: unknown[] = []
    try {
      const baseURL = info.project.use.baseURL
      if (typeof baseURL !== 'string') throw new Error('Disposable Compose baseURL required')
      await post(manager.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      user = (await post<{ user: User }>(manager.request, '/admin/user/create', { username: 'csvorder-' + randomBytes(7).toString('hex'), password, nickname: 'CSV column order fixture', groupKey: 'admin', status: 'active' })).user
      const width = info.title.includes('1280px') ? 1280 : 390, language = info.title.includes(' en ') ? 'en' : 'zh-CN', theme = language === 'en' ? 'dark' : 'light'
      context = await browser.newContext({ baseURL, viewport: { width, height: width === 1280 ? 900 : 800 }, locale: language, hasTouch: width !== 1280, serviceWorkers: 'block', colorScheme: theme, reducedMotion: 'reduce' })
      await context.addInitScript(({ language, theme }) => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', theme) }, { language, theme })
      const page = await context.newPage(); if (width !== 1280) touchPages.add(page)
      await post(page.request, '/auth/login', { username: user.username, password })
      await attach(info, 'runtime', { browser: browser.version(), driverNode: process.version, width, language, theme, userId: user.id, disposableDatabase: true })
      await use({ page, user })
    } catch (error) { failures.push(error) } finally {
      if (context && user) {
        try { for (const link of await links(context.request)) { try { await post(manager.request, '/admin/short-link/delete', { id: link.id }) } catch (error) { failures.push(error) } } } catch (error) { failures.push(error) }
        try { await post(manager.request, '/admin/user/update', { id: user.id, nickname: 'CSV column order fixture', status: 'disabled' }) } catch (error) { failures.push(error) }
      }
      if (context) await context.close().catch(error => failures.push(error))
    }
    if (failures.length) throw new AggregateError(failures, 'Column order scenario or owned cleanup failed')
  }, { timeout: 90_000 }],
})
test.describe.configure({ mode: 'serial' })
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const language of ['zh-CN', 'en'] as const) for (const width of [1280, 390]) {
  test('v0.81.0 ' + language + ' ' + width + 'px imports reordered standard columns without changing their meaning', async ({ scenario }, info) => {
    const { page, user } = scenario, nonce = randomBytes(7).toString('hex')
    const items: Item[] = [
      { targetUrl: 'https://example.com/order81/' + nonce + '/first', title: ' <b>工具 😀</b> ', tags: [' 工具 ', 'a,b'], customSlug: 'OrderA' + nonce, redirectMode: 'intermediate', expiresAt: '2099-01-01T00:00:00Z', maxVisits: '12', intermediateDelaySeconds: '3' },
      { targetUrl: 'https://example.com/order81/' + nonce + '/second', title: ' Second ', tags: [], customSlug: 'OrderB' + nonce, redirectMode: 'intermediate', expiresAt: '', maxVisits: '', intermediateDelaySeconds: '10' },
    ]
    const writes: { path: string; body: unknown; expected: string | undefined }[] = []
    page.on('request', request => { const path = new URL(request.url()).pathname; if (path.includes('/short-link/batch-create')) writes.push({ path, body: request.postDataJSON(), expected: request.headers()['x-moeurl-expected-user-id'] }) })
    await page.goto('/link'); await activate(page.getByTestId('bulk-create-open'))
    const dialog = page.getByRole('dialog'), draft = dialog.getByRole('textbox'), manual = 'https://example.com/manual-order81'
    await draft.fill(manual)
    await upload(page, 'expires_at,title\r\n,missing-url\r\n')
    await expect(page.getByTestId('bulk-create-error')).toBeVisible(); await expect(draft).toHaveValue(manual)
    expect(writes).toStrictEqual([]); expect(await links(page.request)).toStrictEqual([])
    const help = page.getByTestId('bulk-create-csv-help'); await activate(help.locator('summary'))
    const rule = help.getByText(language === 'en'
      ? 'Standard columns may appear in any order. Unknown or duplicate names and headers without target_url are rejected. Examples and templates keep the complete standard order.'
      : '标准列名可任意排列；不能使用未知、重复或缺少 target_url 的表头。示例和模板仍使用完整标准顺序。', { exact: true })
    await rule.scrollIntoViewIfNeeded(); await expect(rule).toBeVisible(); await expect(rule).toBeInViewport({ ratio: 1 })
    await capture(info, 'column-order-help-' + language + '-' + width, page)
    await activate(help.locator('summary'))
    await upload(page, reversedCsv(items))
    for (const stage of ['imported', 'preview']) {
      if (stage === 'preview') await activate(page.getByTestId('bulk-create-preview'))
      const list = page.getByTestId('bulk-create-' + stage + '-list'); await expect(list.locator('li')).toHaveCount(2)
      await expect(list.locator('li').nth(0)).toContainText(items[0]!.targetUrl); await expect(list.locator('li').nth(1)).toContainText(items[1]!.targetUrl)
      await expect(list).toContainText('<b>工具 😀</b>'); await expect(dialog.locator('b')).toHaveCount(0)
      await expect(list.locator('.bulk-create-item-countdown').nth(0)).toContainText('3'); await expect(list.locator('.bulk-create-item-countdown').nth(1)).toContainText('10')
    }
    await capture(info, 'column-order-preview-' + language + '-' + width, page)
    const requestId = await page.getByTestId('bulk-create-request-id').innerText(), response = page.waitForResponse(value => new URL(value.url()).pathname === endpoint)
    await activate(page.getByTestId('bulk-create-submit')); expect(await (await response).json()).toMatchObject({ code: 0, data: { requestId, createdCount: 2 } })
    await expect(dialog).toBeHidden(); expect(writes).toStrictEqual([{ path: endpoint, body: { requestId, items }, expected: user.id }])
    const persisted = await links(page.request); expect(persisted).toHaveLength(2)
    const first = persisted.find(link => link.targetUrl === items[0]!.targetUrl), second = persisted.find(link => link.targetUrl === items[1]!.targetUrl)
    expect(first).toMatchObject({ targetUrl: items[0]!.targetUrl, title: '<b>工具 😀</b>', tags: ['工具', 'a,b'], slug: items[0]!.customSlug.toLowerCase(), redirectMode: 'intermediate', maxVisits: 12, intermediateDelaySeconds: 3 })
    expect(Date.parse(first!.expiresAt!)).toBe(Date.parse(items[0]!.expiresAt))
    expect(second).toMatchObject({ targetUrl: items[1]!.targetUrl, title: 'Second', tags: [], slug: items[1]!.customSlug.toLowerCase(), redirectMode: 'intermediate', expiresAt: null, maxVisits: null, intermediateDelaySeconds: 10 })
    await attach(info, 'column-order-persistence', { requestId, items, writes, persisted, invalidKeptManualDraft: true, csvHeader: 'intermediate_delay_seconds,max_visits,expires_at,redirect_mode,custom_slug,tags,title,target_url' })
  })
}

/** Builds the input fixture only; expected wire objects are specified independently above. */
function reversedCsv(items: readonly Item[]) {
  return '\uFEFFintermediate_delay_seconds,max_visits,expires_at,redirect_mode,custom_slug,tags,title,target_url\r\n' + items.map(item => [item.intermediateDelaySeconds, item.maxVisits, item.expiresAt, item.redirectMode, item.customSlug, JSON.stringify(item.tags), item.title, item.targetUrl].map(value => '"' + value.replaceAll('"', '""') + '"').join(',')).join('\r\n') + '\r\n'
}
async function upload(page: Page, text: string) { await page.getByRole('dialog').getByTestId('bulk-create-standard-file').setInputFiles({ name: 'column-order.csv', mimeType: 'text/csv', buffer: Buffer.from(text) }) }
async function activate(control: Locator) { if (touchPages.has(control.page())) await control.tap(); else { await control.focus(); await control.press('Enter') } }
async function links(api: APIRequestContext) { const response = await api.get('/api/v1/short-link/list?page=1&pageSize=100'); expect(response.status()).toBe(200); const payload = await response.json(); expect(payload.code).toBe(0); return (payload.data as { items: Link[] }).items }
async function post<T = unknown>(api: APIRequestContext, path: string, data: unknown): Promise<T> { const response = await api.post('/api/v1' + path, { data, timeout: 10_000 }); expect(response.status()).toBe(200); const payload = await response.json(); expect(payload.code).toBe(0); return payload.data as T }
async function attach(info: TestInfo, name: string, value: unknown) { const output = info.outputPath(name + '.json'); await writeFile(output, JSON.stringify(value, null, 2)); await info.attach(name, { path: output, contentType: 'application/json' }) }
async function capture(info: TestInfo, name: string, page: Page) { await expectNoHorizontalOverflow(page); await expect.poll(() => page.getByRole('dialog').evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0); const output = info.outputPath(name + '.png'); await page.screenshot({ path: output, animations: 'disabled' }); await info.attach(name, { path: output, contentType: 'image/png' }) }
