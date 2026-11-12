import { randomBytes } from 'node:crypto'
import { expect, test as base } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Locator, Page } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

type Policy = { enabled: boolean; hosts: string[]; updatedAt: string }
type Deny = { hosts: string[]; updatedAt: string }
type Link = { id: string; slug: string; url: string; targetUrl: string }
type Scenario = { page: Page; request: APIRequestContext; userId: string; context(value: BrowserContext): void }
type Mode = 'targets' | 'titles' | 'metadata' | 'custom-slugs'
const path = '/admin/system/target-host-allowlist'
const denyPath = '/admin/system/target-host-denylist'
const password = 'owned-target-allowlist63-fixture'
const text = {
  en: { form: 'Allowed target host settings', enabled: 'Enable target host allowlist', host: 'Host', add: 'Add host', clear: 'Clear list', reload: 'Reload allowed hosts', save: 'Save allowed hosts', saved: 'Allowed target hosts saved.', empty: 'Add at least one valid host before enabling. Clearing the list does not switch the allowlist off.', target: 'Enter link', create: 'Create short link', denied: /site restricts this target host/, bulkDenied: /restricts a target host/, more: 'More actions', configure: 'Access settings', editTarget: 'Target URL', saveSettings: 'Save' },
  'zh-CN': { form: '目标主机白名单设置', enabled: '启用目标主机白名单', host: '主机', add: '添加主机', clear: '清空列表', reload: '重新加载白名单', save: '保存白名单', saved: '目标主机白名单已保存。', empty: '启用白名单前请至少添加一个有效主机；清空列表不会自动关闭白名单。', target: '输入链接', create: '创建短链', denied: /目标主机被站点规则限制/, bulkDenied: /目标主机被站点规则限制/, more: '更多操作', configure: '访问配置', editTarget: '目标链接', saveSettings: '保存' },
} as const

