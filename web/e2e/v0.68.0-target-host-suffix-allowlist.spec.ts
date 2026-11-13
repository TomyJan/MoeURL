import { randomBytes } from 'node:crypto'
import { expect, test as base } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Locator, Page, Request } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

type Policy = { enabled: boolean; suffixes: string[]; updatedAt: string }
type Deny = { hosts: string[]; updatedAt: string }
type ExactAllow = { enabled: boolean; hosts: string[]; updatedAt: string }
type SuffixDeny = { suffixes: string[]; updatedAt: string }
type Link = { id: string; slug: string; url: string; targetUrl: string }
type Scenario = { page: Page; request: APIRequestContext; userId: string; context(value: BrowserContext): void }
type Mode = 'targets' | 'titles' | 'metadata' | 'custom-slugs'
const path = '/admin/system/target-host-suffix-allowlist'
const denyPath = '/admin/system/target-host-denylist'
const password = 'owned-target-suffix-allowlist68-fixture'
const text = {
  en: { form: 'Allowed target DNS suffix settings', enabled: 'Enable target DNS suffix allowlist', host: 'DNS suffix', add: 'Add suffix', clear: 'Clear list', reload: 'Reload allowed suffixes', save: 'Save allowed suffixes', saved: 'Allowed target DNS suffixes saved.', empty: 'Add at least one valid suffix before enabling. Clearing the list does not switch the allowlist off.', target: 'Enter link', create: 'Create short link', denied: /site restricts this target host/, bulkDenied: /restricts a target host/, more: 'More actions', configure: 'Access settings', editTarget: 'Target URL', saveSettings: 'Save' },
  'zh-CN': { form: '目标 DNS 后缀白名单设置', enabled: '启用目标 DNS 后缀白名单', host: 'DNS 后缀', add: '添加后缀', clear: '清空列表', reload: '重新加载后缀白名单', save: '保存后缀白名单', saved: '目标 DNS 后缀白名单已保存。', empty: '启用白名单前请至少添加一个有效后缀；清空列表不会自动关闭白名单。', target: '输入链接', create: '创建短链', denied: /目标主机被站点规则限制/, bulkDenied: /目标主机被站点规则限制/, more: '更多操作', configure: '访问配置', editTarget: '目标链接', saveSettings: '保存' },
} as const

