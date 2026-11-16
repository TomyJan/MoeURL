import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test as base } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Locator, Page, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

interface User { id: string; username: string }
interface Link { id: string; slug: string; targetUrl: string; title: string; tags: string[] }
interface Group { key: string; updatedAt: string; permissions: string[] }
interface Scenario { page: Page; manager: APIRequestContext; account: User }
const password = 'csv-mapped-tags-disposable-account'
const endpoint = '/api/v1/short-link/batch-create-with-metadata'
const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, page: manager }, use, info) => {
    let account: User | undefined, context: BrowserContext | undefined, page: Page | undefined
    let originalPermissions: string[] | undefined
    const failures: unknown[] = []
    try {
      const baseURL = info.project.use.baseURL
      if (typeof baseURL !== 'string') throw new Error('Disposable Compose baseURL required')
      await post(manager.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      originalPermissions = [...(await userGroup(manager.request)).permissions]
      const username = 'csvmappedtags-' + randomBytes(7).toString('hex')
      const created = await manager.request.post('/api/v1/admin/user/create', { data: { username, password, nickname: 'CSV mapped-tags fixture', groupKey: 'user', status: 'active' } })
      expect(created.status()).toBe(200)
      const payload = await created.json() as { code: number; data: { user: User } }
      expect(payload.code).toBe(0); account = payload.data.user
      const width = info.title.includes('1280px') ? 1280 : 390
      const height = width === 1280 ? 720 : 800
      const language = info.title.includes(' en ') ? 'en' : 'zh-CN', theme = language === 'en' ? 'dark' : 'light'
      context = await browser.newContext({ baseURL, viewport: { width, height }, locale: language, hasTouch: width === 390, serviceWorkers: 'block', colorScheme: theme, reducedMotion: 'reduce' })
      await context.addInitScript(({ language, theme }) => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', theme) }, { language, theme })
      page = await context.newPage()
      await post(page.request, '/auth/login', { username, password })
      await attach(info, 'runtime', { browser: browser.version(), driverNode: process.version, width, height, language, theme, userId: account.id, disposableDatabase: true })
      await use({ page, manager: manager.request, account })
    } catch (error) { failures.push(error) } finally {
      if (page) {
        try { for (const link of await links(page.request)) await post(manager.request, '/admin/short-link/delete', { id: link.id }) }
        catch (error) { failures.push(error) }
      }
      if (originalPermissions) {
        try { await setUserPermissions(manager.request, originalPermissions); expect((await userGroup(manager.request)).permissions.slice().sort()).toEqual(originalPermissions.slice().sort()) }
        catch (error) { failures.push(error) }
      }
      if (account) {
        try { await post(manager.request, '/admin/user/update', { id: account.id, nickname: 'CSV mapped-tags fixture', status: 'disabled' }) }
        catch (error) { failures.push(error) }
      }
      if (context) { try { await context.close() } catch (error) { failures.push(error) } }
    }
    if (failures.length) throw new AggregateError(failures, 'CSV mapped-tags scenario or owned cleanup failed')
  }, { timeout: 90_000 }],
})

