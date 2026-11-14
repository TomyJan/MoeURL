import { randomBytes } from 'node:crypto'
import { expect, test as base } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Locator, Page, Request } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

type Rule = { updatedAt: string; [key: string]: unknown }
type User = { id: string; username: string }
type Scenario = { page: Page; request: APIRequestContext; user: User; createUser(): Promise<User> }
const endpoint = '/api/v1/admin/system/target-policy/check-batch'
const resources = ['target-host-denylist', 'target-host-suffix-denylist', 'target-host-allowlist', 'target-host-suffix-allowlist', 'target-ip-denylist', 'target-cidr-denylist', 'target-cidr-allowlist'].map(name => '/admin/system/' + name)
const password = 'owned-batch-check73-fixture'
const text = {
  en: { form: 'Check saved target rules in a batch', heading: 'Batch target rule check', target: 'Target URLs (one per line)', check: 'Check these targets', results: 'Results by line', row: (index: number) => 'Line ' + index, allowed: 'Allowed by current rules', invalid_target: 'Invalid target or disallowed base address', restricted: 'Rejected by target rules', failed: 'Check failed. Your input is kept; please retry.', invalid: /Enter 1–20 nonempty lines/, singleForm: 'Check saved target policies', singleTarget: 'Full target URL', singleCheck: 'Check target', rules: 'Blocked target host settings', add: 'Add host', save: 'Save blocked hosts' },
  'zh-CN': { form: '批量检查已保存目标规则', heading: '批量目标规则检查', target: '目标网址（每行一个）', check: '检查这批目标', results: '逐行检查结果', row: (index: number) => '第 ' + index + ' 行', allowed: '当前规则允许', invalid_target: '目标格式或基础地址不允许', restricted: '被目标规则拒绝', failed: '检查失败，输入已保留，请重试。', invalid: /请输入 1–20 个非空行/, singleForm: '检查已保存目标规则', singleTarget: '完整目标网址', singleCheck: '检查目标', rules: '目标主机黑名单设置', add: '添加主机', save: '保存黑名单' },
} as const

