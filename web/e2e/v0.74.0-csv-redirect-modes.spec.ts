import { randomBytes, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { expect, test as base } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Locator, Page, Request, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow, readVisitCount } from './support'

interface User { id: string; username: string }
interface Item { targetUrl: string; title: string; tags: string[]; customSlug: string; redirectMode: '' | 'direct' | 'intermediate' | 'confirmation' }
interface Link { id: string; slug: string; targetUrl: string; title: string; tags: string[]; redirectMode: string; intermediateDelaySeconds: number }
interface Group { key: string; updatedAt: string; permissions: string[] }
interface Scenario { page: Page; manager: APIRequestContext; user: User; createUser: () => Promise<User> }
const endpoint = '/api/v1/short-link/batch-create-with-redirect-modes'
const password = 'csv-redirect-mode-disposable-account'
const required = ['short_link:create', 'domain:use_default', 'short_link:set_metadata', 'short_link:custom_slug', 'short_link:use_intermediate', 'short_link:use_confirmation']
const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, page: manager }, use, info) => {
    const users: User[] = [], failures: unknown[] = []
    let context: BrowserContext | undefined
    try {
      const baseURL = info.project.use.baseURL
      if (typeof baseURL !== 'string') throw new Error('Requires disposable Compose baseURL')
      await post(manager.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      const createUser = async () => {
        const data = await post<{ user: User }>(manager.request, '/admin/user/create', { username: 'csvmodes-' + randomBytes(7).toString('hex'), password, nickname: 'CSV redirect mode fixture', groupKey: info.title.includes('user grants') ? 'user' : 'admin', status: 'active' })
        users.push(data.user); return data.user
      }
      const user = await createUser(), width = info.title.includes('1280px') ? 1280 : info.title.includes('320px') ? 320 : 390
      const language = info.title.includes(' en ') ? 'en' : 'zh-CN', theme = language === 'en' ? 'dark' : 'light'
      context = await browser.newContext({ baseURL, viewport: { width, height: width === 320 ? 500 : width === 1280 ? 900 : 800 }, locale: language, hasTouch: width !== 1280, serviceWorkers: 'block', colorScheme: theme, reducedMotion: 'reduce' })
      await context.addInitScript(({ language, theme }) => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', theme) }, { language, theme })
      const page = await context.newPage(); await post(page.request, '/auth/login', { username: user.username, password })
      await attach(info, 'runtime', { browser: browser.version(), driverNode: process.version, width, language, theme, userId: user.id, disposableDatabase: true })
      await use({ page, manager: manager.request, user, createUser })
    } catch (error) { failures.push(error) } finally {
      // Each exact owned account gets a fresh cookie jar, including accounts retired in the same SPA.
      for (const user of users) {
        let cleanup: BrowserContext | undefined
        try {
          cleanup = await browser.newContext({ baseURL: info.project.use.baseURL })
          const page = await cleanup.newPage()
          await post(page.request, '/auth/login', { username: user.username, password })
          for (const link of await links(page.request)) await post(manager.request, '/admin/short-link/delete', { id: link.id })
          await post(manager.request, '/admin/user/update', { id: user.id, nickname: 'CSV redirect mode fixture', status: 'disabled' })
        } catch (error) { failures.push(error) } finally { if (cleanup) await cleanup.close().catch(error => failures.push(error)) }
      }
      if (context) await context.close().catch(error => failures.push(error))
    }
    if (failures.length) throw new AggregateError(failures, 'Redirect-mode scenario or exact owned cleanup failed')
  }, { timeout: 90_000 }],
})
test.describe.configure({ mode: 'serial' })
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const language of ['zh-CN', 'en'] as const) for (const width of [1280, 390]) {
  test('v0.74.0 ' + language + ' ' + width + 'px imports all modes, downloads the fifth template and retries one committed batch', async ({ scenario }, info) => {
    test.setTimeout(150_000)
    const { page, user } = scenario, nonce = randomBytes(7).toString('hex')
    const items: Item[] = (['direct', 'intermediate', 'confirmation', ''] as const).map((redirectMode, i) => ({ targetUrl: 'https://example.com/csv74/' + nonce + '/' + i, title: i === 0 ? ' <b>literal</b> ' : '', tags: i === 0 ? [' 工具 ', 'a,b'] : [], customSlug: i % 2 ? '' : 'Mode' + i + nonce, redirectMode }))
    const writes: { path: string; body: unknown; expected: string | undefined }[] = []
    page.on('request', request => { const path = new URL(request.url()).pathname; if (path.includes('/short-link/batch-create')) writes.push({ path, body: request.postDataJSON(), expected: request.headers()['x-moeurl-expected-user-id'] }) })
    await page.goto('/link'); await activate(page.getByTestId('bulk-create-open'))
    const dialog = page.getByRole('dialog'), help = page.getByTestId('bulk-create-csv-help'), draft = dialog.getByRole('textbox')
    await draft.fill('https://private.example/not-in-template'); await activate(help.locator('summary'))
    const downloading = page.waitForEvent('download')
    await activate(help.getByRole('button', { name: language === 'en' ? 'Download CSV template with redirect modes' : '下载带跳转方式的 CSV 模板', exact: true }))
    const download = await downloading, templatePath = info.outputPath('moeurl-redirect-modes-template.csv')
    expect(download.suggestedFilename()).toBe('moeurl-redirect-modes-template.csv')
    await download.saveAs(templatePath); expect(await download.failure()).toBeNull()
    const template = await readFile(templatePath, 'utf8')
    expect(template.startsWith('\uFEFFtarget_url,title,tags,custom_slug,redirect_mode\r\n')).toBe(true)
    expect(template).toContain(',intermediate\r\n'); expect(template).toContain(',confirmation\r\n')
    expect(template).not.toContain('private.example')
    await expect(draft).toHaveValue('https://private.example/not-in-template')
    expect(writes).toEqual([])
    await dialog.locator('input[type=file]').setInputFiles({ name: 'modes.csv', mimeType: 'text/csv', buffer: Buffer.from(csv(items)) })
    await expect(page.getByTestId('bulk-create-imported-list').locator('li')).toHaveCount(4)
    await expect(page.getByTestId('bulk-create-imported-list')).toContainText('<b>literal</b>')
    await expect(dialog.locator('b')).toHaveCount(0)
    await activate(page.getByTestId('bulk-create-preview'))
    await expect(page.getByTestId('bulk-create-preview-list').locator('li')).toHaveCount(4)
    const modeNames = language === 'en' ? ['Direct redirect', 'Intermediate page', 'Confirmation page'] : ['直接跳转', '中间页', '确认页']
    for (const mode of modeNames) await expect(page.getByTestId('bulk-create-preview-list')).toContainText(mode)
    await capture(info, 'mode-preview-' + language + '-' + width, page)
    const requestId = await page.getByTestId('bulk-create-request-id').innerText()
    let committed: unknown
    await page.route('**' + endpoint, async route => {
      const response = await route.fetch(); committed = await response.json()
      expect(committed).toMatchObject({ code: 0, data: { requestId, createdCount: 4 } })
      await route.abort('failed')
    }, { times: 1 })
    await activate(page.getByTestId('bulk-create-submit'))
    await expect(page.getByTestId('bulk-create-error')).toBeVisible()
    await expect(page.getByTestId('bulk-create-request-id')).toHaveText(requestId)
    expect(committed).toMatchObject({ code: 0 })
    await capture(info, 'mode-unknown-' + language + '-' + width, page)
    const retry = page.waitForResponse(response => new URL(response.url()).pathname === endpoint)
    await activate(page.getByTestId('bulk-create-submit'))
    expect(await (await retry).json()).toMatchObject({ code: 0, data: { requestId, createdCount: 4 } })
    await expect(dialog).toBeHidden()
    expect(writes).toEqual(Array.from({ length: 2 }, () => ({ path: endpoint, body: { requestId, items }, expected: user.id })))
    const persisted = await links(page.request); expect(persisted).toHaveLength(4)
    await page.route('https://example.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<main>Owned final redirect destination</main>' }))
    for (const item of items) {
      const link = persisted.find(link => link.targetUrl === item.targetUrl)!
      expect(link).toMatchObject({ title: item.title.trim(), tags: item.tags.map(tag => tag.trim()), redirectMode: item.redirectMode || 'direct' })
      if (item.customSlug) expect(link.slug).toBe(item.customSlug.toLowerCase())
      expect(await readVisitCount(page, link.id)).toBe(0)
      if (!item.redirectMode || item.redirectMode === 'direct') {
        const opened = await page.request.get('/' + link.slug, { maxRedirects: 0 })
        expect(opened.status()).toBe(302); expect(opened.headers().location).toBe(item.targetUrl)
      } else {
        const preview = await page.request.get('/go/' + link.slug + '/preview')
        expect(await preview.json()).toMatchObject({ code: 0, data: { redirectMode: item.redirectMode, intermediateDelaySeconds: item.redirectMode === 'intermediate' ? 5 : null } })
        await page.goto('/' + link.slug)
        if (item.redirectMode === 'confirmation') {
          await expect(page.getByRole('button', { name: /^(继续访问|Continue to site)$/ })).toBeVisible()
          expect(await readVisitCount(page, link.id)).toBe(0)
          await capture(info, 'mode-confirmation-' + language + '-' + width, page)
          await activate(page.getByRole('button', { name: /^(继续访问|Continue to site)$/ }))
        }
        await expect(page).toHaveURL(item.targetUrl)
      }
      await expect.poll(() => readVisitCount(page, link.id), { timeout: 15_000 }).toBe(1)
    }
    await attach(info, 'mode-persistence-and-visits', { requestId, items, writes, persisted, actualCommitAcknowledgementLost: true, retryDidNotDuplicate: true, publicEntryAndVisitCountVerified: true })
  })
}

