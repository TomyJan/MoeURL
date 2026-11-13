import { randomBytes } from 'node:crypto'
import { expect, test as base } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Locator, Page, Request } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

type Language = 'en' | 'zh-CN'
type Policy = { updatedAt: string; enabled?: boolean; hosts?: string[]; suffixes?: string[] }
type Copy = { form: string; field: string; save: string; reload: string; enabled?: string }
type Resource = { key: string; path: string; field: 'hosts' | 'suffixes'; toggle: boolean; copy: Record<Language, Copy> }
const resources: Resource[] = [
  { key: 'exact-allow', path: '/admin/system/target-host-allowlist', field: 'hosts', toggle: true, copy: {
    en: { form: 'Allowed target host settings', field: 'Host', save: 'Save allowed hosts', reload: 'Reload allowed hosts', enabled: 'Enable target host allowlist' },
    'zh-CN': { form: '目标主机白名单设置', field: '主机', save: '保存白名单', reload: '重新加载白名单', enabled: '启用目标主机白名单' },
  } },
  { key: 'exact-deny', path: '/admin/system/target-host-denylist', field: 'hosts', toggle: false, copy: {
    en: { form: 'Blocked target host settings', field: 'Host', save: 'Save blocked hosts', reload: 'Reload blocked hosts' },
    'zh-CN': { form: '目标主机黑名单设置', field: '主机', save: '保存黑名单', reload: '重新加载黑名单' },
  } },
  { key: 'suffix-deny', path: '/admin/system/target-host-suffix-denylist', field: 'suffixes', toggle: false, copy: {
    en: { form: 'Blocked target host suffix settings', field: 'DNS suffix', save: 'Save blocked suffixes', reload: 'Reload blocked suffixes' },
    'zh-CN': { form: '目标 DNS 后缀黑名单设置', field: 'DNS 后缀', save: '保存后缀黑名单', reload: '重新加载后缀黑名单' },
  } },
  { key: 'suffix-allow', path: '/admin/system/target-host-suffix-allowlist', field: 'suffixes', toggle: true, copy: {
    en: { form: 'Allowed target DNS suffix settings', field: 'DNS suffix', save: 'Save allowed suffixes', reload: 'Reload allowed suffixes', enabled: 'Enable target DNS suffix allowlist' },
    'zh-CN': { form: '目标 DNS 后缀白名单设置', field: 'DNS 后缀', save: '保存后缀白名单', reload: '重新加载后缀白名单', enabled: '启用目标 DNS 后缀白名单' },
  } },
]
type OwnedUser = { id: string; username: string }
type Scenario = { page: Page; request: APIRequestContext; user: OwnedUser; language: Language; width: number; createUser(): Promise<OwnedUser>; write(resource: Resource, values: string[], enabled?: boolean): Promise<Policy> }
const password = 'owned-policy-confirmation681-fixture'
const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, request }, use, info) => {
    let context: BrowserContext | undefined
    const failures: unknown[] = [], users: OwnedUser[] = [], originals = new Map<Resource, Policy>(), changed = new Set<Resource>()
    const language: Language = info.title.includes(' en ') ? 'en' : 'zh-CN', width = info.title.includes('1280px') ? 1280 : 390
    async function createUser() {
      const user = (await post<{ user: OwnedUser }>(request, '/admin/user/create', { username: 'confirm681-' + randomBytes(7).toString('hex'), password, nickname: 'Confirmation fixture', groupKey: 'admin', status: 'active' })).user
      users.push(user); return user
    }
    try {
      await post(request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      for (const resource of resources) originals.set(resource, await get<Policy>(request, resource.path))
      const user = await createUser()
      context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width, height: 1000 }, hasTouch: width === 390, serviceWorkers: 'block', reducedMotion: 'reduce', colorScheme: language === 'en' ? 'light' : 'dark' })
      await context.addInitScript(language => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', language === 'en' ? 'light' : 'dark') }, language)
      const page = await context.newPage()
      await post(page.request, '/auth/login', { username: user.username, password })
      const preferences = (await get<{ preferences: { updatedAt: string | null } }>(page.request, '/user/preferences')).preferences
      await post(page.request, '/user/preferences/update', { language, theme: language === 'en' ? 'light' : 'dark', expectedUpdatedAt: preferences.updatedAt })
      await info.attach('runtime', { body: JSON.stringify({ browser: browser.version(), driverNode: process.version, language, width, height: 1000, hasTouch: width === 390, disposableDatabase: true, userId: user.id }), contentType: 'application/json' })
      await use({ page, request, user, language, width, createUser, async write(resource, values, enabled = false) { changed.add(resource); return write(request, resource, values, enabled) } })
    } catch (error) { failures.push(error) } finally {
      for (const resource of changed) { try {
        const original = originals.get(resource)!
        const restored = await write(request, resource, original[resource.field]!, original.enabled)
        expect(restored[resource.field]).toEqual(original[resource.field]); if (resource.toggle) expect(restored.enabled).toBe(original.enabled)
        expect(await get<Policy>(request, resource.path)).toEqual(restored)
      } catch (error) { failures.push(error) } }
      for (const user of users) { try { await post(request, '/admin/user/update', { id: user.id, nickname: 'Retired confirmation fixture', status: 'disabled' }) } catch (error) { failures.push(error) } }
      if (context) { try { await context.close() } catch (error) { failures.push(error) } }
    }
    if (failures.length) throw new AggregateError(failures, 'Policy confirmation or exact owned fixture restoration failed')
  }, { timeout: 120_000 }],
})
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const resource of resources.slice(0, 3)) for (const language of ['en', 'zh-CN'] as const) for (const width of [1280, 390]) {
  test('v0.68.1 ' + language + ' ' + width + 'px ' + resource.key + ' confirms a committed save after its browser response is lost', async ({ scenario }, info) => {
    test.setTimeout(90_000)
    const { page, request } = scenario, labels = resource.copy[language]
    await scenario.write(resource, ['before.example'])
    await page.goto('/admin/setting')
    const form = page.getByRole('form', { name: labels.form, exact: true }), field = form.getByRole('textbox', { name: labels.field + ' 1', exact: true })
    await expect(field).toHaveValue('before.example'); await field.fill('committed.example')
    if (resource.toggle) await form.getByLabel(labels.enabled!, { exact: true }).check()
    const endpoint = '/api/v1' + resource.path + '/update'
    let writes = 0, committed: Policy | undefined, routeError: unknown
    const count = (request: Request) => { if (new URL(request.url()).pathname === endpoint) writes++ }
    page.on('request', count)
    let processed!: () => void
    const handled = new Promise<void>(resolve => { processed = resolve })
    await page.route('**' + endpoint, async route => {
      try {
        const response = await route.fetch(), payload = await response.json()
        expect(response.status()).toBe(200); expect(payload.code).toBe(0); committed = payload.data as Policy
        expect(committed[resource.field]).toEqual(['committed.example']); if (resource.toggle) expect(committed.enabled).toBe(true)
        await route.abort('failed')
      } catch (error) { routeError = error; await route.abort('failed').catch(() => undefined) } finally { processed() }
    }, { times: 1 })
    const terminal = page.waitForEvent('requestfailed', { predicate: request => new URL(request.url()).pathname === endpoint })
    await activate(form.getByRole('button', { name: labels.save, exact: true })); await handled
    if (routeError) throw routeError
    expect((await terminal).failure()?.errorText).toBeTruthy()
    expect(await get<Policy>(request, resource.path)).toEqual(committed)
    const unknown = form.getByText(language === 'en' ? /Save result is unknown/ : /保存结果未确认/), save = form.getByRole('button', { name: labels.save, exact: true }), reload = form.getByRole('button', { name: labels.reload, exact: true })
    await expect(unknown).toBeVisible(); await expect(save).toBeDisabled(); await expect(field).toHaveValue('committed.example')
    await field.fill('newer-draft.example'); if (resource.toggle) await form.getByLabel(labels.enabled!, { exact: true }).uncheck()
    await form.evaluate(element => (element as HTMLFormElement).requestSubmit()); await renderBoundary(page)
    expect(writes).toBe(1); expect(await get<Policy>(request, resource.path)).toEqual(committed)
    await page.route('**/api/v1' + resource.path, route => route.abort('failed'), { times: 1 })
    const failed = page.waitForEvent('requestfailed', { predicate: request => new URL(request.url()).pathname === '/api/v1' + resource.path })
    await activate(reload); await failed; await expect(reload).toBeEnabled()
    await expect(unknown).toBeVisible(); await expect(save).toBeDisabled(); await expect(field).toHaveValue('newer-draft.example')
    await form.evaluate(element => { element.closest('section')!.scrollIntoView({ block: 'start' }); window.scrollBy(0, -80) })
    await expect(unknown).toBeInViewport(); await expect(reload).toBeInViewport(); await expect(save).toBeInViewport(); await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: info.outputPath(resource.key + '-unknown-' + language + '-' + width + '.png') })
    const confirmed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + resource.path)
    await activate(reload); expect((await (await confirmed).json()).data).toEqual(committed)
    await expect(unknown).toBeHidden(); await expect(field).toHaveValue('committed.example'); await expect(save).toBeEnabled()
    if (resource.toggle) await expect(form.getByLabel(labels.enabled!, { exact: true })).toBeChecked()
    await field.fill('confirmed.example')
    const next = page.waitForResponse(response => new URL(response.url()).pathname === endpoint)
    await activate(save); const response = await next, body = await response.json()
    expect(response.request().postDataJSON()).toEqual({ [resource.field]: ['confirmed.example'], ...(resource.toggle ? { enabled: true } : {}), expectedUpdatedAt: committed!.updatedAt })
    expect(body.code).toBe(0); expect(await get<Policy>(request, resource.path)).toEqual(body.data); expect(writes).toBe(2)
    await info.attach('policy-save-confirmation', { body: JSON.stringify({ resource: resource.key, actualCommitted: committed, terminal: 'failed', independentReadMatched: true, failedReloadKeptBarrier: true, newerDraftKept: true, appliedReloadMatched: true, nextExpectedUpdatedAt: committed!.updatedAt, browserWrites: writes }), contentType: 'application/json' })
    page.off('request', count)
  })
}

