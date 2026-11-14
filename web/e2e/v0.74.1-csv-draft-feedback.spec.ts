import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test as base } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Locator, Page, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

interface User { id: string; username: string }
interface Group { key: string; updatedAt: string; permissions: string[] }
interface Link { id: string; targetUrl: string; redirectMode: string }
interface Scenario { page: Page; manager: APIRequestContext; user: User }
const touchPages = new WeakSet<Page>()
const password = 'csv-draft-disposable-account'
const grants = ['short_link:create', 'domain:use_default', 'short_link:set_metadata', 'short_link:custom_slug', 'short_link:use_intermediate']
const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, page: manager }, use, info) => {
    const failures: unknown[] = []
    let context: BrowserContext | undefined, user: User | undefined, original: Group | undefined
    try {
      await post(manager.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      original = await userGroup(manager.request)
      await setGrants(manager.request, [...new Set([...original.permissions, ...grants])])
      user = (await post<{ user: User }>(manager.request, '/admin/user/create', { username: 'csvdraft-' + randomBytes(7).toString('hex'), password, nickname: 'CSV draft fixture', groupKey: 'user', status: 'active' })).user
      const width = info.title.includes('1280px') ? 1280 : 390, language = info.title.includes(' en ') ? 'en' : 'zh-CN', theme = language === 'en' ? 'dark' : 'light'
      context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width, height: width === 1280 ? 900 : 800 }, locale: language, hasTouch: width !== 1280, serviceWorkers: 'block', colorScheme: theme, reducedMotion: 'reduce' })
      await context.addInitScript(({ language, theme }) => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', theme) }, { language, theme })
      const page = await context.newPage(); if (width !== 1280) touchPages.add(page)
      await post(page.request, '/auth/login', { username: user.username, password })
      await attach(info, 'runtime', { browser: browser.version(), driverNode: process.version, width, language, theme, userId: user.id, disposableDatabase: true })
      await use({ page, manager: manager.request, user })
    } catch (error) { failures.push(error) } finally {
      if (original) try { await setGrants(manager.request, original.permissions); expect((await userGroup(manager.request)).permissions.slice().sort()).toEqual(original.permissions.slice().sort()) } catch (error) { failures.push(error) }
      if (user && context) try {
        const page = await context.newPage()
        for (const link of await links(page.request)) await post(manager.request, '/admin/short-link/delete', { id: link.id })
        await post(manager.request, '/admin/user/update', { id: user.id, nickname: 'CSV draft fixture', status: 'disabled' })
      } catch (error) { failures.push(error) }
      if (context) await context.close().catch(error => failures.push(error))
    }
    if (failures.length) throw new AggregateError(failures, 'CSV draft scenario or exact owned cleanup failed')
  }, { timeout: 90_000 }],
})
test.describe.configure({ mode: 'serial' })
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const language of ['zh-CN', 'en'] as const) for (const width of [1280, 390]) {
  // Restoring the stale snapshot-mode check must close the dialog before the manual submit.
  test('v0.74.1 ' + language + ' ' + width + 'px preserves new manual drafts after real custom-code revocation and retires active imports', async ({ scenario }, info) => {
    test.setTimeout(150_000)
    const { page, manager, user } = scenario, nonce = randomBytes(7).toString('hex')
    const writes: { path: string; body: unknown; expected: string | undefined }[] = []
    page.on('request', request => { const path = new URL(request.url()).pathname; if (path.includes('/short-link/batch-create')) writes.push({ path, body: request.postDataJSON(), expected: request.headers()['x-moeurl-expected-user-id'] }) })
    await page.goto('/link'); await activate(page.getByTestId('bulk-create-open'))
    const dialog = page.getByRole('dialog'), draft = dialog.getByRole('textbox'), help = page.getByTestId('bulk-create-csv-help')
    const preserved = 'https://example.com/help-draft741/' + nonce
    await draft.fill(preserved)
    await dialog.locator('input[type=file]').setInputFiles({ name: 'invalid.csv', mimeType: 'text/csv', buffer: Buffer.from('target_url,title,tags,custom_slug,redirect_mode\nhttps://example.com/invalid,,,[],bad') })
    const title = language === 'en' ? 'CSV format example and template' : 'CSV 格式示例与模板'
    await expect(page.getByTestId('bulk-create-error')).toContainText(title)
    await expect(page.getByTestId('bulk-create-error')).toContainText('target_url,title,tags,custom_slug,redirect_mode')
    await expect(draft).toHaveValue(preserved); expect(writes).toEqual([])
    await expect(help.locator('summary')).toHaveText(title)
    await activate(help.locator('summary')); await expect(help).toHaveAttribute('open', '')
    await help.locator('summary').scrollIntoViewIfNeeded(); await capture(info, 'help-' + language + '-' + width, page)

    const outcomes: unknown[] = []
    for (const protocol of ['custom-slugs', 'redirect-modes'] as const) {
      await setGrants(manager, [...new Set([...(await userGroup(manager)).permissions, ...grants])])
      await refreshAuthority(page, user.id, true)
      if (!await dialog.isVisible()) await activate(page.getByTestId('bulk-create-open'))
      const csv = protocol === 'custom-slugs'
        ? 'target_url,title,tags,custom_slug\nhttps://example.com/old741/' + nonce + ',old,[],Old' + nonce
        : 'target_url,title,tags,custom_slug,redirect_mode\nhttps://example.com/old741/' + nonce + ',old,[],Old' + nonce + ',intermediate'
      await dialog.locator('input[type=file]').setInputFiles({ name: protocol + '.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
      await expect(page.getByTestId('bulk-create-imported-list').locator('li')).toHaveCount(1)
      await activate(page.getByTestId('bulk-create-preview'))
      const abandonedId = await page.getByTestId('bulk-create-request-id').innerText()
      await activate(page.getByTestId('bulk-create-edit')); await activate(page.getByTestId('bulk-create-clear-import'))
      const target = 'https://example.com/manual741/' + protocol + '/' + nonce
      await draft.fill(target)
      await setGrants(manager, (await userGroup(manager)).permissions.filter(value => value !== 'short_link:custom_slug'))
      const authority = await refreshAuthority(page, user.id, false)
      await expect(dialog).toBeVisible(); await expect(draft).toHaveValue(target)
      await expect(page.getByTestId('bulk-create-request-id')).toHaveCount(0)
      await draft.scrollIntoViewIfNeeded(); await capture(info, 'manual-' + protocol + '-' + language + '-' + width, page)
      await activate(page.getByTestId('bulk-create-preview'))
      const requestId = await page.getByTestId('bulk-create-request-id').innerText(); expect(requestId).not.toBe(abandonedId)
      const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/short-link/batch-create')
      await activate(page.getByTestId('bulk-create-submit'))
      expect(await (await response).json()).toMatchObject({ code: 0, data: { requestId, createdCount: 1 } })
      await expect(dialog).toBeHidden()
      expect((await links(page.request)).find(link => link.targetUrl === target)).toMatchObject({ targetUrl: target, redirectMode: 'direct' })

      await setGrants(manager, [...new Set([...(await userGroup(manager)).permissions, ...grants])]); await refreshAuthority(page, user.id, true)
      await activate(page.getByTestId('bulk-create-open'))
      await dialog.locator('input[type=file]').setInputFiles({ name: 'active-' + protocol + '.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
      await expect(page.getByTestId('bulk-create-imported-list').locator('li')).toHaveCount(1)
      await activate(page.getByTestId('bulk-create-preview'))
      await setGrants(manager, (await userGroup(manager)).permissions.filter(value => value !== 'short_link:custom_slug')); await refreshAuthority(page, user.id, false)
      await expect(dialog).toBeHidden()
      await activate(page.getByTestId('bulk-create-open')); await expect(draft).toHaveValue('')
      await expect(page.getByTestId('bulk-create-request-id')).toHaveCount(0)
      await activate(page.getByTestId('bulk-create-close'))
      outcomes.push({ protocol, target, abandonedId, requestId, authority, activeImportRetired: true, oldImportCreated: false })
    }
    expect(writes).toHaveLength(2)
    for (const [index, outcome] of (outcomes as { target: string; requestId: string }[]).entries()) expect(writes[index]).toEqual({ path: '/api/v1/short-link/batch-create', body: { requestId: outcome.requestId, targetUrls: [outcome.target] }, expected: user.id })
    expect((await links(page.request)).map(link => link.targetUrl).sort()).toEqual((outcomes as { target: string }[]).map(value => value.target).sort())
    await attach(info, 'draft-authority-continuation', { writes, outcomes, realAdministratorMutation: true, realAuthEndpointAndOriginalQueryFunction: true, syntheticGrantsInjected: false })
  })
}

/** Refetches the existing active auth query through its original function, without inventing grants or changing product code. */
async function refreshAuthority(page: Page, userId: string, hasCustomSlug: boolean) {
  const response = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/me' && response.request().method() === 'GET')
  const cached = await page.evaluate(async () => {
    interface Client { refetchQueries(filter: { queryKey: string[]; exact: boolean; type: 'active' }): Promise<unknown>; getQueryData(key: string[]): unknown }
    const root = document.getElementById('app') as (HTMLElement & { __vue_app__?: { _context: { provides: Record<string, unknown> } } }) | null
    const client = Object.values(root?.__vue_app__?._context.provides ?? {}).find(value => !!value && typeof value === 'object' && 'refetchQueries' in value && typeof value.refetchQueries === 'function' && 'getQueryData' in value && typeof value.getQueryData === 'function') as Client | undefined
    if (!client) throw new Error('Existing Vue Query client unavailable; no synthetic authority fallback')
    await client.refetchQueries({ queryKey: ['auth', 'me'], exact: true, type: 'active' })
    return client.getQueryData(['auth', 'me'])
  })
  const payload = await (await response).json()
  expect(payload.code).toBe(0); expect(payload.data.user.id).toBe(userId)
  expect(payload.data.user.permissions.includes('short_link:custom_slug')).toBe(hasCustomSlug)
  expect(cached).toEqual(payload.data)
  return { userId, hasCustomSlug, actualEndpoint: '/api/v1/auth/me' }
}
async function activate(control: Locator) { if (touchPages.has(control.page())) await control.tap(); else { await control.focus(); await control.press('Enter') } }
async function userGroup(api: APIRequestContext) { const group = (await get<{ groups: Group[] }>(api, '/admin/user-group/list')).groups.find(group => group.key === 'user'); if (!group) throw new Error('Missing user group'); return group }
async function setGrants(api: APIRequestContext, permissions: string[]) { const current = await userGroup(api); await post(api, '/admin/user-group/update-permissions', { groupKey: 'user', expectedUpdatedAt: current.updatedAt, permissions }) }
async function links(api: APIRequestContext) { return (await get<{ items: Link[] }>(api, '/short-link/list?page=1&pageSize=100')).items }
async function get<T>(api: APIRequestContext, resource: string): Promise<T> { const response = await api.get('/api/v1' + resource, { timeout: 10_000 }); expect(response.status()).toBe(200); const payload = await response.json(); expect(payload.code).toBe(0); return payload.data as T }
async function post<T = unknown>(api: APIRequestContext, resource: string, data: unknown): Promise<T> { const response = await api.post('/api/v1' + resource, { data, timeout: 10_000 }); expect(response.status()).toBe(200); const payload = await response.json(); expect(payload.code).toBe(0); return payload.data as T }
async function capture(info: TestInfo, name: string, page: Page) { await expectNoHorizontalOverflow(page); const dialog = page.getByRole('dialog'); await expect.poll(() => dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0); const output = info.outputPath(name + '.png'); await page.screenshot({ path: output, animations: 'disabled' }); await info.attach(name, { path: output, contentType: 'image/png' }) }
async function attach(info: TestInfo, name: string, value: unknown) { const output = info.outputPath(name + '.json'); await writeFile(output, JSON.stringify(value, null, 2)); await info.attach(name, { path: output, contentType: 'application/json' }) }