for (const language of ['zh-CN', 'en'] as const) {
  test('v0.74.0 ' + language + ' 320px keeps a twenty-row five-column preview and keyboard submit usable', async ({ scenario }, info) => {
    const { page } = scenario, nonce = randomBytes(7).toString('hex')
    const modes = ['direct', 'intermediate', 'confirmation', ''] as const
    const items: Item[] = Array.from({ length: 20 }, (_, index) => ({ targetUrl: 'https://example.com/twenty74/' + nonce + '/' + index, title: '工具 <literal> ' + index, tags: ['a,b', '工具'], customSlug: index % 2 ? '' : 'Row' + index + nonce, redirectMode: modes[index % 4]! }))
    await page.goto('/link'); await activate(page.getByTestId('bulk-create-open'))
    await page.getByRole('dialog').locator('input[type=file]').setInputFiles({ name: 'twenty.csv', mimeType: 'text/csv', buffer: Buffer.from(csv(items)) })
    await expect(page.getByTestId('bulk-create-imported-list').locator('li')).toHaveCount(20)
    await activate(page.getByTestId('bulk-create-preview'))
    await expect(page.getByTestId('bulk-create-preview-list').locator('li')).toHaveCount(20)
    await page.getByTestId('bulk-create-preview-list').locator('li').last().scrollIntoViewIfNeeded()
    await capture(info, 'mode-twenty-last-' + language, page)
    await page.getByTestId('bulk-create-submit').focus()
    await expect(page.getByTestId('bulk-create-submit')).toBeInViewport()
    await capture(info, 'mode-twenty-action-' + language, page)
    const response = page.waitForResponse(response => new URL(response.url()).pathname === endpoint)
    await page.getByTestId('bulk-create-submit').press('Enter')
    expect(await (await response).json()).toMatchObject({ code: 0, data: { createdCount: 20 } })
    await expect(page.getByRole('dialog')).toBeHidden()
    expect(await links(page.request)).toHaveLength(20)
  })
}


