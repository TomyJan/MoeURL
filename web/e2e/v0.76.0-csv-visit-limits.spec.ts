import { randomBytes, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { expect, test as base } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Locator, Page, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow, readVisitCount } from './support'

interface User { id: string; username: string }
interface Item { targetUrl: string; title: string; tags: string[]; customSlug: string; redirectMode: 'direct' | 'intermediate' | 'confirmation'; expiresAt: string; maxVisits: string }
interface Link { id: string; slug: string; targetUrl: string; maxVisits: number | null; visitsUsed: number; redirectMode: string; expiresAt: string | null }
interface Group { key: string; updatedAt: string; permissions: string[] }
interface Scenario { page: Page; manager: APIRequestContext; user: User }
const endpoint = '/api/v1/short-link/batch-create-with-visit-limits', touchPages = new WeakSet<Page>()
const required = ['short_link:create', 'domain:use_default', 'short_link:set_metadata', 'short_link:custom_slug', 'short_link:use_intermediate', 'short_link:use_confirmation', 'short_link:set_expiration', 'short_link:set_max_visits']
const password = 'csv-visit-limit-disposable-account'
const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, page: manager }, use, info) => {
    let context: BrowserContext | undefined, user: User | undefined
    const failures: unknown[] = []
    try {
      const baseURL = info.project.use.baseURL
      if (typeof baseURL !== 'string') throw new Error('Requires disposable Compose baseURL')
      await post(manager.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      user = (await post<{ user: User }>(manager.request, '/admin/user/create', { username: 'csvcap-' + randomBytes(7).toString('hex'), password, nickname: 'CSV visit limit fixture', groupKey: info.title.includes('user grants') ? 'user' : 'admin', status: 'active' })).user
      const width = info.title.includes('1280px') ? 1280 : info.title.includes('320px') ? 320 : 390
      const language = info.title.includes(' en ') ? 'en' : 'zh-CN', theme = language === 'en' ? 'dark' : 'light'
      context = await browser.newContext({ baseURL, viewport: { width, height: width === 320 ? 500 : width === 1280 ? 900 : 800 }, locale: language, hasTouch: width !== 1280, serviceWorkers: 'block', colorScheme: theme, reducedMotion: 'reduce' })
      await context.addInitScript(({ language, theme }) => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', theme) }, { language, theme })
      const page = await context.newPage(); if (width !== 1280) touchPages.add(page)
      await post(page.request, '/auth/login', { username: user.username, password })
      await attach(info, 'runtime', { browser: browser.version(), driverNode: process.version, width, language, theme, userId: user.id, disposableDatabase: true })
      await use({ page, manager: manager.request, user })
    } catch (error) { failures.push(error) } finally {
      if (context && user) {
        try {
          const page = await context.newPage()
          for (const link of await links(page.request)) await post(manager.request, '/admin/short-link/delete', { id: link.id })
          await post(manager.request, '/admin/user/update', { id: user.id, nickname: 'CSV visit limit fixture', status: 'disabled' })
        } catch (error) { failures.push(error) }
      }
      if (context) await context.close().catch(error => failures.push(error))
    }
    if (failures.length) throw new AggregateError(failures, 'Visit-limit scenario or owned cleanup failed')
  }, { timeout: 90_000 }],
})
test.describe.configure({ mode: 'serial' })
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const language of ['zh-CN', 'en'] as const) for (const width of [1280, 390]) {
  test('v0.76.0 ' + language + ' ' + width + 'px imports limits, downloads the seventh template and replays consumed limits', async ({ scenario }, info) => {
    test.setTimeout(150_000)
    const { page, user } = scenario, nonce = randomBytes(7).toString('hex')
    const items: Item[] = (['direct', 'intermediate', 'confirmation'] as const).map((redirectMode, i) => ({ targetUrl: 'https://example.com/csv76/' + nonce + '/' + i, title: i === 0 ? ' <b>literal</b> ' : '', tags: i === 0 ? [' 工具 ', 'a,b'] : [], customSlug: 'Cap' + i + nonce, redirectMode, expiresAt: '', maxVisits: ['1', '', '2147483647'][i]! }))
    const writes: { path: string; body: unknown; expected: string | undefined }[] = []
    page.on('request', request => { const path = new URL(request.url()).pathname; if (path.includes('/short-link/batch-create')) writes.push({ path, body: request.postDataJSON(), expected: request.headers()['x-moeurl-expected-user-id'] }) })
    await page.goto('/link'); await activate(page.getByTestId('bulk-create-open'))
    const dialog = page.getByRole('dialog'), help = page.getByTestId('bulk-create-csv-help'), draft = dialog.getByRole('textbox')
    await draft.fill('https://private.example/not-in-template'); await activate(help.locator('summary'))
    const downloading = page.waitForEvent('download')
    await activate(help.getByRole('button', { name: language === 'en' ? 'Download visit-limit CSV template' : '下载访问上限 CSV 模板', exact: true }))
    const download = await downloading, templatePath = info.outputPath('moeurl-visit-limits-template.csv')
    expect(download.suggestedFilename()).toBe('moeurl-visit-limits-template.csv')
    await download.saveAs(templatePath); expect(await download.failure()).toBeNull()
    const template = await readFile(templatePath, 'utf8')
    expect(template.startsWith('\uFEFFtarget_url,title,tags,custom_slug,redirect_mode,expires_at,max_visits\r\n')).toBe(true)
    expect(template).toContain(',direct,,1\r\n'); expect(template).toContain(',intermediate,,\r\n'); expect(template).toContain(',confirmation,,2147483647\r\n')
    expect(template).not.toContain('private.example'); await expect(draft).toHaveValue('https://private.example/not-in-template'); expect(writes).toEqual([])
    await upload(page, items)
    for (const stage of ['imported', 'preview']) {
      if (stage === 'preview') await activate(page.getByTestId('bulk-create-preview'))
      const list = page.getByTestId('bulk-create-' + stage + '-list'); await expect(list.locator('li')).toHaveCount(3)
      await expect(list).toContainText('<b>literal</b>'); await expect(dialog.locator('b')).toHaveCount(0)
      for (const [i, cap] of ['1', language === 'en' ? '(unlimited visits)' : '（无限额）', '2147483647'].entries()) await expect(list.locator('.bulk-create-item-limit').nth(i)).toContainText(cap)
    }
    await capture(info, 'visit-limit-preview-' + language + '-' + width, page)
    const requestId = await page.getByTestId('bulk-create-request-id').innerText()
    let committed: unknown
    await page.route('**' + endpoint, async route => { const response = await route.fetch(); committed = await response.json(); expect(committed).toMatchObject({ code: 0, data: { requestId, createdCount: 3 } }); await route.abort('failed') }, { times: 1 })
    await activate(page.getByTestId('bulk-create-submit')); await expect(page.getByTestId('bulk-create-error')).toBeVisible()
    await expect(page.getByTestId('bulk-create-error-feedback')).toBeFocused(); await expect(page.getByTestId('bulk-create-request-id')).toHaveText(requestId)
    await capture(info, 'visit-limit-unknown-' + language + '-' + width, page)
    const retry = page.waitForResponse(response => new URL(response.url()).pathname === endpoint)
    await activate(page.getByTestId('bulk-create-submit')); expect(await (await retry).json()).toMatchObject({ code: 0, data: { requestId, createdCount: 3 } })
    await expect(dialog).toBeHidden(); expect(writes).toEqual(Array.from({ length: 2 }, () => ({ path: endpoint, body: { requestId, items }, expected: user.id })))
    const persisted = await links(page.request); expect(persisted).toHaveLength(3)
    await page.route('https://example.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<main>Owned final redirect destination</main>' }))
    for (const item of items) {
      const link = persisted.find(link => link.targetUrl === item.targetUrl)!
      expect(link).toMatchObject({ maxVisits: item.maxVisits ? Number(item.maxVisits) : null, visitsUsed: 0, redirectMode: item.redirectMode, expiresAt: null })
      expect(await readVisitCount(page, link.id)).toBe(0)
      if (item.redirectMode === 'direct') {
        const opened = await page.request.get('/' + link.slug, { maxRedirects: 0 }); expect(opened.status()).toBe(302); expect(opened.headers().location).toBe(item.targetUrl)
      } else {
        const preview = await page.request.get('/go/' + link.slug + '/preview'); expect(await preview.json()).toMatchObject({ code: 0, data: { redirectMode: item.redirectMode } })
        expect(await readVisitCount(page, link.id)).toBe(0); await page.goto('/' + link.slug)
        if (item.redirectMode === 'confirmation') { await expect(page.getByRole('button', { name: /^(继续访问|Continue to site)$/ })).toBeVisible(); expect(await readVisitCount(page, link.id)).toBe(0); await activate(page.getByRole('button', { name: /^(继续访问|Continue to site)$/ })) }
        await expect(page).toHaveURL(item.targetUrl)
      }
      await expect.poll(() => readVisitCount(page, link.id), { timeout: 15_000 }).toBe(1)
    }
    const consumed = await links(page.request), capped = consumed.find(link => link.targetUrl === items[0]!.targetUrl)!
    expect(capped.visitsUsed).toBe(1)
    const exhausted = await page.request.get('/' + capped.slug, { maxRedirects: 0 }); expect(exhausted.status()).toBe(302); expect(exhausted.headers().location).toBe('/go/' + capped.slug + '?reason=exhausted')
    expect(await post(page.request, '/short-link/batch-create-with-visit-limits', { requestId, items })).toMatchObject({ requestId, createdCount: 3 })
    expect(await links(page.request)).toEqual(consumed); expect(await readVisitCount(page, capped.id)).toBe(1)
    const stillExhausted = await page.request.get('/' + capped.slug, { maxRedirects: 0 }); expect(stillExhausted.headers().location).toBe('/go/' + capped.slug + '?reason=exhausted')
    await attach(info, 'visit-limit-persistence', { requestId, items, writes, consumed, committed, acknowledgementLost: true, replayDidNotResetUsage: true, exhaustedAfterReplay: true })
  })
}

