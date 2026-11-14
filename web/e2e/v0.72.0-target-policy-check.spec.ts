import { randomBytes } from 'node:crypto'
import { expect, test as base } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Locator, Page, Request } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

type Rule = { updatedAt: string; [key: string]: unknown }
type User = { id: string; username: string }
type Scenario = { page: Page; request: APIRequestContext; user: User; createUser(): Promise<User> }
const endpoint = '/api/v1/admin/system/target-policy/check'
const resources = ['target-host-denylist', 'target-host-suffix-denylist', 'target-host-allowlist', 'target-host-suffix-allowlist', 'target-ip-denylist', 'target-cidr-denylist', 'target-cidr-allowlist'].map(name => '/admin/system/' + name)
const password = 'owned-target-check72-fixture'
const text = {
  en: { form: 'Check saved target policies', heading: 'Target policy check', target: 'Full target URL', check: 'Check target', hint: /excluding unsaved drafts/, scope: /not quotas, short codes or reachability/, allowed: 'Allowed by current rules', invalid_target: 'Target format or base address is not allowed', restricted: 'Rejected by target rules', failed: 'Check failed. Your input is retained; try again.', rules: 'Blocked target host settings', add: 'Add host', save: 'Save blocked hosts' },
  'zh-CN': { form: '检查已保存目标规则', heading: '目标规则检查', target: '完整目标网址', check: '检查目标', hint: /不包含其他卡片未保存的草稿/, scope: /不检查配额、短码或目标可达性/, allowed: '当前规则允许', invalid_target: '目标格式或基础地址不允许', restricted: '被目标规则拒绝', failed: '检查失败，输入已保留，请重试。', rules: '目标主机黑名单设置', add: '添加主机', save: '保存黑名单' },
} as const

