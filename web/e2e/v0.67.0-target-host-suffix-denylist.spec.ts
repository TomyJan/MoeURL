import { randomBytes } from 'node:crypto'
import { expect, test as base } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Locator, Page, Request } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

type Policy = { suffixes: string[]; updatedAt: string }
type Link = { id: string; slug: string; url: string; targetUrl: string }
type AuditItem = { id: string; actorId: string | null; actorUsername: string | null; resourceType: string; resourceId: string; action: string; changedFields: string[]; occurredAt: string }
type Scenario = { page: Page; request: APIRequestContext; userId: string; context(value: BrowserContext): void }
const readPath = '/admin/system/target-host-suffix-denylist'
const password = 'owned-target-suffix67-fixture'
const text = {
  en: { form: 'Blocked target host suffix settings', host: 'DNS suffix', add: 'Add suffix', remove: 'Remove suffix', clear: 'Clear list', reload: 'Reload blocked suffixes', save: 'Save blocked suffixes', saved: 'Blocked target host suffixes saved.', target: 'Enter link', create: 'Create short link', denied: /site restricts this target host/, bulkDenied: /restricts a target host/, more: 'More actions', configure: 'Access settings', editTarget: 'Target URL', saveSettings: 'Save' },
  'zh-CN': { form: '目标 DNS 后缀黑名单设置', host: 'DNS 后缀', add: '添加后缀', remove: '删除后缀', clear: '清空列表', reload: '重新加载后缀黑名单', save: '保存后缀黑名单', saved: '目标 DNS 后缀黑名单已保存。', target: '输入链接', create: '创建短链', denied: /目标主机被站点规则限制/, bulkDenied: /目标主机被站点规则限制/, more: '更多操作', configure: '访问配置', editTarget: '目标链接', saveSettings: '保存' },
} as const

