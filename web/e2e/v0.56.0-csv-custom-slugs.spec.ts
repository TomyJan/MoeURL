import { randomBytes, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { expect, test as base } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Page, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

interface User { id: string; username: string }
interface Link { id: string; slug: string; targetUrl: string; title: string; tags: string[] }
interface Group { key: string; updatedAt: string; permissions: string[] }
interface Scenario { page: Page; manager: APIRequestContext; account: User }
const endpoint = '/api/v1/short-link/batch-create-with-custom-slugs'
const password = 'csv-custom-code-disposable-account'
const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, page: manager }, use, info) => {
    let account: User | undefined, context: BrowserContext | undefined, page: Page | undefined
    const failures: unknown[] = []
    try {
      const baseURL = info.project.use.baseURL
      if (typeof baseURL !== 'string') throw new Error('Requires disposable Compose baseURL')
      await post(manager.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      const username = 'csvcustom-' + randomBytes(7).toString('hex')
      const result = await manager.request.post('/api/v1/admin/user/create', { data: { username, password, nickname: 'CSV custom code fixture', groupKey: info.title.includes('without custom') ? 'user' : 'admin', status: 'active' } })
      const payload = await result.json() as { code: number; data: { user: User } }
      if (payload.code === 0 && payload.data.user.id) account = payload.data.user
      expect(result.status()).toBe(200); expect(payload.code).toBe(0)
      if (!account) throw new Error('Disposable account not created')
      const width = info.title.includes('1280px') ? 1280 : 390
      const language = info.title.includes(' en ') ? 'en' : 'zh-CN', theme = language === 'en' ? 'dark' : 'light'
      context = await browser.newContext({ baseURL, viewport: { width, height: width === 1280 ? 900 : 800 }, locale: language, hasTouch: width === 390, serviceWorkers: 'block', colorScheme: theme, reducedMotion: 'reduce' })
      await context.addInitScript(({ language, theme }) => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', theme) }, { language, theme })
      page = await context.newPage(); await post(page.request, '/auth/login', { username, password })
      await attach(info, 'runtime', { browser: browser.version(), driverNode: process.version, width, language, theme, userId: account.id, disposableDatabase: true })
      await use({ page, manager: manager.request, account })
    } catch (error) { failures.push(error) } finally {
      if (page) { try { for (const link of await links(page.request)) await post(manager.request, '/admin/short-link/delete', { id: link.id }) } catch (error) { failures.push(error) } }
      if (account) { try { await post(manager.request, '/admin/user/update', { id: account.id, nickname: 'CSV custom code fixture', status: 'disabled' }) } catch (error) { failures.push(error) } }
      if (context) { try { await context.close() } catch (error) { failures.push(error) } }
    }
    if (failures.length) throw new AggregateError(failures, 'Custom code scenario or exact owned cleanup failed')
  }, { timeout: 60_000 }],
})
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const language of ['zh-CN', 'en'] as const) for (const width of [1280, 390]) {
  test('v0.56.0 ' + language + ' ' + width + 'px imports custom and random codes and retries one committed batch', async ({ scenario }, info) => {
    const { page, account } = scenario
    const writes: { path: string; body: unknown; expected: string | undefined }[] = []
    page.on('request', request => { const path = new URL(request.url()).pathname; if (path.includes('/short-link/batch-create')) writes.push({ path, body: request.postDataJSON(), expected: request.headers()['x-moeurl-expected-user-id'] }) })
    await page.goto('/link'); await keyboard(page.getByTestId('bulk-create-open'))
    const dialog = page.getByRole('dialog'), help = page.getByTestId('bulk-create-csv-help'), draft = dialog.getByRole('textbox')
    const privateDraft = 'https://private.example/not-in-public-template'
    await draft.fill(privateDraft); await keyboard(help.locator('summary'))
    const downloading = page.waitForEvent('download')
    await keyboard(help.getByRole('button', { name: language === 'en' ? 'Download CSV template with custom short codes' : '下载带自定义短码的 CSV 模板', exact: true }))
    const download = await downloading, templatePath = info.outputPath('moeurl-custom-codes-template.csv')
    expect(download.suggestedFilename()).toBe('moeurl-custom-codes-template.csv')
    await download.saveAs(templatePath); expect(await download.failure()).toBeNull()
    const template = await readFile(templatePath)
    expect(template.equals(Buffer.from('\uFEFFtarget_url,title,tags,custom_slug\r\nhttps://example.com/one,Example title,"[""tools"",""a,b""]",TeamDocs56\r\n"https://example.org/search?q=a,b","Title, with comma",[],\r\n'))).toBe(true)
    expect(template.includes(Buffer.from(privateDraft))).toBe(false); await expect(draft).toHaveValue(privateDraft)
    expect(writes).toEqual([]); expect(await links(page.request)).toEqual([])
    const file = dialog.getByLabel(language === 'en' ? 'Read URLs from CSV' : '从 CSV 读入网址', { exact: true })
    await file.setInputFiles(templatePath)
    const imported = page.getByTestId('bulk-create-imported-list')
    await expect(imported.locator('li')).toHaveCount(2)
    await expect(imported.locator('.bulk-create-item-slug').first()).toContainText('teamdocs56')
    const nonce = randomBytes(7).toString('hex')
    const items = [
      { targetUrl: 'https://example.com/custom/' + nonce + '?a=1,b=2', title: '  中文, "quoted" <b>title</b>  ', tags: ['　tools　', 'a,b', '<b>literal</b>'], customSlug: 'Team' + nonce },
      { targetUrl: 'https://example.org/random/' + nonce, title: '', tags: [], customSlug: '' },
      { targetUrl: 'https://example.net/long/' + nonce, title: '界😀'.repeat(60), tags: ['😀'.repeat(32)], customSlug: 'Code' + nonce + 'X'.repeat(14) },
    ]
    expect(items[2]!.customSlug.length).toBe(32)
    await file.setInputFiles({ name: 'private-custom.csv', mimeType: 'text/csv', buffer: Buffer.from(csv(items)) })
    await expect(imported.locator('li')).toHaveCount(3)
    await expect(imported.locator('.bulk-create-item-slug').nth(1)).toContainText(language === 'en' ? '(randomly generated)' : '随机')
    await expect(imported.locator('.bulk-create-item-slug').nth(2)).toContainText(items[2]!.customSlug.toLowerCase())
    expect(await imported.locator('b').count()).toBe(0)
    await help.locator('summary').press('Enter'); await capture(info, 'custom-draft-' + language + '-' + width, page)
    await keyboard(page.getByTestId('bulk-create-preview'))
    const preview = page.getByTestId('bulk-create-preview-list')
    await expect(preview.locator('li')).toHaveCount(3)
    await expect(preview.locator('.bulk-create-item-slug').first()).toContainText(items[0]!.customSlug.toLowerCase())
    expect(await preview.locator('b').count()).toBe(0)
    const requestId = await page.getByTestId('bulk-create-request-id').innerText()
    expect(writes).toEqual([]); expect(await links(page.request)).toEqual([])
    await capture(info, 'custom-preview-' + language + '-' + width, page)
    await page.route('**' + endpoint, async route => {
      const committed = await route.fetch()
      expect(await committed.json()).toMatchObject({ code: 0, data: { requestId, createdCount: 3 } })
      await route.abort('failed')
    }, { times: 1 })
    await keyboard(page.getByTestId('bulk-create-submit'))
    await expect(page.getByTestId('bulk-create-error')).toContainText(language === 'en' ? 'result is unknown' : '结果未确认')
    await expect(page.getByTestId('bulk-create-edit')).toBeDisabled(); expect(await links(page.request)).toHaveLength(3)
    await capture(info, 'custom-unknown-' + language + '-' + width, page)
    const retried = page.waitForResponse(response => new URL(response.url()).pathname === endpoint)
    await keyboard(page.getByTestId('bulk-create-submit'))
    expect(await (await retried).json()).toMatchObject({ code: 0, data: { requestId, createdCount: 3 } })
    await expect(dialog).toBeHidden()
    expect(writes).toEqual(Array.from({ length: 2 }, () => ({ path: endpoint, body: { requestId, items }, expected: account.id })))
    const created = await links(page.request); expect(created).toHaveLength(3)
    for (const item of items) {
      const link = created.find(link => link.targetUrl === item.targetUrl)
      expect(link).toMatchObject({ title: item.title.trim(), tags: item.tags.map(tag => tag.trim()) })
      if (item.customSlug) expect(link!.slug).toBe(item.customSlug.toLowerCase())
      else expect(link!.slug).toMatch(/^[a-z0-9]+$/)
      const opened = await page.request.get('/' + link!.slug, { maxRedirects: 0 })
      expect(opened.status()).toBe(302); expect(opened.headers().location).toBe(item.targetUrl)
      await expect(page.getByTestId('console-link-row').filter({ hasText: link!.slug })).toBeVisible()
    }
    await expectNoHorizontalOverflow(page)
    await attach(info, 'custom-code-proof', { requestId, items, writes, persisted: created, actualCommitAcknowledgementLost: true, noDuplicateOnExplicitRetry: true, publicRedirectsVerified: true })
  })
}