for (const language of ['zh-CN', 'en'] as const) {
  test('v0.76.0 ' + language + ' 320px keeps twenty seven-column rows and keyboard submission usable', async ({ scenario }, info) => {
    const { page } = scenario, nonce = randomBytes(7).toString('hex')
    const items: Item[] = Array.from({ length: 20 }, (_, i) => ({ targetUrl: 'https://example.com/twenty76/' + nonce + '/' + i, title: '工具 <literal> ' + i, tags: ['a,b', '工具'], customSlug: '', redirectMode: 'direct', expiresAt: '', maxVisits: ['', '1', '2147483647'][i % 3]! }))
    await page.goto('/link'); await activate(page.getByTestId('bulk-create-open')); await upload(page, items)
    await expect(page.getByTestId('bulk-create-imported-list').locator('li')).toHaveCount(20); await activate(page.getByTestId('bulk-create-preview'))
    await expect(page.getByTestId('bulk-create-preview-list').locator('.bulk-create-item-limit')).toHaveCount(20)
    await page.getByTestId('bulk-create-preview-list').locator('li').last().scrollIntoViewIfNeeded(); await capture(info, 'visit-limit-twenty-last-' + language, page)
    await page.getByTestId('bulk-create-submit').focus(); await expect(page.getByTestId('bulk-create-submit')).toBeInViewport(); await capture(info, 'visit-limit-twenty-action-' + language, page)
    const result = page.waitForResponse(response => new URL(response.url()).pathname === endpoint)
    await page.getByTestId('bulk-create-submit').press('Enter'); expect(await (await result).json()).toMatchObject({ code: 0, data: { createdCount: 20 } })
    await expect(page.getByRole('dialog')).toBeHidden(); expect(await links(page.request)).toHaveLength(20)
  })
}