const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, request }, use, info) => {
    const failures: unknown[] = [], originals: Array<{ resource: string; value: Rule }> = [], users: User[] = []
    let context: BrowserContext | undefined
    try {
      await post(request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      for (const resource of resources) {
        const value = await get<Rule>(request, resource); originals.push({ resource, value })
        const empty = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'updatedAt').map(([key, field]) => [key, Array.isArray(field) ? [] : field]))
        await post(request, resource + '/update', { ...empty, expectedUpdatedAt: value.updatedAt })
      }
      const createUser = async () => {
        const result = (await post<{ user: User }>(request, '/admin/user/create', { username: 'check73-' + randomBytes(8).toString('hex'), password, nickname: 'Owned batch check fixture', groupKey: 'admin', status: 'active' })).user
        users.push(result); return result
      }
      const user = await createUser(), language = info.title.includes(' en ') ? 'en' : 'zh-CN', width = info.title.includes('1280px') ? 1280 : 390
      context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width, height: 900 }, hasTouch: width === 390, serviceWorkers: 'block', reducedMotion: 'reduce', colorScheme: language === 'en' ? 'light' : 'dark' })
      await context.addInitScript(language => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', language === 'en' ? 'light' : 'dark') }, language)
      const page = await context.newPage()
      await post(page.request, '/auth/login', { username: user.username, password })
      const preferences = (await get<{ preferences: { updatedAt: string | null } }>(page.request, '/user/preferences')).preferences
      await post(page.request, '/user/preferences/update', { language, theme: language === 'en' ? 'light' : 'dark', expectedUpdatedAt: preferences.updatedAt })
      await info.attach('runtime', { body: JSON.stringify({ browser: browser.version(), driverNode: process.version, language, width, disposableDatabase: true, userId: user.id }), contentType: 'application/json' })
      await use({ page, request, user, createUser })
    } catch (error) { failures.push(error) } finally {
      for (const { resource, value } of originals) { try {
        const fields = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'updatedAt'))
        expect(await post(request, resource + '/update', { ...fields, expectedUpdatedAt: (await get<Rule>(request, resource)).updatedAt })).toMatchObject(fields)
      } catch (error) { failures.push(error) } }
      for (const user of users) { try { await post(request, '/admin/user/update', { id: user.id, nickname: 'Retired batch check fixture', status: 'disabled' }) } catch (error) { failures.push(error) } }
      try { await context?.close() } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, 'Batch scenario or saved-rule restoration failed')
  }, { timeout: 120_000 }],
})
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const language of ['en', 'zh-CN'] as const) for (const width of [1280, 390]) {
  test('v0.73.0 ' + language + ' ' + width + 'px preserves batch positions and independent saved-rule checks', async ({ scenario }, info) => {
    test.setTimeout(180_000)
    const { page, request, user } = scenario, labels = text[language]
    let checks = 0
    page.on('request', request => { if (new URL(request.url()).pathname === endpoint) checks++ })
    await page.goto('/admin/setting')
    const card = page.locator('.target-policy-batch-check'), form = page.getByRole('form', { name: labels.form, exact: true })
    const input = form.getByRole('textbox', { name: labels.target, exact: true }), submit = form.getByRole('button', { name: labels.check, exact: true })
    const results = form.getByRole('list', { name: labels.results, exact: true })
    await expect(submit).toBeEnabled(); expect(checks).toBe(0)
    await expect(card.getByRole('heading', { name: labels.heading, exact: true })).toBeVisible()
    expect(await form.evaluate(element => element.parentElement?.closest('form') === null)).toBe(true)
    const check = async (targets: string[], outcomes: Array<'allowed' | 'invalid_target' | 'restricted'>) => {
      const before = await snapshot(page.request, user.id)
      await input.fill(targets.join('\n'))
      const received = page.waitForResponse(value => new URL(value.url()).pathname === endpoint)
      await activate(submit)
      const response = await received
      expect(response.status()).toBe(200); expect(response.headers()['cache-control']).toBe('no-store')
      expect(response.request().postDataJSON()).toEqual({ targetUrls: targets })
      expect((await response.json()).data).toEqual({ items: outcomes.map((outcome, index) => ({ index: index + 1, outcome })) })
      const rows = results.getByRole('listitem'); await expect(rows).toHaveCount(targets.length)
      for (let index = 0; index < outcomes.length; index++) {
        await expect(rows.nth(index).getByText(labels.row(index + 1), { exact: true })).toBeVisible()
        await expect(rows.nth(index).getByText(labels[outcomes[index]!], { exact: true })).toBeVisible()
      }
      expect(await results.textContent()).not.toContain('https://')
      expect(await snapshot(page.request, user.id)).toEqual(before)
    }
    await check(['https://allowed.example/private?secret=batch73'], ['allowed'])
    await card.screenshot({ path: info.outputPath('batch-one-' + language + '-' + width + '.png') })
    const single = page.getByRole('form', { name: labels.singleForm, exact: true }), singleInput = single.getByRole('textbox', { name: labels.singleTarget, exact: true })
    await singleInput.fill('https://single.example/')
    await activate(single.getByRole('button', { name: labels.singleCheck, exact: true }))
    await expect(single.getByText(labels.allowed, { exact: true })).toBeVisible()
    const rules = page.getByRole('form', { name: labels.rules, exact: true })
    await activate(rules.getByRole('button', { name: labels.add, exact: true })); await rules.getByRole('textbox').fill('blocked.example')
    expect((await get<{ hosts: string[] }>(request, resources[0]!)).hosts).toEqual([])
    await check(['https://blocked.example/', 'https://127.0.0.1/', 'https://blocked.example/'], ['allowed', 'invalid_target', 'allowed'])
    const saved = page.waitForResponse(value => new URL(value.url()).pathname === '/api/v1' + resources[0] + '/update')
    await activate(rules.getByRole('button', { name: labels.save, exact: true })); expect((await (await saved).json()).code).toBe(0)
    await check(['https://allowed.example/' + 'a'.repeat(1200)], ['allowed']); await expectNoHorizontalOverflow(page)
    const targets = ['https://allowed.example/', 'https://127.0.0.1/', 'https://blocked.example/', ...Array.from({ length: 17 }, () => 'https://allowed.example/')]
    await check(targets, ['allowed', 'invalid_target', 'restricted', ...Array.from({ length: 17 }, () => 'allowed' as const)])
    await expect(singleInput).toHaveValue('https://single.example/'); await expect(single.getByText(labels.allowed, { exact: true })).toBeVisible()
    await singleInput.fill('https://other.example/'); await expect(single.getByText(labels.allowed, { exact: true })).toBeHidden(); await expect(results.getByRole('listitem')).toHaveCount(20)
    await expectNoHorizontalOverflow(page); await expect(submit).toBeEnabled(); await submit.focus(); await expect(submit).toBeFocused()
    await card.screenshot({ path: info.outputPath('batch-twenty-' + language + '-' + width + '.png') })
    await input.fill('https://edited.example/'); await expect(results).toHaveCount(0)
    const noSend = checks; await input.fill('https://allowed.example/\n'); await activate(submit); await expect(form.getByText(labels.invalid)).toBeVisible()
    await frames(page); expect(checks).toBe(noSend)
    await page.route('**' + endpoint, route => route.abort('failed'), { times: 1 })
    const privateTarget = 'https://private.example/?secret=batch73'
    await input.fill(privateTarget); await activate(submit); await expect(form.getByText(labels.failed, { exact: true })).toBeVisible(); await expect(input).toHaveValue(privateTarget)
    await frames(page); expect(checks).toBe(noSend + 1)
    expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain('secret=batch73')
    await page.reload(); await expect(input).toHaveValue(''); await expect(results).toHaveCount(0); expect(checks).toBe(noSend + 1)
  })
}