for (const removed of ['short_link:custom_slug', 'short_link:use_intermediate']) {
  test('v0.74.0 en 390px user grants reject five columns without ' + removed + ' and preserve legacy input', async ({ scenario }, info) => {
    const { page, manager } = scenario, original = await userGroup(manager), failures: unknown[] = []
    try {
      await post(manager, '/admin/user-group/update-permissions', { groupKey: 'user', expectedUpdatedAt: original.updatedAt, permissions: [...new Set([...original.permissions, ...required])].filter(value => value !== removed) })
      const target = 'https://example.com/denied74/' + randomBytes(7).toString('hex')
      const item: Item = { targetUrl: target, title: '', tags: [], customSlug: '', redirectMode: removed === 'short_link:custom_slug' ? 'direct' : 'intermediate' }
      const writes: string[] = []
      page.on('request', request => { if (new URL(request.url()).pathname === endpoint) writes.push(request.postData() || '') })
      await page.goto('/link'); await activate(page.getByTestId('bulk-create-open'))
      const dialog = page.getByRole('dialog'), draft = dialog.getByRole('textbox')
      await draft.fill(target)
      await dialog.locator('input[type=file]').setInputFiles({ name: 'denied.csv', mimeType: 'text/csv', buffer: Buffer.from(csv([item])) })
      await expect(page.getByTestId('bulk-create-error')).toContainText(/permission/i)
      await expect(draft).toHaveValue(target); expect(writes).toEqual([])
      const denied = await page.request.post(endpoint, { data: { requestId: randomUUID(), items: [item] } })
      expect(await denied.json()).toMatchObject({ code: 120001 }); expect(await links(page.request)).toEqual([])
      await capture(info, 'mode-current-authority-' + removed.replaceAll(':', '-'), page)
      await dialog.locator('input[type=file]').setInputFiles({ name: 'legacy.csv', mimeType: 'text/csv', buffer: Buffer.from('target_url,title,tags\n' + target + ',,[]') })
      await expect(page.getByTestId('bulk-create-imported-list').locator('li')).toHaveCount(1)
      await activate(page.getByTestId('bulk-create-preview')); await activate(page.getByTestId('bulk-create-submit'))
      await expect(dialog).toBeHidden(); expect(await links(page.request)).toEqual([expect.objectContaining({ targetUrl: target, redirectMode: 'direct' })])
    } catch (error) { failures.push(error) } finally {
      try { const current = await userGroup(manager); await post(manager, '/admin/user-group/update-permissions', { groupKey: 'user', expectedUpdatedAt: current.updatedAt, permissions: original.permissions }); expect((await userGroup(manager)).permissions.slice().sort()).toEqual(original.permissions.slice().sort()) } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, 'Five-column authority or original-grant restoration failed')
  })
}