const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, request }, use, info) => {
    await post(request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
    const original = await get<Policy>(request, readPath)
    const originalExact = await get<{ hosts: string[]; updatedAt: string }>(request, '/admin/system/target-host-denylist')
    const originalAllow = await get<{ enabled: boolean; hosts: string[]; updatedAt: string }>(request, '/admin/system/target-host-allowlist')
    const contexts: BrowserContext[] = [], failures: unknown[] = []
    let user: { id: string; username: string } | undefined, page: Page | undefined
    try {
      await post(request, '/admin/system/target-host-denylist/update', { hosts: [], expectedUpdatedAt: originalExact.updatedAt })
      await setAllowlist(request, false, [])
      user = (await post<{ user: { id: string; username: string } }>(request, '/admin/user/create', { username: 'suffix67-' + randomBytes(7).toString('hex'), password, nickname: 'Owned target-policy fixture', groupKey: 'admin', status: 'active' })).user
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
      try { await write(request, original.suffixes); expect((await get<Policy>(request, readPath)).suffixes).toEqual(original.suffixes) } catch (error) { failures.push(error) }
      try { await post(request, '/admin/system/target-host-denylist/update', { hosts: originalExact.hosts, expectedUpdatedAt: (await get<{ updatedAt: string }>(request, '/admin/system/target-host-denylist')).updatedAt }) } catch (error) { failures.push(error) }
      try { await setAllowlist(request, originalAllow.enabled, originalAllow.hosts) } catch (error) { failures.push(error) }
      if (page && user) {
        try {
          await post(page.request, '/auth/login', { username: user.username, password })
          expect((await get<{ user: { id: string } }>(page.request, '/auth/me')).user.id).toBe(user.id)
          for (const link of await ownLinks(page.request)) await post(request, '/admin/short-link/delete', { id: link.id })
        } catch (error) { failures.push(error) }
      }
      if (user) { try { await post(request, '/admin/user/update', { id: user.id, nickname: 'Retired target-policy fixture', status: 'disabled' }) } catch (error) { failures.push(error) } }
      for (const context of contexts) { try { await context.close() } catch (error) { failures.push(error) } }
    }
    if (failures.length) throw new AggregateError(failures, 'Target policy scenario or exact fixture restoration failed')
  }, { timeout: 90_000 }],
})
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const language of ['en', 'zh-CN'] as const) for (const width of [1280, 390]) {
  test('v0.67.0 ' + language + ' ' + width + 'px suffix policy, seven writes and historical access', async ({ scenario, browser }, info) => {
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
    await activate(form.getByRole('button', { name: labels.add, exact: true }))
    await form.getByRole('textbox', { name: labels.host + ' 3', exact: true }).fill('XN--BCHER-KVA.EXAMPLE.')
    const saveResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + readPath + '/update')
    await activate(form.getByRole('button', { name: labels.save, exact: true }))
    const saved = await saveResponse
    expect(saved.request().postDataJSON().suffixes).toEqual([' BLOCKED.Example. ', 'BLOCKED.LOCALHOST.', 'XN--BCHER-KVA.EXAMPLE.'])
    expect((await saved.json()).code).toBe(0)
    await expect(page.getByText(labels.saved, { exact: true })).toBeVisible(); await expect(first).toHaveValue('blocked.example')
    expect((await get<Policy>(request, readPath)).suffixes).toEqual(['blocked.example', 'blocked.localhost', 'xn--bcher-kva.example'])
    const auditPath = '/admin/audit/list?actorId=' + scenario.userId + '&resourceType=system_setting&action=settings_change'
    const policyAudit = (await get<{ items: AuditItem[] }>(request, auditPath)).items
    expect(policyAudit).toHaveLength(1)
    expect(policyAudit[0]).toMatchObject({ actorId: scenario.userId, resourceId: 'security.target_host_suffix_denylist', changedFields: ['security.target_host_suffix_denylist'] })
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
    for (const deniedTarget of ['https://sub.blocked.example/new', 'https://deep.sub.blocked.example/new', 'https://sub.xn--bcher-kva.example/new']) {
      await page.goto('/')
      await page.getByRole('textbox', { name: labels.target, exact: true }).fill(deniedTarget)
      const rejected = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/short-link/create')
      await page.getByRole('button', { name: labels.create, exact: true }).click()
      expect((await (await rejected).json()).code).toBe(200121)
      await expect(page.getByText(labels.denied)).toBeVisible()
    }
    const unicode = await page.request.post('/api/v1/short-link/create', { data: { targetUrl: 'https://sub.bücher.example/new' } })
    expect(unicode.status()).toBe(200); expect((await unicode.json()).code).toBe(200121)
    for (const allowedTarget of ['https://badblocked.example/allowed', 'https://blocked.example.evil.test/allowed', 'https://allowed.example/allowed']) await create(page, allowedTarget, labels)
    // Exact allowance must never override a matching suffix denial.
    await setAllowlist(request, true, ['blocked.example'])
    await page.goto('/')
    await page.getByRole('textbox', { name: labels.target, exact: true }).fill('https://blocked.example/allow-overlap')
    const overlap = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/short-link/create')
    await page.getByRole('button', { name: labels.create, exact: true }).click()
    expect((await (await overlap).json()).code).toBe(200121)
    await setAllowlist(request, false, [])


    // A 100-row stored list remains a normal form with a disabled add control, including on mobile.
    await write(request, Array.from({ length: 100 }, (_, index) => `host${String(index).padStart(3, '0')}.example`))
    await page.goto('/admin/setting')
    const maximum = page.getByRole('form', { name: labels.form, exact: true })
    await expect(maximum.getByRole('textbox')).toHaveCount(100)
    await expect(maximum.getByRole('button', { name: labels.add, exact: true })).toBeDisabled()
    await expectNoHorizontalOverflow(page)
    await activate(maximum.getByRole('button', { name: labels.clear, exact: true }))
    await expect(maximum.getByRole('textbox')).toHaveCount(0)
    expect((await get<Policy>(request, readPath)).suffixes).toHaveLength(100)
    const cleared = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + readPath + '/update')
    await activate(maximum.getByRole('button', { name: labels.save, exact: true }))
    expect((await (await cleared).json()).code).toBe(0); expect((await get<Policy>(request, readPath)).suffixes).toEqual([])
    await create(page, 'https://blocked.example/after-clear', labels)
  })
}

