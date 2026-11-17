import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test as base } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Locator, Page, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

interface User { id: string; username: string }
interface Group { key: string; updatedAt: string; permissions: string[] }
interface Link { id: string; slug: string; targetUrl: string; title: string; tags: string[]; redirectMode: string; expiresAt: string | null; maxVisits: number | null; intermediateDelaySeconds: number; visitsUsed: number }
interface Scenario { page: Page; manager: APIRequestContext; user: User; originalPermissions: string[] }
const endpoint = '/api/v1/short-link/batch-create-with-countdowns'
const required = ['short_link:create', 'domain:use_default', 'short_link:set_metadata', 'short_link:custom_slug', 'short_link:use_intermediate', 'short_link:use_confirmation', 'short_link:set_expiration', 'short_link:set_max_visits']
const password = 'csv-full-mapping-disposable-account'
const touchPages = new WeakSet<Page>()
const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, page: managerPage }, use, info) => {
    let context: BrowserContext | undefined, user: User | undefined
    const manager = managerPage.request, failures: unknown[] = []
    let originalPermissions: string[] | undefined
    try {
      const baseURL = info.project.use.baseURL
      if (typeof baseURL !== 'string') throw new Error('Disposable Compose baseURL required')
      await post(manager, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      originalPermissions = [...(await userGroup(manager)).permissions]
      await setPermissions(manager, [...new Set([...originalPermissions, ...required])])
      user = (await post<{ user: User }>(manager, '/admin/user/create', { username: 'csvfullmap-' + randomBytes(7).toString('hex'), password, nickname: 'CSV full-mapping fixture', groupKey: 'user', status: 'active' })).user
      const width = info.title.includes('1280px') ? 1280 : 390
      const language = info.title.includes(' en ') ? 'en' : 'zh-CN', theme = language === 'en' ? 'dark' : 'light'
      context = await browser.newContext({ baseURL, viewport: { width, height: width === 1280 ? 900 : 800 }, locale: language, hasTouch: width === 390, serviceWorkers: 'block', colorScheme: theme, reducedMotion: 'reduce' })
      await context.addInitScript(({ language, theme }) => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', theme) }, { language, theme })
      const page = await context.newPage(); if (width === 390) touchPages.add(page)
      await post(page.request, '/auth/login', { username: user.username, password })
      await attach(info, 'runtime', { browser: browser.version(), driverNode: process.version, width, height: width === 1280 ? 900 : 800, language, theme, userId: user.id, disposableDatabase: true })
      await use({ page, manager, user, originalPermissions })
    } catch (error) { failures.push(error) } finally {
      if (context && user) {
        try {
          const ownedPage = await context.newPage()
          for (const link of await links(ownedPage.request)) await post(manager, '/admin/short-link/delete', { id: link.id })
          await post(manager, '/admin/user/update', { id: user.id, nickname: 'CSV full-mapping fixture', status: 'disabled' })
        } catch (error) { failures.push(error) }
      }
      if (context) { try { await context.close() } catch (error) { failures.push(error) } }
      if (originalPermissions) {
        try { await setPermissions(manager, originalPermissions); expect((await userGroup(manager)).permissions.slice().sort()).toEqual(originalPermissions.slice().sort()) }
        catch (error) { failures.push(error) }
      }
    }
    if (failures.length) throw new AggregateError(failures, 'CSV full-mapping scenario or owned cleanup failed')
  }, { timeout: 120_000 }],
})