const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, request }, use, info) => {
    const failures: unknown[] = [], originals: Array<{ resource: string; value: Rule }> = [], users: User[] = []
    let context: BrowserContext | undefined
    try {
      await post(request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      for (const resource of resources) originals.push({ resource, value: await get<Rule>(request, resource) })
      for (const { resource, value } of originals) {
        const fields = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'updatedAt').map(([key, value]) => [key, Array.isArray(value) ? [] : key === 'enabled' ? false : value]))
        await post(request, resource + '/update', { ...fields, expectedUpdatedAt: value.updatedAt })
      }
      const createUser = async () => {
        const result = (await post<{ user: User }>(request, '/admin/user/create', { username: 'check72-' + randomBytes(7).toString('hex'), password, nickname: 'Owned target check fixture', groupKey: 'admin', status: 'active' })).user
        users.push(result); return result
      }
      const user = await createUser(), language = info.title.includes(' en ') ? 'en' : 'zh-CN', width = info.title.includes('1280px') ? 1280 : 390
      context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width, height: 900 }, hasTouch: width === 390, serviceWorkers: 'block', reducedMotion: 'reduce', colorScheme: language === 'en' ? 'light' : 'dark' })
      await context.addInitScript(language => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', language === 'en' ? 'light' : 'dark') }, language)
      const page = await context.newPage()
      await post(page.request, '/auth/login', { username: user.username, password })
      const preferences = (await get<{ preferences: { updatedAt: string | null } }>(page.request, '/user/preferences')).preferences
      await post(page.request, '/user/preferences/update', { language, theme: language === 'en' ? 'light' : 'dark', expectedUpdatedAt: preferences.updatedAt })
      await info.attach('runtime', { body: JSON.stringify({ browser: browser.version(), driverNode: process.version, language, width, hasTouch: width === 390, disposableDatabase: true, userId: user.id }), contentType: 'application/json' })
      await use({ page, request, user, createUser })
    } catch (error) { failures.push(error) } finally {
      for (const { resource, value } of originals) { try {
        const fields = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'updatedAt'))
        expect(await post(request, resource + '/update', { ...fields, expectedUpdatedAt: (await get<Rule>(request, resource)).updatedAt })).toMatchObject(fields)
      } catch (error) { failures.push(error) } }
      for (const user of users) { try { await post(request, '/admin/user/update', { id: user.id, nickname: 'Retired target check fixture', status: 'disabled' }) } catch (error) { failures.push(error) } }
      try { await context?.close() } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, 'Target check scenario or seven-resource restoration failed')
  }, { timeout: 120_000 }],
})
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const language of ['en', 'zh-CN'] as const) for (const width of [1280, 390]) {
  test('v0.72.0 ' + language + ' ' + width + 'px checks saved rules without creating links', async ({ scenario }, info) => {
    test.setTimeout(120_000)
    const { page, request, user } = scenario, labels = text[language]
    let checks = 0
    page.on('request', request => { if (new URL(request.url()).pathname === endpoint) checks++ })
    await page.goto('/admin/setting')
    const card = page.locator('.target-policy-check'), form = page.getByRole('form', { name: labels.form, exact: true })
    const input = form.getByRole('textbox', { name: labels.target, exact: true }), submit = form.getByRole('button', { name: labels.check, exact: true })
    await expect(submit).toBeEnabled(); expect(checks).toBe(0)
    await expect(card.getByText(labels.hint)).toBeVisible(); await expect(card.getByText(labels.scope)).toBeVisible()
    expect(await form.evaluate(element => element.parentElement?.closest('form') === null)).toBe(true)
    const rules = page.getByRole('form', { name: labels.rules, exact: true })
    await expect(rules.getByRole('button', { name: labels.add, exact: true })).toBeEnabled()
    await activate(rules.getByRole('button', { name: labels.add, exact: true }))
    await rules.getByRole('textbox').fill('blocked.example')
    expect((await get<{ hosts: string[] }>(request, resources[0]!)).hosts).toEqual([])
    const check = async (targetUrl: string, outcome: 'allowed' | 'invalid_target' | 'restricted') => {
      const before = await snapshot(page.request, user.id)
      await input.fill(targetUrl)
      const received = page.waitForResponse(value => new URL(value.url()).pathname === endpoint)
      await activate(submit)
      const response = await received
      expect(response.status()).toBe(200); expect(response.headers()['cache-control']).toBe('no-store')
      expect(response.request().postDataJSON()).toEqual({ targetUrl })
      expect((await response.json()).data).toEqual({ outcome })
      await expect(form.getByText(labels[outcome], { exact: true })).toBeVisible()
      expect(await snapshot(page.request, user.id)).toEqual(before)
    }
    // An unsaved rule in a different card must not affect this action.
    await check('https://blocked.example/private?secret=check72', 'allowed')
    await input.fill('https://edited.example/')
    await expect(form.getByText(labels.allowed, { exact: true })).toBeHidden()
    const saved = page.waitForResponse(value => new URL(value.url()).pathname === '/api/v1' + resources[0] + '/update')
    await activate(rules.getByRole('button', { name: labels.save, exact: true }))
    expect((await (await saved).json()).code).toBe(0)
    await check('https://blocked.example/private?secret=check72', 'restricted')
    await check('https://127.0.0.1/not-allowed', 'invalid_target')
    await check('https://allowed.example/' + 'a'.repeat(1200), 'allowed')
    await card.evaluate(element => { element.scrollIntoView({ block: 'start' }); window.scrollBy(0, -100) })
    await expect(card.getByRole('heading', { name: labels.heading })).toBeInViewport()
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: info.outputPath('check-heading-' + language + '-' + width + '.png') })
    await submit.scrollIntoViewIfNeeded(); await expect(submit).toBeInViewport({ ratio: 1 })
    if (width === 390) {
      await expect.poll(() => submit.evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) })).toBe(true)
      await submit.tap({ trial: true, scroll: 'none' })
      await info.attach('check-touch-reachability', { body: JSON.stringify({ width, hasTouch: true, centerHit: true, touchTrial: true }), contentType: 'application/json' })
    }
    await page.screenshot({ path: info.outputPath('check-actions-' + language + '-' + width + '.png') })
    await page.route('**' + endpoint, route => route.abort('failed'), { times: 1 })
    const beforeFailure = checks, target = 'https://private.example/?secret=check72'
    await input.fill(target); await activate(submit)
    await expect(form.getByText(labels.failed, { exact: true })).toBeVisible(); await expect(input).toHaveValue(target)
    await frames(page); expect(checks).toBe(beforeFailure + 1)
    expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain('secret=check72')
    await page.reload(); await expect(input).toHaveValue(''); await expect(form.getByRole('alert').filter({ hasText: /\S/ })).toHaveCount(0)
    expect(checks).toBe(beforeFailure + 1)
  })
}

