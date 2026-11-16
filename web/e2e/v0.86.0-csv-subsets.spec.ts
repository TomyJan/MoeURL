import { randomBytes } from 'node:crypto'
import { expect, test as base } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Locator, Page, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'
import { csvIssueAttach as attach, csvIssueLinks as links, csvIssuePost as post } from './csv-issues-fixture'

interface User { id: string; username: string }
interface Group { key: string; updatedAt: string; permissions: string[] }
interface Scenario { page: Page; manager: APIRequestContext; user: User }
interface Write { path: string; body: unknown; expected: string | undefined }
const touchPages = new WeakSet<Page>(), password = 'csv-subsets-disposable-account'
const grants = ['short_link:create', 'domain:use_default', 'short_link:set_metadata', 'short_link:custom_slug', 'short_link:use_intermediate', 'short_link:use_confirmation', 'short_link:set_expiration', 'short_link:set_max_visits']
const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, page: manager }, use, info) => {
    let context: BrowserContext | undefined, user: User | undefined
    const failures: unknown[] = []
    try {
      const baseURL = info.project.use.baseURL
      if (typeof baseURL !== 'string') throw new Error('Requires disposable Compose baseURL')
      await post(manager.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      user = (await post<{ user: User }>(manager.request, '/admin/user/create', { username: 'csvsubsets-' + randomBytes(7).toString('hex'), password, nickname: 'CSV subsets fixture', groupKey: info.title.includes('user grants') ? 'user' : 'admin', status: 'active' })).user
      const width = info.title.includes('1280px') ? 1280 : 390, language = info.title.includes(' en ') ? 'en' : 'zh-CN', theme = language === 'en' ? 'dark' : 'light'
      context = await browser.newContext({ baseURL, viewport: { width, height: width === 1280 ? 720 : 800 }, locale: language, hasTouch: width !== 1280, serviceWorkers: 'block', colorScheme: theme, reducedMotion: 'reduce' })
      await context.addInitScript(({ language, theme }) => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', theme) }, { language, theme })
      const page = await context.newPage(); if (width !== 1280) touchPages.add(page)
      await post(page.request, '/auth/login', { username: user.username, password })
      await attach(info, 'runtime', { browser: browser.version(), driverNode: process.version, viewport: page.viewportSize(), language, theme, userId: user.id, disposableDatabase: true })
      await use({ page, manager: manager.request, user })
    } catch (error) { failures.push(error) } finally {
      if (context && user) {
        try { for (const link of await links(context.request)) { try { await post(manager.request, '/admin/short-link/delete', { id: link.id }) } catch (error) { failures.push(error) } } } catch (error) { failures.push(error) }
      }
      if (user) { try { await post(manager.request, '/admin/user/update', { id: user.id, nickname: 'CSV subsets fixture', status: 'disabled' }) } catch (error) { failures.push(error) } }
      if (context) await context.close().catch(error => failures.push(error))
    }
    if (failures.length) throw new AggregateError(failures, 'CSV subsets scenario or owned cleanup failed')
  }, { timeout: 90_000 }],
})
test.describe.configure({ mode: 'serial' })
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const language of ['zh-CN', 'en'] as const) for (const width of [1280, 390]) {
  test('v0.86.1 ' + language + ' ' + width + 'px imports sparse columns with real defaults and identical unknown retries', async ({ scenario }, info) => {
    test.setTimeout(150_000)
    const { page, user } = scenario, nonce = randomBytes(7).toString('hex'), writes: Write[] = []
    recordWrites(page, writes)
    await page.goto('/link'); await activate(page.getByTestId('bulk-create-open'))
    const dialog = page.getByRole('dialog'), draft = dialog.getByRole('textbox'), manual = 'https://example.com/manual86'
    const policy = dialog.getByText(language === 'en' ? /^One HTTP\(S\) URL per line/ : /^每行一个 HTTP\(S\) 网址/)
    await policy.scrollIntoViewIfNeeded(); await expect(policy).toBeInViewport({ ratio: 1 })
    await expect(policy).toContainText(language === 'en' ? 'Standard CSV uses the supplied fields for' : '标准 CSV 按所填字段指定跳转方式')
    await expect(policy).toContainText(language === 'en' ? 'Omitting the mode uses direct redirects; omitting the countdown uses 5 seconds' : '省略跳转方式为直接跳转，省略倒计时为 5 秒')
    await capture(info, 'subsets-policy-' + language + '-' + width, page)
    await draft.fill(manual)
    for (const invalid of ['tags,title\n[],no-url', 'owner,target_url\nuser,https://example.com', 'tags,target_url\n,https://example.com', 'intermediate_delay_seconds,target_url\n3,https://example.com', 'expires_at,target_url\n2099-01-01T00:00:00Z']) {
      await upload(page, invalid); await expect(page.getByTestId('bulk-create-error')).toBeVisible(); await expect(draft).toHaveValue(manual)
      expect(writes).toStrictEqual([]); expect(await links(page.request)).toStrictEqual([])
    }
    const help = page.getByTestId('bulk-create-csv-help'); await activate(help.locator('summary'))
    const defaults = help.getByText(language === 'en' ? /^Omitted titles and codes are empty/ : /^省略的标题和短码为空/)
    await defaults.scrollIntoViewIfNeeded(); await expect(defaults).toBeVisible(); await expect(defaults).toBeInViewport({ ratio: 1 })
    const permissions = help.getByText(language === 'en' ? /^Omitting columns does not reduce/ : /^省列不减少原格式的权限要求/)
    await permissions.scrollIntoViewIfNeeded(); await expect(permissions).toBeInViewport({ ratio: 1 })
    await capture(info, 'subsets-help-' + language + '-' + width, page); await activate(help.locator('summary'))
    const baseUrl = 'https://example.com/subsets86/' + nonce
    const batches = [
      { header: ['tags', 'target_url'], rows: [['[" 工具 ","a,b"]', baseUrl + '/tags'], ['[]', baseUrl + '/empty-tags']], endpoint: 'batch-create-with-metadata', items: [{ targetUrl: baseUrl + '/tags', title: '', tags: [' 工具 ', 'a,b'] }, { targetUrl: baseUrl + '/empty-tags', title: '', tags: [] }] },
      { header: ['custom_slug', 'target_url'], rows: [['Subset' + nonce, baseUrl + '/code']], endpoint: 'batch-create-with-custom-slugs', items: [{ targetUrl: baseUrl + '/code', title: '', tags: [], customSlug: 'Subset' + nonce }] },
      { header: ['max_visits', 'expires_at', 'target_url'], rows: [['12', '2099-01-01T00:00:00Z', baseUrl + '/limit']], endpoint: 'batch-create-with-visit-limits', items: [{ targetUrl: baseUrl + '/limit', title: '', tags: [], customSlug: '', redirectMode: '', expiresAt: '2099-01-01T00:00:00Z', maxVisits: '12' }] },
      { header: ['intermediate_delay_seconds', 'target_url', 'redirect_mode'], rows: [['3', baseUrl + '/countdown', 'intermediate']], endpoint: 'batch-create-with-countdowns', items: [{ targetUrl: baseUrl + '/countdown', title: '', tags: [], customSlug: '', redirectMode: 'intermediate', expiresAt: '', maxVisits: '', intermediateDelaySeconds: '3' }] },
      { header: ['intermediate_delay_seconds', 'target_url'], rows: [['', baseUrl + '/defaults']], endpoint: 'batch-create-with-countdowns', items: [{ targetUrl: baseUrl + '/defaults', title: '', tags: [], customSlug: '', redirectMode: '', expiresAt: '', maxVisits: '', intermediateDelaySeconds: '' }] },
    ]
    let lostResponse: unknown
    const outcomes: unknown[] = []
    for (const [index, batch] of batches.entries()) {
      if (index) await activate(page.getByTestId('bulk-create-open'))
      await upload(page, csv(batch.header, batch.rows)); await expect(page.getByTestId('bulk-create-imported-list').locator('li')).toHaveCount(batch.items.length)
      await activate(page.getByTestId('bulk-create-preview'))
      const requestId = await page.getByTestId('bulk-create-request-id').innerText(), path = '/api/v1/short-link/' + batch.endpoint, before = writes.length
      await expect(page.getByTestId('bulk-create-preview-list').locator('li')).toHaveCount(batch.items.length)
      if (index === 2) {
        await capture(info, 'subsets-preview-' + language + '-' + width, page)
        await page.route('**' + path, async route => { const committed = await route.fetch(); lostResponse = await committed.json(); expect(lostResponse).toMatchObject({ code: 0, data: { requestId, createdCount: 1 } }); await route.abort('failed') }, { times: 1 })
        await activate(page.getByTestId('bulk-create-submit')); await expect(page.getByTestId('bulk-create-error')).toBeVisible()
        await expect(page.getByTestId('bulk-create-request-id')).toHaveText(requestId); await expect(page.getByTestId('bulk-create-edit')).toBeDisabled()
      }
      const receiving = page.waitForResponse(value => new URL(value.url()).pathname === path)
      await activate(page.getByTestId('bulk-create-submit')); expect(await (await receiving).json()).toMatchObject({ code: 0, data: { requestId, createdCount: batch.items.length } })
      await expect(dialog).toBeHidden()
      const expected = { path, body: { requestId, items: batch.items }, expected: user.id }
      expect(writes.slice(before)).toStrictEqual(index === 2 ? [expected, expected] : [expected])
      outcomes.push({ header: batch.header, expected, repeated: index === 2 })
    }
    const persisted = await links(page.request); expect(persisted).toHaveLength(6)
    expect(persisted.find(link => link.targetUrl === baseUrl + '/tags')).toMatchObject({ title: '', tags: ['工具', 'a,b'], redirectMode: 'direct' })
    expect(persisted.find(link => link.targetUrl === baseUrl + '/empty-tags')).toMatchObject({ title: '', tags: [] })
    expect(persisted.find(link => link.targetUrl === baseUrl + '/code')).toMatchObject({ title: '', tags: [], slug: ('Subset' + nonce).toLowerCase() })
    expect(persisted.find(link => link.targetUrl === baseUrl + '/limit')).toMatchObject({ title: '', tags: [], redirectMode: 'direct', expiresAt: '2099-01-01T00:00:00Z', maxVisits: 12, intermediateDelaySeconds: 5 })
    expect(persisted.find(link => link.targetUrl === baseUrl + '/countdown')).toMatchObject({ redirectMode: 'intermediate', intermediateDelaySeconds: 3 })
    expect(persisted.find(link => link.targetUrl === baseUrl + '/defaults')).toMatchObject({ title: '', tags: [], redirectMode: 'direct', expiresAt: null, maxVisits: null, intermediateDelaySeconds: 5 })
    await attach(info, 'subsets-persistence', { outcomes, writes, persisted, lostResponse, unknownRetrySameRequest: true })
  })
}