for (const language of ['en', 'zh-CN'] as const) {
  test('v0.73.0 ' + language + ' 390px reaches the twenty-line batch action by touch after dismissing a saved-rule notification', async ({ scenario }, info) => {
    test.setTimeout(90_000)
    const { page, user } = scenario, labels = text[language]
    await page.goto('/admin/setting')
    const rules = page.getByRole('form', { name: labels.rules, exact: true })
    await activate(rules.getByRole('button', { name: labels.add, exact: true })); await rules.getByRole('textbox').fill('blocked.example')
    const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + resources[0] + '/update')
    await activate(rules.getByRole('button', { name: labels.save, exact: true })); expect((await (await saved).json()).code).toBe(0)
    const toast = page.locator('[data-sonner-toast]')
    await expect(toast).toHaveCount(1)
    await toast.getByRole('button', { name: language === 'en' ? 'Dismiss notification' : '关闭提示', exact: true }).tap()
    await expect(toast).toHaveCount(0)
    const form = page.getByRole('form', { name: labels.form, exact: true }), submit = form.getByRole('button', { name: labels.check, exact: true })
    const targets = Array.from({ length: 20 }, () => 'https://allowed.example/')
    await form.getByRole('textbox').fill(targets.join('\n'))
    const before = await snapshot(page.request, user.id)
    for (let attempt = 0; attempt < 2; attempt++) {
      await submit.scrollIntoViewIfNeeded(); await expect(submit).toBeInViewport({ ratio: 1 })
      await expect.poll(() => submit.evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) })).toBe(true)
      const response = page.waitForResponse(value => new URL(value.url()).pathname === endpoint)
      await submit.tap({ scroll: 'none' })
      expect((await (await response).json()).data).toEqual({ items: targets.map((_, index) => ({ index: index + 1, outcome: 'allowed' })) })
      await expect(form.getByRole('listitem')).toHaveCount(20)
    }
    expect(await snapshot(page.request, user.id)).toEqual(before)
    await expectNoHorizontalOverflow(page)
    await submit.scrollIntoViewIfNeeded(); await expect(submit).toBeInViewport({ ratio: 1 })
    await info.attach('batch-touch-reachability', { body: JSON.stringify({ language, width: 390, hasTouch: true, rows: 20, notificationDismissedByUser: true, centerHit: true, actualTouchRequests: 2, noCSSOrDOMRemoval: true }), contentType: 'application/json' })
    await page.screenshot({ path: info.outputPath('batch-touch-' + language + '-390.png') })
  })
}

