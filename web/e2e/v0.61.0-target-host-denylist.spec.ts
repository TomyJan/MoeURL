import { randomBytes } from 'node:crypto'
import { expect, test as base } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Locator, Page } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

type Policy = { hosts: string[]; updatedAt: string }
type Link = { id: string; slug: string; url: string; targetUrl: string }
type AuditItem = { id: string; actorId: string | null; actorUsername: string | null; resourceType: string; resourceId: string; action: string; changedFields: string[]; occurredAt: string }
type Scenario = { page: Page; request: APIRequestContext; userId: string; context(value: BrowserContext): void }
const readPath = '/admin/system/target-host-denylist'
const password = 'owned-target-policy61-fixture'
const text = {
  en: { form: 'Blocked target host settings', host: 'Host', add: 'Add host', remove: 'Remove host', clear: 'Clear list', reload: 'Reload blocked hosts', save: 'Save blocked hosts', saved: 'Blocked target hosts saved.', target: 'Enter link', create: 'Create short link', denied: /site restricts this target host/, bulkDenied: /restricts a target host/, more: 'More actions', configure: 'Access settings', editTarget: 'Target URL', saveSettings: 'Save' },
  'zh-CN': { form: '目标主机黑名单设置', host: '主机', add: '添加主机', remove: '删除主机', clear: '清空列表', reload: '重新加载黑名单', save: '保存黑名单', saved: '目标主机黑名单已保存。', target: '输入链接', create: '创建短链', denied: /目标主机被站点规则限制/, bulkDenied: /目标主机被站点规则限制/, more: '更多操作', configure: '访问配置', editTarget: '目标链接', saveSettings: '保存' },
} as const