const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, request }, use, info) => {
    const contexts: BrowserContext[] = [], failures: unknown[] = []
    let original: Policy | undefined, deny: Deny | undefined, exactAllow: ExactAllow | undefined, suffixDeny: SuffixDeny | undefined
    let user: { id: string; username: string } | undefined, page: Page | undefined
    try {
      await post(request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      // Register both original resources before the first fixture mutation.
      original = await get<Policy>(request, path)
      deny = await get<Deny>(request, denyPath)
      exactAllow = await get<ExactAllow>(request, '/admin/system/target-host-allowlist')
      suffixDeny = await get<SuffixDeny>(request, '/admin/system/target-host-suffix-denylist')
      await writeDeny(request, []); await setExactAllow(request, false, []); await setSuffixDeny(request, [])
      user = (await post<{ user: { id: string; username: string } }>(request, '/admin/user/create', { username: 'suffix68-' + randomBytes(7).toString('hex'), password, nickname: 'Owned allowlist fixture', groupKey: 'admin', status: 'active' })).user
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
      if (original) { try { await write(request, original.enabled, original.suffixes); expect(await get<Policy>(request, path)).toMatchObject({ enabled: original.enabled, suffixes: original.suffixes }) } catch (error) { failures.push(error) } }
      if (deny) { try { await writeDeny(request, deny.hosts); expect((await get<Deny>(request, denyPath)).hosts).toEqual(deny.hosts) } catch (error) { failures.push(error) } }
      if (exactAllow) { try { await setExactAllow(request, exactAllow.enabled, exactAllow.hosts) } catch (error) { failures.push(error) } }
      if (suffixDeny) { try { await setSuffixDeny(request, suffixDeny.suffixes) } catch (error) { failures.push(error) } }
      if (page) { try { for (const link of await ownLinks(page.request)) await post(request, '/admin/short-link/delete', { id: link.id }) } catch (error) { failures.push(error) } }
      if (user) { try { await post(request, '/admin/user/update', { id: user.id, nickname: 'Retired allowlist fixture', status: 'disabled' }) } catch (error) { failures.push(error) } }
      for (const context of contexts) { try { await context.close() } catch (error) { failures.push(error) } }
    }
    if (failures.length) throw new AggregateError(failures, 'Allowlist scenario or exact fixture restoration failed')
  }, { timeout: 120_000 }],
})
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const language of ['en', 'zh-CN'] as const) for (const width of [1280, 390]) {
  test('v0.68.0 ' + language + ' ' + width + 'px optional policy, seven writes and historical access', async ({ scenario, browser }, info) => {
    test.setTimeout(180_000)
    const { page, request } = scenario, labels = text[language]
    await write(request, false, []); await writeDeny(request, [])
    const historicalTarget = new URL('/api/v1/health', info.project.use.baseURL as string)
    historicalTarget.hostname = 'historical.localhost'
    const historical = await create(page, historicalTarget.href, labels)
    await page.goto('/admin/setting')
    const form = page.getByRole('form', { name: labels.form, exact: true })
    const warning = page.locator('.target-suffix-allowlist').getByText(language === 'en' ? /com allows all \.com targets unless a deny rule matches/ : /com 会允许所有 \.com 目标，除非命中拒绝规则/)
    await warning.scrollIntoViewIfNeeded(); await expect(warning).toBeVisible()
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: info.outputPath('suffix-allowlist-warning-' + language + '-' + width + '.png') })
    const toggle = form.getByLabel(labels.enabled, { exact: true })
    await expect(toggle).toBeEnabled(); await expect(toggle).not.toBeChecked()
    await toggle.focus(); await toggle.press('Space'); await expect(toggle).toBeChecked()
    await activate(form.getByRole('button', { name: labels.save, exact: true }))
    await expect(form.getByText(labels.empty, { exact: true })).toBeVisible()
    expect(await get<Policy>(request, path)).toMatchObject({ enabled: false, suffixes: [] })
    const addHost = form.getByRole('button', { name: labels.add, exact: true })
    if (width === 390) await addHost.tap()
    else await activate(addHost)
    const first = form.getByRole('textbox', { name: labels.host + ' 1', exact: true })
    await first.focus(); await page.keyboard.type(' ALLOWED.Example. ')
    await activate(form.getByRole('button', { name: labels.add, exact: true }))
    await form.getByRole('textbox', { name: labels.host + ' 2', exact: true }).fill('DENIED.EXAMPLE.')
    await activate(form.getByRole('button', { name: labels.add, exact: true }))
    await form.getByRole('textbox', { name: labels.host + ' 3', exact: true }).fill('XN--BCHER-KVA.EXAMPLE.')
    const savedResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + path + '/update')
    await activate(form.getByRole('button', { name: labels.save, exact: true }))
    const saved = await savedResponse
    expect(saved.request().postDataJSON()).toMatchObject({ enabled: true, suffixes: [' ALLOWED.Example. ', 'DENIED.EXAMPLE.', 'XN--BCHER-KVA.EXAMPLE.'] })
    expect((await saved.json()).code).toBe(0)
    await expect(page.getByText(labels.saved, { exact: true })).toBeVisible(); await expect(first).toHaveValue('allowed.example')
    expect(await get<Policy>(request, path)).toMatchObject({ enabled: true, suffixes: ['allowed.example', 'denied.example', 'xn--bcher-kva.example'] })
    const audits = (await get<{ items: { actorId: string; resourceId: string; changedFields: string[] }[] }>(request, '/admin/audit/list?actorId=' + scenario.userId + '&resourceType=system_setting&action=settings_change')).items
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ actorId: scenario.userId, resourceId: 'security.target_host_suffix_allowlist', changedFields: ['security.target_host_suffix_allowlist'] })
    expect(JSON.stringify(audits)).not.toContain('allowed.example')
    await expectNoHorizontalOverflow(page)
    const card = page.locator('.target-suffix-allowlist')
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
    for (const url of ['https://sub.allowed.example/new', 'https://deep.sub.allowed.example/new', 'https://sub.xn--bcher-kva.example/new']) await create(page, url, labels)
    const unicode = 'https://sub.bücher.example/new'
    expect(await post<{ shortLink: Link }>(page.request, '/short-link/create', { targetUrl: unicode })).toMatchObject({ shortLink: { targetUrl: unicode } })
    // The two enabled allowlists form a union; neither deny rule can be overridden.
    await enableExactUnionThroughUI(page, language, ['exact-only.test', 'blocked.allowed.example'])
    await create(page, 'https://exact-only.test/union-exact', labels)
    await create(page, 'https://deep.allowed.example/union-suffix', labels)
    await setSuffixDeny(request, ['blocked.allowed.example'])

    for (const targetUrl of ['https://other.example/new', 'https://badallowed.example/new', 'https://allowed.example.evil.test/new', 'https://denied.example/new', 'https://blocked.allowed.example/new', 'https://deep.blocked.allowed.example/new']) {
      await page.goto('/')
      const target = page.getByRole('textbox', { name: labels.target, exact: true }); await target.fill(targetUrl)
      const result = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/short-link/create')
      await page.getByRole('button', { name: labels.create, exact: true }).click()
      expect((await (await result).json()).code).toBe(200121)
      await expect(page.getByText(labels.denied)).toBeVisible(); await expect(target).toHaveValue(targetUrl)
    }
    // A documentation-range IP passes the existing target syntax validator;
    // test allowlist rejection through real HTTP without navigating to that IP.
    await setExactAllow(request, false, [])
    const ip = await page.request.post('/api/v1/short-link/create', { data: { targetUrl: 'https://192.0.2.1/new' } })
    expect(ip.status()).toBe(200); expect((await ip.json()).code).toBe(200121)

    for (const mode of ['targets', 'titles', 'metadata', 'custom-slugs'] as const) {
      await page.goto('/link')
      let dialog = await batch(page, mode, ['https://allowed.example/bulk-a', 'https://deep.allowed.example/bulk-b'])
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
      await target.fill('https://sub.allowed.example/editor')
      const allowed = page.waitForResponse(response => new URL(response.url()).pathname === endpoint)
      await dialog.getByRole('button', { name: labels.saveSettings, exact: true }).click()
      expect((await (await allowed).json()).code).toBe(0); await expect(dialog).toBeHidden()
      // Independent same-byte API supplement restores the historical URL while disabled.
      await write(request, false, ['allowed.example', 'denied.example', 'xn--bcher-kva.example'])
      await post(page.request, '/short-link/update', { id: historical.id, targetUrl: historicalTarget.href })
      await write(request, true, ['allowed.example', 'denied.example', 'xn--bcher-kva.example'])
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

    // A concurrent administrator save must retain the local draft and block another write.
    await page.goto('/admin/setting')
    await form.getByRole('textbox', { name: labels.host + ' 1', exact: true }).fill('draft.example')
    await write(request, true, ['server.example'])
    const conflict = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + path + '/update')
    await activate(form.getByRole('button', { name: labels.save, exact: true }))
    expect((await (await conflict).json()).code).toBe(900219)
    await expect(form.getByRole('textbox', { name: labels.host + ' 1', exact: true })).toHaveValue('draft.example')
    await expect(form.getByRole('button', { name: labels.save, exact: true })).toBeDisabled()
    await expect(form.getByText(language === 'en' ? /Another request changed the suffix list/ : /后缀白名单已被其他请求修改/)).toBeVisible()
    await activate(form.getByRole('button', { name: labels.reload, exact: true }))
    await expect(form.getByRole('textbox')).toHaveValue('server.example')
    await expect(form.getByRole('button', { name: labels.save, exact: true })).toBeEnabled()

    await write(request, true, Array.from({ length: 100 }, (_, index) => `host${String(index).padStart(3, '0')}.example`))
    await page.goto('/admin/setting'); await expect(form.getByRole('textbox')).toHaveCount(100)
    await expect(form.getByRole('button', { name: labels.add, exact: true })).toBeDisabled()
    await expectNoHorizontalOverflow(page)
    await activate(form.getByRole('button', { name: labels.clear, exact: true }))
    await expect(form.getByRole('textbox')).toHaveCount(0); await expect(toggle).toBeChecked()
    await activate(form.getByRole('button', { name: labels.save, exact: true }))
    await expect(form.getByText(labels.empty, { exact: true })).toBeVisible()
    expect((await get<Policy>(request, path)).suffixes).toHaveLength(100)
    await activate(form.getByRole('button', { name: labels.reload, exact: true })); await expect(form.getByRole('textbox')).toHaveCount(100)
    await toggle.uncheck(); await expect(form.getByRole('textbox')).toHaveCount(100)
    const off = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + path + '/update')
    await activate(form.getByRole('button', { name: labels.save, exact: true })); expect((await (await off).json()).code).toBe(0)
    expect(await get<Policy>(request, path)).toMatchObject({ enabled: false, suffixes: expect.any(Array) }); expect((await get<Policy>(request, path)).suffixes).toHaveLength(100)
    await create(page, 'https://other.example/after-switch-off', labels)
    await setExactAllow(request, true, ['exact-only.test'])
    const disabledPreconfiguration = await page.request.post('/api/v1/short-link/create', { data: { targetUrl: 'https://host000.example/disabled-preconfiguration' } })
    expect(disabledPreconfiguration.status()).toBe(200); expect((await disabledPreconfiguration.json()).code).toBe(200121)
    await setExactAllow(request, false, [])
    await page.goto('/admin/setting'); await expect(toggle).not.toBeChecked()
    await expect(form.getByRole('textbox')).toHaveCount(100)
    await activate(form.getByRole('button', { name: labels.clear, exact: true }))
    const emptyOff = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + path + '/update')
    await activate(form.getByRole('button', { name: labels.save, exact: true })); expect((await (await emptyOff).json()).code).toBe(0)
    await expect(toggle).not.toBeChecked(); expect(await get<Policy>(request, path)).toMatchObject({ enabled: false, suffixes: [] })
    await form.scrollIntoViewIfNeeded(); await page.screenshot({ path: info.outputPath('allowlist-disabled-empty-' + language + '-' + width + '.png') })
  })
}