test('v0.73.0 en 390px retires a delayed batch across a real same SPA account change', async ({ scenario }, info) => {
  test.setTimeout(180_000)
  const { page } = scenario, next = await scenario.createUser(), labels = text.en
  await page.goto('/admin/setting')
  const form = page.getByRole('form', { name: labels.form, exact: true })
  await expect(form.getByRole('textbox')).toBeEnabled(); await form.getByRole('textbox').fill('https://old.example/')
  const marker = randomBytes(12).toString('hex')
  await page.evaluate(value => { (window as Window & { batchIdentity73?: string }).batchIdentity73 = value }, marker)
  let release!: () => void, processed!: () => void, held: Request | undefined, terminal: 'finished' | 'failed' | undefined, captured = false, routeError: unknown
  const gate = new Promise<void>(resolve => { release = resolve }), handled = new Promise<void>(resolve => { processed = resolve })
  const finished = (value: Request) => { if (value === held) terminal = 'finished' }, failed = (value: Request) => { if (value === held) terminal = 'failed' }
  page.on('requestfinished', finished); page.on('requestfailed', failed)
  try {
    await page.route('**' + endpoint, async route => {
      held = route.request()
      try { const response = await route.fetch(); expect((await response.json()).data).toEqual({ items: [{ index: 1, outcome: 'allowed' }] }); captured = true; await gate; await route.fulfill({ response }) }
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
    if (new URL(page.url()).pathname === '/') { await page.getByRole('button', { name: 'Owned batch check fixture', exact: true }).click(); await expect(page).toHaveURL(/\/profile$/) }
    if (new URL(page.url()).pathname !== '/admin/setting') { await page.locator('button.console-topbar__menu').click(); await page.locator('a[href="/admin/setting"]').filter({ visible: true }).click() }
    await expect(form.getByRole('textbox')).toHaveValue(''); await form.getByRole('textbox').fill('https://127.0.0.1/new-account')
    await activate(form.getByRole('button', { name: labels.check, exact: true })); await expect(form.getByText(labels.invalid_target, { exact: true })).toBeVisible()
    release(); await handled; if (routeError) throw routeError
    await expect.poll(() => terminal).toMatch(/^(finished|failed)$/)
    if (terminal === 'finished') { const response = (await held!.response())!; expect(await response.finished()).toBeNull(); expect((await response.json()).data).toEqual({ items: [{ index: 1, outcome: 'allowed' }] }) }
    else expect(held!.failure()?.errorText).toBeTruthy()
    await frames(page)
    await expect(form.getByRole('textbox')).toHaveValue('https://127.0.0.1/new-account'); await expect(form.getByText(labels.invalid_target, { exact: true })).toBeVisible(); await expect(form.getByText(labels.allowed, { exact: true })).toHaveCount(0)
    expect(await page.evaluate(() => (window as Window & { batchIdentity73?: string }).batchIdentity73)).toBe(marker)
    await info.attach('identity-continuation', { body: JSON.stringify({ oldUser: scenario.user.id, newUser: next.id, sameDocumentMarker: marker, terminal, originalResponseAllowed: captured, guard: 'two frames after exact request terminal' }), contentType: 'application/json' })
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