const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, request }, use, info) => {
    await post(request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
    const original = await get<Policy>(request, readPath)
    const contexts: BrowserContext[] = [], failures: unknown[] = []
    let user: { id: string; username: string } | undefined, page: Page | undefined
    try {
      user = (await post<{ user: { id: string; username: string } }>(request, '/admin/user/create', { username: 'policy61-' + randomBytes(7).toString('hex'), password, nickname: 'Owned target-policy fixture', groupKey: 'admin', status: 'active' })).user
      const language = info.title.includes(' en ') ? 'en' : 'zh-CN'
      const width = info.title.includes('1280px') ? 1280 : 390
      const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width, height: 900 }, serviceWorkers: 'block', reducedMotion: 'reduce', colorScheme: language === 'en' ? 'light' : 'dark' })
      contexts.push(context)
      await context.addInitScript(language => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', language === 'en' ? 'light' : 'dark') }, language)
      page = await context.newPage()
      await post(page.request, '/auth/login', { username: user.username, password })
      const preference = (await get<{ preferences: { updatedAt: string | null } }>(page.request, '/user/preferences')).preferences
      await post(page.request, '/user/preferences/update', { language, theme: language === 'en' ? 'light' : 'dark', expectedUpdatedAt: preference.updatedAt })
      await info.attach('runtime', { body: JSON.stringify({ browser: browser.version(), driverNode: process.version, language, width, disposableDatabase: true, userId: user.id }), contentType: 'application/json' })
      await use({ page, request, userId: user.id, context: value => { contexts.push(value) } })
    } catch (error) { failures.push(error) } finally {
      // Independent request survives page closure and always restores with a fresh CAS.
      try { await write(request, original.hosts); expect((await get<Policy>(request, readPath)).hosts).toEqual(original.hosts) } catch (error) { failures.push(error) }
      if (page) {
        try { for (const link of await ownLinks(page.request)) await post(request, '/admin/short-link/delete', { id: link.id }) } catch (error) { failures.push(error) }
      }
      if (user) { try { await post(request, '/admin/user/update', { id: user.id, nickname: 'Retired target-policy fixture', status: 'disabled' }) } catch (error) { failures.push(error) } }
      for (const context of contexts) { try { await context.close() } catch (error) { failures.push(error) } }
    }
    if (failures.length) throw new AggregateError(failures, 'Target policy scenario or exact fixture restoration failed')
  }, { timeout: 90_000 }],
})
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const language of ['en', 'zh-CN'] as const) for (const width of [1280, 390]) {
  test('v0.61.0 ' + language + ' ' + width + 'px exact policy, seven writes and historical access', async ({ scenario, browser }, info) => {
    test.setTimeout(150_000)
    const { page, request } = scenario, labels = text[language]
    await write(request, [])
    const historicalTarget = new URL('/api/v1/health', info.project.use.baseURL as string)
    historicalTarget.hostname = 'blocked.localhost'
    const historical = await create(page, historicalTarget.href, labels)
    await page.goto('/admin/setting')
    const form = page.getByRole('form', { name: labels.form, exact: true })
    await expect(form.getByRole('button', { name: labels.add, exact: true })).toBeEnabled()
    await activate(form.getByRole('button', { name: labels.add, exact: true }))
    const first = form.getByRole('textbox', { name: labels.host + ' 1', exact: true })
    await first.focus(); await page.keyboard.type(' BLOCKED.Example. ')
    await activate(form.getByRole('button', { name: labels.add, exact: true }))
    await form.getByRole('textbox', { name: labels.host + ' 2', exact: true }).fill('BLOCKED.LOCALHOST.')
    await activate(form.getByRole('button', { name: labels.add, exact: true }))
    await activate(form.getByRole('button', { name: labels.remove + ' 3', exact: true }))
    const saveResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + readPath + '/update')
    await activate(form.getByRole('button', { name: labels.save, exact: true }))
    const saved = await saveResponse
    expect(saved.request().postDataJSON().hosts).toEqual([' BLOCKED.Example. ', 'BLOCKED.LOCALHOST.'])
    expect((await saved.json()).code).toBe(0)
    await expect(page.getByText(labels.saved, { exact: true })).toBeVisible(); await expect(first).toHaveValue('blocked.example')
    expect((await get<Policy>(request, readPath)).hosts).toEqual(['blocked.example', 'blocked.localhost'])
    const auditPath = '/admin/audit/list?actorId=' + scenario.userId + '&resourceType=system_setting&action=settings_change'
    const policyAudit = (await get<{ items: AuditItem[] }>(request, auditPath)).items
    expect(policyAudit).toHaveLength(1)
    expect(policyAudit[0]).toMatchObject({ actorId: scenario.userId, resourceId: 'security.target_host_denylist', changedFields: ['security.target_host_denylist'] })
    expect(Object.keys(policyAudit[0]!).sort()).toEqual(['action', 'actorId', 'actorUsername', 'changedFields', 'id', 'occurredAt', 'resourceId', 'resourceType'])
    expect(JSON.stringify(policyAudit)).not.toContain('blocked.example')
    expect(JSON.stringify(policyAudit)).not.toContain('blocked.localhost')
    await expectNoHorizontalOverflow(page)
    await form.scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('policy-saved-' + language + '-' + width + '.png') })

    await page.goto('/')
    const target = page.getByRole('textbox', { name: labels.target, exact: true })
    await target.fill('https://blocked.example/new')
    const single = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/short-link/create')
    await page.getByRole('button', { name: labels.create, exact: true }).click()
    expect((await (await single).json()).code).toBe(200121)
    await expect(page.getByText(labels.denied)).toBeVisible(); await expect(target).toHaveValue('https://blocked.example/new')

    await page.goto('/link')
    for (const mode of ['targets', 'titles', 'metadata', 'custom-slugs'] as const) {
      await activate(page.getByTestId('bulk-create-open'))
      const dialog = page.getByTestId('bulk-create-dialog')
      if (mode === 'targets') await dialog.getByRole('textbox').fill('https://blocked.example/bulk\nhttps://allowed.example/bulk')
      else {
        const header = mode === 'titles' ? 'target_url,title' : mode === 'metadata' ? 'target_url,title,tags' : 'target_url,title,tags,custom_slug'
        const fields = mode === 'titles' ? ',Policy' : mode === 'metadata' ? ',Policy,[]' : ',Policy,[],'
        await dialog.locator('input[type=file]').setInputFiles({ name: 'policy.csv', mimeType: 'text/csv', buffer: Buffer.from(header + '\nhttps://blocked.example/bulk' + fields + '\nhttps://allowed.example/bulk' + fields) })
        await expect(page.getByTestId('bulk-create-imported-list')).toBeVisible()
      }
      await activate(page.getByTestId('bulk-create-preview'))
      const id = await page.getByTestId('bulk-create-request-id').innerText()
      const endpoint = '/api/v1/short-link/batch-create' + (mode === 'targets' ? '' : '-with-' + mode)
      const result = page.waitForResponse(response => new URL(response.url()).pathname === endpoint)
      await activate(page.getByTestId('bulk-create-submit'))
      expect((await (await result).json()).code).toBe(200121)
      await expect(page.getByTestId('bulk-create-error')).toContainText(labels.bulkDenied)
      await expect(page.getByTestId('bulk-create-request-id')).toHaveText(id)
      await expect(page.getByTestId('bulk-create-edit')).toBeEnabled()
      expect((await ownLinks(page.request)).map(link => link.id)).toEqual([historical.id])
      if (mode === 'custom-slugs') { await expectNoHorizontalOverflow(page); await page.screenshot({ path: info.outputPath('policy-batch-denied-' + language + '-' + width + '.png') }) }
      await activate(page.getByTestId('bulk-create-close'))
      await expect(dialog).toBeHidden()
    }

    // Both real editors keep the changed target after a definite policy refusal.
    for (const scope of ['own', 'admin'] as const) {
      await page.goto(scope === 'own' ? '/link' : '/admin/link')
      const row = page.getByTestId('console-link-row').filter({ hasText: historical.slug })
      await row.getByRole('button', { name: labels.more, exact: true }).click()
      await page.getByRole('menuitem', { name: labels.configure, exact: true }).click()
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('textbox', { name: labels.editTarget, exact: true }).fill('https://blocked.example/changed')
      const result = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/' + (scope === 'admin' ? 'admin/' : '') + 'short-link/update')
      await dialog.getByRole('button', { name: labels.saveSettings, exact: true }).click()
      expect((await (await result).json()).code).toBe(200121)
      await expect(page.getByText(labels.denied)).toBeVisible()
      await expect(dialog.getByRole('textbox', { name: labels.editTarget, exact: true })).toHaveValue('https://blocked.example/changed')
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: info.outputPath('policy-' + scope + '-denied-' + language + '-' + width + '.png') })
    }

    const visitor = await browser.newContext({ baseURL: info.project.use.baseURL, serviceWorkers: 'block' }); scenario.context(visitor)
    expect((await get<{ items: AuditItem[] }>(request, auditPath)).items).toEqual(policyAudit)
    // Both the public redirect and its blocked-host destination are real, isolated local HTTP requests.
    const visit = await visitor.newPage()
    const redirected = visit.waitForResponse(response => new URL(response.url()).pathname === '/' + historical.slug)
    const destination = await visit.goto('/' + historical.slug)
    expect((await redirected).status()).toBe(302)
    expect((await redirected).headers().location).toBe(historicalTarget.href)
    await expect(visit).toHaveURL(historicalTarget.href)
    expect(destination?.status()).toBe(200)
    expect((await destination!.json()).code).toBe(0)
    // Explicit unchanged-byte API supplement, separate from browser editor assertions.
    await post(page.request, '/short-link/update', { id: historical.id, targetUrl: historical.targetUrl, metadata: { title: 'Unchanged target remains editable', tags: [] } })
    await post(page.request, '/admin/short-link/update', { id: historical.id, targetUrl: historical.targetUrl, metadata: { title: 'Admin unchanged target', tags: [] } })
    await create(page, 'https://sub.blocked.example/allowed', labels)
    await create(page, 'https://allowed.example/allowed', labels)

    // A 100-row stored list remains a normal form with a disabled add control, including on mobile.
    await write(request, Array.from({ length: 100 }, (_, index) => `host${String(index).padStart(3, '0')}.example`))
    await page.goto('/admin/setting')
    const maximum = page.getByRole('form', { name: labels.form, exact: true })
    await expect(maximum.getByRole('textbox')).toHaveCount(100)
    await expect(maximum.getByRole('button', { name: labels.add, exact: true })).toBeDisabled()
    await expectNoHorizontalOverflow(page)
    await activate(maximum.getByRole('button', { name: labels.clear, exact: true }))
    await expect(maximum.getByRole('textbox')).toHaveCount(0)
    expect((await get<Policy>(request, readPath)).hosts).toHaveLength(100)
    const cleared = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + readPath + '/update')
    await activate(maximum.getByRole('button', { name: labels.save, exact: true }))
    expect((await (await cleared).json()).code).toBe(0); expect((await get<Policy>(request, readPath)).hosts).toEqual([])
    await create(page, 'https://blocked.example/after-clear', labels)
  })
}