test('v0.72.0 en 390px retires a delayed check across a real same SPA account change', async ({ scenario }, info) => {
  test.setTimeout(180_000)
  const { page, user } = scenario, next = await scenario.createUser(), labels = text.en
  await page.goto('/admin/setting')
  const form = page.getByRole('form', { name: labels.form, exact: true })
  await expect(form.getByRole('textbox')).toBeEnabled(); await form.getByRole('textbox').fill('https://old.example/')
  const marker = randomBytes(12).toString('hex')
  await page.evaluate(value => { (window as Window & { checkIdentity72?: string }).checkIdentity72 = value }, marker)
  let release!: () => void, processed!: () => void, held: Request | undefined, terminal: 'finished' | 'failed' | undefined, captured = false, routeError: unknown
  const gate = new Promise<void>(resolve => { release = resolve }), handled = new Promise<void>(resolve => { processed = resolve })
  const finished = (value: Request) => { if (value === held) terminal = 'finished' }, failed = (value: Request) => { if (value === held) terminal = 'failed' }
  page.on('requestfinished', finished); page.on('requestfailed', failed)
  try {
    await page.route('**' + endpoint, async route => {
      held = route.request()
      try { const response = await route.fetch(); expect((await response.json()).data).toEqual({ outcome: 'allowed' }); captured = true; await gate; await route.fulfill({ response }) }
      catch (error) { routeError = error; await route.abort('failed').catch(() => undefined) } finally { processed() }
    }, { times: 1 })
    await activate(form.getByRole('button', { name: labels.check, exact: true }))
    await expect.poll(() => captured || Boolean(routeError)).toBe(true); if (routeError) throw routeError
    const logout = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/logout')
    await page.getByRole('button', { name: /^(打开账号菜单|Open account menu)$/ }).click()
    await page.getByTestId('console-mobile-account-menu').getByRole('menuitem', { name: /^(退出登录|Sign out)$/ }).click()
    expect((await (await logout).json()).code).toBe(0); await expect(page).toHaveURL(url => url.pathname === '/login')
    await page.getByLabel(/^(账号|Username)$/).fill(next.username); await page.getByLabel(/^(密码|Password)$/).fill(password)
    const login = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/login')
    await page.getByRole('button', { name: /^(登录|Sign in)$/ }).click(); expect((await (await login).json()).data.user.id).toBe(next.id)
    await expect(page).not.toHaveURL(url => url.pathname === '/login')
    if (new URL(page.url()).pathname === '/') { await page.getByRole('button', { name: 'Owned target check fixture', exact: true }).click(); await expect(page).toHaveURL(/\/profile$/) }
    if (new URL(page.url()).pathname !== '/admin/setting') { await page.locator('button.console-topbar__menu').click(); await page.locator('a[href="/admin/setting"]').filter({ visible: true }).click() }
    await expect(form.getByRole('textbox')).toHaveValue(''); await form.getByRole('textbox').fill('https://127.0.0.1/new-account')
    await activate(form.getByRole('button', { name: labels.check, exact: true })); await expect(form.getByText(labels.invalid_target, { exact: true })).toBeVisible()
    release(); await handled; if (routeError) throw routeError
    await expect.poll(() => terminal).toMatch(/^(finished|failed)$/)
    if (terminal === 'finished') { const response = (await held!.response())!; expect(await response.finished()).toBeNull(); expect((await response.json()).data).toEqual({ outcome: 'allowed' }) }
    else expect(held!.failure()?.errorText).toBeTruthy()
    await frames(page)
    await expect(form.getByRole('textbox')).toHaveValue('https://127.0.0.1/new-account')
    await expect(form.getByText(labels.invalid_target, { exact: true })).toBeVisible(); await expect(form.getByText(labels.allowed, { exact: true })).toBeHidden()
    expect(await page.evaluate(() => (window as Window & { checkIdentity72?: string }).checkIdentity72)).toBe(marker)
    expect((await get<{ user: User }>(page.request, '/auth/me')).user.id).toBe(next.id)
    await info.attach('check-identity-terminal', { body: JSON.stringify({ from: user.id, to: next.id, terminal, sameRuntime: true, browserBoundary: 'two frames after exact request terminal', currentOutcome: 'invalid_target' }), contentType: 'application/json' })
  } finally { release(); page.off('requestfinished', finished); page.off('requestfailed', failed) }
})

async function activate(control: Locator) { await control.focus(); await control.press('Enter') }
async function frames(page: Page) { await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))) }
async function snapshot(request: APIRequestContext, actor: string) {
  const links = await get<{ items: unknown[] }>(request, '/short-link/list?page=1&pageSize=100')
  const audits = await get<{ items: unknown[] }>(request, '/admin/audit/list?actorId=' + actor + '&resourceType=system_setting&action=settings_change')
  return { links: links.items, audits: audits.items }
}
async function get<T>(request: APIRequestContext, resource: string): Promise<T> {
  const response = await request.get('/api/v1' + resource, { timeout: 10_000 }); expect(response.status()).toBe(200)
  const payload = await response.json(); expect(payload.code).toBe(0); return payload.data as T
}
async function post<T = unknown>(request: APIRequestContext, resource: string, data: unknown): Promise<T> {
  const response = await request.post('/api/v1' + resource, { data, timeout: 10_000 }); expect(response.status()).toBe(200)
  const payload = await response.json(); expect(payload.code).toBe(0); return payload.data as T
}