test.describe.configure({ mode: 'serial' })
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const language of ['zh-CN', 'en'] as const) for (const width of [1280, 390] as const) {
  test('v0.88.0 ' + language + ' ' + width + 'px maps all fields, preserves denied drafts and retries the exact request', async ({ scenario }, info) => {
    test.setTimeout(180_000)
    const { page, manager, user, originalPermissions } = scenario, english = language === 'en'
    const labels = english
      ? { target: 'URL column', title: 'Title column (optional)', tags: 'Tags column (optional)', slug: 'Custom short code column (optional)', mode: 'Redirect mode column (optional)', expiration: 'Expiration column (optional)', visits: 'Maximum visits column (optional)', countdown: 'Intermediate countdown column (optional)' }
      : { target: '网址列', title: '标题列（可不导入）', tags: '标签列（可不导入）', slug: '自定义短码列（可不导入）', mode: '跳转方式列（可不导入）', expiration: '过期时间列（可不导入）', visits: '最大访问次数列（可不导入）', countdown: '中间页倒计时列（可不导入）' }
    const nonce = randomBytes(6).toString('hex'), shortCode = 'full' + nonce
    const targetUrl = 'https://example.com/v088/' + nonce
    const manualDraft = 'https://example.org/preserve-v088-' + nonce
    const csvText = csv(
      ['Labels', 'Redirect policy', 'Address', 'Code', 'Deadline', 'Visit cap', 'Display name', 'Countdown'],
      [['["docs","工程"]', 'intermediate', targetUrl, shortCode, '2099-01-01T00:00:00Z', '12', 'Mapped title ' + nonce, '7']],
    )
    const writes: { path: string; body: unknown; expected: string | undefined }[] = []
    page.on('request', request => {
      const path = new URL(request.url()).pathname
      if (path.includes('/short-link/batch-create')) writes.push({ path, body: request.postDataJSON(), expected: request.headers()['x-moeurl-expected-user-id'] })
    })

    // A selected nonempty value without its value permission must be rejected without replacing prior input.
    const grantedPermissions = [...new Set([...originalPermissions, ...required])]
    await setPermissions(manager, grantedPermissions.filter(permission => permission !== 'short_link:set_max_visits'))
    await page.goto('/link'); await activate(page.getByTestId('bulk-create-open'))
    const dialog = page.getByRole('dialog'), draft = dialog.getByRole('textbox')
    await draft.fill(manualDraft)
    await upload(page, csvText)
    const deniedMapping = page.getByTestId('bulk-create-csv-mapping')
    await choose(page, deniedMapping.getByRole('combobox', { name: labels.target, exact: true }), column(3, 'Address', english))
    await activate(deniedMapping.locator('details').getByText(english ? 'More fields (optional)' : '更多字段（可选）', { exact: true }))
    await choose(page, deniedMapping.getByRole('combobox', { name: labels.visits, exact: true }), column(6, 'Visit cap', english))
    await activate(page.getByTestId('bulk-create-mapping-apply'))
    await expect(page.getByTestId('bulk-create-error-feedback')).toBeFocused()
    await expect(deniedMapping).toBeVisible(); await expect(page.getByTestId('bulk-create-preview')).toBeDisabled()
    await activate(page.getByTestId('bulk-create-mapping-cancel')); await expect(draft).toHaveValue(manualDraft)
    await activate(page.getByTestId('bulk-create-close')); await expect(dialog).toBeHidden()

    // Restore the exact grants before importing; the backend remains the final permission authority.
    await setPermissions(manager, grantedPermissions)
    await page.reload(); await activate(page.getByTestId('bulk-create-open'))
    const mappingInput = page.getByTestId('bulk-create-mapping-file')
    const secret = 'never-render-or-send-' + nonce
    const privacyTarget = 'https://example.com/explicit-safe-column/' + nonce, privacySlug = 'safe' + nonce
    await page.getByRole('dialog').getByRole('textbox').fill(manualDraft)
    await mappingInput.setInputFiles({ name: 'ignored-column.csv', mimeType: 'text/csv', buffer: Buffer.from(csv(['url', 'Private', 'custom_slug'], [[privacyTarget, secret, privacySlug]])) })
    const privacyMapping = page.getByTestId('bulk-create-csv-mapping')
    await expect(privacyMapping).toBeVisible(); await expect(privacyMapping).not.toContainText(secret)
    await activate(privacyMapping.getByRole('button', { name: english ? 'Match empty choices by header' : '按表头匹配空选项' }))
    await expect(privacyMapping.getByRole('status')).toContainText(english ? 'Filled 2 choices.' : '已填充 2 个选项。')
    await expect(privacyMapping.getByRole('combobox', { name: labels.target, exact: true })).toHaveValue(column(1, 'url', english))
    await activate(privacyMapping.locator('details').getByText(english ? 'More fields (optional)' : '更多字段（可选）', { exact: true }))
    await expect(privacyMapping.getByRole('combobox', { name: labels.slug, exact: true })).toHaveValue(column(3, 'custom_slug', english))
    await capture(info, 'header-aliases-' + language + '-' + width, page)
    const applyMapping = page.getByTestId('bulk-create-mapping-apply')
    await applyMapping.scrollIntoViewIfNeeded()
    await expect(applyMapping).toBeInViewport()
    await capture(info, 'mapping-apply-reachable-' + language + '-' + width, page)
    await activate(applyMapping)
    await expect(privacyMapping).toHaveCount(0)
    await expect(page.getByTestId('bulk-create-imported-list')).toContainText(privacySlug)
    await expect(page.getByRole('dialog')).not.toContainText(secret)
    await activate(page.getByTestId('bulk-create-preview'))
    const privacyRequestId = await page.getByTestId('bulk-create-request-id').innerText()
    const privacyPath = '/api/v1/short-link/batch-create-with-custom-slugs'
    const privacyResponse = page.waitForResponse(response => new URL(response.url()).pathname === privacyPath)
    await activate(page.getByTestId('bulk-create-submit'))
    expect(await (await privacyResponse).json()).toMatchObject({ code: 0, data: { requestId: privacyRequestId, createdCount: 1 } })
    await expect(page.getByRole('dialog')).toBeHidden()
    const privacyExpected = { path: privacyPath, body: { requestId: privacyRequestId, items: [{ targetUrl: privacyTarget, title: '', tags: [], customSlug: privacySlug }] }, expected: user.id }
    expect(writes).toStrictEqual([privacyExpected]); expect(JSON.stringify(writes)).not.toContain(secret)
    const privacySaved = await links(page.request)
    expect(privacySaved).toHaveLength(1)
    expect(privacySaved[0]).toMatchObject({ slug: privacySlug, targetUrl: privacyTarget, title: '', tags: [] })
    expect(JSON.stringify(privacySaved)).not.toContain(secret)
    await activate(page.getByTestId('bulk-create-open'))
    await mappingInput.setInputFiles({ name: 'explicit-full-mapping.csv', mimeType: 'text/csv', buffer: Buffer.from(csvText) })
    const mapping = page.getByTestId('bulk-create-csv-mapping')
    await expect(mapping).toBeVisible()
    for (const [label, index, name] of [
      [labels.target, 3, 'Address'], [labels.title, 7, 'Display name'], [labels.tags, 1, 'Labels'],
    ] as const) await choose(page, mapping.getByRole('combobox', { name: label, exact: true }), column(index, name, english))
    await activate(mapping.locator('details').getByText(english ? 'More fields (optional)' : '更多字段（可选）', { exact: true }))
    for (const [label, index, name] of [
      [labels.slug, 4, 'Code'], [labels.mode, 2, 'Redirect policy'], [labels.expiration, 5, 'Deadline'], [labels.visits, 6, 'Visit cap'], [labels.countdown, 8, 'Countdown'],
    ] as const) await choose(page, mapping.getByRole('combobox', { name: label, exact: true }), column(index, name, english))

    if (width === 390) {
      const lastAdvanced = mapping.getByRole('combobox', { name: labels.countdown, exact: true })
      await lastAdvanced.scrollIntoViewIfNeeded(); await expect(lastAdvanced).toBeInViewport()
      for (const action of [page.getByTestId('bulk-create-mapping-apply'), page.getByTestId('bulk-create-mapping-cancel')]) { await action.scrollIntoViewIfNeeded(); await expect(action).toBeInViewport() }
    }
    await capture(info, 'full-mapping-' + language + '-' + width, page)
    await activate(page.getByTestId('bulk-create-mapping-apply'))
    const imported = page.getByTestId('bulk-create-imported-list')
    await expect(imported.locator('li')).toHaveCount(1); await expect(imported).toContainText(shortCode)
    await expect(imported).toContainText('Mapped title ' + nonce)
    await activate(page.getByTestId('bulk-create-preview'))
    const requestId = await page.getByTestId('bulk-create-request-id').innerText()
    let committed: unknown
    await page.route('**' + endpoint, async route => {
      const response = await route.fetch(); committed = await response.json()
      expect(committed).toMatchObject({ code: 0, data: { requestId, createdCount: 1 } })
      await route.abort('failed')
    }, { times: 1 })
    await activate(page.getByTestId('bulk-create-submit'))
    await expect(page.getByTestId('bulk-create-error')).toBeVisible()
    expect(committed).toMatchObject({ code: 0, data: { requestId, createdCount: 1 } })
    await expect(page.getByTestId('bulk-create-request-id')).toHaveText(requestId)
    const retry = page.waitForResponse(response => new URL(response.url()).pathname === endpoint)
    await activate(page.getByTestId('bulk-create-submit'))
    expect(await (await retry).json()).toMatchObject({ code: 0, data: { requestId, createdCount: 1 } })
    await expect(dialog).toBeHidden()
    const expected = { path: endpoint, body: { requestId, items: [{ targetUrl, title: 'Mapped title ' + nonce, tags: ['docs', '工程'], customSlug: shortCode, redirectMode: 'intermediate', expiresAt: '2099-01-01T00:00:00Z', maxVisits: '12', intermediateDelaySeconds: '7' }] }, expected: user.id }
    expect(writes).toStrictEqual([privacyExpected, expected, expected]); expect(JSON.stringify(writes)).not.toContain(secret)
    const persisted = await links(page.request)
    expect(persisted).toHaveLength(2)
    const mapped = persisted.find(link => link.slug === shortCode)
    expect(mapped).toMatchObject({ slug: shortCode, targetUrl, title: 'Mapped title ' + nonce, tags: ['docs', '工程'], redirectMode: 'intermediate', maxVisits: 12, visitsUsed: 0, intermediateDelaySeconds: 7 })
    expect(Date.parse(mapped?.expiresAt ?? '')).toBe(Date.parse('2099-01-01T00:00:00Z'))
    const safeMapped = persisted.find(link => link.slug === privacySlug)
    expect(safeMapped).toMatchObject({ slug: privacySlug, targetUrl: privacyTarget, title: '', tags: [] })
    await attach(info, 'full-mapping-proof', { requestId, expected, privacyExpected, writes, persisted, deniedValuePermissionPreservedDraft: manualDraft, ignoredColumnAppliedAndSubmitted: true, exactPayloadRetry: true })
  })
}

