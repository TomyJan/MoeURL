import { randomBytes, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { expect, test as base } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Locator, Page, Request, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow, readVisitCount } from './support'

interface User { id: string; username: string }
interface Item { targetUrl: string; title: string; tags: string[]; customSlug: string; redirectMode: '' | 'direct' | 'intermediate' | 'confirmation'; expiresAt: string }
interface Link { id: string; slug: string; targetUrl: string; title: string; tags: string[]; redirectMode: string; intermediateDelaySeconds: number; expiresAt: string | null }
interface Group { key: string; updatedAt: string; permissions: string[] }
interface Scenario { page: Page; manager: APIRequestContext; user: User; createUser: () => Promise<User> }
const endpoint = '/api/v1/short-link/batch-create-with-expirations', touchPages = new WeakSet<Page>()
const password = 'csv-expiration-disposable-account'
const required = ['short_link:create', 'domain:use_default', 'short_link:set_metadata', 'short_link:custom_slug', 'short_link:use_intermediate', 'short_link:use_confirmation', 'short_link:set_expiration']
const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, page: manager }, use, info) => {
    const users: User[] = [], failures: unknown[] = []
    let context: BrowserContext | undefined
    try {
      const baseURL = info.project.use.baseURL
      if (typeof baseURL !== 'string') throw new Error('Requires disposable Compose baseURL')
      await post(manager.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      const createUser = async () => {
        const data = await post<{ user: User }>(manager.request, '/admin/user/create', { username: 'csvexpiry-' + randomBytes(7).toString('hex'), password, nickname: 'CSV expiration fixture', groupKey: info.title.includes('user grants') ? 'user' : 'admin', status: 'active' })
        users.push(data.user); return data.user
      }
      const user = await createUser(), width = info.title.includes('1280px') ? 1280 : info.title.includes('320px') ? 320 : 390
      const language = info.title.includes(' en ') ? 'en' : 'zh-CN', theme = language === 'en' ? 'dark' : 'light'
      context = await browser.newContext({ baseURL, viewport: { width, height: width === 320 ? 500 : width === 1280 ? 900 : 800 }, locale: language, hasTouch: width !== 1280, serviceWorkers: 'block', colorScheme: theme, reducedMotion: 'reduce' })
      await context.addInitScript(({ language, theme }) => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', theme) }, { language, theme })
      const page = await context.newPage(); if (width !== 1280) touchPages.add(page); await post(page.request, '/auth/login', { username: user.username, password })
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
          await post(manager.request, '/admin/user/update', { id: user.id, nickname: 'CSV expiration fixture', status: 'disabled' })
        } catch (error) { failures.push(error) } finally { if (cleanup) await cleanup.close().catch(error => failures.push(error)) }
      }
      if (context) await context.close().catch(error => failures.push(error))
    }
    if (failures.length) throw new AggregateError(failures, 'Expiration scenario or exact owned cleanup failed')
  }, { timeout: 90_000 }],
})
test.describe.configure({ mode: 'serial' })
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const language of ['zh-CN', 'en'] as const) for (const width of [1280, 390]) {
  test('v0.75.0 ' + language + ' ' + width + 'px imports all modes, downloads the sixth template and retries one committed batch', async ({ scenario }, info) => {
    test.setTimeout(150_000)
    const { page, user } = scenario, nonce = randomBytes(7).toString('hex')
    const items: Item[] = (['direct', 'intermediate', 'confirmation', ''] as const).map((redirectMode, i) => ({ targetUrl: 'https://example.com/csv75/' + nonce + '/' + i, title: i === 0 ? ' <b>literal</b> ' : '', tags: i === 0 ? [' 工具 ', 'a,b'] : [], customSlug: i % 2 ? '' : 'Mode' + i + nonce, redirectMode, expiresAt: i < 2 ? '2030-01-01T00:00:00Z' : '' }))
    const writes: { path: string; body: unknown; expected: string | undefined }[] = []
    page.on('request', request => { const path = new URL(request.url()).pathname; if (path.includes('/short-link/batch-create')) writes.push({ path, body: request.postDataJSON(), expected: request.headers()['x-moeurl-expected-user-id'] }) })
    await page.goto('/link'); await activate(page.getByTestId('bulk-create-open'))
    const dialog = page.getByRole('dialog'), help = page.getByTestId('bulk-create-csv-help'), draft = dialog.getByRole('textbox')
    await draft.fill('https://private.example/not-in-template'); await activate(help.locator('summary'))
    const downloading = page.waitForEvent('download')
    await activate(help.getByRole('button', { name: language === 'en' ? 'Download CSV template with expiration times' : '下载带过期时间的 CSV 模板', exact: true }))
    const download = await downloading, templatePath = info.outputPath('moeurl-expirations-template.csv')
    expect(download.suggestedFilename()).toBe('moeurl-expirations-template.csv')
    await download.saveAs(templatePath); expect(await download.failure()).toBeNull()
    const template = await readFile(templatePath, 'utf8')
    expect(template.startsWith('\uFEFFtarget_url,title,tags,custom_slug,redirect_mode,expires_at\r\n')).toBe(true)
    expect(template).toContain(',intermediate,2030-01-01T00:00:00Z\r\n'); expect(template).toContain(',confirmation,\r\n')
    expect(template).not.toContain('private.example')
    await expect(draft).toHaveValue('https://private.example/not-in-template')
    expect(writes).toEqual([])
    await dialog.locator('input[type=file]').setInputFiles({ name: 'modes.csv', mimeType: 'text/csv', buffer: Buffer.from(csv(items)) })
    await expect(page.getByTestId('bulk-create-imported-list').locator('li')).toHaveCount(4)
    await expect(page.getByTestId('bulk-create-imported-list')).toContainText('<b>literal</b>')
    await expect(dialog.locator('b')).toHaveCount(0)
    for (const item of items) await expect(page.getByTestId('bulk-create-imported-list')).toContainText(item.expiresAt || (language === 'en' ? '(no deadline)' : '（无期限）'))
    await activate(page.getByTestId('bulk-create-preview'))
    await expect(page.getByTestId('bulk-create-preview-list').locator('li')).toHaveCount(4)
    const modeNames = language === 'en' ? ['Direct redirect', 'Intermediate page', 'Confirmation page'] : ['直接跳转', '中间页', '确认页']
    for (const mode of modeNames) await expect(page.getByTestId('bulk-create-preview-list')).toContainText(mode)
    for (const item of items) await expect(page.getByTestId('bulk-create-preview-list')).toContainText(item.expiresAt || (language === 'en' ? '(no deadline)' : '（无期限）'))
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
      expect(link).toMatchObject({ title: item.title.trim(), tags: item.tags.map(tag => tag.trim()), redirectMode: item.redirectMode || 'direct', expiresAt: item.expiresAt || null })
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
  test('v0.75.0 ' + language + ' 320px keeps a twenty-row six-column preview and keyboard submit usable', async ({ scenario }, info) => {
    const { page } = scenario, nonce = randomBytes(7).toString('hex')
    const modes = ['direct', 'intermediate', 'confirmation', ''] as const
    const items: Item[] = Array.from({ length: 20 }, (_, index) => ({ targetUrl: 'https://example.com/twenty75/' + nonce + '/' + index, title: '工具 <literal> ' + index, tags: ['a,b', '工具'], customSlug: index % 2 ? '' : 'Row' + index + nonce, redirectMode: modes[index % 4]!, expiresAt: index % 2 ? '' : '2030-01-01T00:00:00Z' }))
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


for (const removed of ['short_link:custom_slug', 'short_link:use_intermediate', 'short_link:set_expiration']) {
  test('v0.75.0 en 390px user grants reject six columns without ' + removed + ' and preserve legacy input', async ({ scenario }, info) => {
    const { page, manager } = scenario, original = await userGroup(manager), failures: unknown[] = []
    try {
      await post(manager, '/admin/user-group/update-permissions', { groupKey: 'user', expectedUpdatedAt: original.updatedAt, permissions: [...new Set([...original.permissions, ...required])].filter(value => value !== removed) })
      const target = 'https://example.com/denied75/' + randomBytes(7).toString('hex')
      const item: Item = { targetUrl: target, title: '', tags: [], customSlug: '', redirectMode: removed === 'short_link:use_intermediate' ? 'intermediate' : 'direct', expiresAt: removed === 'short_link:set_expiration' ? '2030-01-01T00:00:00Z' : '' }
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
    if (failures.length) throw new AggregateError(failures, 'Six-column authority or original-grant restoration failed')
  })
}

test('v0.75.0 en 390px user grants retire an unknown expiration batch after server revocation and do not restore it automatically', async ({ scenario }, info) => {
  const { page, manager } = scenario, original = await userGroup(manager), failures: unknown[] = []
  try {
    await post(manager, '/admin/user-group/update-permissions', { groupKey: 'user', expectedUpdatedAt: original.updatedAt, permissions: [...new Set([...original.permissions, ...required])] })
    const item: Item = { targetUrl: 'https://example.com/revoked75/' + randomBytes(7).toString('hex'), title: '', tags: [], customSlug: '', redirectMode: 'intermediate', expiresAt: '2030-01-01T00:00:00Z' }
    await page.goto('/link'); await activate(page.getByTestId('bulk-create-open'))
    await page.getByRole('dialog').locator('input[type=file]').setInputFiles({ name: 'unknown.csv', mimeType: 'text/csv', buffer: Buffer.from(csv([item])) })
    await activate(page.getByTestId('bulk-create-preview'))
    const oldId = await page.getByTestId('bulk-create-request-id').innerText(), writes: unknown[] = []
    page.on('request', request => { if (new URL(request.url()).pathname === endpoint) writes.push(request.postDataJSON()) })
    await page.route('**' + endpoint, async route => { const response = await route.fetch(); expect(await response.json()).toMatchObject({ code: 0, data: { requestId: oldId } }); await route.abort('failed') }, { times: 1 })
    await activate(page.getByTestId('bulk-create-submit')); await expect(page.getByTestId('bulk-create-error')).toBeVisible()
    const current = await userGroup(manager)
    await post(manager, '/admin/user-group/update-permissions', { groupKey: 'user', expectedUpdatedAt: current.updatedAt, permissions: current.permissions.filter(value => value !== 'short_link:set_expiration') })
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
  test('v0.75.0 en 390px isolates a real same SPA account change from a late expiration ' + outcome, async ({ scenario }, info) => {
    test.setTimeout(180_000)
    const { page } = scenario, next = await scenario.createUser(), nonce = randomBytes(7).toString('hex')
    await page.goto('/profile')
    await page.locator('button.console-topbar__menu').click()
    await page.getByTestId('console-drawer-transition').locator('a[href="/link"]').click()
    await expect(page).toHaveURL(url => url.pathname === '/link')
    const marker = randomBytes(12).toString('hex')
    await page.evaluate(value => { (window as Window & { expirationIdentity75?: string }).expirationIdentity75 = value }, marker)
    const item: Item = { targetUrl: 'https://example.com/late75/' + nonce, title: '', tags: [], customSlug: '', redirectMode: 'confirmation', expiresAt: '2030-01-01T00:00:00Z' }
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
      if (new URL(page.url()).pathname === '/') { await page.getByRole('button', { name: 'CSV expiration fixture', exact: true }).click(); await expect(page).toHaveURL(/\/profile$/) }
      if (new URL(page.url()).pathname !== '/link') { await page.locator('button.console-topbar__menu').click(); await page.getByTestId('console-drawer-transition').locator('a[href="/link"]').click() }
      await activate(page.getByTestId('bulk-create-open'))
      const freshTarget = 'https://example.com/new-account75/' + nonce
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
      expect(await page.evaluate(() => (window as Window & { expirationIdentity75?: string }).expirationIdentity75)).toBe(marker)
      expect(await links(page.request)).toEqual([])
      await attach(info, 'mode-identity-continuation', { oldUser: scenario.user.id, newUser: next.id, marker, oldId, newId, outcome, terminal, captured, guard: 'exact request terminal and two frames before asserting fresh batch' })
    } finally { release(); if (held) await handled; page.off('requestfinished', finished); page.off('requestfailed', failed) }
  })
}

// Removing receipt-before-deadline ordering would reject the replay; accepting expired
// new batches or counting their public requests would violate the assertions below.
test('v0.75.0 en 390px replays an expired receipt, rejects a new expired batch and accepts an explicit correction', async ({ scenario }, info) => {
  test.setTimeout(120_000)
  const { page } = scenario, nonce = randomBytes(7).toString('hex')
  const readNavigationClock = async () => {
    const response = await page.request.get('/api/v1/short-link/list?page=1&pageSize=100')
    expect(response.status()).toBe(200)
    const time = Date.parse(response.headers().date || '')
    expect(Number.isFinite(time)).toBe(true)
    return time
  }
  await page.route('**/link', async route => {
    const started = await readNavigationClock()
    let released = started
    await expect.poll(async () => { released = await readNavigationClock(); return released }, { timeout: 20_000, intervals: [250, 500] }).toBeGreaterThanOrEqual(started + 13_000)
    await attach(info, 'slow-navigation-clock', { started, released, minimumDelayMs: 13_000 })
    await route.continue()
  }, { times: 1 })
  await page.goto('/link'); await activate(page.getByTestId('bulk-create-open'))
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  const clock = await page.request.get('/api/v1/short-link/list?page=1&pageSize=100')
  expect(clock.status()).toBe(200)
  const serverTime = Date.parse(clock.headers().date || '')
  expect(Number.isFinite(serverTime)).toBe(true)
  const expiresAt = new Date(serverTime + 30_000).toISOString().replace('.000Z', 'Z')
  const item: Item = { targetUrl: 'https://example.com/deadline75/' + nonce, title: '', tags: [], customSlug: '', redirectMode: 'direct', expiresAt }
  await dialog.locator('input[type=file]').setInputFiles({ name: 'deadline.csv', mimeType: 'text/csv', buffer: Buffer.from(csv([item])) })
  await activate(page.getByTestId('bulk-create-preview'))
  const requestId = await page.getByTestId('bulk-create-request-id').innerText(), writes: unknown[] = []
  page.on('request', request => { if (new URL(request.url()).pathname === endpoint) writes.push(request.postDataJSON()) })
  await page.route('**' + endpoint, async route => {
    const response = await route.fetch()
    expect(await response.json()).toMatchObject({ code: 0, data: { requestId, createdCount: 1 } })
    await route.abort('failed')
  }, { times: 1 })
  await activate(page.getByTestId('bulk-create-submit')); await expect(page.getByTestId('bulk-create-error')).toBeVisible()
  const stored = await links(page.request); expect(stored).toHaveLength(1)
  const link = stored[0]!
  expect(link).toMatchObject({ targetUrl: item.targetUrl, expiresAt })
  await expect.poll(async () => (await (await page.request.get('/go/' + link.slug + '/preview')).json()).code, { timeout: 45_000, intervals: [100, 250, 500] }).toBe(200109)
  const publicResponse = await page.request.get('/' + link.slug, { maxRedirects: 0 })
  expect(publicResponse.status()).toBe(302)
  expect(publicResponse.headers().location).toBe('/go/' + link.slug + '?reason=expired')
  const expiredLink = { ...link, expired: true }, expiredStored = [expiredLink]
  expect(await links(page.request)).toEqual(expiredStored)
  expect(await readVisitCount(page, link.id)).toBe(0)
  const replay = page.waitForResponse(response => new URL(response.url()).pathname === endpoint)
  await activate(page.getByTestId('bulk-create-submit'))
  expect(await (await replay).json()).toMatchObject({ code: 0, data: { requestId, createdCount: 1 } })
  await expect(dialog).toBeHidden()
  expect(writes).toEqual([{ requestId, items: [item] }, { requestId, items: [item] }])
  expect(await links(page.request)).toEqual(expiredStored); expect(await readVisitCount(page, link.id)).toBe(0)

  const newItem = { ...item, targetUrl: 'https://example.com/correction75/' + nonce }
  await activate(page.getByTestId('bulk-create-open'))
  await dialog.locator('input[type=file]').setInputFiles({ name: 'expired.csv', mimeType: 'text/csv', buffer: Buffer.from(csv([newItem])) })
  await activate(page.getByTestId('bulk-create-preview'))
  const rejectedId = await page.getByTestId('bulk-create-request-id').innerText(); expect(rejectedId).not.toBe(requestId)
  const rejection = page.waitForResponse(response => new URL(response.url()).pathname === endpoint)
  await activate(page.getByTestId('bulk-create-submit'))
  expect(await (await rejection).json()).toMatchObject({ code: 200108 })
  await expect(page.getByTestId('bulk-create-error')).toContainText('expired')
  await expect(page.getByTestId('bulk-create-edit')).toBeEnabled()
  expect(await links(page.request)).toEqual(expiredStored)
  await capture(info, 'expiration-explicit-denial', page)
  await activate(page.getByTestId('bulk-create-edit'))
  const corrected = { ...newItem, expiresAt: '2030-01-01T00:00:00Z' }
  await dialog.locator('input[type=file]').setInputFiles({ name: 'corrected.csv', mimeType: 'text/csv', buffer: Buffer.from(csv([corrected])) })
  await activate(page.getByTestId('bulk-create-preview'))
  const correctedId = await page.getByTestId('bulk-create-request-id').innerText(); expect(correctedId).not.toBe(rejectedId)
  const creation = page.waitForResponse(response => new URL(response.url()).pathname === endpoint)
  await activate(page.getByTestId('bulk-create-submit'))
  expect(await (await creation).json()).toMatchObject({ code: 0, data: { requestId: correctedId, createdCount: 1 } })
  await expect(dialog).toBeHidden()
  expect(await links(page.request)).toEqual(expect.arrayContaining([expiredLink, expect.objectContaining({ targetUrl: corrected.targetUrl, expiresAt: corrected.expiresAt })]))
  expect(await links(page.request)).toHaveLength(2)
  await attach(info, 'expiration-real-deadline', { requestId, rejectedId, correctedId, expiresAt, writes, expiredPublicCode: 200109, expiredCreateCode: 200108, noDuplicateOrExpiredVisit: true })
})

// Removing actual-intent guards would either retain a revoked timed import or
// erase a legitimate empty-time/manual draft when only expiration is revoked.
test('v0.75.0 en 390px user grants retire timed drafts and preserve empty-time and replacement drafts through real authority changes', async ({ scenario }, info) => {
  test.setTimeout(180_000)
  const { page, manager, user } = scenario, original = await userGroup(manager), failures: unknown[] = [], outcomes: unknown[] = []
  try {
    await setGrants(manager, [...new Set([...original.permissions, ...required])])
    await page.goto('/link')
    for (const kind of ['timed-import', 'timed-snapshot', 'replacement', 'empty-import', 'empty-snapshot'] as const) {
      await setGrants(manager, [...new Set([...(await userGroup(manager)).permissions, ...required])]); await refreshAuthority(page, user.id, true)
      await activate(page.getByTestId('bulk-create-open'))
      const dialog = page.getByRole('dialog'), targetUrl = 'https://example.com/authority75/' + kind + '/' + randomBytes(7).toString('hex')
      const item: Item = { targetUrl, title: '', tags: [], customSlug: '', redirectMode: 'direct', expiresAt: kind.startsWith('empty') ? '' : '2030-01-01T00:00:00Z' }
      await dialog.locator('input[type=file]').setInputFiles({ name: kind + '.csv', mimeType: 'text/csv', buffer: Buffer.from(csv([item])) })
      await expect(page.getByTestId('bulk-create-imported-list').locator('li')).toHaveCount(1)
      if (kind.endsWith('snapshot') || kind === 'replacement') await activate(page.getByTestId('bulk-create-preview'))
      if (kind === 'replacement') {
        await activate(page.getByTestId('bulk-create-edit')); await activate(page.getByTestId('bulk-create-clear-import'))
        await dialog.getByRole('textbox').fill(targetUrl)
      }
      const oldId = kind.endsWith('snapshot') ? await page.getByTestId('bulk-create-request-id').innerText() : null
      await setGrants(manager, (await userGroup(manager)).permissions.filter(value => value !== 'short_link:set_expiration'))
      await refreshAuthority(page, user.id, false)
      if (kind.startsWith('timed')) {
        await expect(dialog).toBeHidden()
        await setGrants(manager, [...new Set([...(await userGroup(manager)).permissions, ...required])]); await refreshAuthority(page, user.id, true)
        await activate(page.getByTestId('bulk-create-open'))
        await expect(dialog.getByRole('textbox')).toHaveValue('')
        await expect(page.getByTestId('bulk-create-request-id')).toHaveCount(0)
        await expect(page.getByTestId('bulk-create-imported-list')).toHaveCount(0)
        await activate(page.getByTestId('bulk-create-close'))
      } else {
        await expect(dialog).toBeVisible()
        if (kind === 'replacement') await expect(dialog.getByRole('textbox')).toHaveValue(targetUrl)
        else if (oldId) await expect(page.getByTestId('bulk-create-request-id')).toHaveText(oldId)
        else await expect(page.getByTestId('bulk-create-imported-list')).toContainText('(no deadline)')
        if (!oldId) await activate(page.getByTestId('bulk-create-preview'))
        const requestId = await page.getByTestId('bulk-create-request-id').innerText()
        const path = kind === 'replacement' ? '/api/v1/short-link/batch-create' : endpoint
        const creation = page.waitForResponse(response => new URL(response.url()).pathname === path)
        await activate(page.getByTestId('bulk-create-submit'))
        expect(await (await creation).json()).toMatchObject({ code: 0, data: { requestId, createdCount: 1 } })
        await expect(dialog).toBeHidden()
        expect((await links(page.request)).find(link => link.targetUrl === targetUrl)).toMatchObject({ expiresAt: null })
      }
      outcomes.push({ kind, targetUrl, oldId })
    }
    expect(await links(page.request)).toHaveLength(3)
    await attach(info, 'expiration-live-authority', { outcomes, actualAdministratorCAS: true, originalAuthQueryFunction: true, timedRevival: false, lowPermissionDraftsSaved: 3 })
  } catch (error) { failures.push(error) } finally {
    try { await setGrants(manager, original.permissions); expect((await userGroup(manager)).permissions.slice().sort()).toEqual(original.permissions.slice().sort()) } catch (error) { failures.push(error) }
  }
  if (failures.length) throw new AggregateError(failures, 'Expiration lifecycle or exact original-grant restoration failed')
})

/** Refetches the original active query; authority comes only from the real endpoint. */
async function refreshAuthority(page: Page, userId: string, hasExpiration: boolean) {
  const response = page.waitForResponse(value => new URL(value.url()).pathname === '/api/v1/auth/me' && value.request().method() === 'GET')
  const cached = await page.evaluate(async () => {
    interface Client { refetchQueries(filter: { queryKey: string[]; exact: boolean; type: 'active' }): Promise<unknown>; getQueryData(key: string[]): unknown }
    const root = document.getElementById('app') as (HTMLElement & { __vue_app__?: { _context: { provides: Record<string, unknown> } } }) | null
    const client = Object.values(root?.__vue_app__?._context.provides ?? {}).find(value => !!value && typeof value === 'object' && 'refetchQueries' in value && typeof value.refetchQueries === 'function' && 'getQueryData' in value && typeof value.getQueryData === 'function') as Client | undefined
    if (!client) throw new Error('Existing Vue Query client unavailable; no synthetic fallback')
    await client.refetchQueries({ queryKey: ['auth', 'me'], exact: true, type: 'active' })
    return client.getQueryData(['auth', 'me'])
  })
  const payload = await (await response).json()
  expect(payload.code).toBe(0); expect(payload.data.user.id).toBe(userId)
  expect(payload.data.user.permissions.includes('short_link:set_expiration')).toBe(hasExpiration)
  expect(cached).toEqual(payload.data)
}
async function setGrants(api: APIRequestContext, permissions: string[]) { const current = await userGroup(api); await post(api, '/admin/user-group/update-permissions', { groupKey: 'user', expectedUpdatedAt: current.updatedAt, permissions }) }

/** Preserves all raw fields through both JSON-array and CSV quoting layers. */
function csv(items: readonly Item[]) { return '\uFEFFtarget_url,title,tags,custom_slug,redirect_mode,expires_at\r\n' + items.map(item => [item.targetUrl, item.title, JSON.stringify(item.tags), item.customSlug, item.redirectMode, item.expiresAt].map(value => '"' + value.replaceAll('"', '""') + '"').join(',')).join('\r\n') + '\r\n' }
async function activate(control: Locator) { if (touchPages.has(control.page())) await control.tap(); else { await control.focus(); await control.press('Enter') } }
async function frames(page: Page) { await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))) }
async function links(api: APIRequestContext) { return (await get<{ items: Link[] }>(api, '/short-link/list?page=1&pageSize=100')).items }
async function userGroup(api: APIRequestContext) { const group = (await get<{ groups: Group[] }>(api, '/admin/user-group/list')).groups.find(group => group.key === 'user'); if (!group) throw new Error('Missing user group'); return group }
async function get<T>(api: APIRequestContext, resource: string): Promise<T> { const response = await api.get('/api/v1' + resource, { timeout: 10_000 }); expect(response.status()).toBe(200); const payload = await response.json(); expect(payload.code).toBe(0); return payload.data as T }
async function post<T = unknown>(api: APIRequestContext, resource: string, data: unknown): Promise<T> { const response = await api.post('/api/v1' + resource, { data, timeout: 10_000 }); expect(response.status()).toBe(200); const payload = await response.json(); expect(payload.code).toBe(0); return payload.data as T }
async function capture(info: TestInfo, name: string, page: Page) { await expectNoHorizontalOverflow(page); const dialog = page.getByRole('dialog'); if (await dialog.isVisible()) await expect.poll(() => dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0); const output = info.outputPath(name + '.png'); await page.screenshot({ path: output, animations: 'disabled' }); await info.attach(name, { path: output, contentType: 'image/png' }) }
async function attach(info: TestInfo, name: string, value: unknown) { const output = info.outputPath(name + '.json'); await writeFile(output, JSON.stringify(value, null, 2)); await info.attach(name, { path: output, contentType: 'application/json' }) }
