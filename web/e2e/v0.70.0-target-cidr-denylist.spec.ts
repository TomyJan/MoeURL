import { randomBytes } from 'node:crypto'
import { expect, test as base } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Locator, Page, Request } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

type Policy = { prefixes: string[]; updatedAt: string }
type Rule = { updatedAt: string; [key: string]: unknown }
type Link = { id: string; slug: string; targetUrl: string }
type Scenario = { page: Page; request: APIRequestContext; userId: string }
const path = '/admin/system/target-cidr-denylist'
const others = ['/admin/system/target-ip-denylist', '/admin/system/target-host-denylist', '/admin/system/target-host-suffix-denylist', '/admin/system/target-host-allowlist', '/admin/system/target-host-suffix-allowlist']
const password = 'owned-target-cidr70-fixture'
const text = {
  en: { form: 'Blocked target IP network settings', prefix: 'CIDR prefix', add: 'Add network', remove: 'Remove network', clear: 'Clear list', reload: 'Reload blocked networks', save: 'Save blocked networks', saved: 'Blocked target IP networks saved.', target: 'Enter link', create: 'Create short link', denied: /site restricts this target host/, invalid: /Check CIDR syntax, canonical duplicates/, conflict: /Another request changed the network list/, unknown: /Save result is unknown/, scope: /does not resolve DNS/, wide: /\/0 blocks all new targets/ },
  'zh-CN': { form: '目标 IP 网段黑名单设置', prefix: 'CIDR 网段', add: '添加网段', remove: '删除网段', clear: '清空列表', reload: '重新加载网段黑名单', save: '保存网段黑名单', saved: '目标 IP 网段黑名单已保存。', target: '输入链接', create: '创建短链', denied: /目标主机被站点规则限制/, invalid: /请检查网段格式、规范重复项/, conflict: /网段黑名单已被其他请求修改/, unknown: /保存结果未确认/, scope: /不解析 DNS/, wide: /\/0 会拒绝对应地址族的全部新目标/ },
} as const

