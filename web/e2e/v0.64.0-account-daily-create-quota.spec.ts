import { randomBytes } from 'node:crypto'
import { expect, test as base } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Locator, Page, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

type Quota = { dailyLimit: number | null; updatedAt: string }
type Deny = { hosts: string[]; updatedAt: string }
type Allow = Deny & { enabled: boolean }
type Link = { id: string; slug: string; url: string; targetUrl: string }
type Mode = 'targets' | 'titles' | 'metadata' | 'custom-slugs'
type Scenario = { page: Page; request: APIRequestContext; userId: string; username: string; context(value: BrowserContext): void }
const resource = '/admin/system/account-daily-create-quota'
const denyResource = '/admin/system/target-host-denylist'
const allowResource = '/admin/system/target-host-allowlist'
const password = 'owned-daily-quota64-fixture'
const text = {
  en: { form: 'Account daily creation quota settings', enabled: 'Limit daily creation', limit: 'Daily limit per account', save: 'Save daily quota', reload: 'Reload daily quota', saved: 'Daily creation quota saved.', conflict: /Another request changed the quota/, target: 'Enter link', create: 'Create short link', denied: /Your daily creation quota is exhausted/, bulkDenied: /Your remaining daily quota/, unknown: /result is unknown/, more: 'More actions', configure: 'Access settings', editTarget: 'Target URL', saveSettings: 'Save' },
  'zh-CN': { form: '账号每日创建配额设置', enabled: '限制每日创建数量', limit: '每账号每日上限', save: '保存每日配额', reload: '重新加载每日配额', saved: '每日创建配额已保存。', conflict: /每日配额已被其他请求修改/, target: '输入链接', create: '创建短链', denied: /账号今日创建额度已用尽/, bulkDenied: /账号今日剩余额度不足/, unknown: /结果未确认/, more: '更多操作', configure: '访问配置', editTarget: '目标链接', saveSettings: '保存' },
} as const
type Labels = typeof text[keyof typeof text]