test('v0.76.0 en 390px rejects noncanonical caps without replacing a manual draft', async ({ scenario }, info) => {
  const { page } = scenario, item: Item = { targetUrl: 'https://example.com/invalid76/' + randomBytes(7).toString('hex'), title: '', tags: [], customSlug: '', redirectMode: 'direct', expiresAt: '', maxVisits: '1' }
  await page.goto('/link'); await activate(page.getByTestId('bulk-create-open'))
  const draft = page.getByRole('dialog').getByRole('textbox'); await draft.fill(item.targetUrl)
  const writes: unknown[] = []; page.on('request', request => { if (new URL(request.url()).pathname === endpoint) writes.push(request.postDataJSON()) })
  for (const maxVisits of ['0', '01', '+1', '-1', ' 1', '1 ', '1.0', '1e1', '１', '2147483648']) {
    await upload(page, [{ ...item, maxVisits }]); await expect(page.getByTestId('bulk-create-error')).toBeVisible(); await expect(page.getByTestId('bulk-create-error-feedback')).toBeFocused(); await expect(draft).toHaveValue(item.targetUrl)
    const rejected = await page.request.post(endpoint, { data: { requestId: randomUUID(), items: [{ ...item, maxVisits }] } }); expect(await rejected.json()).toMatchObject({ code: 100001 })
  }
  expect(writes).toEqual([]); expect(await links(page.request)).toEqual([]); await capture(info, 'visit-limit-invalid-keeps-draft', page)
})