test.describe.configure({ mode: 'serial' })
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const language of ['zh-CN', 'en'] as const) for (const width of [1280, 390] as const) {
  test('v0.87.0 ' + language + ' ' + width + 'px maps tags, preserves drafts, checks grants and retries the exact request', async ({ scenario }, info) => {
    const { page, manager, account } = scenario
    const english = language === 'en'
    const urlLabel = english ? 'URL column' : '网址列'
    const titleLabel = english ? 'Title column (optional)' : '标题列（可不导入）'
    const tagsLabel = english ? 'Tags column (optional)' : '标签列（可不导入）'
    const mappingPath = page.getByTestId('bulk-create-mapping-file')
    const writes: { path: string; body: unknown; expected: string | undefined }[] = []
    page.on('request', request => {
      const path = new URL(request.url()).pathname
      if (path.includes('/short-link/batch-create')) writes.push({ path, body: request.postDataJSON(), expected: request.headers()['x-moeurl-expected-user-id'] })
    })

    await page.goto('/link'); await activate(page.getByTestId('bulk-create-open'))
    const dialog = page.getByRole('dialog'), draft = dialog.getByRole('textbox')
    const original = 'https://example.com/kept-draft-' + randomBytes(7).toString('hex')
    await draft.fill(original)

    const originalPermissions = [...(await userGroup(manager)).permissions]
    const withMetadata = [...new Set([...originalPermissions, 'short_link:set_metadata'])]
    const withoutMetadata = withMetadata.filter(permission => permission !== 'short_link:set_metadata')
    await setUserPermissions(manager, withoutMetadata)
    await page.reload(); await activate(page.getByTestId('bulk-create-open'))
    await mappingPath.setInputFiles({ name: 'url-only.csv', mimeType: 'text/csv', buffer: Buffer.from(csv(['Address', 'Labels'], [['https://example.com/url-only-' + randomBytes(5).toString('hex'), '[]']])) })
    const mapping = page.getByTestId('bulk-create-csv-mapping')
    const urlColumn = mapping.getByRole('combobox', { name: urlLabel, exact: true })
    const tagsColumn = mapping.getByRole('combobox', { name: tagsLabel, exact: true })
    await expect(tagsColumn).toBeDisabled()
    await tagsColumn.scrollIntoViewIfNeeded(); await expect(tagsColumn).toBeInViewport()
    await capture(info, 'mapping-without-metadata-' + language + '-' + width, page)
    await choose(page, urlColumn, column(1, 'Address', english))
    await activate(page.getByTestId('bulk-create-mapping-apply'))
    await expect(draft).toHaveValue(/url-only-/)
    await activate(page.getByTestId('bulk-create-preview'))
    const urlOnlyId = await page.getByTestId('bulk-create-request-id').innerText()
    const urlOnlyResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/short-link/batch-create')
    await activate(page.getByTestId('bulk-create-submit'))
    expect(await (await urlOnlyResponse).json()).toMatchObject({ code: 0, data: { requestId: urlOnlyId, createdCount: 1 } })
    expect(writes).toHaveLength(1); expect(writes[0]).toMatchObject({ path: '/api/v1/short-link/batch-create', expected: account.id })
    await expect(dialog).toBeHidden()

    await setUserPermissions(manager, withMetadata)
    await page.reload(); await activate(page.getByTestId('bulk-create-open'))
    const freshDraft = 'https://example.org/keep-on-invalid-' + randomBytes(7).toString('hex')
    await page.getByRole('dialog').getByRole('textbox').fill(freshDraft)
    await mappingPath.setInputFiles({ name: 'invalid-tags.json.csv', mimeType: 'text/csv', buffer: Buffer.from(csv(['Address', 'Display name', 'Labels'], [['https://example.com/invalid-tags', 'Do not save', 'not-json']])) })
    const invalidMapping = page.getByTestId('bulk-create-csv-mapping')
    await choose(page, invalidMapping.getByRole('combobox', { name: urlLabel, exact: true }), column(1, 'Address', english))
    await choose(page, invalidMapping.getByRole('combobox', { name: tagsLabel, exact: true }), column(3, 'Labels', english))
    for (let attempt = 0; attempt < 2; attempt++) {
      await activate(page.getByTestId('bulk-create-mapping-apply'))
      await expect(page.getByTestId('bulk-create-error-feedback')).toBeFocused()
      await expect(page.getByTestId('bulk-create-csv-mapping')).toBeVisible()
      await expect(page.getByTestId('bulk-create-preview')).toBeDisabled()
    }
    await activate(page.getByTestId('bulk-create-mapping-cancel')); await expect(draft).toHaveValue(freshDraft)
    await activate(page.getByTestId('bulk-create-close')); await expect(dialog).toBeHidden()

    await activate(page.getByTestId('bulk-create-open'))
    const nonce = randomBytes(7).toString('hex')
    const tagsOnly = [
      { targetUrl: 'https://example.com/tags-only/' + nonce + '/one', title: '', tags: ['docs', '工程'] },
      { targetUrl: 'https://example.com/tags-only/' + nonce + '/empty', title: '', tags: [] as string[] },
    ]
    await mappingPath.setInputFiles({ name: 'tags-only.csv', mimeType: 'text/csv', buffer: Buffer.from(csv(['Address', 'Display name', 'Labels'], tagsOnly.map(item => [item.targetUrl, item.title, JSON.stringify(item.tags)]))) })
    const tagsOnlyMapping = page.getByTestId('bulk-create-csv-mapping')
    await choose(page, tagsOnlyMapping.getByRole('combobox', { name: urlLabel, exact: true }), column(1, 'Address', english))
    await choose(page, tagsOnlyMapping.getByRole('combobox', { name: tagsLabel, exact: true }), column(3, 'Labels', english))
    await geometry(tagsOnlyMapping, width)
    await capture(info, 'tags-only-mapping-' + language + '-' + width, page)
    await activate(page.getByTestId('bulk-create-mapping-apply'))
    const imported = page.getByTestId('bulk-create-imported-list')
    await expect(imported.locator('li')).toHaveCount(2)
    await expect(imported.locator('.bulk-create-item-title').first()).toContainText(english ? '(empty title)' : '（空标题）')
    await expect(imported.locator('.bulk-create-item-tags').first()).toContainText('工程')
    await activate(page.getByTestId('bulk-create-preview'))
    const requestId = await page.getByTestId('bulk-create-request-id').innerText()
    await expect(page.getByTestId('bulk-create-preview-list').locator('li')).toHaveCount(2)
    await capture(info, 'tags-only-preview-' + language + '-' + width, page)
    let committed: { code: number; data: { requestId: string; createdCount: number } } | undefined
    await page.route('**' + endpoint, async route => {
      const response = await route.fetch(), body = await response.json() as { code: number; data: { requestId: string; createdCount: number } }
      expect(body).toMatchObject({ code: 0, data: { requestId, createdCount: 2 } })
      committed = body
      await route.abort('failed')
    }, { times: 1 })
    await activate(page.getByTestId('bulk-create-submit'))
    await expect(page.getByTestId('bulk-create-error')).toContainText(english ? 'result is unknown' : '结果未确认')
    expect(committed).toMatchObject({ code: 0, data: { requestId, createdCount: 2 } })
    expect(await links(page.request)).toHaveLength(3)
    await activate(page.getByTestId('bulk-create-submit'))
    await expect(dialog).toBeHidden()
    const retried = writes.filter(write => write.path === endpoint)
    const expectedItems = tagsOnly.map(item => ({ targetUrl: item.targetUrl, title: item.title, tags: item.tags }))
    expect(retried).toStrictEqual(Array.from({ length: 2 }, () => ({ path: endpoint, body: { requestId, items: expectedItems }, expected: account.id })))

    await activate(page.getByTestId('bulk-create-open'))
    const titled = { targetUrl: 'https://example.com/titled/' + nonce, title: 'Quarterly update ' + nonce, tags: ['reports', '团队'] }
    await mappingPath.setInputFiles({ name: 'title-and-tags.csv', mimeType: 'text/csv', buffer: Buffer.from(csv(['Address', 'Display name', 'Labels'], [[titled.targetUrl, titled.title, JSON.stringify(titled.tags)]])) })
    const titledMapping = page.getByTestId('bulk-create-csv-mapping')
    await choose(page, titledMapping.getByRole('combobox', { name: urlLabel, exact: true }), column(1, 'Address', english))
    await choose(page, titledMapping.getByRole('combobox', { name: titleLabel, exact: true }), column(2, 'Display name', english))
    await choose(page, titledMapping.getByRole('combobox', { name: tagsLabel, exact: true }), column(3, 'Labels', english))
    await activate(page.getByTestId('bulk-create-mapping-apply'))
    await expect(page.getByTestId('bulk-create-imported-list')).toContainText(titled.title)
    await activate(page.getByTestId('bulk-create-preview'))
    const titledId = await page.getByTestId('bulk-create-request-id').innerText()
    const titledResponse = page.waitForResponse(response => new URL(response.url()).pathname === endpoint)
    await activate(page.getByTestId('bulk-create-submit'))
    expect(await (await titledResponse).json()).toMatchObject({ code: 0, data: { requestId: titledId, createdCount: 1 } })

    const revokedTarget = 'https://example.com/revoked/' + nonce
    await activate(page.getByTestId('bulk-create-open'))
    await mappingPath.setInputFiles({ name: 'revoked-tags.csv', mimeType: 'text/csv', buffer: Buffer.from(csv(['Address', 'Labels'], [[revokedTarget, '["no-write"]']])) })
    const revokedMapping = page.getByTestId('bulk-create-csv-mapping')
    await choose(page, revokedMapping.getByRole('combobox', { name: urlLabel, exact: true }), column(1, 'Address', english))
    await choose(page, revokedMapping.getByRole('combobox', { name: tagsLabel, exact: true }), column(2, 'Labels', english))
    await activate(page.getByTestId('bulk-create-mapping-apply')); await activate(page.getByTestId('bulk-create-preview'))
    await setUserPermissions(manager, withoutMetadata)
    const deniedResponse = page.waitForResponse(response => new URL(response.url()).pathname === endpoint)
    await activate(page.getByTestId('bulk-create-submit'))
    expect(await (await deniedResponse).json()).toMatchObject({ code: 120001 })
    await expect(dialog).toBeHidden(); await expect.poll(async () => (await links(page.request)).length).toBe(4)
    expect((await links(page.request)).some(link => link.targetUrl === revokedTarget)).toBe(false)
    await setUserPermissions(manager, withMetadata)
    await page.reload()
    const persisted = await links(page.request)
    expect(persisted).toHaveLength(4)
    expect(persisted.find(link => link.targetUrl === tagsOnly[0]!.targetUrl)).toMatchObject({ title: '', tags: ['docs', '工程'] })
    expect(persisted.find(link => link.targetUrl === tagsOnly[1]!.targetUrl)).toMatchObject({ title: '', tags: [] })
    expect(persisted.find(link => link.targetUrl === titled.targetUrl)).toMatchObject({ title: titled.title, tags: titled.tags })
    expect(JSON.stringify(writes)).not.toContain('not-json')
    await attach(info, 'mapped-tags-proof', { requestId, expectedItems, writes, persisted, noMetadataControlDisabled: true, repeatedInvalidJsonFocused: true, cancelledDraftPreserved: freshDraft, permissionRevocationDenied: true, retryReusedExactRequest: true })
  })
}