test('v0.86.1 en 390px user grants remain required for sparse and empty structured fields', async ({ scenario }, info) => {
  test.setTimeout(150_000)
  const { page, manager, user } = scenario, original = await userGroup(manager), failures: unknown[] = [], writes: Write[] = [], outcomes: unknown[] = []
  recordWrites(page, writes)
  try {
    const all = [...new Set([...original.permissions, ...grants])]
    await setGrants(manager, all); await page.goto('/link'); await activate(page.getByTestId('bulk-create-open'))
    const draft = page.getByRole('dialog').getByRole('textbox'), manual = 'https://example.com/retained86'
    await draft.fill(manual)
    for (const sample of [
      { grant: 'short_link:set_metadata', text: 'expires_at,target_url\n,https://example.com/empty-expiry' },
      { grant: 'short_link:custom_slug', text: 'expires_at,target_url\n,https://example.com/empty-expiry' },
      { grant: 'short_link:set_expiration', text: 'expires_at,target_url\n2099-01-01T00:00:00Z,https://example.com/expiry' },
      { grant: 'short_link:set_max_visits', text: 'max_visits,target_url\n12,https://example.com/limit' },
    ]) {
      await setGrants(manager, all.filter(value => value !== sample.grant)); await refreshAuthority(page, user.id, sample.grant, false)
      await upload(page, sample.text); await expect(page.getByTestId('bulk-create-error')).toBeVisible(); await expect(draft).toHaveValue(manual)
      expect(writes).toStrictEqual([]); outcomes.push(sample)
      await setGrants(manager, all); await refreshAuthority(page, user.id, sample.grant, true)
    }
    await upload(page, 'expires_at,target_url\n,https://example.com/revoked-' + randomBytes(7).toString('hex'))
    await expect(page.getByTestId('bulk-create-imported-list').locator('li')).toHaveCount(1); await activate(page.getByTestId('bulk-create-preview'))
    const oldId = await page.getByTestId('bulk-create-request-id').innerText()
    await setGrants(manager, all.filter(value => value !== 'short_link:custom_slug')); await refreshAuthority(page, user.id, 'short_link:custom_slug', false)
    await expect(page.getByRole('dialog')).toBeHidden()
    await setGrants(manager, all); await refreshAuthority(page, user.id, 'short_link:custom_slug', true)
    await activate(page.getByTestId('bulk-create-open')); await expect(draft).toHaveValue(''); await expect(page.getByTestId('bulk-create-request-id')).toHaveCount(0)
    expect(writes).toStrictEqual([]); expect(await links(page.request)).toStrictEqual([])
    await attach(info, 'subsets-real-authority', { outcomes, oldId, actualCAS: true, originalAuthQuery: true, revived: false, writes })
  } catch (error) { failures.push(error) } finally {
    try { await setGrants(manager, original.permissions); expect((await userGroup(manager)).permissions.slice().sort()).toStrictEqual(original.permissions.slice().sort()) } catch (error) { failures.push(error) }
  }
  if (failures.length) throw new AggregateError(failures, 'Sparse authority or exact grant restoration failed')
})