test('v0.74.0 en 390px user grants retire an unknown mode batch after server revocation and do not restore it automatically', async ({ scenario }, info) => {
  const { page, manager } = scenario, original = await userGroup(manager), failures: unknown[] = []
  try {
    await post(manager, '/admin/user-group/update-permissions', { groupKey: 'user', expectedUpdatedAt: original.updatedAt, permissions: [...new Set([...original.permissions, ...required])] })
    const item: Item = { targetUrl: 'https://example.com/revoked74/' + randomBytes(7).toString('hex'), title: '', tags: [], customSlug: '', redirectMode: 'intermediate' }
    await page.goto('/link'); await activate(page.getByTestId('bulk-create-open'))
    await page.getByRole('dialog').locator('input[type=file]').setInputFiles({ name: 'unknown.csv', mimeType: 'text/csv', buffer: Buffer.from(csv([item])) })
    await activate(page.getByTestId('bulk-create-preview'))
    const oldId = await page.getByTestId('bulk-create-request-id').innerText(), writes: unknown[] = []
    page.on('request', request => { if (new URL(request.url()).pathname === endpoint) writes.push(request.postDataJSON()) })
    await page.route('**' + endpoint, async route => { const response = await route.fetch(); expect(await response.json()).toMatchObject({ code: 0, data: { requestId: oldId } }); await route.abort('failed') }, { times: 1 })
    await activate(page.getByTestId('bulk-create-submit')); await expect(page.getByTestId('bulk-create-error')).toBeVisible()
    const current = await userGroup(manager)
    await post(manager, '/admin/user-group/update-permissions', { groupKey: 'user', expectedUpdatedAt: current.updatedAt, permissions: current.permissions.filter(value => value !== 'short_link:use_intermediate') })
    const refusal = page.waitForResponse(response => new URL(response.url()).pathname === endpoint)
    await activate(page.getByTestId('bulk-create-submit'))
    expect(await (await refusal).json()).toMatchObject({ code: 120001 })
    await expect(page.getByRole('dialog')).toBeHidden()
    expect(writes).toEqual([{ requestId: oldId, items: [item] }, { requestId: oldId, items: [item] }])
    expect(await links(page.request)).toHaveLength(1)
    const revoked = await userGroup(manager)
    await post(manager, '/admin/user-group/update-permissions', { groupKey: 'user', expectedUpdatedAt: revoked.updatedAt, permissions: [...new Set([...revoked.permissions, ...required])] })
    await page.reload(); await activate(page.getByTestId('bulk-create-open'))
    await expect(page.getByRole('dialog').getByRole('textbox')).toHaveValue('')
    await expect(page.getByTestId('bulk-create-request-id')).toHaveCount(0)
    expect(writes).toHaveLength(2); expect(await links(page.request)).toHaveLength(1)
    await attach(info, 'mode-revocation-replay', { oldId, writes, originalReceiptPreserved: true, unauthorizedReplayDenied: true, automaticRevival: false })
  } catch (error) { failures.push(error) } finally {
    try { const current = await userGroup(manager); await post(manager, '/admin/user-group/update-permissions', { groupKey: 'user', expectedUpdatedAt: current.updatedAt, permissions: original.permissions }); expect((await userGroup(manager)).permissions.slice().sort()).toEqual(original.permissions.slice().sort()) } catch (error) { failures.push(error) }
  }
  if (failures.length) throw new AggregateError(failures, 'Unknown replay revocation or original-grant restoration failed')
})