function csv(headers: string[], rows: string[][]) {
  return '\uFEFF' + [headers, ...rows].map(row => row.map(value => '"' + value.replaceAll('"', '""') + '"').join(',')).join('\r\n') + '\r\n'
}
function column(number: number, name: string, english: boolean) { return english ? 'Column ' + number + ': ' + name : '第 ' + number + ' 列：' + name }
async function choose(page: Page, control: Locator, name: string) {
  await activate(control); await activate(page.getByRole('option', { name, exact: true })); await expect(control).toHaveValue(name)
}
async function activate(control: Locator) {
  if (control.page().viewportSize()?.width === 390) {
    if (await control.getAttribute('role') === 'combobox') {
      const field = control.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " v-field ")][1]')
      await field.locator('.v-field__append-inner').tap()
    } else await control.tap()
  }
  else { await control.focus(); await control.press('Enter') }
}
async function geometry(mapping: ReturnType<Page['getByTestId']>, width: number) {
  for (const control of [mapping.getByRole('combobox').nth(0), mapping.getByRole('combobox').nth(1), mapping.getByRole('combobox').nth(2), mapping.getByTestId('bulk-create-mapping-apply'), mapping.getByTestId('bulk-create-mapping-cancel')]) {
    await control.scrollIntoViewIfNeeded(); await expect(control).toBeInViewport()
    const box = await control.boundingBox(); expect(box).not.toBeNull(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width)
  }
}
async function capture(info: TestInfo, name: string, page: Page) {
  await expectNoHorizontalOverflow(page)
  await expect.poll(() => page.getByRole('dialog').evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0)
  const path = info.outputPath(name + '.png'); await page.screenshot({ path, animations: 'disabled' }); await info.attach(name, { path, contentType: 'image/png' })
}
async function attach(info: TestInfo, name: string, value: unknown) {
  const path = info.outputPath(name + '.json'); await writeFile(path, JSON.stringify(value, null, 2)); await info.attach(name, { path, contentType: 'application/json' })
}
async function userGroup(api: APIRequestContext): Promise<Group> {
  const response = await api.get('/api/v1/admin/user-group/list'); expect(response.status()).toBe(200)
  const payload = await response.json() as { code: number; data: { groups: Group[] } }; expect(payload.code).toBe(0)
  const group = payload.data.groups.find(group => group.key === 'user'); if (!group) throw new Error('Missing user group'); return group
}
async function setUserPermissions(api: APIRequestContext, permissions: string[]) {
  const current = await userGroup(api)
  await post(api, '/admin/user-group/update-permissions', { groupKey: 'user', expectedUpdatedAt: current.updatedAt, permissions })
}
async function links(api: APIRequestContext): Promise<Link[]> {
  const response = await api.get('/api/v1/short-link/list?page=1&pageSize=100'); expect(response.status()).toBe(200)
  const payload = await response.json() as { code: number; data: { items: Link[] } }; expect(payload.code).toBe(0); return payload.data.items
}
async function post(api: APIRequestContext, path: string, data: unknown) {
  const response = await api.post('/api/v1' + path, { data }); expect(response.status()).toBe(200); expect(await response.json()).toMatchObject({ code: 0 })
}