const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, request }, use, info) => {
    const failures: unknown[] = [], originals: Array<{ resource: string; value: Rule }> = []
    let context: BrowserContext | undefined, page: Page | undefined, user: { id: string; username: string } | undefined
    try {
      await post(request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      // Capture every resource before changing any member of the six-resource gate.
      for (const resource of [path, ...others]) originals.push({ resource, value: await get<Rule>(request, resource) })
      for (const original of originals) {
        const fields = Object.fromEntries(Object.entries(original.value).filter(([key]) => key !== 'updatedAt').map(([key, value]) => [key, Array.isArray(value) ? [] : key === 'enabled' ? false : value]))
        await post(request, original.resource + '/update', { ...fields, expectedUpdatedAt: original.value.updatedAt })
      }
      user = (await post<{ user: { id: string; username: string } }>(request, '/admin/user/create', { username: 'cidr70-' + randomBytes(7).toString('hex'), password, nickname: 'Owned CIDR fixture', groupKey: 'admin', status: 'active' })).user
      const language = info.title.includes(' en ') ? 'en' : 'zh-CN', width = info.title.includes('1280px') ? 1280 : 390
      context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width, height: 900 }, hasTouch: width === 390, serviceWorkers: 'block', reducedMotion: 'reduce', colorScheme: language === 'en' ? 'light' : 'dark' })
      await context.addInitScript(language => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', language === 'en' ? 'light' : 'dark') }, language)
      page = await context.newPage()
      await post(page.request, '/auth/login', { username: user.username, password })
      const preference = (await get<{ preferences: { updatedAt: string | null } }>(page.request, '/user/preferences')).preferences
      await post(page.request, '/user/preferences/update', { language, theme: language === 'en' ? 'light' : 'dark', expectedUpdatedAt: preference.updatedAt })
      await info.attach('runtime', { body: JSON.stringify({ browser: browser.version(), driverNode: process.version, language, width, hasTouch: width === 390, disposableDatabase: true, userId: user.id }), contentType: 'application/json' })
      await use({ page, request, userId: user.id })
    } catch (error) { failures.push(error) } finally {
      for (const original of originals) { try {
        const fields = Object.fromEntries(Object.entries(original.value).filter(([key]) => key !== 'updatedAt'))
        const current = await get<Rule>(request, original.resource)
        expect(await post(request, original.resource + '/update', { ...fields, expectedUpdatedAt: current.updatedAt })).toMatchObject(fields)
      } catch (error) { failures.push(error) } }
      if (page && user) { try {
        expect((await post<{ user: { id: string } }>(page.request, '/auth/login', { username: user.username, password })).user.id).toBe(user.id)
        for (const link of await ownLinks(page.request)) await post(request, '/admin/short-link/delete', { id: link.id })
      } catch (error) { failures.push(error) } }
      if (user) { try { await post(request, '/admin/user/update', { id: user.id, nickname: 'Retired CIDR fixture', status: 'disabled' }) } catch (error) { failures.push(error) } }
      try { await context?.close() } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, 'CIDR scenario or exact six-resource restoration failed')
  }, { timeout: 120_000 }],
})
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const language of ['en', 'zh-CN'] as const) for (const width of [1280, 390]) {
  test('v0.70.0 ' + language + ' ' + width + 'px CIDR identity, canonical save and confirmation barriers', async ({ scenario }, info) => {
    test.setTimeout(180_000)
    const { page, request } = scenario, labels = text[language]
    const historical = await create(page, 'https://192.0.2.9/historical', labels)
    await page.goto('/admin/setting')
    const card = page.locator('.target-cidr-policy'), form = page.getByRole('form', { name: labels.form, exact: true })
    const action = (name: string) => form.getByRole('button', { name, exact: true })
    await expect(action(labels.add)).toBeEnabled(); await expect(form.getByRole('textbox')).toHaveCount(0)
    await expect(card.getByText(labels.scope)).toBeVisible(); await expect(card.getByText(labels.wide)).toBeVisible()
    expect(await form.evaluate(element => element.parentElement?.closest('form') === null)).toBe(true)
    await addPrefix(form, labels, ' 2001:0DB8:1234::9/48 '); await addPrefix(form, labels, '192.0.2.129/24')
    const response = page.waitForResponse(value => new URL(value.url()).pathname === '/api/v1' + path + '/update')
    await activate(action(labels.save))
    const saved = await response
    expect(saved.request().postDataJSON()).toMatchObject({ prefixes: [' 2001:0DB8:1234::9/48 ', '192.0.2.129/24'] })
    expect((await saved.json()).code).toBe(0)
    await expect(page.getByText(labels.saved, { exact: true })).toBeVisible()
    await expect(form.getByRole('textbox').nth(0)).toHaveValue('192.0.2.0/24')
    await expect(form.getByRole('textbox').nth(1)).toHaveValue('2001:db8:1234::/48')
    const audits = (await get<{ items: { actorId: string; resourceId: string; changedFields: string[] }[] }>(request, '/admin/audit/list?actorId=' + scenario.userId + '&resourceType=system_setting&action=settings_change')).items
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ actorId: scenario.userId, resourceId: 'security.target_cidr_denylist', changedFields: ['security.target_cidr_denylist'] })
    expect(JSON.stringify(audits)).not.toContain('192.0.2.')
    await card.evaluate(element => { element.scrollIntoView({ block: 'start' }); window.scrollBy(0, -100) })
    await expect(card.getByRole('heading')).toBeInViewport(); await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: info.outputPath('cidr-heading-' + language + '-' + width + '.png') })
    if (width === 390) {
      for (const name of [labels.reload, labels.save]) {
        const control = action(name)
        await expect(control).toBeEnabled(); await control.evaluate(element => element.scrollIntoView({ block: 'center' }))
        await expect(control).toBeInViewport({ ratio: 1 })
        await expect.poll(() => control.evaluate(element => { const box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) })).toBe(true)
        await control.tap({ trial: true, scroll: 'none' })
      }
      await info.attach('cidr-touch-reachability', { body: JSON.stringify({ width, hasTouch: true, wholeViewport: true, centerHit: true, touchTrial: true }), contentType: 'application/json' })
    }
    await page.screenshot({ path: info.outputPath('cidr-actions-' + language + '-' + width + '.png') })
    for (const invalid of ['192.0.2.9/24', '::ffff:192.0.2.0/120']) {
      await addPrefix(form, labels, invalid); await activate(action(labels.save))
      await expect(form.getByText(labels.invalid)).toBeVisible()
      expect((await get<Policy>(request, path)).prefixes).toEqual(['192.0.2.0/24', '2001:db8:1234::/48'])
      await activate(action(labels.remove + ' 3'))
    }
    await page.reload(); await expect(form.getByRole('textbox').nth(0)).toHaveValue('192.0.2.0/24')
    for (const target of ['https://192.0.2.9/new', 'https://[::ffff:192.0.2.9]/new', 'https://[2001:db8:1234::1]/new']) await refuse(page, target, labels)
    await create(page, 'https://198.51.100.9/outside', labels)
    await create(page, 'https://allowed.example/192.0.2.9', labels)
    await create(page, 'https://[::192.0.2.9]/native-compatible', labels)
    const old = await request.get('/' + historical.slug, { maxRedirects: 0 })
    expect(old.status()).toBe(302); expect(old.headers().location).toBe(historical.targetUrl)

    // The two /0 rules act on different families, even for mapped targets.
    for (const prefix of ['::/0', '0.0.0.0/0']) {
      await page.goto('/admin/setting'); await expect(action(labels.clear)).toBeEnabled()
      await activate(action(labels.clear)); await addPrefix(form, labels, prefix); await activate(action(labels.save))
      await expect(page.getByText(labels.saved, { exact: true })).toBeVisible()
      expect((await get<Policy>(request, path)).prefixes).toEqual([prefix])
      const ipv4 = 'https://192.0.2.23/wide', mapped = 'https://[::ffff:192.0.2.23]/wide', ipv6 = 'https://[2001:db8::23]/wide'
      for (const target of prefix === '::/0' ? [ipv4, mapped] : [ipv6]) await create(page, target, labels)
      for (const target of prefix === '::/0' ? [ipv6, 'https://[::192.0.2.23]/wide'] : [ipv4, mapped]) await refuse(page, target, labels)
    }

    await page.goto('/admin/setting'); await expect(action(labels.save)).toBeEnabled()
    await form.getByRole('textbox').fill('198.51.100.9/24')
    await write(request, ['203.0.113.0/24']); await activate(action(labels.save))
    await expect(form.getByText(labels.conflict)).toBeVisible(); await expect(action(labels.save)).toBeDisabled()
    await expect(form.getByRole('textbox')).toHaveValue('198.51.100.9/24')
    await activate(action(labels.reload)); await expect(form.getByRole('textbox')).toHaveValue('203.0.113.0/24')
    await expect(action(labels.save)).toBeEnabled()
    await form.getByRole('textbox').fill('2001:db8::7/128')
    await checkUnknownSave(page, request, form, labels, info.outputPath('cidr-unknown-' + language + '-' + width + '.png'))
    await expect(form.getByRole('textbox')).toHaveValue('2001:db8::7/128')
    await activate(action(labels.clear)); await activate(action(labels.save))
    await expect(page.getByText(labels.saved, { exact: true })).toBeVisible()
    expect((await get<Policy>(request, path)).prefixes).toEqual([])
  })
}