test('v0.61.0 en 390px visible refusal and editor geometry supplement', async ({ scenario }, info) => {
  test.setTimeout(120_000)
  const { page, request } = scenario, labels = text.en
  await write(request, [])
  const link = await create(page, 'https://blocked.example/geometry-fixture', labels)
  await write(request, ['blocked.example'])
  await page.goto('/link')
  await activate(page.getByTestId('bulk-create-open'))
  const bulk = page.getByTestId('bulk-create-dialog')
  await bulk.locator('input[type=file]').setInputFiles({ name: 'policy.csv', mimeType: 'text/csv', buffer: Buffer.from('target_url,title,tags,custom_slug\nhttps://blocked.example/bulk,Policy,[],\nhttps://allowed.example/bulk,Policy,[],') })
  await expect(page.getByTestId('bulk-create-imported-list')).toBeVisible()
  await activate(page.getByTestId('bulk-create-preview'))
  const rejected = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/short-link/batch-create-with-custom-slugs')
  await activate(page.getByTestId('bulk-create-submit'))
  expect((await (await rejected).json()).code).toBe(200121)
  const alert = page.getByTestId('bulk-create-error')
  await expect(alert).toContainText(labels.bulkDenied)
  await alert.scrollIntoViewIfNeeded()
  const refusal = await alert.evaluate(element => {
    const rect = (node: Element) => { const value = node.getBoundingClientRect(); return { left: value.left, right: value.right, top: value.top, bottom: value.bottom } }
    return { alert: rect(element), body: rect(element.closest('.v-card-text')!), viewportHeight: innerHeight }
  })
  expect(refusal.alert.top).toBeGreaterThanOrEqual(refusal.body.top - 1)
  expect(refusal.alert.bottom).toBeLessThanOrEqual(Math.min(refusal.body.bottom, refusal.viewportHeight) + 1)
  await info.attach('mobile-refusal-geometry', { body: JSON.stringify(refusal), contentType: 'application/json' })
  await page.screenshot({ path: info.outputPath('policy-batch-denied-visible-en-390.png') })
  await activate(page.getByTestId('bulk-create-close'))
  await expect(bulk).toBeHidden()
  const row = page.getByTestId('console-link-row').filter({ hasText: link.slug })
  await row.getByRole('button', { name: labels.more, exact: true }).click()
  await page.getByRole('menuitem', { name: labels.configure, exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: labels.editTarget, exact: true }).fill('https://blocked.example/changed')
  const result = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/short-link/update')
  await dialog.getByRole('button', { name: labels.saveSettings, exact: true }).click()
  expect((await (await result).json()).code).toBe(200121)
  await expect(page.getByText(labels.denied)).toBeVisible()
  const geometry = await dialog.locator('.short-link-settings-dialog').evaluate(card => {
    const rect = (node: Element) => { const value = node.getBoundingClientRect(); return { left: value.left, right: value.right, top: value.top, bottom: value.bottom } }
    return { card: rect(card), clientWidth: card.clientWidth, scrollWidth: card.scrollWidth, scrollLeft: card.scrollLeft, controls: Array.from(card.querySelectorAll('.v-btn-toggle button')).map(node => ({ text: node.textContent?.trim(), rect: rect(node) })) }
  })
  await info.attach('mobile-editor-geometry', { body: JSON.stringify(geometry), contentType: 'application/json' })
  await page.screenshot({ path: info.outputPath('policy-editor-geometry-en-390.png') })
})

