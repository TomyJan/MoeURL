import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { expect, test as base } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Page, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

interface User { id: string; username: string }
interface Link { id: string; slug: string; targetUrl: string; title: string }
interface Group { key: string; updatedAt: string; permissions: string[] }
interface Scenario { page: Page; manager: APIRequestContext; account: User }
const password = 'csv-titles-disposable-account'
const endpoint = '/api/v1/short-link/batch-create-with-titles'
const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, page: manager }, use, info) => {
    let account: User | undefined, context: BrowserContext | undefined, page: Page | undefined
    const failures: unknown[] = []
    try {
      const baseURL = info.project.use.baseURL
      if (typeof baseURL !== 'string') throw new Error('Requires disposable Compose baseURL')
      await post(manager.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      const username = 'csvtitles-' + randomBytes(7).toString('hex')
      const response = await manager.request.post('/api/v1/admin/user/create', { data: { username, password, nickname: 'CSV title fixture', groupKey: info.title.includes('without metadata') ? 'user' : 'admin', status: 'active' } })
      const payload = await response.json() as { code: number; data: { user: User } }
      if (payload.code === 0 && payload.data.user.id) account = payload.data.user
      expect(response.status()).toBe(200); expect(payload.code).toBe(0)
      if (!account) throw new Error('Disposable account not created')
      const width = info.title.includes('1280px') ? 1280 : 390
      const language = info.title.includes(' en ') ? 'en' : 'zh-CN'
      const theme = language === 'en' ? 'dark' : 'light'
      context = await browser.newContext({ baseURL, viewport: { width, height: width === 1280 ? 900 : 800 }, locale: language, hasTouch: width === 390, serviceWorkers: 'block', colorScheme: theme, reducedMotion: 'reduce' })
      await context.addInitScript(({ language, theme }) => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', theme) }, { language, theme })
      page = await context.newPage()
      await post(page.request, '/auth/login', { username, password })
      await attach(info, 'runtime', { browser: browser.version(), driverNode: process.version, width, language, theme, userId: account.id, disposableDatabase: true })
      await use({ page, manager: manager.request, account })
    } catch (error) { failures.push(error) } finally {
      // Discover links owned by this fresh account even when the commit acknowledgement was lost.
      if (page) {
        try { for (const link of await links(page.request)) await post(manager.request, '/admin/short-link/delete', { id: link.id }) } catch (error) { failures.push(error) }
      }
      if (account) { try { await post(manager.request, '/admin/user/update', { id: account.id, nickname: 'CSV title fixture', status: 'disabled' }) } catch (error) { failures.push(error) } }
      if (context) { try { await context.close() } catch (error) { failures.push(error) } }
    }
    if (failures.length) throw new AggregateError(failures, 'CSV titles scenario or exact owned cleanup failed')
  }, { timeout: 60_000 }],
})
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const language of ['zh-CN', 'en'] as const) for (const width of [1280, 390]) {
  test('v0.54.0 ' + language + ' ' + width + 'px downloads titles, preserves literal preview and retries the committed batch once', async ({ scenario }, info) => {
    const { page, account } = scenario
    const writes: { path: string; body: unknown; expected: string | undefined }[] = []
    page.on('request', request => { const path = new URL(request.url()).pathname; if (path.includes('/short-link/batch-create')) writes.push({ path, body: request.postDataJSON(), expected: request.headers()['x-moeurl-expected-user-id'] }) })
    await page.goto('/link')
    await keyboard(page.getByTestId('bulk-create-open'))
    const dialog = page.getByRole('dialog'), help = page.getByTestId('bulk-create-csv-help')
    const draft = dialog.getByRole('textbox')
    const privateDraft = 'https://private.example/not-in-public-template'
    await draft.fill(privateDraft)
    await keyboard(help.locator('summary'))
    const downloading = page.waitForEvent('download')
    await keyboard(help.getByRole('button', { name: language === 'en' ? 'Download CSV template with titles' : '下载带标题的 CSV 模板', exact: true }))
    const download = await downloading
    expect(download.suggestedFilename()).toBe('moeurl-titles-template.csv')
    const filePath = info.outputPath('moeurl-titles-template.csv')
    await download.saveAs(filePath)
    expect(await download.failure()).toBeNull()
    const bytes = await readFile(filePath)
    expect(bytes.equals(Buffer.from('\uFEFFtarget_url,title\r\nhttps://example.com/one,Example title\r\n"https://example.org/search?q=a,b","Title, with comma"\r\n'))).toBe(true)
    expect(bytes.includes(Buffer.from(privateDraft))).toBe(false)
    await expect(draft).toHaveValue(privateDraft)
    expect(writes).toEqual([]); expect(await links(page.request)).toEqual([])
    const file = dialog.getByLabel(language === 'en' ? 'Read URLs from CSV' : '从 CSV 读入网址', { exact: true })
    await file.setInputFiles(filePath)
    const imported = page.getByTestId('bulk-create-imported-list')
    await expect(imported.locator('li')).toHaveCount(2)
    await expect(imported).toContainText('Title, with comma')
    await expect(draft).toBeHidden()
    // Replace examples with private rows; the literal title must never become markup.
    const nonce = randomBytes(7).toString('hex')
    const items = [
      { targetUrl: 'https://example.com/titles/' + nonce + '?a=1,b=2', title: '  中文, "quoted" <img src=x onerror=alert(1)>  ' },
      { targetUrl: 'https://example.org/empty/' + nonce, title: '' },
      { targetUrl: 'https://example.net/long/' + nonce, title: '界😀'.repeat(60) },
    ]
    const csv = '\uFEFFtarget_url,title\r\n' + items.map(item => [item.targetUrl, item.title].map(value => '"' + value.replaceAll('"', '""') + '"').join(',')).join('\r\n') + '\r\n'
    await file.setInputFiles({ name: 'private-titles.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
    await expect(imported.locator('li')).toHaveCount(3)
    await expect(imported.locator('.bulk-create-item-title')).toHaveText(importedTitles(items, language))
    expect(await imported.locator('img').count()).toBe(0)
    await help.locator('summary').press('Enter')
    await capture(info, 'titles-draft-' + language + '-' + width, page)
    await keyboard(page.getByTestId('bulk-create-preview'))
    const preview = page.getByTestId('bulk-create-preview-list')
    await expect(preview.locator('li')).toHaveCount(3)
    await expect(preview.locator('.bulk-create-item-title')).toHaveText(importedTitles(items, language))
    expect(await preview.locator('img').count()).toBe(0)
    const requestId = await page.getByTestId('bulk-create-request-id').innerText()
    expect(writes).toEqual([]); expect(await links(page.request)).toEqual([])
    await capture(info, 'titles-preview-' + language + '-' + width, page)
    await page.route('**/api/v1/short-link/batch-create-with-titles', async route => {
      const committed = await route.fetch()
      expect(await committed.json()).toMatchObject({ code: 0, data: { requestId, createdCount: 3 } })
      await route.abort('failed')
    }, { times: 1 })
    await keyboard(page.getByTestId('bulk-create-submit'))
    await expect(page.getByTestId('bulk-create-error')).toContainText(language === 'en' ? 'result is unknown' : '结果未确认')
    await expect(page.getByTestId('bulk-create-edit')).toBeDisabled()
    expect(await links(page.request)).toHaveLength(3)
    await capture(info, 'titles-unknown-' + language + '-' + width, page)
    const retried = page.waitForResponse(response => new URL(response.url()).pathname === endpoint)
    await keyboard(page.getByTestId('bulk-create-submit'))
    expect(await (await retried).json()).toMatchObject({ code: 0, data: { requestId, createdCount: 3 } })
    await expect(dialog).toBeHidden()
    expect(writes).toEqual(Array.from({ length: 2 }, () => ({ path: endpoint, body: { requestId, items }, expected: account.id })))
    const created = await links(page.request)
    expect(created).toHaveLength(3)
    for (const item of items) {
      const link = created.find(link => link.targetUrl === item.targetUrl)
      expect(link).toMatchObject({ title: item.title.trim() })
      const row = page.getByTestId('console-link-row').filter({ hasText: link!.slug })
      await expect(row).toBeVisible()
      if (item.title) await expect(row).toContainText(item.title.trim())
    }
    await expectNoHorizontalOverflow(page)
    await attach(info, 'titles-proof', { requestId, items, writes, persisted: created, actualCommitAcknowledgementLost: true, noDuplicateOnExplicitRetry: true })
  })
}

test('v0.54.0 en 390px refuses an allowed-size file whose complete request exceeds the byte limit', async ({ scenario }, info) => {
  const { page } = scenario
  await page.goto('/link'); await keyboard(page.getByTestId('bulk-create-open'))
  const dialog = page.getByRole('dialog'), draft = dialog.getByRole('textbox')
  const original = 'https://example.org/keep-' + randomBytes(7).toString('hex')
  await draft.fill(original)
  const csv = Buffer.from('target_url,title\nhttps://example.com,' + ' '.repeat(65499))
  expect(csv.byteLength).toBe(65536)
  const writes: unknown[] = []
  page.on('request', request => { if (new URL(request.url()).pathname.includes('/short-link/batch-create')) writes.push(request.postDataJSON()) })
  await dialog.getByLabel('Read URLs from CSV', { exact: true }).setInputFiles({ name: 'too-large-request.csv', mimeType: 'text/csv', buffer: csv })
  const error = page.getByTestId('bulk-create-error')
  await expect(error).toContainText('complete create request must fit 64 KiB')
  await expect(draft).toHaveValue(original)
  await expect(page.getByTestId('bulk-create-imported-list')).toBeHidden()
  expect(writes).toEqual([]); expect(await links(page.request)).toEqual([])
  await error.scrollIntoViewIfNeeded()
  await capture(info, 'titles-request-size-refusal', page)
  await keyboard(page.getByTestId('bulk-create-preview'))
  await expect(page.getByTestId('bulk-create-preview-list')).toContainText(original)
  expect(writes).toEqual([])
})

test('v0.54.0 zh-CN 390px rejects empty-title double columns without metadata while preserving single-column creation', async ({ scenario }, info) => {
  const { page, manager } = scenario
  const original = await userGroup(manager)
  const failures: unknown[] = []
  try {
    expect(original.permissions).toContain('short_link:set_metadata')
    await post(manager, '/admin/user-group/update-permissions', { groupKey: 'user', expectedUpdatedAt: original.updatedAt, permissions: original.permissions.filter(p => p !== 'short_link:set_metadata') })
    const identity = await (await page.request.get('/api/v1/auth/me')).json() as { data: { user: { permissions: string[] } } }
    expect(identity.data.user.permissions).not.toContain('short_link:set_metadata')
    expect(identity.data.user.permissions).toEqual(expect.arrayContaining(['short_link:create', 'domain:use_default']))
    await page.goto('/link'); await keyboard(page.getByTestId('bulk-create-open'))
    const dialog = page.getByRole('dialog'), draft = dialog.getByRole('textbox')
    const target = 'https://example.com/no-metadata-' + randomBytes(7).toString('hex')
    await draft.fill(target)
    const writes: unknown[] = []
    page.on('request', request => { if (new URL(request.url()).pathname.includes('/short-link/batch-create')) writes.push(request.postDataJSON()) })
    await dialog.getByLabel('从 CSV 读入网址', { exact: true }).setInputFiles({ name: 'empty-titles.csv', mimeType: 'text/csv', buffer: Buffer.from('target_url,title\n' + target + ',') })
    await expect(page.getByTestId('bulk-create-error')).toContainText('权限')
    await expect(draft).toHaveValue(target)
    await expect(page.getByTestId('bulk-create-imported-list')).toBeHidden()
    expect(writes).toEqual([]); expect(await links(page.request)).toEqual([])
    await capture(info, 'titles-permission-refusal', page)
    await keyboard(page.getByTestId('bulk-create-preview'))
    const requestId = await page.getByTestId('bulk-create-request-id').innerText()
    await keyboard(page.getByTestId('bulk-create-submit'))
    await expect(dialog).toBeHidden()
    expect(writes).toEqual([{ requestId, targetUrls: [target] }])
    expect(await links(page.request)).toEqual([expect.objectContaining({ targetUrl: target, title: '' })])
    await attach(info, 'permission-proof', { withoutMetadata: true, emptyTitledCSVRefused: true, oldProtocolStillWorks: true, writes })
  } catch (error) { failures.push(error) } finally {
    try {
      const current = await userGroup(manager)
      await post(manager, '/admin/user-group/update-permissions', { groupKey: 'user', expectedUpdatedAt: current.updatedAt, permissions: original.permissions })
      expect((await userGroup(manager)).permissions.slice().sort()).toEqual(original.permissions.slice().sort())
    } catch (error) { failures.push(error) }
  }
  if (failures.length) throw new AggregateError(failures, 'Permission scenario or full original-grant CAS restoration failed')
})

/** Returns the exact expected literal title text in either product language. */
function importedTitles(items: { title: string }[], language: string) {
  return items.map(item => (language === 'en' ? 'Title: ' : '标题： ') + (item.title || (language === 'en' ? '(empty title)' : '（空标题）')))
}
/** Exercises the actual keyboard action without synthesizing application calls. */
async function keyboard(locator: ReturnType<Page['getByTestId']>) { await locator.focus(); await locator.press('Enter') }
/** Loads the current CAS revision; restoration never assumes an old version remains valid. */
async function userGroup(api: APIRequestContext): Promise<Group> {
  const response = await api.get('/api/v1/admin/user-group/list')
  expect(response.status()).toBe(200)
  const payload = await response.json() as { code: number; data: { groups: Group[] } }
  expect(payload.code).toBe(0)
  const group = payload.data.groups.find(group => group.key === 'user')
  if (!group) throw new Error('Missing user group')
  return group
}
/** Reads only this fresh scenario account's persisted links. */
async function links(api: APIRequestContext): Promise<Link[]> {
  const response = await api.get('/api/v1/short-link/list?page=1&pageSize=100')
  expect(response.status()).toBe(200)
  const payload = await response.json() as { code: number; data: { items: Link[] } }
  expect(payload.code).toBe(0)
  return payload.data.items
}
/** Requires business success in the isolated database. */
async function post(api: APIRequestContext, path: string, data: unknown) {
  const response = await api.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200); expect(await response.json()).toMatchObject({ code: 0 })
}
/** Captures the real viewport with all guidance and notifications preserved. */
async function capture(info: TestInfo, name: string, page: Page) {
  await expectNoHorizontalOverflow(page)
  const dialog = page.getByRole('dialog')
  await expect.poll(() => dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0)
  const path = info.outputPath(name + '.png')
  await page.screenshot({ path, animations: 'disabled' }); await info.attach(name, { path, contentType: 'image/png' })
}
/** Preserves observed runtime, payload and persistence facts. */
async function attach(info: TestInfo, name: string, value: unknown) {
  const path = info.outputPath(name + '.json')
  await writeFile(path, JSON.stringify(value, null, 2)); await info.attach(name, { path, contentType: 'application/json' })
}