const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, request }, use, info) => {
    const contexts: BrowserContext[] = [], failures: unknown[] = []
    let original: Policy | undefined, deny: Deny | undefined
    let user: { id: string; username: string } | undefined, page: Page | undefined
    try {
      await post(request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      // Register both original resources before the first fixture mutation.
      original = await get<Policy>(request, path)
      deny = await get<Deny>(request, denyPath)
      user = (await post<{ user: { id: string; username: string } }>(request, '/admin/user/create', { username: 'allow63-' + randomBytes(7).toString('hex'), password, nickname: 'Owned allowlist fixture', groupKey: 'admin', status: 'active' })).user
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
      await use({ page, request, userId: user.id, context: value => { contexts.push(value) } })
    } catch (error) { failures.push(error) } finally {
      // Restore independently through the manager request and fresh full CAS.
      if (original) { try { await write(request, original.enabled, original.hosts); expect(await get<Policy>(request, path)).toMatchObject({ enabled: original.enabled, hosts: original.hosts }) } catch (error) { failures.push(error) } }
      if (deny) { try { await writeDeny(request, deny.hosts); expect((await get<Deny>(request, denyPath)).hosts).toEqual(deny.hosts) } catch (error) { failures.push(error) } }
      if (page) { try { for (const link of await ownLinks(page.request)) await post(request, '/admin/short-link/delete', { id: link.id }) } catch (error) { failures.push(error) } }
      if (user) { try { await post(request, '/admin/user/update', { id: user.id, nickname: 'Retired allowlist fixture', status: 'disabled' }) } catch (error) { failures.push(error) } }
      for (const context of contexts) { try { await context.close() } catch (error) { failures.push(error) } }
    }
    if (failures.length) throw new AggregateError(failures, 'Allowlist scenario or exact fixture restoration failed')
  }, { timeout: 120_000 }],
})
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const language of ['en', 'zh-CN'] as const) for (const width of [1280, 390]) {
  test('v0.63.0 ' + language + ' ' + width + 'px optional policy, seven writes and historical access', async ({ scenario, browser }, info) => {
    test.setTimeout(180_000)
    const { page, request } = scenario, labels = text[language]
    await write(request, false, []); await writeDeny(request, [])
    const historicalTarget = new URL('/api/v1/health', info.project.use.baseURL as string)
    historicalTarget.hostname = 'historical.localhost'
    const historical = await create(page, historicalTarget.href, labels)
    await page.goto('/admin/setting')
    const form = page.getByRole('form', { name: labels.form, exact: true })
    const toggle = form.getByLabel(labels.enabled, { exact: true })
    await expect(toggle).toBeEnabled(); await expect(toggle).not.toBeChecked()
    await toggle.focus(); await toggle.press('Space'); await expect(toggle).toBeChecked()
    await activate(form.getByRole('button', { name: labels.save, exact: true }))
    await expect(form.getByText(labels.empty, { exact: true })).toBeVisible()
    expect(await get<Policy>(request, path)).toMatchObject({ enabled: false, hosts: [] })
    const addHost = form.getByRole('button', { name: labels.add, exact: true })
    if (width === 390) await addHost.tap()
    else await activate(addHost)
    const first = form.getByRole('textbox', { name: labels.host + ' 1', exact: true })
    await first.focus(); await page.keyboard.type(' ALLOWED.Example. ')
    await activate(form.getByRole('button', { name: labels.add, exact: true }))
    await form.getByRole('textbox', { name: labels.host + ' 2', exact: true }).fill('DENIED.EXAMPLE.')
    const savedResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + path + '/update')
    await activate(form.getByRole('button', { name: labels.save, exact: true }))
    const saved = await savedResponse
    expect(saved.request().postDataJSON()).toMatchObject({ enabled: true, hosts: [' ALLOWED.Example. ', 'DENIED.EXAMPLE.'] })
    expect((await saved.json()).code).toBe(0)
    await expect(page.getByText(labels.saved, { exact: true })).toBeVisible(); await expect(first).toHaveValue('allowed.example')
    expect(await get<Policy>(request, path)).toMatchObject({ enabled: true, hosts: ['allowed.example', 'denied.example'] })
    const audits = (await get<{ items: { actorId: string; resourceId: string; changedFields: string[] }[] }>(request, '/admin/audit/list?actorId=' + scenario.userId + '&resourceType=system_setting&action=settings_change')).items
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ actorId: scenario.userId, resourceId: 'security.target_host_allowlist', changedFields: ['security.target_host_allowlist'] })
    expect(JSON.stringify(audits)).not.toContain('allowed.example')
    await expectNoHorizontalOverflow(page)
    const card = page.locator('.target-allowlist')
    await card.evaluate(element => { element.scrollIntoView({ block: 'start' }); window.scrollBy(0, -100) })
    await expect(card.getByRole('heading')).toBeInViewport()
    await page.screenshot({ path: info.outputPath('allowlist-heading-' + language + '-' + width + '.png') })
    await form.scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath('allowlist-saved-' + language + '-' + width + '.png') })
    await page.reload(); await expect(toggle).toBeChecked(); await expect(first).toHaveValue('allowed.example')
    await card.evaluate(element => { element.scrollIntoView({ block: 'start' }); window.scrollBy(0, -100) })
    await expect(card.getByRole('heading')).toBeInViewport()
    await page.screenshot({ path: info.outputPath('allowlist-reloaded-heading-' + language + '-' + width + '.png') })
    await writeDeny(request, ['denied.example'])
    await create(page, 'https://allowed.example/single', labels)

    for (const targetUrl of ['https://other.example/new', 'https://sub.allowed.example/new', 'https://denied.example/new']) {
      await page.goto('/')
      const target = page.getByRole('textbox', { name: labels.target, exact: true }); await target.fill(targetUrl)
      const result = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/short-link/create')
      await page.getByRole('button', { name: labels.create, exact: true }).click()
      expect((await (await result).json()).code).toBe(200121)
      await expect(page.getByText(labels.denied)).toBeVisible(); await expect(target).toHaveValue(targetUrl)
    }
    // A documentation-range IP passes the existing target syntax validator;
    // test allowlist rejection through real HTTP without navigating to that IP.
    const ip = await page.request.post('/api/v1/short-link/create', { data: { targetUrl: 'https://192.0.2.1/new' } })
    expect(ip.status()).toBe(200); expect((await ip.json()).code).toBe(200121)

    for (const mode of ['targets', 'titles', 'metadata', 'custom-slugs'] as const) {
      await page.goto('/link')
      let dialog = await batch(page, mode, ['https://allowed.example/bulk-a', 'https://allowed.example/bulk-b'])
      const endpoint = '/api/v1/short-link/batch-create' + (mode === 'targets' ? '' : '-with-' + mode)
      const allowed = page.waitForResponse(response => new URL(response.url()).pathname === endpoint)
      await activate(page.getByTestId('bulk-create-submit'))
      expect(await (await allowed).json()).toMatchObject({ code: 0, data: { createdCount: 2 } }); await expect(dialog).toBeHidden()
      const before = (await ownLinks(page.request)).map(link => link.id).sort()
      dialog = await batch(page, mode, ['https://allowed.example/bulk', 'https://other.example/bulk'])
      const requestId = await page.getByTestId('bulk-create-request-id').innerText()
      const denied = page.waitForResponse(response => new URL(response.url()).pathname === endpoint)
      await activate(page.getByTestId('bulk-create-submit'))
      expect((await (await denied).json()).code).toBe(200121)
      await expect(page.getByTestId('bulk-create-error')).toContainText(labels.bulkDenied)
      await expect(page.getByTestId('bulk-create-request-id')).toHaveText(requestId)
      await expect(page.getByTestId('bulk-create-edit')).toBeEnabled()
      expect((await ownLinks(page.request)).map(link => link.id).sort()).toEqual(before)
      if (mode === 'custom-slugs') {
        const alert = page.getByTestId('bulk-create-error'); await alert.scrollIntoViewIfNeeded()
        await expect.poll(() => alert.evaluate(element => { const r = element.getBoundingClientRect(); const b = element.closest('.v-card-text')!.getBoundingClientRect(); return r.top >= b.top - 1 && r.bottom <= Math.min(b.bottom, innerHeight) + 1 })).toBe(true)
        await expectNoHorizontalOverflow(page); await page.screenshot({ path: info.outputPath('allowlist-batch-denied-' + language + '-' + width + '.png') })
      }
      await activate(page.getByTestId('bulk-create-close')); await expect(dialog).toBeHidden()
    }

    for (const scope of ['own', 'admin'] as const) {
      await page.goto(scope === 'own' ? '/link' : '/admin/link')
      const row = page.getByTestId('console-link-row').filter({ hasText: historical.slug })
      await row.getByRole('button', { name: labels.more, exact: true }).click()
      await page.getByRole('menuitem', { name: labels.configure, exact: true }).click()
      const dialog = page.getByRole('dialog')
      const target = dialog.getByRole('textbox', { name: labels.editTarget, exact: true })
      const endpoint = '/api/v1/' + (scope === 'admin' ? 'admin/' : '') + 'short-link/update'
      await target.fill('https://allowed.example/editor')
      const allowed = page.waitForResponse(response => new URL(response.url()).pathname === endpoint)
      await dialog.getByRole('button', { name: labels.saveSettings, exact: true }).click()
      expect((await (await allowed).json()).code).toBe(0); await expect(dialog).toBeHidden()
      // Independent same-byte API supplement restores the historical URL while disabled.
      await write(request, false, ['allowed.example', 'denied.example'])
      await post(page.request, '/short-link/update', { id: historical.id, targetUrl: historicalTarget.href })
      await write(request, true, ['allowed.example', 'denied.example'])
      await page.reload()
      await row.getByRole('button', { name: labels.more, exact: true }).click()
      await page.getByRole('menuitem', { name: labels.configure, exact: true }).click()
      await target.fill('https://other.example/changed')
      const denied = page.waitForResponse(response => new URL(response.url()).pathname === endpoint)
      await dialog.getByRole('button', { name: labels.saveSettings, exact: true }).click()
      expect((await (await denied).json()).code).toBe(200121)
      await expect(page.getByText(labels.denied)).toBeVisible(); await expect(target).toHaveValue('https://other.example/changed')
      await expectNoHorizontalOverflow(page); await page.screenshot({ path: info.outputPath('allowlist-' + scope + '-denied-' + language + '-' + width + '.png') })
    }

    const visitor = await browser.newContext({ baseURL: info.project.use.baseURL, serviceWorkers: 'block' }); scenario.context(visitor)
    const visit = await visitor.newPage(), redirected = visit.waitForResponse(response => new URL(response.url()).pathname === '/' + historical.slug)
    const destination = await visit.goto('/' + historical.slug)
    expect((await redirected).status()).toBe(302); expect((await redirected).headers().location).toBe(historicalTarget.href)
    await expect(visit).toHaveURL(historicalTarget.href); expect(destination?.status()).toBe(200); expect((await destination!.json()).code).toBe(0)
    // Unchanged-byte edits are explicit HTTP supplements, distinct from browser edits.
    for (const prefix of ['', 'admin/']) await post(page.request, '/' + prefix + 'short-link/update', { id: historical.id, targetUrl: historicalTarget.href, metadata: { title: 'Existing target remains editable', tags: [] } })

    await write(request, true, Array.from({ length: 100 }, (_, index) => `host${String(index).padStart(3, '0')}.example`))
    await page.goto('/admin/setting'); await expect(form.getByRole('textbox')).toHaveCount(100)
    await expect(form.getByRole('button', { name: labels.add, exact: true })).toBeDisabled()
    await expectNoHorizontalOverflow(page)
    await activate(form.getByRole('button', { name: labels.clear, exact: true }))
    await expect(form.getByRole('textbox')).toHaveCount(0); await expect(toggle).toBeChecked()
    await activate(form.getByRole('button', { name: labels.save, exact: true }))
    await expect(form.getByText(labels.empty, { exact: true })).toBeVisible()
    expect((await get<Policy>(request, path)).hosts).toHaveLength(100)
    await activate(form.getByRole('button', { name: labels.reload, exact: true })); await expect(form.getByRole('textbox')).toHaveCount(100)
    await toggle.uncheck(); await expect(form.getByRole('textbox')).toHaveCount(100)
    const off = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + path + '/update')
    await activate(form.getByRole('button', { name: labels.save, exact: true })); expect((await (await off).json()).code).toBe(0)
    expect(await get<Policy>(request, path)).toMatchObject({ enabled: false, hosts: expect.any(Array) }); expect((await get<Policy>(request, path)).hosts).toHaveLength(100)
    await create(page, 'https://other.example/after-switch-off', labels)
    await page.goto('/admin/setting'); await expect(toggle).not.toBeChecked()
    await expect(form.getByRole('textbox')).toHaveCount(100)
    await activate(form.getByRole('button', { name: labels.clear, exact: true }))
    const emptyOff = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + path + '/update')
    await activate(form.getByRole('button', { name: labels.save, exact: true })); expect((await (await emptyOff).json()).code).toBe(0)
    await expect(toggle).not.toBeChecked(); expect(await get<Policy>(request, path)).toMatchObject({ enabled: false, hosts: [] })
    await form.scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('allowlist-disabled-empty-' + language + '-' + width + '.png') })
  })
}