for (const outcome of ['success', 'error', 'unknown'] as const) {
  test('v0.74.0 en 390px isolates a real same SPA account change from a late mode ' + outcome, async ({ scenario }, info) => {
    test.setTimeout(180_000)
    const { page } = scenario, next = await scenario.createUser(), nonce = randomBytes(7).toString('hex')
    await page.goto('/profile')
    await page.locator('button.console-topbar__menu').click()
    await page.locator('a[href="/link"]').filter({ visible: true }).click()
    await expect(page).toHaveURL(url => url.pathname === '/link')
    const marker = randomBytes(12).toString('hex')
    await page.evaluate(value => { (window as Window & { modeIdentity74?: string }).modeIdentity74 = value }, marker)
    const item: Item = { targetUrl: 'https://example.com/late74/' + nonce, title: '', tags: [], customSlug: '', redirectMode: 'confirmation' }
    await activate(page.getByTestId('bulk-create-open'))
    await page.getByRole('dialog').locator('input[type=file]').setInputFiles({ name: 'old.csv', mimeType: 'text/csv', buffer: Buffer.from(csv([item])) })
    await activate(page.getByTestId('bulk-create-preview'))
    const oldId = await page.getByTestId('bulk-create-request-id').innerText()
    let release!: () => void, processed!: () => void, held: Request | undefined, terminal: 'finished' | 'failed' | undefined, captured = false, routeError: unknown
    const gate = new Promise<void>(resolve => { release = resolve }), handled = new Promise<void>(resolve => { processed = resolve })
    const finished = (value: Request) => { if (value === held) terminal = 'finished' }, failed = (value: Request) => { if (value === held) terminal = 'failed' }
    page.on('requestfinished', finished); page.on('requestfailed', failed)
    try {
      await page.route('**' + endpoint, async route => {
        held = route.request()
        try {
          const response = await route.fetch(); expect(await response.json()).toMatchObject({ code: 0, data: { requestId: oldId, createdCount: 1 } }); captured = true
          await gate
          if (outcome === 'unknown') await route.abort('failed')
          else if (outcome === 'error') await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 120001, message: '', data: null, meta: {} }) })
          else await route.fulfill({ response })
        } catch (error) { routeError = error; await route.abort('failed').catch(() => undefined) } finally { processed() }
      }, { times: 1 })
      await activate(page.getByTestId('bulk-create-submit'))
      await expect.poll(() => captured || Boolean(routeError)).toBe(true); if (routeError) throw routeError
      // Native history navigation leaves the persistent modal through normal SPA unmount.
      await page.goBack(); await expect(page).toHaveURL(url => url.pathname === '/profile')
      await expect(page.getByRole('dialog')).toBeHidden()
      const logout = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/logout')
      await page.getByRole('button', { name: /^(打开账号菜单|Open account menu)$/ }).click()
      await page.getByTestId('console-mobile-account-menu').getByRole('menuitem', { name: /^(退出登录|Sign out)$/ }).click()
      expect((await (await logout).json()).code).toBe(0); await expect(page).toHaveURL(url => url.pathname === '/login')
      await page.getByLabel(/^(账号|Username)$/).fill(next.username); await page.getByLabel(/^(密码|Password)$/).fill(password)
      const login = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/login')
      await page.getByRole('button', { name: /^(登录|Sign in)$/ }).click(); expect((await (await login).json()).data.user.id).toBe(next.id)
      await expect(page).not.toHaveURL(url => url.pathname === '/login')
      if (new URL(page.url()).pathname === '/') { await page.getByRole('button', { name: 'CSV redirect mode fixture', exact: true }).click(); await expect(page).toHaveURL(/\/profile$/) }
      if (new URL(page.url()).pathname !== '/link') { await page.locator('button.console-topbar__menu').click(); await page.locator('a[href="/link"]').filter({ visible: true }).click() }
      await activate(page.getByTestId('bulk-create-open'))
      const freshTarget = 'https://example.com/new-account74/' + nonce
      await page.getByRole('dialog').getByRole('textbox').fill(freshTarget)
      await activate(page.getByTestId('bulk-create-preview'))
      const newId = await page.getByTestId('bulk-create-request-id').innerText()
      expect(newId).not.toBe(oldId)
      release(); await handled; if (routeError) throw routeError
      await expect.poll(() => terminal).toMatch(/^(finished|failed)$/)
      if (terminal === 'finished') expect(await (await held!.response())!.finished()).toBeNull()
      else expect(held!.failure()?.errorText).toBeTruthy()
      await frames(page)
      await expect(page.getByTestId('bulk-create-request-id')).toHaveText(newId)
      await expect(page.getByTestId('bulk-create-preview-list')).toHaveText(freshTarget)
      await expect(page.getByTestId('bulk-create-submit')).toBeEnabled()
      await expect(page.getByTestId('bulk-create-error')).toHaveCount(0)
      expect(await page.evaluate(() => (window as Window & { modeIdentity74?: string }).modeIdentity74)).toBe(marker)
      expect(await links(page.request)).toEqual([])
      await attach(info, 'mode-identity-continuation', { oldUser: scenario.user.id, newUser: next.id, marker, oldId, newId, outcome, terminal, captured, guard: 'exact request terminal and two frames before asserting fresh batch' })
    } finally { release(); if (held) await handled; page.off('requestfinished', finished); page.off('requestfailed', failed) }
  })
}