for (const [operation, language, width] of [['load', 'en', 390], ['save', 'zh-CN', 1280]] as const) {
  test('v0.61.0 ' + language + ' ' + width + 'px server revocation clears the private ' + operation + ' draft', async ({ scenario }, info) => {
    const { page, request } = scenario, labels = text[language]
    await write(request, ['private.example'])
    await page.goto('/admin/setting')
    const form = page.getByRole('form', { name: labels.form, exact: true })
    const field = form.getByRole('textbox', { name: labels.host + ' 1', exact: true })
    await expect(field).toHaveValue('private.example')
    await field.fill('unsaved-private.example')
    type Group = { key: string; permissions: string[]; updatedAt: string }
    const adminGroup = async () => (await get<{ groups: Group[] }>(request, '/admin/user-group/list')).groups.find(group => group.key === 'admin')!
    const original = await adminGroup(), failures: unknown[] = []
    try {
      expect(original.permissions).toContain('system:manage')
      await post(request, '/admin/user-group/update-permissions', { groupKey: 'admin', permissions: original.permissions.filter(permission => permission !== 'system:manage'), expectedUpdatedAt: original.updatedAt })
      const refusal = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + readPath + (operation === 'save' ? '/update' : ''))
      const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/me')
      await activate(form.getByRole('button', { name: operation === 'save' ? labels.save : labels.reload, exact: true }))
      const rejected = await refusal
      expect(rejected.status()).toBe(200); expect((await rejected.json()).code).toBe(120001)
      const identity = (await (await refreshed).json()).data.user
      expect(identity.group).toBe('admin'); expect(identity.permissions).not.toContain('system:manage')
      await expect(form).toBeHidden()
      await expect(page.locator('input[name^=target-host-]')).toHaveCount(0)
      await info.attach('server-revocation', { body: JSON.stringify({ operation, status: rejected.status(), code: 120001, confirmedSystemManage: false, privateFormRemoved: true }), contentType: 'application/json' })
      await page.screenshot({ path: info.outputPath('policy-revoked-' + operation + '-' + language + '-' + width + '.png') })
    } catch (error) { failures.push(error) } finally {
      try {
        await post(request, '/admin/user-group/update-permissions', { groupKey: 'admin', permissions: original.permissions, expectedUpdatedAt: (await adminGroup()).updatedAt })
        expect([...(await adminGroup()).permissions].sort()).toEqual([...original.permissions].sort())
      } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, 'Server revocation or exact permission restoration failed')
    expect((await get<Policy>(request, readPath)).hosts).toEqual(['private.example'])
  })
}