const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, request }, use, info) => {
    const contexts: BrowserContext[] = [], failures: unknown[] = []
    let original: Quota | undefined, deny: Deny | undefined, allow: Allow | undefined
    let user: { id: string; username: string } | undefined, page: Page | undefined
    try {
      await post(request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      // Register every shared setting before the first mutation, even if later setup fails.
      original = await get<Quota>(request, resource)
      deny = await get<Deny>(request, denyResource)
      allow = await get<Allow>(request, allowResource)
      user = (await post<{ user: { id: string; username: string } }>(request, '/admin/user/create', { username: 'quota64-' + randomBytes(7).toString('hex'), password, nickname: 'Owned quota fixture', groupKey: 'admin', status: 'active' })).user
      const language = info.title.includes(' en ') ? 'en' : 'zh-CN'
      const width = info.title.includes('1280px') ? 1280 : 390
      const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width, height: 900 }, hasTouch: width === 390, serviceWorkers: 'block', reducedMotion: 'reduce', colorScheme: language === 'en' ? 'light' : 'dark' })
      contexts.push(context)
      await context.addInitScript(language => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', language === 'en' ? 'light' : 'dark') }, language)
      page = await context.newPage()
      await post(page.request, '/auth/login', { username: user.username, password })
      const preference = (await get<{ preferences: { updatedAt: string | null } }>(page.request, '/user/preferences')).preferences
      await post(page.request, '/user/preferences/update', { language, theme: language === 'en' ? 'light' : 'dark', expectedUpdatedAt: preference.updatedAt })
      await info.attach('runtime', { body: JSON.stringify({ browser: browser.version(), driverNode: process.version, language, width, hasTouch: width === 390, disposableDatabase: true, userId: user.id }), contentType: 'application/json' })
      await use({ page, request, userId: user.id, username: user.username, context: value => { contexts.push(value) } })
    } catch (error) { failures.push(error) } finally {
      if (original) { try { await write(request, original.dailyLimit); expect((await get<Quota>(request, resource)).dailyLimit).toBe(original.dailyLimit) } catch (error) { failures.push(error) } }
      if (deny) { try { await writeDeny(request, deny.hosts); expect((await get<Deny>(request, denyResource)).hosts).toEqual(deny.hosts) } catch (error) { failures.push(error) } }
      if (allow) { try { await writeAllow(request, allow.enabled, allow.hosts); expect(await get<Allow>(request, allowResource)).toMatchObject({ enabled: allow.enabled, hosts: allow.hosts }) } catch (error) { failures.push(error) } }
      if (page) { try { for (const link of await ownLinks(page.request)) await post(request, '/admin/short-link/delete', { id: link.id }) } catch (error) { failures.push(error) } }
      if (user) { try { await post(request, '/admin/user/update', { id: user.id, nickname: 'Retired quota fixture', status: 'disabled' }) } catch (error) { failures.push(error) } }
      for (const context of contexts) { try { await context.close() } catch (error) { failures.push(error) } }
    }
    if (failures.length) throw new AggregateError(failures, 'Quota scenario or exact fixture restoration failed')
  }, { timeout: 120_000 }],
})
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const language of ['en', 'zh-CN'] as const) for (const width of [1280, 390]) {
  test('v0.64.0 ' + language + ' ' + width + 'px quota, five writes, replay and historical access', async ({ scenario, browser }, info) => {
    test.setTimeout(180_000)
    const { page, request } = scenario, labels = text[language]
    await write(request, null); await writeDeny(request, []); await writeAllow(request, false, [])
    const destination = new URL('/api/v1/health', info.project.use.baseURL as string)
    destination.hostname = 'historical.localhost'
    // Unlimited creation still consumes one unit, including for an administrator.
    const historical = await create(page, destination.href, labels)
    await page.goto('/admin/setting')
    const form = page.getByRole('form', { name: labels.form, exact: true })
    const toggle = form.getByLabel(labels.enabled, { exact: true })
    const field = form.getByRole('textbox', { name: labels.limit, exact: true })
    await expect(toggle).toBeEnabled(); await expect(toggle).not.toBeChecked(); await expect(field).toBeDisabled()
    expect(await form.getAttribute('aria-label')).toBe(labels.form)
    await toggle.focus(); await toggle.press('Space'); await expect(toggle).toBeChecked()
    await expect(field).toHaveAttribute('inputmode', 'numeric')
    if (width === 390) await field.tap(); else await field.focus()
    await field.press('ControlOrMeta+A'); await page.keyboard.type('3')
    await saveCard(page, form, labels, 3)
    await expect(field).toHaveValue('3'); await cardShot(page, info, 'quota-enabled-' + language + '-' + width)
    await page.reload(); await expect(field).toHaveValue('3'); await expect(toggle).toBeChecked()
    await create(page, 'https://example.com/quota-single', labels)

    const before = (await ownLinks(page.request)).map(link => link.id).sort()
    for (const mode of ['targets', 'titles', 'metadata', 'custom-slugs'] as const) {
      await page.goto('/link')
      const dialog = await batch(page, mode, ['https://example.com/quota-a', 'https://example.com/quota-b'])
      const id = await page.getByTestId('bulk-create-request-id').innerText()
      const result = page.waitForResponse(response => new URL(response.url()).pathname === endpoint(mode))
      await activate(page.getByTestId('bulk-create-submit'))
      expect((await (await result).json()).code).toBe(200122)
      await expect(page.getByTestId('bulk-create-error')).toContainText(labels.bulkDenied)
      await expect(page.getByTestId('bulk-create-request-id')).toHaveText(id)
      await expect(page.getByTestId('bulk-create-edit')).toBeEnabled()
      expect((await ownLinks(page.request)).map(link => link.id).sort()).toEqual(before)
      if (mode === 'custom-slugs') {
        await page.getByTestId('bulk-create-error').scrollIntoViewIfNeeded()
        await expectNoHorizontalOverflow(page); await page.screenshot({ path: info.outputPath('quota-batch-denied-' + language + '-' + width + '.png') })
      }
      await activate(page.getByTestId('bulk-create-close')); await expect(dialog).toBeHidden()
    }
    // Two-item failures did not spend the one remaining unit.
    await page.goto('/link')
    let dialog = await batch(page, 'targets', ['https://example.com/last-unit'])
    const last = page.waitForResponse(response => new URL(response.url()).pathname === endpoint('targets'))
    await activate(page.getByTestId('bulk-create-submit')); expect((await (await last).json()).code).toBe(0); await expect(dialog).toBeHidden()
    await page.goto('/')
    const target = page.getByRole('textbox', { name: labels.target, exact: true }); await expect(target).toBeEnabled(); await target.fill('https://example.com/retained-quota-draft')
    const refused = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/short-link/create')
    await page.getByRole('button', { name: labels.create, exact: true }).click()
    expect((await (await refused).json()).code).toBe(200122)
    await expect(page.getByText(labels.denied)).toBeVisible(); await expect(target).toHaveValue('https://example.com/retained-quota-draft')
    await expectNoHorizontalOverflow(page); await page.screenshot({ path: info.outputPath('quota-single-denied-' + language + '-' + width + '.png') })

    await page.goto('/admin/setting'); await expect(field).toHaveValue('3')
    await toggle.uncheck(); await saveCard(page, form, labels, null); await expect(toggle).not.toBeChecked()
    const receipts: { endpoint: string; body: unknown; data: unknown }[] = []
    for (const mode of ['targets', 'titles', 'metadata', 'custom-slugs'] as const) {
      await page.goto('/link')
      dialog = await batch(page, mode, ['https://example.com/unlimited-a', 'https://example.com/unlimited-b'])
      const result = page.waitForResponse(response => new URL(response.url()).pathname === endpoint(mode))
      await activate(page.getByTestId('bulk-create-submit'))
      const response = await result, payload = await response.json()
      expect(payload).toMatchObject({ code: 0, data: { createdCount: 2 } })
      receipts.push({ endpoint: endpoint(mode), body: response.request().postDataJSON(), data: payload.data })
      await expect(dialog).toBeHidden()
    }
    await page.goto('/admin/setting'); await expect(toggle).toBeEnabled(); await expect(toggle).not.toBeChecked()
    await toggle.check(); await field.fill('0'); await saveCard(page, form, labels, 0)
    await page.reload(); await expect(toggle).toBeChecked(); await expect(field).toHaveValue('0')
    await cardShot(page, info, 'quota-zero-reloaded-' + language + '-' + width)
    const all = (await ownLinks(page.request)).map(link => link.id).sort()
    // Direct HTTP supplements verify every real receipt with the unchanged UUID and body.
    for (const receipt of receipts) {
      const replay = await page.request.post(receipt.endpoint, { data: receipt.body })
      expect(replay.status()).toBe(200); expect(await replay.json()).toMatchObject({ code: 0, data: receipt.data })
    }
    expect((await ownLinks(page.request)).map(link => link.id).sort()).toEqual(all)
    const fresh = await page.request.post('/api/v1/short-link/create', { data: { targetUrl: 'https://example.com/zero-new' } })
    expect((await fresh.json()).code).toBe(200122)

    for (const scope of ['own', 'admin'] as const) {
      await page.goto(scope === 'own' ? '/link' : '/admin/link')
      const row = page.getByTestId('console-link-row').filter({ hasText: historical.slug })
      await row.getByRole('button', { name: labels.more, exact: true }).click()
      await page.getByRole('menuitem', { name: labels.configure, exact: true }).click()
      const editor = page.getByRole('dialog')
      const edited = new URL(destination); edited.searchParams.set('edited', scope)
      await editor.getByRole('textbox', { name: labels.editTarget, exact: true }).fill(edited.href)
      const result = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/' + (scope === 'admin' ? 'admin/' : '') + 'short-link/update')
      await editor.getByRole('button', { name: labels.saveSettings, exact: true }).click()
      expect((await (await result).json()).code).toBe(0); await expect(editor).toBeHidden()
      destination.href = edited.href
    }
    const visitor = await browser.newContext({ baseURL: info.project.use.baseURL, serviceWorkers: 'block' }); scenario.context(visitor)
    const visit = await visitor.newPage(), redirected = visit.waitForResponse(response => new URL(response.url()).pathname === '/' + historical.slug)
    const landed = await visit.goto('/' + historical.slug)
    expect((await redirected).status()).toBe(302); await expect(visit).toHaveURL(destination.href)
    expect(landed?.status()).toBe(200); expect((await landed!.json()).code).toBe(0)

    await page.goto('/admin/setting'); await expect(field).toHaveValue('0')
    const stale = await get<Quota>(request, resource)
    await field.fill('8'); const newer = await write(request, 2); expect(newer.updatedAt).not.toBe(stale.updatedAt)
    const conflict = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + resource + '/update')
    await activate(form.getByRole('button', { name: labels.save, exact: true }))
    expect((await (await conflict).json()).code).toBe(900215)
    await expect(form.getByText(labels.conflict)).toBeVisible(); await expect(field).toHaveValue('8')
    await expect(form.getByRole('button', { name: labels.save, exact: true })).toBeDisabled()
    await cardShot(page, info, 'quota-conflict-' + language + '-' + width)
    await activate(form.getByRole('button', { name: labels.reload, exact: true })); await expect(field).toHaveValue('2')
    await expect(form.getByRole('button', { name: labels.save, exact: true })).toBeEnabled()
    await toggle.uncheck(); await saveCard(page, form, labels, null)
    await expect(toggle).not.toBeChecked()
    const audits = (await get<{ items: { resourceId: string; changedFields: string[] }[] }>(request, '/admin/audit/list?actorId=' + scenario.userId + '&resourceType=system_setting&action=settings_change')).items
    const quotaAudits = audits.filter(item => item.resourceId === 'security.account_daily_create_quota')
    expect(quotaAudits.length).toBeGreaterThan(0)
    for (const audit of quotaAudits) expect(audit.changedFields).toEqual(['security.account_daily_create_quota'])
  })
}