async function activate(control: Locator) { await control.focus(); await control.press('Enter') }
async function addPrefix(form: Locator, labels: typeof text[keyof typeof text], prefix: string) {
  const index = await form.getByRole('textbox').count()
  await activate(form.getByRole('button', { name: labels.add, exact: true }))
  await form.getByRole('textbox', { name: labels.prefix + ' ' + (index + 1), exact: true }).fill(prefix)
}
async function create(page: Page, target: string, labels: typeof text[keyof typeof text]): Promise<Link> {
  await page.goto('/')
  const input = page.getByRole('textbox', { name: labels.target, exact: true })
  await expect(input).toBeEnabled(); await input.fill(target)
  const response = page.waitForResponse(value => new URL(value.url()).pathname === '/api/v1/short-link/create')
  await page.getByRole('button', { name: labels.create, exact: true }).click()
  const result = await (await response).json(); expect(result.code).toBe(0)
  return result.data.shortLink as Link
}
async function refuse(page: Page, target: string, labels: typeof text[keyof typeof text]) {
  const before = (await ownLinks(page.request)).map(link => link.id).sort()
  await page.goto('/')
  const input = page.getByRole('textbox', { name: labels.target, exact: true })
  await expect(input).toBeEnabled(); await input.fill(target)
  const response = page.waitForResponse(value => new URL(value.url()).pathname === '/api/v1/short-link/create')
  await page.getByRole('button', { name: labels.create, exact: true }).click()
  expect((await (await response).json()).code).toBe(200121)
  await expect(page.getByText(labels.denied)).toBeVisible(); await expect(input).toHaveValue(target)
  expect((await ownLinks(page.request)).map(link => link.id).sort()).toEqual(before)
}
async function ownLinks(request: APIRequestContext): Promise<Link[]> { return (await get<{ items: Link[] }>(request, '/short-link/list?page=1&pageSize=100')).items }
async function write(request: APIRequestContext, prefixes: string[]) { return post<Policy>(request, path + '/update', { prefixes, expectedUpdatedAt: (await get<Policy>(request, path)).updatedAt }) }
async function checkUnknownSave(page: Page, request: APIRequestContext, form: Locator, labels: typeof text[keyof typeof text], screenshot: string) {
  let committed: Policy | undefined, dropError: unknown, browserWrites = 0
  let processed!: () => void
  const dropped = new Promise<void>(resolve => { processed = resolve })
  const onWrite = (value: Request) => { if (new URL(value.url()).pathname === '/api/v1' + path + '/update') browserWrites++ }
  page.on('request', onWrite)
  try {
    await page.route('**/api/v1' + path + '/update', async route => {
      try {
        const result = await route.fetch(), payload = await result.json()
        expect(result.status()).toBe(200); expect(payload.code).toBe(0)
        committed = payload.data as Policy
        expect(committed.prefixes).toEqual(['2001:db8::7/128'])
        await route.abort('failed')
      } catch (error) { dropError = error; await route.abort('failed').catch(() => undefined) }
      finally { processed() }
    }, { times: 1 })
    const lost = page.waitForEvent('requestfailed', { predicate: value => new URL(value.url()).pathname === '/api/v1' + path + '/update' })
    await activate(form.getByRole('button', { name: labels.save, exact: true })); await dropped
    if (dropError) throw dropError
    expect((await lost).failure()?.errorText).toBeTruthy()
    expect(await get<Policy>(request, path)).toEqual(committed)
    const unknown = form.getByText(labels.unknown)
    await expect(unknown).toBeVisible()
    await expect(form.getByRole('button', { name: labels.save, exact: true })).toBeDisabled()
    await form.evaluate(element => (element as HTMLFormElement).requestSubmit())
    expect(browserWrites).toBe(1)
    expect((await get<Policy>(request, path)).updatedAt).toBe(committed!.updatedAt)
    await page.route('**/api/v1' + path, route => route.abort('failed'), { times: 1 })
    const failed = page.waitForEvent('requestfailed', { predicate: value => new URL(value.url()).pathname === '/api/v1' + path })
    await activate(form.getByRole('button', { name: labels.reload, exact: true })); await failed
    await expect(form.getByRole('button', { name: labels.reload, exact: true })).toBeEnabled()
    await expect(unknown).toBeVisible()
    await expect(form.getByRole('button', { name: labels.save, exact: true })).toBeDisabled()
    await unknown.scrollIntoViewIfNeeded(); await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: screenshot })
    const confirmed = page.waitForResponse(value => new URL(value.url()).pathname === '/api/v1' + path)
    await activate(form.getByRole('button', { name: labels.reload, exact: true }))
    expect((await (await confirmed).json()).data).toEqual(committed)
    await expect(unknown).toBeHidden()
    await expect(form.getByRole('button', { name: labels.save, exact: true })).toBeEnabled()
  } finally { page.off('request', onWrite) }
}
async function get<T>(request: APIRequestContext, resource: string): Promise<T> {
  const response = await request.get('/api/v1' + resource, { timeout: 10_000 })
  expect(response.status()).toBe(200)
  const payload = await response.json(); expect(payload.code).toBe(0)
  return payload.data as T
}
async function post<T = unknown>(request: APIRequestContext, resource: string, data: unknown): Promise<T> {
  const response = await request.post('/api/v1' + resource, { data, timeout: 10_000 })
  expect(response.status()).toBe(200)
  const payload = await response.json(); expect(payload.code).toBe(0)
  return payload.data as T
}