for (const [operation, language, width] of [['load', 'en', 390], ['save', 'zh-CN', 1280]] as const) {
  test('v0.67.0 ' + language + ' ' + width + 'px server revocation clears the private ' + operation + ' draft', async ({ scenario }, info) => {
    const { page, request } = scenario, labels = text[language]
    await write(request, ['private.example'])
    await page.goto('/admin/setting')
    const form = page.getByRole('form', { name: labels.form, exact: true })
    const field = form.getByRole('textbox', { name: labels.host + ' 1', exact: true })
    await expect(field).toHaveValue('private.example')
    await field.fill('unsaved-private.example')
    const original = (await get<{ user: { id: string; username: string; nickname: string } }>(page.request, '/auth/me')).user
    expect(original.id).toBe(scenario.userId)
    const failures: unknown[] = []
    try {
      // Disable only this disposable account; protected administrator grants are immutable.
      const disabled = await post<{ user: { id: string; status: string } }>(request, '/admin/user/update', { id: original.id, nickname: original.nickname, status: 'disabled' })
      expect(disabled.user).toMatchObject({ id: original.id, status: 'disabled' })
      const refusal = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + readPath + (operation === 'save' ? '/update' : ''))
      const refreshed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/me')
      await activate(form.getByRole('button', { name: operation === 'save' ? labels.save : labels.reload, exact: true }))
      const rejected = await refusal
      expect(rejected.status()).toBe(200); expect((await rejected.json()).code).toBe(120001)
      const identity = (await (await refreshed).json()).data.user
      expect(identity.group).toBe('guest'); expect(identity.permissions).not.toContain('system:manage')
      await expect(form).toBeHidden()
      await expect(page.locator('input[name^=target-suffix-host-]')).toHaveCount(0)
      await info.attach('server-revocation', { body: JSON.stringify({ operation, status: rejected.status(), code: 120001, disabledOwnedAccount: true, confirmedGuest: true, privateFormRemoved: true }), contentType: 'application/json' })
      await page.screenshot({ path: info.outputPath('policy-revoked-' + operation + '-' + language + '-' + width + '.png') })
    } catch (error) { failures.push(error) } finally {
      try {
        const restored = await post<{ user: { id: string; nickname: string; status: string } }>(request, '/admin/user/update', { id: original.id, nickname: original.nickname, status: 'active' })
        expect(restored.user).toMatchObject({ id: original.id, nickname: original.nickname, status: 'active' })
        await post(page.request, '/auth/login', { username: original.username, password })
        expect((await get<{ user: { id: string } }>(page.request, '/auth/me')).user.id).toBe(original.id)
      } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, 'Server revocation or owned account restoration failed')
    expect((await get<Policy>(request, readPath)).suffixes).toEqual(['private.example'])
  })
}