for (const [operation, language, width] of [['load', 'en', 390], ['save', 'zh-CN', 1280]] as const) {
  test('v0.64.0 ' + language + ' ' + width + 'px revocation clears private ' + operation + ' draft', async ({ scenario }, info) => {
    const { page, request } = scenario, labels = text[language]
    await write(request, 7); await page.goto('/admin/setting')
    const form = page.getByRole('form', { name: labels.form, exact: true }), field = form.getByRole('textbox', { name: labels.limit, exact: true })
    await expect(field).toHaveValue('7'); await field.fill('12')
    const failures: unknown[] = []
    try {
      await post(request, '/admin/user/update', { id: scenario.userId, nickname: 'Owned quota fixture', status: 'disabled' })
      const rejected = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + resource + (operation === 'save' ? '/update' : ''))
      const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/me')
      await activate(form.getByRole('button', { name: operation === 'save' ? labels.save : labels.reload, exact: true }))
      expect((await (await rejected).json()).code).toBe(120001)
      expect((await (await refreshed).json()).data.user.group).toBe('guest')
      await expect(form).toBeHidden(); await expect(page.locator('input[name=account-daily-create-limit]')).toHaveCount(0)
      await page.screenshot({ path: info.outputPath('quota-revoked-' + operation + '-' + language + '-' + width + '.png') })
    } catch (error) { failures.push(error) } finally {
      try { await post(request, '/admin/user/update', { id: scenario.userId, nickname: 'Owned quota fixture', status: 'active' }); await post(page.request, '/auth/login', { username: scenario.username, password }) } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, 'Quota revocation or exact owned account restoration failed')
    expect((await get<Quota>(request, resource)).dailyLimit).toBe(7)
  })
}