function csv(headers: string[], rows: string[][]) { return '\uFEFF' + [headers, ...rows].map(row => row.map(value => '"' + value.replaceAll('"', '""') + '"').join(',')).join('\r\n') + '\r\n' }
function column(index: number, name: string, english: boolean) { return english ? 'Column ' + index + ': ' + name : '第 ' + index + ' 列：' + name }
async function upload(page: Page, text: string) { await page.getByTestId('bulk-create-mapping-file').setInputFiles({ name: 'mapping.csv', mimeType: 'text/csv', buffer: Buffer.from(text) }) }
async function activate(control: Locator) {
  if (control.page().viewportSize()?.width === 390) {
    if (await control.getAttribute('role') === 'combobox') await control.locator('xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " v-field ")][1]').locator('.v-field__append-inner').tap()
    else await control.tap()
  } else { await control.focus(); await control.press('Enter') }
}
async function choose(page: Page, control: Locator, name: string) {
  await activate(control)
  const option = page.getByRole('option', { name, exact: true })
  if (control.page().viewportSize()?.width === 390) await option.tap()
  else await option.click()
  await expect(control).toHaveValue(name)
}
async function capture(info: TestInfo, name: string, page: Page) {
  await expectNoHorizontalOverflow(page)
  const dialog = page.getByRole('dialog'); await expect.poll(() => dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0)
  const path = info.outputPath(name + '.png'); await page.screenshot({ path, animations: 'disabled' }); await info.attach(name, { path, contentType: 'image/png' })
}
async function attach(info: TestInfo, name: string, value: unknown) { const path = info.outputPath(name + '.json'); await writeFile(path, JSON.stringify(value, null, 2)); await info.attach(name, { path, contentType: 'application/json' }) }
async function userGroup(api: APIRequestContext): Promise<Group> {
  const response = await api.get('/api/v1/admin/user-group/list'); expect(response.status()).toBe(200)
  const payload = await response.json() as { code: number; data: { groups: Group[] } }; expect(payload.code).toBe(0)
  const group = payload.data.groups.find(item => item.key === 'user'); if (!group) throw new Error('Missing user group'); return group
}
async function setPermissions(api: APIRequestContext, permissions: string[]) {
  const current = await userGroup(api)
  await post(api, '/admin/user-group/update-permissions', { groupKey: 'user', expectedUpdatedAt: current.updatedAt, permissions })
}
async function links(api: APIRequestContext): Promise<Link[]> {
  const response = await api.get('/api/v1/short-link/list?page=1&pageSize=100'); expect(response.status()).toBe(200)
  const payload = await response.json() as { code: number; data: { items: Link[] } }; expect(payload.code).toBe(0); return payload.data.items
}
async function post<T = unknown>(api: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await api.post('/api/v1' + path, { data }); expect(response.status()).toBe(200)
  const payload = await response.json() as { code: number; data: T }; expect(payload.code).toBe(0); return payload.data
}