for (const [operation, language, width] of [['load', 'en', 390], ['save', 'zh-CN', 1280]] as const) {
  test('v0.67.0 ' + language + ' ' + width + 'px same SPA account change retires delayed suffix ' + operation, async ({ scenario }, info) => {
    const { page, request } = scenario, labels = text[language]
    const failures: unknown[] = []
    let nextUser: { id: string; username: string } | undefined
    let release: (() => void) | undefined
    let held: Request | undefined, terminal: 'finished' | 'failed' | undefined
    let captured = false, fulfillReturned = false, fulfillError: unknown
    const onFinished = (value: Request) => { if (value === held) terminal = 'finished' }
    const onFailed = (value: Request) => { if (value === held) terminal = 'failed' }
    page.on('requestfinished', onFinished); page.on('requestfailed', onFailed)
    try {
      nextUser = (await post<{ user: { id: string; username: string } }>(request, '/admin/user/create', { username: 'suffix67-next-' + randomBytes(7).toString('hex'), password, nickname: 'Next suffix fixture', groupKey: 'admin', status: 'active' })).user
      await write(request, ['private.example'])
      await page.goto('/admin/setting')
      const form = page.getByRole('form', { name: labels.form, exact: true })
      await expect(form.getByRole('textbox', { name: labels.host + ' 1', exact: true })).toHaveValue('private.example')
      await form.getByRole('textbox', { name: labels.host + ' 1', exact: true }).fill('unsaved-private.example')
      const marker = randomBytes(12).toString('hex')
      await page.evaluate(value => { (window as Window & { suffix67Marker?: string }).suffix67Marker = value }, marker)
      const gate = new Promise<void>(resolve => { release = resolve })
      let processed!: () => void
      const handled = new Promise<void>(resolve => { processed = resolve })
      await page.route('**/api/v1' + readPath + (operation === 'save' ? '/update' : ''), async route => {
        held = route.request()
        try {
          const result = await route.fetch(), payload = await result.json()
          expect(payload.code).toBe(0)
          expect(payload.data.suffixes).toEqual([operation === 'save' ? 'unsaved-private.example' : 'private.example'])
          captured = true
          await gate
          await route.fulfill({ response: result }); fulfillReturned = true
        } catch (error) { fulfillError = error; await route.abort('failed').catch(() => undefined) }
        finally { processed() }
      }, { times: 1 })
      await activate(form.getByRole('button', { name: operation === 'save' ? labels.save : labels.reload, exact: true }))
      await expect.poll(() => captured || Boolean(fulfillError)).toBe(true)
      if (fulfillError) throw fulfillError
      const signedOut = page.waitForResponse(value => new URL(value.url()).pathname === '/api/v1/auth/logout')
      if (width === 390) {
        await page.getByRole('button', { name: /^(打开账号菜单|Open account menu)$/ }).click()
        await page.getByTestId('console-mobile-account-menu').getByRole('menuitem', { name: /^(退出登录|Sign out)$/ }).click()
      } else await page.getByTestId('console-account').getByRole('button', { name: /^(退出登录|Sign out)$/ }).click()
      expect((await (await signedOut).json()).code).toBe(0)
      await expect(page).toHaveURL(url => url.pathname === '/login')
      await expect(page.locator('input[name^=target-suffix-host-]')).toHaveCount(0)
      expect(await page.evaluate(() => (window as Window & { suffix67Marker?: string }).suffix67Marker)).toBe(marker)
      await write(request, ['current.example'])
      await page.getByLabel(/^(账号|Username)$/).fill(nextUser.username)
      await page.getByLabel(/^(密码|Password)$/).fill(password)
      const signedIn = page.waitForResponse(value => new URL(value.url()).pathname === '/api/v1/auth/login')
      await page.getByRole('button', { name: /^(登录|Sign in)$/ }).click()
      expect((await (await signedIn).json()).data.user.id).toBe(nextUser.id)
      await expect(page).not.toHaveURL(url => url.pathname === '/login')
      if (new URL(page.url()).pathname === '/') {
        await page.getByRole('button', { name: 'Next suffix fixture', exact: true }).click()
        await expect(page).toHaveURL(/\/profile$/)
      }
      if (new URL(page.url()).pathname !== '/admin/setting') {
        if (width === 390) await page.locator('button.console-topbar__menu').click()
        await page.locator('a[href="/admin/setting"]').filter({ visible: true }).click()
      }
      const currentForm = page.getByRole('form', { name: /^(目标 DNS 后缀黑名单设置|Blocked target host suffix settings)$/ })
      await expect(currentForm.getByRole('textbox')).toHaveValue('current.example')
      expect((await get<{ user: { id: string } }>(page.request, '/auth/me')).user.id).toBe(nextUser.id)
      release!(); await handled
      if (fulfillError) throw fulfillError
      await expect.poll(() => terminal).toMatch(/^(finished|failed)$/)
      if (terminal === 'finished') {
        expect(held!.failure()).toBeNull()
        const response = await held!.response(); expect(response).not.toBeNull()
        expect(await response!.finished()).toBeNull(); expect((await response!.json()).code).toBe(0)
      } else expect(held!.failure()?.errorText).toBeTruthy()
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      await expect(currentForm.getByRole('textbox')).toHaveValue('current.example')
      expect(await page.evaluate(() => (window as Window & { suffix67Marker?: string }).suffix67Marker)).toBe(marker)
      await expectNoHorizontalOverflow(page)
      await info.attach('suffix-identity-network-terminal', { body: JSON.stringify({ from: scenario.userId, to: nextUser.id, operation, terminal, fulfillReturned, runtimeRetained: true, browserProcessingBoundary: 'two-animation-frames-after-network-terminal', currentValue: 'current.example' }), contentType: 'application/json' })
      await page.screenshot({ path: info.outputPath('suffix-identity-' + operation + '-' + language + '-' + width + '.png') })
    } catch (error) { failures.push(error) }
    finally {
      release?.(); page.off('requestfinished', onFinished); page.off('requestfailed', onFailed)
      if (nextUser) { try { await post(request, '/admin/user/update', { id: nextUser.id, nickname: 'Retired next suffix fixture', status: 'disabled' }) } catch (error) { failures.push(error) } }
    }
    if (failures.length) throw new AggregateError(failures, 'Same SPA suffix request or exact fixture cleanup failed')
  })
}

async function setAllowlist(request: APIRequestContext, enabled: boolean, hosts: string[]) {
  const current = await get<{ updatedAt: string }>(request, '/admin/system/target-host-allowlist')
  return post(request, '/admin/system/target-host-allowlist/update', { enabled, hosts, expectedUpdatedAt: current.updatedAt })
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
async function write(request: APIRequestContext, suffixes: string[]) { return post<Policy>(request, readPath + '/update', { suffixes, expectedUpdatedAt: (await get<Policy>(request, readPath)).updatedAt }) }
async function get<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get('/api/v1' + path, { timeout: 10_000 }); expect(response.status()).toBe(200)
  const payload = await response.json(); expect(payload.code).toBe(0); return payload.data as T
}
async function post<T = unknown>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await request.post('/api/v1' + path, { data, timeout: 10_000 }); expect(response.status()).toBe(200)
  const payload = await response.json(); expect(payload.code).toBe(0); return payload.data as T
}