for (const language of ['en', 'zh-CN'] as const) {
  test('v0.64.0 ' + language + ' 390px unknown response then real quota refusal keeps the original batch immutable', async ({ scenario }, info) => {
    const { page, request } = scenario, labels = text[language]
    await write(request, 0); await writeDeny(request, []); await writeAllow(request, false, [])
    await page.goto('/link')
    const dialog = await batch(page, 'targets', ['https://example.com/unknown-quota'])
    const id = await page.getByTestId('bulk-create-request-id').innerText(), bodies: unknown[] = []
    // Only the first transport is deliberately unknown; the second reaches the real quota service.
    const routePath = '**/api/v1/short-link/batch-create'
    await page.route(routePath, async route => { bodies.push(route.request().postDataJSON()); await route.abort('failed') }, { times: 1 })
    await activate(page.getByTestId('bulk-create-submit')); await expect(page.getByTestId('bulk-create-error')).toContainText(labels.unknown)
    const retry = page.waitForResponse(response => new URL(response.url()).pathname === endpoint('targets'))
    await activate(page.getByTestId('bulk-create-submit'))
    const actual = await retry; bodies.push(actual.request().postDataJSON()); expect((await actual.json()).code).toBe(200122)
    await expect(page.getByTestId('bulk-create-submit')).toBeEnabled()
    await expect(page.getByTestId('bulk-create-error')).toContainText(labels.unknown)
    await expect(page.getByTestId('bulk-create-error')).not.toContainText(language === 'en' ? 'No links were created' : '整批未创建')
    await expect(page.getByTestId('bulk-create-edit')).toBeDisabled(); await expect(page.getByTestId('bulk-create-request-id')).toHaveText(id)
    expect(bodies).toHaveLength(2); expect(bodies[1]).toEqual(bodies[0]); expect(await ownLinks(page.request)).toEqual([])
    await page.getByTestId('bulk-create-error').scrollIntoViewIfNeeded(); await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: info.outputPath('quota-unknown-' + language + '-390.png') })
    await activate(page.getByTestId('bulk-create-close'))
    await expect(page.getByTestId('bulk-create-close-warning')).toBeVisible(); await expect(dialog).toBeVisible()
    await activate(page.getByTestId('bulk-create-keep')); await expect(page.getByTestId('bulk-create-close-warning')).toBeHidden()
    await expect(page.getByTestId('bulk-create-request-id')).toHaveText(id)
    await activate(page.getByTestId('bulk-create-close')); await activate(page.getByTestId('bulk-create-discard'))
    await expect(dialog).toBeHidden()
  })
}