for (const [operation, language, width] of [['load', 'en', 390], ['save', 'zh-CN', 1280]] as const) {
  test('v0.63.0 ' + language + ' ' + width + 'px server revocation clears private ' + operation + ' draft', async ({ scenario }, info) => {
    const { page, request } = scenario, labels = text[language]
    await write(request, true, ['private.example'])
    await page.goto('/admin/setting')
    const form = page.getByRole('form', { name: labels.form, exact: true })
    const field = form.getByRole('textbox', { name: labels.host + ' 1', exact: true })
    await expect(field).toHaveValue('private.example'); await field.fill('unsaved-private.example')
    const original = (await get<{ user: { id: string; username: string; nickname: string } }>(page.request, '/auth/me')).user
    const failures: unknown[] = []
    try {
      expect(original.id).toBe(scenario.userId)
      await post(request, '/admin/user/update', { id: original.id, nickname: original.nickname, status: 'disabled' })
      const rejected = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + path + (operation === 'save' ? '/update' : ''))
      const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/me')
      await activate(form.getByRole('button', { name: operation === 'save' ? labels.save : labels.reload, exact: true }))
      expect((await (await rejected).json()).code).toBe(120001)
      expect((await (await refreshed).json()).data.user.group).toBe('guest')
      await expect(form).toBeHidden(); await expect(page.locator('input[name^=allowed-target-host-]')).toHaveCount(0)
      await page.screenshot({ path: info.outputPath('allowlist-revoked-' + operation + '-' + language + '-' + width + '.png') })
    } catch (error) { failures.push(error) } finally {
      try { await post(request, '/admin/user/update', { id: original.id, nickname: original.nickname, status: 'active' }); await post(page.request, '/auth/login', { username: original.username, password }) } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, 'Revocation or owned account restoration failed')
    expect(await get<Policy>(request, path)).toMatchObject({ enabled: true, hosts: ['private.example'] })
  })
}