test('v0.76.0 en 390px user grants retire unknown caps and preserve unlimited and replacement drafts', async ({ scenario }, info) => {
  test.setTimeout(180_000)
  const { page, manager, user } = scenario, original = await userGroup(manager), failures: unknown[] = [], outcomes: unknown[] = []
  try {
    for (const kind of ['capped-import', 'capped-snapshot', 'capped-unknown', 'replacement', 'empty-import', 'empty-snapshot'] as const) {
      await setGrants(manager, [...new Set([...original.permissions, ...required])]); await page.goto('/link'); await activate(page.getByTestId('bulk-create-open'))
      const dialog = page.getByRole('dialog'), item: Item = { targetUrl: 'https://example.com/authority76/' + kind + '/' + randomBytes(7).toString('hex'), title: '', tags: [], customSlug: '', redirectMode: 'direct', expiresAt: '', maxVisits: kind.startsWith('empty') ? '' : '1' }
      await upload(page, [item]); await expect(page.getByTestId('bulk-create-imported-list').locator('li')).toHaveCount(1)
      if (kind.endsWith('snapshot') || kind === 'replacement' || kind === 'capped-unknown') await activate(page.getByTestId('bulk-create-preview'))
      const oldId = kind.endsWith('snapshot') || kind === 'capped-unknown' ? await page.getByTestId('bulk-create-request-id').innerText() : null
      if (kind === 'replacement') { await activate(page.getByTestId('bulk-create-edit')); await activate(page.getByTestId('bulk-create-clear-import')); await dialog.getByRole('textbox').fill(item.targetUrl) }
      if (kind === 'capped-unknown') {
        await page.route('**' + endpoint, async route => { const committed = await route.fetch(); expect(await committed.json()).toMatchObject({ code: 0, data: { requestId: oldId } }); await route.abort('failed') }, { times: 1 })
        await activate(page.getByTestId('bulk-create-submit')); await expect(page.getByTestId('bulk-create-error')).toBeVisible()
      }
      await setGrants(manager, (await userGroup(manager)).permissions.filter(p => p !== 'short_link:set_max_visits'))
      if (kind === 'capped-unknown') {
        const rejection = page.waitForResponse(response => new URL(response.url()).pathname === endpoint)
        await activate(page.getByTestId('bulk-create-submit')); expect(await (await rejection).json()).toMatchObject({ code: 120001 })
      } else await refreshAuthority(page, user.id, false)
      if (kind.startsWith('capped')) {
        await expect(dialog).toBeHidden(); await setGrants(manager, [...new Set([...original.permissions, ...required])]); await refreshAuthority(page, user.id, true)
        await activate(page.getByTestId('bulk-create-open')); await expect(dialog.getByRole('textbox')).toHaveValue(''); await expect(page.getByTestId('bulk-create-request-id')).toHaveCount(0); await activate(page.getByTestId('bulk-create-close'))
      } else {
        await expect(dialog).toBeVisible()
        if (kind === 'replacement') await expect(dialog.getByRole('textbox')).toHaveValue(item.targetUrl)
        else if (oldId) await expect(page.getByTestId('bulk-create-request-id')).toHaveText(oldId)
        else await expect(page.getByTestId('bulk-create-imported-list')).toContainText('(unlimited visits)')
        if (!oldId) await activate(page.getByTestId('bulk-create-preview'))
        const path = kind === 'replacement' ? '/api/v1/short-link/batch-create' : endpoint, created = page.waitForResponse(response => new URL(response.url()).pathname === path)
        await activate(page.getByTestId('bulk-create-submit')); expect(await (await created).json()).toMatchObject({ code: 0, data: { createdCount: 1 } }); await expect(dialog).toBeHidden()
      }
      outcomes.push({ kind, item, oldId })
    }
    expect(await links(page.request)).toHaveLength(4); await attach(info, 'visit-limit-real-authority', { outcomes, actualCAS: true, originalAuthQuery: true, revived: false })
  } catch (error) { failures.push(error) } finally {
    try { await setGrants(manager, original.permissions); expect((await userGroup(manager)).permissions.slice().sort()).toEqual(original.permissions.slice().sort()) } catch (error) { failures.push(error) }
  }
  if (failures.length) throw new AggregateError(failures, 'Cap authority or exact original-grant restoration failed')
})