for (const resource of resources.slice(0, 3)) {
  test('v0.68.1 en 390px ' + resource.key + ' retires a delayed save across a real same SPA account change', async ({ scenario }, info) => {
    test.setTimeout(180_000)
    const { page } = scenario, labels = resource.copy.en, next = await scenario.createUser()
    await scenario.write(resource, ['private.example'])
    await page.goto('/admin/setting')
    const form = page.getByRole('form', { name: labels.form, exact: true })
    await expect(form.getByRole('textbox')).toHaveValue('private.example'); await form.getByRole('textbox').fill('retired.example')
    const marker = randomBytes(12).toString('hex')
    await page.evaluate(value => { (window as Window & { confirmation681?: string }).confirmation681 = value }, marker)
    let release!: () => void, processed!: () => void, held: Request | undefined, terminal: 'finished' | 'failed' | undefined, captured = false, routeError: unknown
    const gate = new Promise<void>(resolve => { release = resolve }), handled = new Promise<void>(resolve => { processed = resolve })
    const onFinished = (value: Request) => { if (value === held) terminal = 'finished' }, onFailed = (value: Request) => { if (value === held) terminal = 'failed' }
    page.on('requestfinished', onFinished); page.on('requestfailed', onFailed)
    try {
      await page.route('**/api/v1' + resource.path + '/update', async route => {
        held = route.request()
        try { const response = await route.fetch(); expect((await response.json()).code).toBe(0); captured = true; await gate; await route.fulfill({ response }) }
        catch (error) { routeError = error; await route.abort('failed').catch(() => undefined) } finally { processed() }
      }, { times: 1 })
      await activate(form.getByRole('button', { name: labels.save, exact: true })); await expect.poll(() => captured || Boolean(routeError)).toBe(true)
      if (routeError) throw routeError
      const logout = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/logout')
      await page.getByRole('button', { name: /^(打开账号菜单|Open account menu)$/ }).click()
      await page.getByTestId('console-mobile-account-menu').getByRole('menuitem', { name: /^(退出登录|Sign out)$/ }).click()
      expect((await (await logout).json()).code).toBe(0); await expect(page).toHaveURL(url => url.pathname === '/login')
      expect(await page.evaluate(() => (window as Window & { confirmation681?: string }).confirmation681)).toBe(marker)
      await scenario.write(resource, ['current.example'])
      await page.getByLabel(/^(账号|Username)$/).fill(next.username); await page.getByLabel(/^(密码|Password)$/).fill(password)
      const login = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/login')
      await page.getByRole('button', { name: /^(登录|Sign in)$/ }).click(); expect((await (await login).json()).data.user.id).toBe(next.id)
      await expect(page).not.toHaveURL(url => url.pathname === '/login')
      if (new URL(page.url()).pathname === '/') { await page.getByRole('button', { name: 'Confirmation fixture', exact: true }).click(); await expect(page).toHaveURL(/\/profile$/) }
      if (new URL(page.url()).pathname !== '/admin/setting') { await page.locator('button.console-topbar__menu').click(); await page.locator('a[href="/admin/setting"]').filter({ visible: true }).click() }
      const current = page.getByRole('form', { name: labels.form, exact: true })
      await expect(current.getByRole('textbox')).toHaveValue('current.example'); expect((await get<{ user: { id: string } }>(page.request, '/auth/me')).user.id).toBe(next.id)
      release(); await handled; if (routeError) throw routeError
      await expect.poll(() => terminal).toMatch(/^(finished|failed)$/)
      if (terminal === 'finished') {
        const response = (await held!.response())!
        expect(await response.finished()).toBeNull(); expect(response.status()).toBe(200)
        expect((await response.json()).code).toBe(0)
      } else expect(held!.failure()?.errorText).toBeTruthy()
      await renderBoundary(page); await expect(current.getByRole('textbox')).toHaveValue('current.example')
      expect(await page.evaluate(() => (window as Window & { confirmation681?: string }).confirmation681)).toBe(marker)
      await info.attach('policy-identity-terminal', { body: JSON.stringify({ resource: resource.key, from: scenario.user.id, to: next.id, terminal, runtimeRetained: true, browserBoundary: 'two frames after exact request terminal', currentValue: 'current.example' }), contentType: 'application/json' })
    } finally { release(); page.off('requestfinished', onFinished); page.off('requestfailed', onFailed) }
  })
}