async function activate(control: Locator) { await control.focus(); await control.press('Enter') }
async function create(page: Page, target: string, labels: typeof text[keyof typeof text]): Promise<Link> {
  await page.goto('/')
  const input = page.getByRole('textbox', { name: labels.target, exact: true }); await expect(input).toBeEnabled(); await input.fill(target)
  const result = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/short-link/create')
  await page.getByRole('button', { name: labels.create, exact: true }).click()
  const payload = await (await result).json(); expect(payload.code).toBe(0); return payload.data.shortLink as Link
}
async function batch(page: Page, mode: Mode, targets: string[]): Promise<Locator> {
  await activate(page.getByTestId('bulk-create-open'))
  const dialog = page.getByTestId('bulk-create-dialog')
  if (mode === 'targets') await dialog.getByRole('textbox').fill(targets.join('\n'))
  else {
    const header = mode === 'titles' ? 'target_url,title' : mode === 'metadata' ? 'target_url,title,tags' : 'target_url,title,tags,custom_slug'
    const fields = mode === 'titles' ? ',Allowlist' : mode === 'metadata' ? ',Allowlist,[]' : ',Allowlist,[],'
    await dialog.locator('input[type=file]').setInputFiles({ name: 'allowlist.csv', mimeType: 'text/csv', buffer: Buffer.from(header + '\n' + targets.map(target => target + fields).join('\n')) })
    await expect(page.getByTestId('bulk-create-imported-list')).toBeVisible()
  }
  await activate(page.getByTestId('bulk-create-preview')); return dialog
}
async function ownLinks(request: APIRequestContext): Promise<Link[]> { return (await get<{ items: Link[] }>(request, '/short-link/list?page=1&pageSize=100')).items }
async function write(request: APIRequestContext, enabled: boolean, hosts: string[]) { return post<Policy>(request, path + '/update', { enabled, hosts, expectedUpdatedAt: (await get<Policy>(request, path)).updatedAt }) }
async function writeDeny(request: APIRequestContext, hosts: string[]) { return post<Deny>(request, denyPath + '/update', { hosts, expectedUpdatedAt: (await get<Deny>(request, denyPath)).updatedAt }) }
async function get<T>(request: APIRequestContext, resource: string): Promise<T> {
  const response = await request.get('/api/v1' + resource, { timeout: 10_000 }); expect(response.status()).toBe(200)
  const payload = await response.json(); expect(payload.code).toBe(0); return payload.data as T
}
async function post<T = unknown>(request: APIRequestContext, resource: string, data: unknown): Promise<T> {
  const response = await request.post('/api/v1' + resource, { data, timeout: 10_000 }); expect(response.status()).toBe(200)
  const payload = await response.json(); expect(payload.code).toBe(0); return payload.data as T
}