/** Preserves all raw fields through both JSON-array and CSV quoting layers. */
function csv(items: readonly Item[]) { return '\uFEFFtarget_url,title,tags,custom_slug,redirect_mode\r\n' + items.map(item => [item.targetUrl, item.title, JSON.stringify(item.tags), item.customSlug, item.redirectMode].map(value => '"' + value.replaceAll('"', '""') + '"').join(',')).join('\r\n') + '\r\n' }
async function activate(control: Locator) { await control.focus(); await control.press('Enter') }
async function frames(page: Page) { await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))) }
async function links(api: APIRequestContext) { return (await get<{ items: Link[] }>(api, '/short-link/list?page=1&pageSize=100')).items }
async function userGroup(api: APIRequestContext) { const group = (await get<{ groups: Group[] }>(api, '/admin/user-group/list')).groups.find(group => group.key === 'user'); if (!group) throw new Error('Missing user group'); return group }
async function get<T>(api: APIRequestContext, resource: string): Promise<T> { const response = await api.get('/api/v1' + resource, { timeout: 10_000 }); expect(response.status()).toBe(200); const payload = await response.json(); expect(payload.code).toBe(0); return payload.data as T }
async function post<T = unknown>(api: APIRequestContext, resource: string, data: unknown): Promise<T> { const response = await api.post('/api/v1' + resource, { data, timeout: 10_000 }); expect(response.status()).toBe(200); const payload = await response.json(); expect(payload.code).toBe(0); return payload.data as T }
async function capture(info: TestInfo, name: string, page: Page) { await expectNoHorizontalOverflow(page); const dialog = page.getByRole('dialog'); if (await dialog.isVisible()) await expect.poll(() => dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0); const output = info.outputPath(name + '.png'); await page.screenshot({ path: output, animations: 'disabled' }); await info.attach(name, { path: output, contentType: 'image/png' }) }
async function attach(info: TestInfo, name: string, value: unknown) { const output = info.outputPath(name + '.json'); await writeFile(output, JSON.stringify(value, null, 2)); await info.attach(name, { path: output, contentType: 'application/json' }) }