for (const language of ['en', 'zh-CN'] as const) for (const width of [1280, 390]) {
  test('v0.64.1 ' + language + ' ' + width + 'px confirms a committed quota save after its response is lost', async ({ scenario }, info) => {
    const { page, request } = scenario, labels = text[language]
    await write(request, 7); await page.goto('/admin/setting')
    const form = page.getByRole('form', { name: labels.form, exact: true })
    const field = form.getByRole('textbox', { name: labels.limit, exact: true })
    const save = form.getByRole('button', { name: labels.save, exact: true })
    const reload = form.getByRole('button', { name: labels.reload, exact: true })
    const warning = language === 'en' ? /Save result is unknown/ : /保存结果未确认/
    const alert = form.getByRole('alert').filter({ hasText: warning })
    await expect(field).toHaveValue('7')
    const original = await get<Quota>(request, resource), writes: unknown[] = []
    let committed: Quota | undefined, pageReads = 0
    page.on('request', value => { if (value.method() === 'GET' && new URL(value.url()).pathname === '/api/v1' + resource) pageReads++ })
    await page.route('**/api/v1' + resource + '/update', async route => {
      writes.push(route.request().postDataJSON())
      if (writes.length === 1) {
        // Forward the real write, then lose only its response to the browser.
        const response = await route.fetch(), payload = await response.json()
        expect(response.status()).toBe(200); expect(payload.code).toBe(0)
        committed = payload.data as Quota
        await route.abort('failed')
      } else await route.continue()
    })
    if (width === 390) await field.tap(); else await field.focus()
    await field.fill('12'); await activate(save)
    await expect(alert).toContainText(warning); await expect(alert).toHaveAttribute('aria-live', 'polite')
    await expect(field).toHaveValue('12'); await expect(save).toBeDisabled(); await expect(reload).toBeEnabled()
    expect(writes).toEqual([{ dailyLimit: 12, expectedUpdatedAt: original.updatedAt }])
    expect(committed?.dailyLimit).toBe(12); expect(committed?.updatedAt).not.toBe(original.updatedAt)
    expect(await get<Quota>(request, resource)).toEqual(committed); expect(pageReads).toBe(0)
    await form.evaluate(element => (element as HTMLFormElement).requestSubmit())
    const failedReload = page.waitForEvent('requestfailed', value => value.method() === 'GET' && new URL(value.url()).pathname === '/api/v1' + resource)
    await page.route('**/api/v1' + resource, route => route.abort('failed'), { times: 1 })
    await activate(reload); await failedReload
    await expect(reload).toBeEnabled(); await expect(alert).toContainText(warning); await expect(save).toBeDisabled()
    await field.fill('13'); await expect(alert).toContainText(warning)
    await form.evaluate(element => (element as HTMLFormElement).requestSubmit())
    await cardShot(page, info, 'quota-save-unknown-' + language + '-' + width)
    expect(writes).toHaveLength(1); expect(await get<Quota>(request, resource)).toEqual(committed)
    const confirmedRead = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/v1' + resource)
    await activate(reload); expect((await (await confirmedRead).json()).data).toEqual(committed)
    await expect(field).toHaveValue('12'); await expect(save).toBeEnabled(); await expect(alert).toBeHidden()
    await field.fill('14'); await saveCard(page, form, labels, 14)
    expect(writes).toHaveLength(2); expect(writes[1]).toEqual({ dailyLimit: 14, expectedUpdatedAt: committed!.updatedAt })
    await cardShot(page, info, 'quota-save-confirmed-' + language + '-' + width)
  })
}

