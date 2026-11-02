import { createHash, randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { expect, test as base } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Page, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

interface User { id: string; username: string }
interface Link { id: string; slug: string; targetUrl: string; redirectMode: string; url: string }
interface Scenario { page: Page; manager: APIRequestContext; account: User }
const password = 'csv-help-disposable-account'
const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, page: manager }, use, info) => {
    let account: User | undefined, context: BrowserContext | undefined, page: Page | undefined
    const failures: unknown[] = []
    try {
      const baseURL = info.project.use.baseURL
      if (typeof baseURL !== 'string') throw new Error('Requires disposable Compose baseURL')
      await post(manager.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      const username = 'csvhelp-' + randomBytes(7).toString('hex')
      const response = await manager.request.post('/api/v1/admin/user/create', { data: { username, password, nickname: 'CSV help fixture', groupKey: 'admin', status: 'active' } })
      const payload = await response.json() as { code: number; data: { user: User } }
      if (payload.code === 0 && payload.data.user.id) account = payload.data.user
      expect(response.status()).toBe(200); expect(payload.code).toBe(0)
      if (!account) throw new Error('Disposable account not created')
      const width = info.title.includes('1280px') ? 1280 : 390
      const language = info.title.includes(' en ') ? 'en' : 'zh-CN'
      const theme = language === 'en' ? 'dark' : 'light'
      context = await browser.newContext({ baseURL, viewport: { width, height: width === 1280 ? 720 : 800 }, locale: language, hasTouch: width === 390, serviceWorkers: 'block', colorScheme: theme, reducedMotion: 'reduce' })
      await context.addInitScript(({ language, theme }) => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', theme) }, { language, theme })
      page = await context.newPage()
      await post(page.request, '/auth/login', { username, password })
      await attach(info, 'runtime', { browser: browser.version(), driverNode: process.version, width, language, theme, userId: account.id, disposableDatabase: true })
      await use({ page, manager: manager.request, account })
    } catch (error) { failures.push(error) } finally {
      // Discover this fresh account's links even if an assertion failed after the actual commit.
      if (page) {
        try { for (const link of await links(page.request)) await post(manager.request, '/admin/short-link/delete', { id: link.id }) } catch (error) { failures.push(error) }
      }
      if (account) { try { await post(manager.request, '/admin/user/update', { id: account.id, nickname: 'CSV help fixture', status: 'disabled' }) } catch (error) { failures.push(error) } }
      if (context) { try { await context.close() } catch (error) { failures.push(error) } }
    }
    if (failures.length) throw new AggregateError(failures, 'CSV help scenario or exact owned cleanup failed')
  }, { timeout: 60_000 }],
})
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const language of ['zh-CN', 'en'] as const) for (const width of [1280, 390]) {
  test('v0.40.1 ' + language + ' ' + width + 'px downloads and reimports the public CSV template without creating links', async ({ scenario }, info) => {
    const { page } = scenario
    const writes: unknown[] = []
    page.on('request', request => { if (new URL(request.url()).pathname === '/api/v1/short-link/batch-create') writes.push(request.postDataJSON()) })
    expect(await links(page.request)).toEqual([])
    await page.goto('/link')
    const open = page.getByTestId('bulk-create-open')
    await open.focus(); await open.press('Enter')
    const dialog = page.getByRole('dialog'), draft = dialog.getByRole('textbox')
    const help = page.getByTestId('bulk-create-csv-help'), summary = help.locator('summary')
    await expect(help).not.toHaveAttribute('open')
    await expect(summary).toHaveText(language === 'en' ? 'CSV format example and template' : 'CSV 格式示例与模板')
    const privateDraft = 'https://private.example/not-in-template'
    await draft.fill(privateDraft)
    await summary.focus(); await summary.press('Enter')
    await expect(help).toHaveAttribute('open', '')
    await expect(summary).toBeFocused()
    await expect(help).toContainText('65536')
    await expect(help).toContainText(language === 'en' ? 'Replace the example URLs first.' : '请先替换示例网址。')
    await expect(page.getByTestId('bulk-create-csv-example')).toHaveText('target_url\nhttps://example.com/one\n"https://example.org/search?q=a,b"')
    const button = help.getByRole('button', { name: language === 'en' ? 'Download CSV template' : '下载 CSV 模板', exact: true })
    await button.scrollIntoViewIfNeeded(); await button.focus()
    const waiting = page.waitForEvent('download')
    await button.press('Enter')
    const download = await waiting
    expect(download.suggestedFilename()).toBe('moeurl-target-urls-template.csv')
    const filePath = info.outputPath('moeurl-target-urls-template.csv')
    await download.saveAs(filePath)
    expect(await download.failure()).toBeNull()
    const bytes = await readFile(filePath)
    expect(bytes.equals(Buffer.from('\uFEFFtarget_url\r\nhttps://example.com/one\r\n"https://example.org/search?q=a,b"\r\n', 'utf8'))).toBe(true)
    expect(bytes.includes(Buffer.from(privateDraft))).toBe(false)
    await expect(draft).toHaveValue(privateDraft)
    await expect(page.getByTestId('bulk-create-csv-feedback')).toHaveText(language === 'en' ? 'Template download started. Confirm saving in your browser.' : '已发起模板下载，请在浏览器中确认保存。')
    expect(writes).toHaveLength(0); expect(await links(page.request)).toEqual([])
    await capture(info, 'csv-help-' + language + '-' + width, page)
    const close = page.getByTestId('bulk-create-close')
    await close.focus(); await close.press('Enter')
    await expect(dialog).toBeHidden()
    await open.focus(); await open.press('Enter')
    await expect(help).not.toHaveAttribute('open')
    await expect(page.getByTestId('bulk-create-csv-feedback')).toBeHidden()
    await dialog.getByLabel(language === 'en' ? 'Read URLs from CSV' : '从 CSV 读入网址', { exact: true }).setInputFiles(filePath)
    await expect(draft).toHaveValue('https://example.com/one\nhttps://example.org/search?q=a,b')
    const preview = page.getByTestId('bulk-create-preview')
    await preview.focus(); await preview.press('Enter')
    await expect(page.getByTestId('bulk-create-preview-list').locator('li')).toHaveText(['https://example.com/one', 'https://example.org/search?q=a,b'])
    await expect(help).toBeHidden()
    await capture(info, 'csv-template-preview-' + language + '-' + width, page)
    expect(writes).toHaveLength(0); expect(await links(page.request)).toEqual([])
    await info.attach('downloaded-public-template', { path: filePath, contentType: 'text/csv;charset=utf-8' })
    await attach(info, 'template-download-proof', { fileName: download.suggestedFilename(), bytes: bytes.length, SHA256: createHash('sha256').update(bytes).digest('hex'), writes, privateDraftExcluded: true, parserRoundTrip: true, previewRequiresConfirmation: true })
  })
}

/** Verifies the current fresh scenario account's persisted list. */
async function links(api: APIRequestContext): Promise<Link[]> {
  const response = await api.get('/api/v1/short-link/list?page=1&pageSize=100')
  expect(response.status()).toBe(200)
  const payload = await response.json() as { code: number; data: { items: Link[] } }
  expect(payload.code).toBe(0)
  return payload.data.items
}
/** Validates business success in the disposable database. */
async function post(api: APIRequestContext, path: string, data: unknown) {
  const response = await api.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200); expect(await response.json()).toMatchObject({ code: 0 })
}
/** Captures the actual viewport without hiding product guidance or notifications. */
async function capture(info: TestInfo, name: string, page: Page) {
  await expectNoHorizontalOverflow(page)
  const dialog = page.getByRole('dialog')
  await expect.poll(() => dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0)
  const path = info.outputPath(name + '.png')
  await page.screenshot({ path, animations: 'disabled' }); await info.attach(name, { path, contentType: 'image/png' })
}
/** Preserves actual runtime and protocol observations. */
async function attach(info: TestInfo, name: string, value: unknown) {
  const path = info.outputPath(name + '.json')
  await writeFile(path, JSON.stringify(value, null, 2)); await info.attach(name, { path, contentType: 'application/json' })
}