for (const [operation, language, width] of [['load', 'en', 390], ['save', 'zh-CN', 1280]] as const) {
  test('v0.68.0 ' + language + ' ' + width + 'px server revocation clears private ' + operation + ' draft', async ({ scenario }, info) => {
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
      await expect(form).toBeHidden(); await expect(page.locator('input[name^=allowed-target-suffix-]')).toHaveCount(0)
      await info.attach('server-revocation', { body: JSON.stringify({ operation, status: 200, code: 120001, disabledOwnedAccount: true, confirmedGuest: true, privateFormRemoved: true }), contentType: 'application/json' })
      await page.screenshot({ path: info.outputPath('allowlist-revoked-' + operation + '-' + language + '-' + width + '.png') })
    } catch (error) { failures.push(error) } finally {
      try { await post(request, '/admin/user/update', { id: original.id, nickname: original.nickname, status: 'active' }); await post(page.request, '/auth/login', { username: original.username, password }) } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, 'Revocation or owned account restoration failed')
    expect(await get<Policy>(request, path)).toMatchObject({ enabled: true, suffixes: ['private.example'] })
  })
}

for (const [operation, language, width] of [['load', 'en', 390], ['save', 'zh-CN', 1280]] as const) {
  test('v0.68.0 ' + language + ' ' + width + 'px same SPA account change retires delayed suffix ' + operation, async ({ scenario }, info) => {
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
      nextUser = (await post<{ user: { id: string; username: string } }>(request, '/admin/user/create', { username: 'suffix68-next-' + randomBytes(7).toString('hex'), password, nickname: 'Next suffix fixture', groupKey: 'admin', status: 'active' })).user
      await write(request, true, ['private.example'])
      await page.goto('/admin/setting')
      const form = page.getByRole('form', { name: labels.form, exact: true })
      await expect(form.getByRole('textbox', { name: labels.host + ' 1', exact: true })).toHaveValue('private.example')
      await form.getByRole('textbox', { name: labels.host + ' 1', exact: true }).fill('unsaved-private.example')
      const marker = randomBytes(12).toString('hex')
      await page.evaluate(value => { (window as Window & { suffix68Marker?: string }).suffix68Marker = value }, marker)
      const gate = new Promise<void>(resolve => { release = resolve })
      let processed!: () => void
      const handled = new Promise<void>(resolve => { processed = resolve })
      await page.route('**/api/v1' + path + (operation === 'save' ? '/update' : ''), async route => {
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
      await expect(page.locator('input[name^=allowed-target-suffix-]')).toHaveCount(0)
      expect(await page.evaluate(() => (window as Window & { suffix68Marker?: string }).suffix68Marker)).toBe(marker)
      await write(request, true, ['current.example'])
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
      const currentForm = page.getByRole('form', { name: /^(目标 DNS 后缀白名单设置|Allowed target DNS suffix settings)$/ })
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
      expect(await page.evaluate(() => (window as Window & { suffix68Marker?: string }).suffix68Marker)).toBe(marker)
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
async function write(request: APIRequestContext, enabled: boolean, suffixes: string[]) { return post<Policy>(request, path + '/update', { enabled, suffixes, expectedUpdatedAt: (await get<Policy>(request, path)).updatedAt }) }
async function writeDeny(request: APIRequestContext, hosts: string[]) { return post<Deny>(request, denyPath + '/update', { hosts, expectedUpdatedAt: (await get<Deny>(request, denyPath)).updatedAt }) }
async function setExactAllow(request: APIRequestContext, enabled: boolean, hosts: string[]) {
  const current = await get<ExactAllow>(request, '/admin/system/target-host-allowlist')
  return post<ExactAllow>(request, '/admin/system/target-host-allowlist/update', { enabled, hosts, expectedUpdatedAt: current.updatedAt })
}
async function enableExactUnionThroughUI(page: Page, language: keyof typeof text, hosts: string[]) {
  await page.goto('/admin/setting')
  const english = language === 'en'
  const form = page.getByRole('form', { name: english ? 'Allowed target host settings' : '目标主机白名单设置', exact: true })
  const toggle = form.getByLabel(english ? 'Enable target host allowlist' : '启用目标主机白名单', { exact: true })
  await expect(toggle).toBeEnabled(); await expect(toggle).not.toBeChecked()
  await expect(form.getByRole('textbox')).toHaveCount(0)
  for (const [index, host] of hosts.entries()) {
    await activate(form.getByRole('button', { name: english ? 'Add host' : '添加主机', exact: true }))
    await form.getByRole('textbox', { name: (english ? 'Host ' : '主机 ') + (index + 1), exact: true }).fill(host)
  }
  await toggle.check()
  const response = page.waitForResponse(value => new URL(value.url()).pathname === '/api/v1/admin/system/target-host-allowlist/update')
  await activate(form.getByRole('button', { name: english ? 'Save allowed hosts' : '保存白名单', exact: true }))
  const result = await response
  expect(result.request().postDataJSON()).toMatchObject({ enabled: true, hosts })
  expect((await result.json()).code).toBe(0)
}
async function setSuffixDeny(request: APIRequestContext, suffixes: string[]) {
  const current = await get<SuffixDeny>(request, '/admin/system/target-host-suffix-denylist')
  return post<SuffixDeny>(request, '/admin/system/target-host-suffix-denylist/update', { suffixes, expectedUpdatedAt: current.updatedAt })
}
async function get<T>(request: APIRequestContext, resource: string): Promise<T> {
  const response = await request.get('/api/v1' + resource, { timeout: 10_000 }); expect(response.status()).toBe(200)
  const payload = await response.json(); expect(payload.code).toBe(0); return payload.data as T
}
async function post<T = unknown>(request: APIRequestContext, resource: string, data: unknown): Promise<T> {
  const response = await request.post('/api/v1' + resource, { data, timeout: 10_000 }); expect(response.status()).toBe(200)
  const payload = await response.json(); expect(payload.code).toBe(0); return payload.data as T
}