async function activate(control: Locator) { await control.focus(); await control.press('Enter') }
async function cardShot(page: Page, info: TestInfo, label: string) {
  const card = page.locator('.daily-quota')
  await card.evaluate(element => { element.scrollIntoView({ block: 'start' }); window.scrollBy(0, -100) })
  await expect(card.getByRole('heading')).toBeInViewport(); await expectNoHorizontalOverflow(page)
  await page.screenshot({ path: info.outputPath(label + '.png') })
}
async function saveCard(page: Page, form: Locator, labels: Labels, dailyLimit: number | null) {
  const before = await get<Quota>(page.request, resource)
  const result = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + resource + '/update')
  await activate(form.getByRole('button', { name: labels.save, exact: true }))
  const response = await result
  expect(response.request().postDataJSON()).toEqual({ dailyLimit, expectedUpdatedAt: before.updatedAt })
  const payload = await response.json(); expect(payload.code).toBe(0)
  expect(payload.data.dailyLimit).toBe(dailyLimit); expect(response.headers()['cache-control']).toContain('no-store')
  await expect(page.getByText(labels.saved, { exact: true })).toBeVisible()
  expect(await get<Quota>(page.request, resource)).toEqual(payload.data)
}
async function create(page: Page, target: string, labels: Labels): Promise<Link> {
  await page.goto('/')
  const input = page.getByRole('textbox', { name: labels.target, exact: true }); await expect(input).toBeEnabled(); await input.fill(target)
  const result = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/short-link/create')
  await page.getByRole('button', { name: labels.create, exact: true }).click()
  const payload = await (await result).json(); expect(payload.code).toBe(0); return payload.data.shortLink as Link
}
function endpoint(mode: Mode) { return '/api/v1/short-link/batch-create' + (mode === 'targets' ? '' : '-with-' + mode) }
async function batch(page: Page, mode: Mode, targets: string[]): Promise<Locator> {
  await activate(page.getByTestId('bulk-create-open')); const dialog = page.getByTestId('bulk-create-dialog')
  if (mode === 'targets') await dialog.getByRole('textbox').fill(targets.join('\n'))
  else {
    const header = mode === 'titles' ? 'target_url,title' : mode === 'metadata' ? 'target_url,title,tags' : 'target_url,title,tags,custom_slug'
    const fields = mode === 'titles' ? ',Quota' : mode === 'metadata' ? ',Quota,[]' : ',Quota,[],'
    await dialog.locator('input[type=file]').setInputFiles({ name: 'quota.csv', mimeType: 'text/csv', buffer: Buffer.from(header + '\n' + targets.map(target => target + fields).join('\n')) })
    await expect(page.getByTestId('bulk-create-imported-list')).toBeVisible()
  }
  await activate(page.getByTestId('bulk-create-preview')); return dialog
}
async function ownLinks(request: APIRequestContext): Promise<Link[]> { return (await get<{ items: Link[] }>(request, '/short-link/list?page=1&pageSize=100')).items }
async function write(request: APIRequestContext, dailyLimit: number | null) { return post<Quota>(request, resource + '/update', { dailyLimit, expectedUpdatedAt: (await get<Quota>(request, resource)).updatedAt }) }
async function writeDeny(request: APIRequestContext, hosts: string[]) { return post<Deny>(request, denyResource + '/update', { hosts, expectedUpdatedAt: (await get<Deny>(request, denyResource)).updatedAt }) }
async function writeAllow(request: APIRequestContext, enabled: boolean, hosts: string[]) { return post<Allow>(request, allowResource + '/update', { enabled, hosts, expectedUpdatedAt: (await get<Allow>(request, allowResource)).updatedAt }) }
async function get<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get('/api/v1' + path, { timeout: 10_000 }); expect(response.status()).toBe(200)
  const payload = await response.json(); expect(payload.code).toBe(0); return payload.data as T
}
async function post<T = unknown>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await request.post('/api/v1' + path, { data, timeout: 10_000 }); expect(response.status()).toBe(200)
  const payload = await response.json(); expect(payload.code).toBe(0); return payload.data as T
}