test('v0.56.0 en 390px preserves a conflicting custom-code batch and rolls back its earlier row', async ({ scenario }, info) => {
  const { page } = scenario, nonce = randomBytes(7).toString('hex'), occupied = 'Occupied' + nonce
  await post(page.request, '/short-link/batch-create-with-custom-slugs', { requestId: randomUUID(), items: [{ targetUrl: 'https://example.org/occupied/' + nonce, title: '', tags: [], customSlug: occupied }] })
  await page.goto('/link'); await keyboard(page.getByTestId('bulk-create-open'))
  const dialog = page.getByRole('dialog'), items = [
    { targetUrl: 'https://example.org/rollback/' + nonce, title: 'must roll back', tags: ['rollback'], customSlug: 'Fresh' + nonce },
    { targetUrl: 'https://example.org/conflict/' + nonce, title: '', tags: [], customSlug: occupied.toUpperCase() },
  ]
  await dialog.getByLabel('Read URLs from CSV', { exact: true }).setInputFiles({ name: 'conflict.csv', mimeType: 'text/csv', buffer: Buffer.from(csv(items)) })
  await keyboard(page.getByTestId('bulk-create-preview'))
  const requestId = await page.getByTestId('bulk-create-request-id').innerText()
  const refusal = page.waitForResponse(response => new URL(response.url()).pathname === endpoint)
  await keyboard(page.getByTestId('bulk-create-submit'))
  expect(await (await refusal).json()).toMatchObject({ code: 200101 })
  await expect(page.getByTestId('bulk-create-error')).toBeVisible()
  await expect(page.getByTestId('bulk-create-request-id')).toHaveText(requestId)
  await expect(page.getByTestId('bulk-create-preview-list').locator('li')).toHaveCount(2)
  expect(await links(page.request)).toEqual([expect.objectContaining({ slug: occupied.toLowerCase() })])
  await expect(page.getByTestId('bulk-create-edit')).toBeEnabled()
  await capture(info, 'custom-conflict-preserved', page)
  await keyboard(page.getByTestId('bulk-create-edit'))
  await expect(page.getByTestId('bulk-create-imported-list').locator('li')).toHaveCount(2)
})