async function activate(control: Locator) { await control.focus(); await control.press('Enter') }
async function create(page: Page, target: string, labels: typeof text[keyof typeof text]): Promise<Link> {
  await page.goto('/')
  const input = page.getByRole('textbox', { name: labels.target, exact: true }); await expect(input).toBeEnabled(); await input.fill(target)
  const result = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/short-link/create')
  await page.getByRole('button', { name: labels.create, exact: true }).click()
  const payload = await (await result).json(); expect(payload.code).toBe(0)
  return payload.data.shortLink as Link
}
async function ownLinks(request: APIRequestContext): Promise<Link[]> { return (await get<{ items: Link[] }>(request, '/short-link/list?page=1&pageSize=100')).items }
async function write(request: APIRequestContext, hosts: string[]) { return post<Policy>(request, readPath + '/update', { hosts, expectedUpdatedAt: (await get<Policy>(request, readPath)).updatedAt }) }
async function get<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get('/api/v1' + path, { timeout: 10_000 }); expect(response.status()).toBe(200)
  const payload = await response.json(); expect(payload.code).toBe(0); return payload.data as T
}
async function post<T = unknown>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await request.post('/api/v1' + path, { data, timeout: 10_000 }); expect(response.status()).toBe(200)
  const payload = await response.json(); expect(payload.code).toBe(0); return payload.data as T
}
