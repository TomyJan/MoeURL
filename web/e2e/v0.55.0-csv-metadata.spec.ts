import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { expect, test as base } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Page, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

interface User { id: string; username: string }
interface Link { id: string; slug: string; targetUrl: string; title: string; tags: string[] }
interface Group { key: string; updatedAt: string; permissions: string[] }
interface Scenario { page: Page; manager: APIRequestContext; account: User }
const password = 'csv-metadata-disposable-account'
const endpoint = '/api/v1/short-link/batch-create-with-metadata'
const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, page: manager }, use, info) => {
    let account: User | undefined, context: BrowserContext | undefined, page: Page | undefined
    const failures: unknown[] = []
    try {
      const baseURL = info.project.use.baseURL
      if (typeof baseURL !== 'string') throw new Error('Requires disposable Compose baseURL')
      await post(manager.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      const username = 'csvmetadata-' + randomBytes(7).toString('hex')
      const response = await manager.request.post('/api/v1/admin/user/create', { data: { username, password, nickname: 'CSV metadata fixture', groupKey: info.title.includes('without metadata') ? 'user' : 'admin', status: 'active' } })
      const payload = await response.json() as { code: number; data: { user: User } }
      if (payload.code === 0 && payload.data.user.id) account = payload.data.user
      expect(response.status()).toBe(200); expect(payload.code).toBe(0)
      if (!account) throw new Error('Disposable account not created')
      const width = info.title.includes('1280px') ? 1280 : 390
      const language = info.title.includes(' en ') ? 'en' : 'zh-CN', theme = language === 'en' ? 'dark' : 'light'
      context = await browser.newContext({ baseURL, viewport: { width, height: width === 1280 ? 900 : 800 }, locale: language, hasTouch: width === 390, serviceWorkers: 'block', colorScheme: theme, reducedMotion: 'reduce' })
      await context.addInitScript(({ language, theme }) => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', theme) }, { language, theme })
      page = await context.newPage()
      await post(page.request, '/auth/login', { username, password })
      await attach(info, 'runtime', { browser: browser.version(), driverNode: process.version, width, language, theme, userId: account.id, disposableDatabase: true })
      await use({ page, manager: manager.request, account })
    } catch (error) { failures.push(error) } finally {
      // Discover this fixture's links even if their commit acknowledgement was lost.
      if (page) { try { for (const link of await links(page.request)) await post(manager.request, '/admin/short-link/delete', { id: link.id }) } catch (error) { failures.push(error) } }
      if (account) { try { await post(manager.request, '/admin/user/update', { id: account.id, nickname: 'CSV metadata fixture', status: 'disabled' }) } catch (error) { failures.push(error) } }
      if (context) { try { await context.close() } catch (error) { failures.push(error) } }
    }
    if (failures.length) throw new AggregateError(failures, 'CSV metadata scenario or exact owned cleanup failed')
  }, { timeout: 60_000 }],
})
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const language of ['zh-CN', 'en'] as const) for (const width of [1280, 390]) {
  test('v0.55.0 ' + language + ' ' + width + 'px imports literal tags, retries a committed batch and finds persisted tags', async ({ scenario }, info) => {
    const { page, account } = scenario
    const writes: { path: string; body: unknown; expected: string | undefined }[] = []
    page.on('request', request => { const path = new URL(request.url()).pathname; if (path.includes('/short-link/batch-create')) writes.push({ path, body: request.postDataJSON(), expected: request.headers()['x-moeurl-expected-user-id'] }) })
    await page.goto('/link'); await keyboard(page.getByTestId('bulk-create-open'))
    const dialog = page.getByRole('dialog'), help = page.getByTestId('bulk-create-csv-help'), draft = dialog.getByRole('textbox')
    const privateDraft = 'https://private.example/not-in-public-template'
    await draft.fill(privateDraft); await keyboard(help.locator('summary'))
    const downloading = page.waitForEvent('download')
    await keyboard(help.getByRole('button', { name: language === 'en' ? 'Download CSV template with titles and tags' : '下载带标题和标签的 CSV 模板', exact: true }))
    const download = await downloading, filePath = info.outputPath('moeurl-metadata-template.csv')
    expect(download.suggestedFilename()).toBe('moeurl-metadata-template.csv')
    await download.saveAs(filePath); expect(await download.failure()).toBeNull()
    const bytes = await readFile(filePath)
    expect(bytes.equals(Buffer.from('\uFEFFtarget_url,title,tags\r\nhttps://example.com/one,Example title,"[""tools"",""a,b""]"\r\n"https://example.org/search?q=a,b","Title, with comma",[]\r\n'))).toBe(true)
    expect(bytes.includes(Buffer.from(privateDraft))).toBe(false); await expect(draft).toHaveValue(privateDraft)
    expect(writes).toEqual([]); expect(await links(page.request)).toEqual([])
    const file = dialog.getByLabel(language === 'en' ? 'Read URLs from CSV' : '从 CSV 读入网址', { exact: true })
    await file.setInputFiles(filePath)
    const imported = page.getByTestId('bulk-create-imported-list')
    await expect(imported.locator('li')).toHaveCount(2); await expect(imported).toContainText('a,b')
    const nonce = randomBytes(7).toString('hex'), uniqueTag = 'metadata-' + nonce
    const items = [
      { targetUrl: 'https://example.com/metadata/' + nonce + '?a=1,b=2', title: '  中文, "quoted" <b>title</b>  ', tags: ['　' + uniqueTag + '　', 'a,b', 'say "hi"', '<b>literal</b>'] },
      { targetUrl: 'https://example.org/empty/' + nonce, title: '', tags: [] },
      { targetUrl: 'https://example.net/long/' + nonce, title: '界😀'.repeat(60), tags: ['😀'.repeat(32), ...Array.from({ length: 9 }, (_, i) => '标签-' + i + '-界'.repeat(12))] },
    ]
    const csv = '\uFEFFtarget_url,title,tags\r\n' + items.map(item => [item.targetUrl, item.title, JSON.stringify(item.tags)].map(quote).join(',')).join('\r\n') + '\r\n'
    await file.setInputFiles({ name: 'private-metadata.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
    await expect(imported.locator('li')).toHaveCount(3)
    await expect(imported.locator('.bulk-create-tag')).toHaveText(items.flatMap(item => item.tags))
    await expect(imported).toContainText(language === 'en' ? '(no tags)' : '（无标签）')
    expect(await imported.locator('b').count()).toBe(0); await help.locator('summary').press('Enter')
    await capture(info, 'metadata-draft-' + language + '-' + width, page)
    await keyboard(page.getByTestId('bulk-create-preview'))
    const preview = page.getByTestId('bulk-create-preview-list')
    await expect(preview.locator('li')).toHaveCount(3)
    await expect(preview.locator('.bulk-create-tag')).toHaveText(items.flatMap(item => item.tags))
    expect(await preview.locator('b').count()).toBe(0)
    const requestId = await page.getByTestId('bulk-create-request-id').innerText()
    expect(writes).toEqual([]); expect(await links(page.request)).toEqual([])
    await capture(info, 'metadata-preview-' + language + '-' + width, page)
    await page.route('**' + endpoint, async route => {
      const committed = await route.fetch()
      expect(await committed.json()).toMatchObject({ code: 0, data: { requestId, createdCount: 3 } })
      await route.abort('failed')
    }, { times: 1 })
    await keyboard(page.getByTestId('bulk-create-submit'))
    await expect(page.getByTestId('bulk-create-error')).toContainText(language === 'en' ? 'result is unknown' : '结果未确认')
    await expect(page.getByTestId('bulk-create-edit')).toBeDisabled(); expect(await links(page.request)).toHaveLength(3)
    await capture(info, 'metadata-unknown-' + language + '-' + width, page)
    const retried = page.waitForResponse(response => new URL(response.url()).pathname === endpoint)
    await keyboard(page.getByTestId('bulk-create-submit'))
    expect(await (await retried).json()).toMatchObject({ code: 0, data: { requestId, createdCount: 3 } })
    await expect(dialog).toBeHidden()
    expect(writes).toEqual(Array.from({ length: 2 }, () => ({ path: endpoint, body: { requestId, items }, expected: account.id })))
    const created = await links(page.request); expect(created).toHaveLength(3)
    for (const item of items) {
      const link = created.find(link => link.targetUrl === item.targetUrl)
      expect(link).toMatchObject({ title: item.title.trim(), tags: item.tags.map(tag => tag.trim()) })
      await expect(page.getByTestId('console-link-row').filter({ hasText: link!.slug })).toBeVisible()
    }
    const catalog = await (await page.request.get('/api/v1/short-link/tags?q=' + encodeURIComponent(uniqueTag))).json()
    expect(catalog).toMatchObject({ code: 0, data: { items: [{ tag: uniqueTag, linkCount: 1 }], hasMore: false } })
    await page.getByLabel(language === 'en' ? 'Tag' : '标签', { exact: true }).fill(uniqueTag)
    await expect(page.getByTestId('console-link-row')).toHaveCount(1)
    await expect(page.getByTestId('console-link-row')).toContainText(created.find(link => link.targetUrl === items[0]!.targetUrl)!.slug)
    await expectNoHorizontalOverflow(page)
    await attach(info, 'metadata-proof', { requestId, items, writes, persisted: created, catalog, actualCommitAcknowledgementLost: true, noDuplicateOnExplicitRetry: true })
  })
}

test('v0.55.0 zh-CN 390px refuses empty tags without metadata but keeps the old URL-only protocol usable', async ({ scenario }, info) => {
  const { page, manager } = scenario, original = await userGroup(manager), failures: unknown[] = []
  try {
    expect(original.permissions).toContain('short_link:set_metadata')
    await post(manager, '/admin/user-group/update-permissions', { groupKey: 'user', expectedUpdatedAt: original.updatedAt, permissions: original.permissions.filter(p => p !== 'short_link:set_metadata') })
    await page.goto('/link'); await keyboard(page.getByTestId('bulk-create-open'))
    const dialog = page.getByRole('dialog'), draft = dialog.getByRole('textbox'), target = 'https://example.com/no-metadata-' + randomBytes(7).toString('hex')
    await draft.fill(target)
    await dialog.getByLabel('从 CSV 读入网址', { exact: true }).setInputFiles({ name: 'empty-metadata.csv', mimeType: 'text/csv', buffer: Buffer.from('target_url,title,tags\n' + target + ',,[]') })
    await expect(page.getByTestId('bulk-create-error')).toContainText('权限'); await expect(draft).toHaveValue(target)
    expect(await links(page.request)).toEqual([])
    const denied = await page.request.post(endpoint, { data: { requestId: '11111111-1111-4111-8111-111111115551', items: [{ targetUrl: target, title: '', tags: [] }] } })
    expect(await denied.json()).toMatchObject({ code: 120001 }); expect(await links(page.request)).toEqual([])
    await capture(info, 'metadata-permission-refusal', page)
    await keyboard(page.getByTestId('bulk-create-preview')); await keyboard(page.getByTestId('bulk-create-submit'))
    await expect(dialog).toBeHidden()
    expect(await links(page.request)).toEqual([expect.objectContaining({ targetUrl: target, title: '', tags: [] })])
  } catch (error) { failures.push(error) } finally {
    try { const current = await userGroup(manager); await post(manager, '/admin/user-group/update-permissions', { groupKey: 'user', expectedUpdatedAt: current.updatedAt, permissions: original.permissions }); expect((await userGroup(manager)).permissions.slice().sort()).toEqual(original.permissions.slice().sort()) } catch (error) { failures.push(error) }
  }
  if (failures.length) throw new AggregateError(failures, 'Permission scenario or original-grant CAS restoration failed')
})

test('v0.55.0 en 390px preserves its draft when metadata JSON exceeds the request limit despite an allowed-size CSV', async ({ scenario }, info) => {
  const { page } = scenario
  await page.goto('/link'); await keyboard(page.getByTestId('bulk-create-open'))
  const dialog = page.getByRole('dialog'), draft = dialog.getByRole('textbox'), original = 'https://example.org/keep-' + randomBytes(7).toString('hex')
  await draft.fill(original)
  const item = { targetUrl: 'https://example.com', title: '', tags: [] as string[] }, requestId = '11111111-1111-4111-8111-111111115552'
  const fixed = Buffer.byteLength(JSON.stringify({ requestId, items: [item] }))
  item.title = ' '.repeat(65537 - fixed)
  expect(Buffer.byteLength(JSON.stringify({ requestId, items: [item] }))).toBe(65537)
  const csv = Buffer.from('target_url,title,tags\n' + [item.targetUrl, item.title, '[]'].map(quote).join(','))
  expect(csv.byteLength).toBeLessThanOrEqual(65536)
  const writes: unknown[] = []
  page.on('request', request => { if (new URL(request.url()).pathname.includes('/short-link/batch-create')) writes.push(request.postDataJSON()) })
  await dialog.getByLabel('Read URLs from CSV', { exact: true }).setInputFiles({ name: 'too-large-json.csv', mimeType: 'text/csv', buffer: csv })
  await expect(page.getByTestId('bulk-create-error')).toContainText('complete create request must fit 64 KiB')
  await expect(draft).toHaveValue(original); await expect(page.getByTestId('bulk-create-imported-list')).toBeHidden()
  expect(writes).toEqual([]); expect(await links(page.request)).toEqual([])
  await capture(info, 'metadata-request-size-refusal', page)
  await keyboard(page.getByTestId('bulk-create-preview'))
  await expect(page.getByTestId('bulk-create-preview-list')).toContainText(original)
  expect(writes).toEqual([])
})

/** CSV quotes preserve both JSON escaping and literal commas. */
function quote(value: string) { return '"' + value.replaceAll('"', '""') + '"' }
/** Exercises the actual keyboard action. */
async function keyboard(locator: ReturnType<Page['getByTestId']>) { await locator.focus(); await locator.press('Enter') }
/** Reads a fresh revision for restoring only this test's permission edit. */
async function userGroup(api: APIRequestContext): Promise<Group> {
  const response = await api.get('/api/v1/admin/user-group/list'); expect(response.status()).toBe(200)
  const payload = await response.json() as { code: number; data: { groups: Group[] } }; expect(payload.code).toBe(0)
  const group = payload.data.groups.find(group => group.key === 'user'); if (!group) throw new Error('Missing user group'); return group
}
/** Reads only the disposable account's persisted links. */
async function links(api: APIRequestContext): Promise<Link[]> {
  const response = await api.get('/api/v1/short-link/list?page=1&pageSize=100'); expect(response.status()).toBe(200)
  const payload = await response.json() as { code: number; data: { items: Link[] } }; expect(payload.code).toBe(0); return payload.data.items
}
/** Requires real business success in the isolated database. */
async function post(api: APIRequestContext, path: string, data: unknown) {
  const response = await api.post('/api/v1' + path, { data }); expect(response.status()).toBe(200); expect(await response.json()).toMatchObject({ code: 0 })
}
/** Captures the real viewport with guidance and notifications preserved. */
async function capture(info: TestInfo, name: string, page: Page) {
  await expectNoHorizontalOverflow(page)
  await expect.poll(() => page.getByRole('dialog').evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0)
  const path = info.outputPath(name + '.png'); await page.screenshot({ path, animations: 'disabled' }); await info.attach(name, { path, contentType: 'image/png' })
}
/** Preserves observed runtime and persistence, without claiming execution from a test definition. */
async function attach(info: TestInfo, name: string, value: unknown) {
  const path = info.outputPath(name + '.json'); await writeFile(path, JSON.stringify(value, null, 2)); await info.attach(name, { path, contentType: 'application/json' })
}