test('v0.56.0 zh-CN 390px refuses all-random four-column input without custom permission and preserves three-column creation', async ({ scenario }, info) => {
  const { page, manager } = scenario, original = await userGroup(manager), failures: unknown[] = []
  try {
    expect(original.permissions).toContain('short_link:custom_slug')
    expect(original.permissions).toContain('short_link:set_metadata')
    await post(manager, '/admin/user-group/update-permissions', { groupKey: 'user', expectedUpdatedAt: original.updatedAt, permissions: original.permissions.filter(p => p !== 'short_link:custom_slug') })
    await page.goto('/link'); await keyboard(page.getByTestId('bulk-create-open'))
    const dialog = page.getByRole('dialog'), draft = dialog.getByRole('textbox'), target = 'https://example.com/no-custom-' + randomBytes(7).toString('hex')
    await draft.fill(target)
    const item = { targetUrl: target, title: '', tags: [] as string[], customSlug: '' }
    await dialog.getByLabel('从 CSV 读入网址', { exact: true }).setInputFiles({ name: 'no-custom.csv', mimeType: 'text/csv', buffer: Buffer.from(csv([item])) })
    await expect(page.getByTestId('bulk-create-error')).toContainText('权限'); await expect(draft).toHaveValue(target)
    const denied = await page.request.post(endpoint, { data: { requestId: randomUUID(), items: [item] } })
    expect(await denied.json()).toMatchObject({ code: 120001 }); expect(await links(page.request)).toEqual([])
    await capture(info, 'custom-permission-refusal', page)
    await dialog.getByLabel('从 CSV 读入网址', { exact: true }).setInputFiles({ name: 'metadata-still-allowed.csv', mimeType: 'text/csv', buffer: Buffer.from('target_url,title,tags\n' + target + ',,[]') })
    await expect(page.getByTestId('bulk-create-imported-list').locator('li')).toHaveCount(1)
    await keyboard(page.getByTestId('bulk-create-preview')); await keyboard(page.getByTestId('bulk-create-submit'))
    await expect(dialog).toBeHidden()
    expect(await links(page.request)).toEqual([expect.objectContaining({ targetUrl: target, title: '', tags: [] })])
  } catch (error) { failures.push(error) } finally {
    try { const current = await userGroup(manager); await post(manager, '/admin/user-group/update-permissions', { groupKey: 'user', expectedUpdatedAt: current.updatedAt, permissions: original.permissions }); expect((await userGroup(manager)).permissions.slice().sort()).toEqual(original.permissions.slice().sort()) } catch (error) { failures.push(error) }
  }
  if (failures.length) throw new AggregateError(failures, 'Permission scenario or original-grant CAS restoration failed')
})