/** Refetches the existing active query against the actual server without replacing its function. */
async function refreshAuthority(page: Page, userId: string, hasCap: boolean) {
  const response = page.waitForResponse(value => new URL(value.url()).pathname === '/api/v1/auth/me' && value.request().method() === 'GET')
  const cached = await page.evaluate(async () => {
    interface Client { refetchQueries(filter: { queryKey: string[]; exact: boolean; type: 'active' }): Promise<unknown>; getQueryData(key: string[]): unknown }
    const root = document.getElementById('app') as (HTMLElement & { __vue_app__?: { _context: { provides: Record<string, unknown> } } }) | null
    const client = Object.values(root?.__vue_app__?._context.provides ?? {}).find(value => !!value && typeof value === 'object' && 'refetchQueries' in value && typeof value.refetchQueries === 'function' && 'getQueryData' in value && typeof value.getQueryData === 'function') as Client | undefined
    if (!client) throw new Error('Existing Vue Query client unavailable; no synthetic fallback')
    await client.refetchQueries({ queryKey: ['auth', 'me'], exact: true, type: 'active' }); return client.getQueryData(['auth', 'me'])
  })
  const payload = await (await response).json(); expect(payload.code).toBe(0); expect(payload.data.user.id).toBe(userId)
  expect(payload.data.user.permissions.includes('short_link:set_max_visits')).toBe(hasCap); expect(cached).toEqual(payload.data)
}
async function upload(page: Page, items: readonly Item[]) { await page.getByRole('dialog').getByTestId('bulk-create-standard-file').setInputFiles({ name: 'visit-limits.csv', mimeType: 'text/csv', buffer: Buffer.from(csv(items)) }) }
/** Preserves raw strings through JSON-array and CSV quoting, including an empty cap. */
function csv(items: readonly Item[]) { return '\uFEFFtarget_url,title,tags,custom_slug,redirect_mode,expires_at,max_visits\r\n' + items.map(item => [item.targetUrl, item.title, JSON.stringify(item.tags), item.customSlug, item.redirectMode, item.expiresAt, item.maxVisits].map(value => '"' + value.replaceAll('"', '""') + '"').join(',')).join('\r\n') + '\r\n' }
async function activate(control: Locator) { if (touchPages.has(control.page())) await control.tap(); else { await control.focus(); await control.press('Enter') } }
async function links(api: APIRequestContext) { return (await get<{ items: Link[] }>(api, '/short-link/list?page=1&pageSize=100')).items }
async function userGroup(api: APIRequestContext) { const group = (await get<{ groups: Group[] }>(api, '/admin/user-group/list')).groups.find(group => group.key === 'user'); if (!group) throw new Error('Missing user group'); return group }
async function setGrants(api: APIRequestContext, permissions: string[]) { const current = await userGroup(api); await post(api, '/admin/user-group/update-permissions', { groupKey: 'user', expectedUpdatedAt: current.updatedAt, permissions }) }
async function get<T>(api: APIRequestContext, resource: string): Promise<T> { const response = await api.get('/api/v1' + resource, { timeout: 10_000 }); expect(response.status()).toBe(200); const payload = await response.json(); expect(payload.code).toBe(0); return payload.data as T }
async function post<T = unknown>(api: APIRequestContext, resource: string, data: unknown): Promise<T> { const response = await api.post('/api/v1' + resource, { data, timeout: 10_000 }); expect(response.status()).toBe(200); const payload = await response.json(); expect(payload.code).toBe(0); return payload.data as T }
async function capture(info: TestInfo, name: string, page: Page) { await expectNoHorizontalOverflow(page); const dialog = page.getByRole('dialog'); if (await dialog.isVisible()) await expect.poll(() => dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0); const output = info.outputPath(name + '.png'); await page.screenshot({ path: output, animations: 'disabled' }); await info.attach(name, { path: output, contentType: 'image/png' }) }
async function attach(info: TestInfo, name: string, value: unknown) { const output = info.outputPath(name + '.json'); await writeFile(output, JSON.stringify(value, null, 2)); await info.attach(name, { path: output, contentType: 'application/json' }) }