test('v0.68.1 en 390px four policy drafts keep unknown barriers across actual unrelated permission removal and addition', async ({ scenario }, info) => {
  test.setTimeout(150_000)
  const { page, request } = scenario, permission = 'short_link:use_intermediate'
  const original = (await get<{ groups: { key: string; permissions: string[]; updatedAt: string }[] }>(request, '/admin/user-group/list')).groups.find(group => group.key === 'admin')!
  for (const resource of resources) await scenario.write(resource, ['before.example'])
  await page.goto('/admin/setting')
  for (const resource of resources) {
    const labels = resource.copy.en, form = page.getByRole('form', { name: labels.form, exact: true })
    await expect(form.getByRole('textbox')).toHaveValue('before.example'); await form.getByRole('textbox').fill('private.example')
    const endpoint = '/api/v1' + resource.path + '/update'
    let routeError: unknown, processed!: () => void
    const handled = new Promise<void>(resolve => { processed = resolve })
    await page.route('**' + endpoint, async route => {
      try {
        const response = await route.fetch()
        expect(response.status()).toBe(200); expect((await response.json()).code).toBe(0)
        await route.abort('failed')
      } catch (error) { routeError = error; await route.abort('failed').catch(() => undefined) } finally { processed() }
    }, { times: 1 })
    const failed = page.waitForEvent('requestfailed', { predicate: request => new URL(request.url()).pathname === endpoint })
    await activate(form.getByRole('button', { name: labels.save, exact: true })); await handled; await failed
    if (routeError) throw routeError
    await expect(form.getByText(/Save result is unknown/)).toBeVisible()
  }
  let policyReads = 0
  const count = (value: Request) => { if (resources.some(resource => new URL(value.url()).pathname === '/api/v1' + resource.path)) policyReads++ }
  page.on('request', count)
  const changed = original.permissions.includes(permission) ? original.permissions.filter(value => value !== permission) : [...original.permissions, permission]
  try {
    for (const permissions of [changed, original.permissions]) {
      await updatePermissions(request, permissions)
      await page.context().setOffline(true)
      const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/me')
      await page.context().setOffline(false); const response = await refreshed
      expect(await response.finished()).toBeNull()
      const refreshedUser = (await response.json()).data.user as { id: string; permissions: string[] }
      expect(refreshedUser.id).toBe(scenario.user.id); expect([...refreshedUser.permissions].sort()).toEqual([...permissions].sort())
      await renderBoundary(page)
      for (const resource of resources) {
        const labels = resource.copy.en, form = page.getByRole('form', { name: labels.form, exact: true })
        await expect(form.getByRole('textbox')).toHaveValue('private.example'); await expect(form.getByText(/Save result is unknown/)).toBeVisible()
        await expect(form.getByRole('button', { name: labels.save, exact: true })).toBeDisabled()
      }
      expect(policyReads).toBe(0)
    }
    await info.attach('policy-unrelated-permissions', { body: JSON.stringify({ cards: resources.map(resource => resource.key), actualServerPermissionsChanged: true, bothDirections: true, authRefreshedBy: 'real browser offline/online reconnect', sameUser: scenario.user.id, policyReads, draftsRetained: true, unknownBarriersRetained: true }), contentType: 'application/json' })
  } finally { page.off('request', count); await page.context().setOffline(false); await updatePermissions(request, original.permissions) }
})

async function activate(control: Locator) { await control.focus(); await control.press('Enter') }
async function renderBoundary(page: Page) { await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))) }
async function write(request: APIRequestContext, resource: Resource, values: string[], enabled = false) {
  const current = await get<Policy>(request, resource.path)
  return post<Policy>(request, resource.path + '/update', { [resource.field]: values, ...(resource.toggle ? { enabled } : {}), expectedUpdatedAt: current.updatedAt })
}
async function updatePermissions(request: APIRequestContext, permissions: string[]) {
  const current = (await get<{ groups: { key: string; updatedAt: string }[] }>(request, '/admin/user-group/list')).groups.find(group => group.key === 'admin')!
  await post(request, '/admin/user-group/update-permissions', { groupKey: 'admin', permissions, expectedUpdatedAt: current.updatedAt })
}
async function get<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get('/api/v1' + path, { timeout: 10_000 }); expect(response.status()).toBe(200)
  const payload = await response.json(); expect(payload.code).toBe(0); return payload.data as T
}
async function post<T = unknown>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await request.post('/api/v1' + path, { data, timeout: 10_000 }); expect(response.status()).toBe(200)
  const payload = await response.json(); expect(payload.code).toBe(0); return payload.data as T
}