/** Preserves literal fields through both JSON-array and CSV quoting layers. */
function csv(items: { targetUrl: string; title: string; tags: string[]; customSlug: string }[]) {
  return '\uFEFFtarget_url,title,tags,custom_slug\r\n' + items.map(item => [item.targetUrl, item.title, JSON.stringify(item.tags), item.customSlug].map(value => '"' + value.replaceAll('"', '""') + '"').join(',')).join('\r\n') + '\r\n'
}
/** Exercises an actual keyboard action. */
async function keyboard(locator: ReturnType<Page['getByTestId']>) { await locator.focus(); await locator.press('Enter') }
/** Reads the current revision for restoring only this test's permission edit. */
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
/** Captures the real viewport without hiding guidance or notifications. */
async function capture(info: TestInfo, name: string, page: Page) {
  await expectNoHorizontalOverflow(page)
  await expect.poll(() => page.getByRole('dialog').evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0)
  const path = info.outputPath(name + '.png'); await page.screenshot({ path, animations: 'disabled' }); await info.attach(name, { path, contentType: 'image/png' })
}
/** Saves observed runtime and persistence without claiming execution from a definition. */
async function attach(info: TestInfo, name: string, value: unknown) {
  const path = info.outputPath(name + '.json'); await writeFile(path, JSON.stringify(value, null, 2)); await info.attach(name, { path, contentType: 'application/json' })
}