function csv(header: readonly string[], rows: readonly (readonly string[])[]) { return '\uFEFF' + header.join(',') + '\r\n' + rows.map(row => row.map(value => '"' + value.replaceAll('"', '""') + '"').join(',')).join('\r\n') + '\r\n' }
async function upload(page: Page, text: string) { await page.getByRole('dialog').getByTestId('bulk-create-standard-file').setInputFiles({ name: 'subsets.csv', mimeType: 'text/csv', buffer: Buffer.from(text) }) }
async function activate(control: Locator) { if (touchPages.has(control.page())) await control.tap(); else { await control.focus(); await control.press('Enter') } }
function recordWrites(page: Page, writes: Write[]) { page.on('request', request => { const path = new URL(request.url()).pathname; if (path.includes('/short-link/batch-create')) writes.push({ path, body: request.postDataJSON(), expected: request.headers()['x-moeurl-expected-user-id'] }) }) }
async function capture(info: TestInfo, name: string, page: Page) {
  const width = info.title.includes('1280px') ? 1280 : 390, viewport = { width, height: width === 1280 ? 720 : 800 }
  expect(page.viewportSize()).toStrictEqual(viewport)
  await expectNoHorizontalOverflow(page)
  const dialog = page.getByRole('dialog'), actions = dialog.locator('.bulk-create-actions'), body = dialog.locator('.bulk-create-body')
  await expect.poll(() => dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0)
  await expect(actions).toBeInViewport({ ratio: 1 })
  const ids = await actions.locator('button').evaluateAll(buttons => buttons.map(button => button.getAttribute('data-testid')))
  expect(ids).toStrictEqual(await page.getByTestId('bulk-create-submit').count() ? ['bulk-create-close', 'bulk-create-edit', 'bulk-create-submit'] : ['bulk-create-close', 'bulk-create-preview'])
  const controls = []
  for (const id of ids) {
    expect(id).not.toBeNull()
    const control = page.getByTestId(id!)
    await expect(control).toBeVisible(); await expect(control).toBeInViewport({ ratio: 1 })
    const box = await control.boundingBox(); expect(box).not.toBeNull()
    if (!box) throw new Error('Visible action has no geometry')
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width); expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
    expect(await control.evaluate(element => { const rect = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) })).toBe(true)
    controls.push({ id, ...box })
  }
  for (let index = 0; index < controls.length; index++) for (let next = index + 1; next < controls.length; next++) {
    const a = controls[index]!, b = controls[next]!
    expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true)
  }
  await attach(info, name + '-geometry', { viewport: page.viewportSize(), dialog: await dialog.boundingBox(), body: await body.boundingBox(), scroll: await body.evaluate(element => ({ top: element.scrollTop, height: element.clientHeight, content: element.scrollHeight })), actions: await actions.boundingBox(), controls })
  const path = info.outputPath(name + '.png'); await page.screenshot({ path, animations: 'disabled' }); await info.attach(name, { path, contentType: 'image/png' })
}
async function userGroup(api: APIRequestContext) { const response = await api.get('/api/v1/admin/user-group/list'); expect(response.status()).toBe(200); const payload = await response.json(); expect(payload.code).toBe(0); const group = (payload.data.groups as Group[]).find(value => value.key === 'user'); if (!group) throw new Error('Missing user group'); return group }
async function setGrants(api: APIRequestContext, permissions: string[]) { const current = await userGroup(api); await post(api, '/admin/user-group/update-permissions', { groupKey: 'user', expectedUpdatedAt: current.updatedAt, permissions }) }
/** Refetches the original active auth query against the real server, without a synthetic cache replacement. */
async function refreshAuthority(page: Page, userId: string, grant: string, hasGrant: boolean) {
  const receiving = page.waitForResponse(value => new URL(value.url()).pathname === '/api/v1/auth/me' && value.request().method() === 'GET')
  const cached = await page.evaluate(async () => {
    interface Client { refetchQueries(filter: { queryKey: string[]; exact: boolean; type: 'active' }): Promise<unknown>; getQueryData(key: string[]): unknown }
    const root = document.getElementById('app') as (HTMLElement & { __vue_app__?: { _context: { provides: Record<string, unknown> } } }) | null
    const client = Object.values(root?.__vue_app__?._context.provides ?? {}).find(value => !!value && typeof value === 'object' && 'refetchQueries' in value && typeof value.refetchQueries === 'function' && 'getQueryData' in value && typeof value.getQueryData === 'function') as Client | undefined
    if (!client) throw new Error('Existing Vue Query client unavailable; no synthetic fallback')
    await client.refetchQueries({ queryKey: ['auth', 'me'], exact: true, type: 'active' }); return client.getQueryData(['auth', 'me'])
  })
  const payload = await (await receiving).json(); expect(payload.code).toBe(0); expect(payload.data.user.id).toBe(userId)
  expect(payload.data.user.permissions.includes(grant)).toBe(hasGrant); expect(cached).toStrictEqual(payload.data)
}
