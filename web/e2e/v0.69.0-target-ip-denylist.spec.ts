import { randomBytes } from 'node:crypto'
import { expect, test as base } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Locator, Page, Request } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

type Policy = { addresses: string[]; updatedAt: string }
type DNSPolicy = { hosts?: string[]; suffixes?: string[]; enabled?: boolean; updatedAt: string }
type Link = { id: string; slug: string; targetUrl: string }
type Scenario = { page: Page; request: APIRequestContext; userId: string }
type Mode = 'targets' | 'titles' | 'metadata' | 'custom-slugs'
const path = '/admin/system/target-ip-denylist'
const dnsPaths = ['/admin/system/target-host-denylist', '/admin/system/target-host-suffix-denylist', '/admin/system/target-host-allowlist', '/admin/system/target-host-suffix-allowlist'] as const
const password = 'owned-target-ip-denylist69-fixture'
const blocked = ['192.0.2.1', '2001:db8::1']
const text = {
  en: { form: 'Blocked target IP settings', address: 'IP address', add: 'Add address', remove: 'Remove address', clear: 'Clear list', reload: 'Reload blocked IPs', save: 'Save blocked IPs', saved: 'Blocked target IP addresses saved.', target: 'Enter link', create: 'Create short link', denied: /site restricts this target host/, bulkDenied: /restricts a target host/, more: 'More actions', configure: 'Access settings', editTarget: 'Target URL', saveSettings: 'Save', invalid: /Check address syntax, duplicates/, conflict: /Another request changed the IP list/, unknown: /Save result is unknown/, scope: /Matches only IP addresses written directly in URLs/ },
  'zh-CN': { form: '目标 IP 黑名单设置', address: 'IP 地址', add: '添加地址', remove: '删除地址', clear: '清空列表', reload: '重新加载 IP 黑名单', save: '保存 IP 黑名单', saved: '目标 IP 黑名单已保存。', target: '输入链接', create: '创建短链', denied: /目标主机被站点规则限制/, bulkDenied: /目标主机被站点规则限制/, more: '更多操作', configure: '访问配置', editTarget: '目标链接', saveSettings: '保存', invalid: /请检查地址格式、重复项/, conflict: /IP 黑名单已被其他请求修改/, unknown: /保存结果未确认/, scope: /只匹配 URL 中直接填写的 IP/ },
} as const

const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, request }, use, info) => {
    const failures: unknown[] = []
    const originals: Array<{ resource: string; value: DNSPolicy | Policy }> = []
    let context: BrowserContext | undefined, page: Page | undefined
    let user: { id: string; username: string } | undefined
    try {
      await post(request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      // Capture every original before mutating any of the five shared policies.
      originals.push({ resource: path, value: await get<Policy>(request, path) })
      for (const resource of dnsPaths) originals.push({ resource, value: await get<DNSPolicy>(request, resource) })
      await write(request, [])
      for (const resource of dnsPaths) await writeDNS(request, resource, { ...(resource.includes('allowlist') ? { enabled: false } : {}), ...(resource.includes('suffix') ? { suffixes: [] } : { hosts: [] }) })
      user = (await post<{ user: { id: string; username: string } }>(request, '/admin/user/create', { username: 'ip69-' + randomBytes(7).toString('hex'), password, nickname: 'Owned IP fixture', groupKey: 'admin', status: 'active' })).user
      const language = info.title.includes(' en ') ? 'en' : 'zh-CN'
      const width = info.title.includes('1280px') ? 1280 : 390
      context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width, height: 900 }, hasTouch: width === 390, serviceWorkers: 'block', reducedMotion: 'reduce', colorScheme: language === 'en' ? 'light' : 'dark' })
      await context.addInitScript(language => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', language === 'en' ? 'light' : 'dark') }, language)
      page = await context.newPage()
      await post(page.request, '/auth/login', { username: user.username, password })
      const preference = (await get<{ preferences: { updatedAt: string | null } }>(page.request, '/user/preferences')).preferences
      await post(page.request, '/user/preferences/update', { language, theme: language === 'en' ? 'light' : 'dark', expectedUpdatedAt: preference.updatedAt })
      await info.attach('runtime', { body: JSON.stringify({ browser: browser.version(), driverNode: process.version, language, width, hasTouch: width === 390, disposableDatabase: true, userId: user.id }), contentType: 'application/json' })
      await use({ page, request, userId: user.id })
    } catch (error) { failures.push(error) } finally {
      // Restore all five independently, with fresh full CAS through the manager.
      for (const original of originals) {
        try {
          const fields = Object.fromEntries(Object.entries(original.value).filter(([key]) => key !== 'updatedAt'))
          const current = await get<{ updatedAt: string }>(request, original.resource)
          const restored = await post(request, original.resource + '/update', { ...fields, expectedUpdatedAt: current.updatedAt })
          expect(restored).toMatchObject(fields)
        } catch (error) { failures.push(error) }
      }
      if (page && user) { try {
        expect((await post<{ user: { id: string } }>(page.request, '/auth/login', { username: user.username, password })).user.id).toBe(user.id)
        for (const link of await ownLinks(page.request)) await post(request, '/admin/short-link/delete', { id: link.id })
      } catch (error) { failures.push(error) } }
      if (user) { try { await post(request, '/admin/user/update', { id: user.id, nickname: 'Retired IP fixture', status: 'disabled' }) } catch (error) { failures.push(error) } }
      try { await context?.close() } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, 'IP scenario or exact five-policy restoration failed')
  }, { timeout: 120_000 }],
})

test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const language of ['en', 'zh-CN'] as const) for (const width of [1280, 390]) {
  test('v0.69.0 ' + language + ' ' + width + 'px exact IP policy, seven writes and historical access', async ({ scenario }, info) => {
    test.setTimeout(180_000)
    const { page, request } = scenario, labels = text[language]
    // Empty policies must not make numeric aliases or mapped base-blocked addresses safe.
    const emptyLinks = (await ownLinks(page.request)).map(link => link.id).sort()
    for (const targetUrl of ['http://127.1/path', 'http://0177.0.0.1/path', 'http://0x7f000001/path']) {
      await page.goto('/')
      const field = page.getByRole('textbox', { name: labels.target, exact: true })
      await expect(field).toBeEnabled(); await field.fill(targetUrl)
      await page.getByRole('button', { name: labels.create, exact: true }).click()
      await expect(page.getByText(language === 'en' ? 'Enter a valid URL' : '请输入有效的 URL', { exact: true })).toBeVisible()
      await expect(field).toHaveValue(targetUrl)
    }
    for (const targetUrl of ['https://[::ffff:100.64.0.1]/', 'https://[::ffff:0.0.0.0]/']) {
      await page.goto('/')
      const field = page.getByRole('textbox', { name: labels.target, exact: true })
      await expect(field).toBeEnabled(); await field.fill(targetUrl)
      const response = page.waitForResponse(value => new URL(value.url()).pathname === '/api/v1/short-link/create')
      await page.getByRole('button', { name: labels.create, exact: true }).click()
      expect((await (await response).json()).code).toBe(200103)
      await expect(field).toHaveValue(targetUrl)
    }
    expect((await ownLinks(page.request)).map(link => link.id).sort()).toEqual(emptyLinks)
    expect((await create(page, 'https://[::ffff:203.0.113.20]/mapped-public', labels)).targetUrl).toBe('https://[::ffff:203.0.113.20]/mapped-public')
    const historicalTarget = 'https://192.0.2.1/historical'
    const historical = await create(page, historicalTarget, labels)
    await page.goto('/admin/setting')
    const card = page.locator('.target-ip-policy')
    const form = page.getByRole('form', { name: labels.form, exact: true })
    await expect(form.getByRole('button', { name: labels.add, exact: true })).toBeEnabled()
    await expect(form.getByRole('textbox')).toHaveCount(0)
    await expect(card.getByText(labels.scope)).toBeVisible()
    await addAddress(form, labels, ' 2001:0DB8::1 ')
    await addAddress(form, labels, '::ffff:192.0.2.1')
    const response = page.waitForResponse(value => new URL(value.url()).pathname === '/api/v1' + path + '/update')
    await activate(form.getByRole('button', { name: labels.save, exact: true }))
    const saved = await response
    expect(saved.request().postDataJSON()).toMatchObject({ addresses: [' 2001:0DB8::1 ', '::ffff:192.0.2.1'] })
    expect((await saved.json()).code).toBe(0)
    await expect(page.getByText(labels.saved, { exact: true })).toBeVisible()
    await expect(form.getByRole('textbox').nth(0)).toHaveValue(blocked[0])
    await expect(form.getByRole('textbox').nth(1)).toHaveValue(blocked[1])
    expect((await get<Policy>(request, path)).addresses).toEqual(blocked)
    const audits = (await get<{ items: { actorId: string; resourceId: string; changedFields: string[] }[] }>(request, '/admin/audit/list?actorId=' + scenario.userId + '&resourceType=system_setting&action=settings_change')).items
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ actorId: scenario.userId, resourceId: 'security.target_ip_denylist', changedFields: ['security.target_ip_denylist'] })
    expect(JSON.stringify(audits)).not.toContain('192.0.2.1')
    await card.evaluate(element => { element.scrollIntoView({ block: 'start' }); window.scrollBy(0, -100) })
    await expect(card.getByRole('heading')).toBeInViewport()
    await expectNoHorizontalOverflow(page)
    await page.screenshot({ path: info.outputPath('ip-heading-saved-' + language + '-' + width + '.png') })
    await form.scrollIntoViewIfNeeded()
    // English390 reachability supplement start
    if (language === 'en' && width === 390) {
      for (const name of [labels.reload, labels.save]) {
        const action = form.getByRole('button', { name, exact: true })
        await expect(action).toBeEnabled()
        await action.evaluate(element => element.scrollIntoView({ block: 'center' }))
        await expect(action).toBeInViewport({ ratio: 1 })
        await expect.poll(() => action.evaluate(element => {
          const box = element.getBoundingClientRect()
          return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
        })).toBe(true)
        await action.tap({ trial: true, scroll: 'none' })
      }
      await expect(page.getByText(labels.saved, { exact: true })).toBeVisible()
      await info.attach('ip-settings-actions-touch-reachability', { body: JSON.stringify({ width, hasTouch: true, wholeViewport: true, centerHit: true, touchTrial: true, liveSavedFeedback: true }), contentType: 'application/json' })
    }
    // English390 reachability supplement end
    await page.screenshot({ path: info.outputPath('ip-actions-saved-' + language + '-' + width + '.png') })

    await addAddress(form, labels, '::ffff:c000:201')
    await activate(form.getByRole('button', { name: labels.save, exact: true }))
    await expect(form.getByText(labels.invalid)).toBeVisible()
    await expect(form.getByRole('textbox').nth(2)).toHaveValue('::ffff:c000:201')
    expect((await get<Policy>(request, path)).addresses).toEqual(blocked)
    await activate(form.getByRole('button', { name: labels.remove + ' 3', exact: true }))
    await page.reload()
    await expect(form.getByRole('textbox').nth(0)).toHaveValue(blocked[0])
    await expect(form.getByRole('textbox').nth(1)).toHaveValue(blocked[1])
    await create(page, 'https://203.0.113.20/allowed-ip', labels)
    await create(page, 'https://allowed.example/192.0.2.1', labels)
    for (const targetUrl of ['https://192.0.2.1/new', 'https://[::ffff:192.0.2.1]/new', 'https://[2001:0DB8:0:0::1]:443/new?x=1']) {
      await page.goto('/')
      const field = page.getByRole('textbox', { name: labels.target, exact: true })
      await field.fill(targetUrl)
      const result = page.waitForResponse(value => new URL(value.url()).pathname === '/api/v1/short-link/create')
      await page.getByRole('button', { name: labels.create, exact: true }).click()
      expect((await (await result).json()).code).toBe(200121)
      await expect(page.getByText(labels.denied)).toBeVisible()
      await expect(field).toHaveValue(targetUrl)
    }
    for (const mode of ['targets', 'titles', 'metadata', 'custom-slugs'] as const) {
      await page.goto('/link')
      let dialog = await batch(page, mode, ['https://203.0.113.20/batch', 'https://allowed.example/batch'])
      const endpoint = '/api/v1/short-link/batch-create' + (mode === 'targets' ? '' : '-with-' + mode)
      const allowed = page.waitForResponse(value => new URL(value.url()).pathname === endpoint)
      await activate(page.getByTestId('bulk-create-submit'))
      expect(await (await allowed).json()).toMatchObject({ code: 0, data: { createdCount: 2 } })
      await expect(dialog).toBeHidden()
      const before = (await ownLinks(page.request)).map(link => link.id).sort()
      dialog = await batch(page, mode, ['https://allowed.example/batch', 'https://[::ffff:c000:201]/batch'])
      const requestId = await page.getByTestId('bulk-create-request-id').innerText()
      const denied = page.waitForResponse(value => new URL(value.url()).pathname === endpoint)
      await activate(page.getByTestId('bulk-create-submit'))
      expect((await (await denied).json()).code).toBe(200121)
      await expect(page.getByTestId('bulk-create-error')).toContainText(labels.bulkDenied)
      await expect(page.getByTestId('bulk-create-request-id')).toHaveText(requestId)
      await expect(page.getByTestId('bulk-create-edit')).toBeEnabled()
      expect((await ownLinks(page.request)).map(link => link.id).sort()).toEqual(before)
      if (mode === 'custom-slugs') {
        await page.getByTestId('bulk-create-error').scrollIntoViewIfNeeded()
        await expectNoHorizontalOverflow(page)
        await page.screenshot({ path: info.outputPath('ip-batch-denied-' + language + '-' + width + '.png') })
      }
      await activate(page.getByTestId('bulk-create-close'))
      await expect(dialog).toBeHidden()
    }
    for (const scope of ['own', 'admin'] as const) {
      await page.goto(scope === 'own' ? '/link' : '/admin/link')
      const row = page.getByTestId('console-link-row').filter({ hasText: historical.slug })
      await row.getByRole('button', { name: labels.more, exact: true }).click()
      await page.getByRole('menuitem', { name: labels.configure, exact: true }).click()
      const dialog = page.getByRole('dialog')
      const target = dialog.getByRole('textbox', { name: labels.editTarget, exact: true })
      const endpoint = '/api/v1/' + (scope === 'admin' ? 'admin/' : '') + 'short-link/update'
      await target.fill('https://203.0.113.20/changed')
      const allowed = page.waitForResponse(value => new URL(value.url()).pathname === endpoint)
      await dialog.getByRole('button', { name: labels.saveSettings, exact: true }).click()
      expect((await (await allowed).json()).code).toBe(0)
      await expect(dialog).toBeHidden()
      await write(request, [])
      await post(page.request, '/short-link/update', { id: historical.id, targetUrl: historicalTarget })
      await write(request, blocked)
      await page.reload()
      await row.getByRole('button', { name: labels.more, exact: true }).click()
      await page.getByRole('menuitem', { name: labels.configure, exact: true }).click()
      await target.fill('https://[::ffff:192.0.2.1]/changed')
      const denied = page.waitForResponse(value => new URL(value.url()).pathname === endpoint)
      await dialog.getByRole('button', { name: labels.saveSettings, exact: true }).click()
      expect((await (await denied).json()).code).toBe(200121)
      await expect(page.getByText(labels.denied)).toBeVisible()
      await expect(target).toHaveValue('https://[::ffff:192.0.2.1]/changed')
      await expectNoHorizontalOverflow(page)
      // English390 reachability supplement start
      if (language === 'en' && width === 390) {
        const action = dialog.getByRole('button', { name: labels.saveSettings, exact: true })
        await expect(action).toBeEnabled()
        await action.evaluate(element => element.scrollIntoView({ block: 'center' }))
        await expect(action).toBeInViewport({ ratio: 1 })
        await expect.poll(() => action.evaluate(element => {
          const box = element.getBoundingClientRect()
          return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
        })).toBe(true)
        await action.tap({ trial: true, scroll: 'none' })
        await info.attach('ip-' + scope + '-save-touch-reachability', { body: JSON.stringify({ width, hasTouch: true, wholeViewport: true, centerHit: true, touchTrial: true }), contentType: 'application/json' })
      }
      // English390 reachability supplement end
      await page.screenshot({ path: info.outputPath('ip-' + scope + '-denied-' + language + '-' + width + '.png') })
    }
    // Exercise the real historical slug, but never follow to the documentation IP.
    const visit = await page.request.get('/' + historical.slug, { maxRedirects: 0 })
    expect(visit.status()).toBe(302)
    expect(visit.headers().location).toBe(historicalTarget)
    for (const prefix of ['', 'admin/']) await post(page.request, '/' + prefix + 'short-link/update', { id: historical.id, targetUrl: historicalTarget, metadata: { title: 'Existing IP remains editable', tags: [] } })

    // The old DNS allow rule still rejects direct IPs and can never override a deny.
    await enableDNSAllowThroughUI(page, language)
    await create(page, 'https://allowed.example/dns-rule', labels)
    for (const targetUrl of ['https://203.0.113.20/dns-rule', 'https://192.0.2.1/dns-rule', 'https://other.example/dns-rule']) {
      const result = await page.request.post('/api/v1/short-link/create', { data: { targetUrl } })
      expect(result.status()).toBe(200)
      expect((await result.json()).code).toBe(200121)
    }
    await writeDNS(request, '/admin/system/target-host-allowlist', { enabled: false, hosts: [] })
    await page.goto('/admin/setting')
    await form.getByRole('textbox').nth(0).fill('198.51.100.1')
    await write(request, ['198.51.100.2'])
    const conflict = page.waitForResponse(value => new URL(value.url()).pathname === '/api/v1' + path + '/update')
    await activate(form.getByRole('button', { name: labels.save, exact: true }))
    expect((await (await conflict).json()).code).toBe(900221)
    await expect(form.getByRole('textbox').nth(0)).toHaveValue('198.51.100.1')
    await expect(form.getByText(labels.conflict)).toBeVisible()
    await expect(form.getByRole('button', { name: labels.save, exact: true })).toBeDisabled()
    await activate(form.getByRole('button', { name: labels.reload, exact: true }))
    await expect(form.getByRole('textbox')).toHaveCount(1)
    await expect(form.getByRole('textbox').nth(0)).toHaveValue('198.51.100.2')
    await expect(form.getByRole('button', { name: labels.save, exact: true })).toBeEnabled()
    await write(request, Array.from({ length: 100 }, (_, index) => '198.51.100.' + index))
    await page.reload()
    await expect(form.getByRole('textbox')).toHaveCount(100)
    await expect(form.getByRole('button', { name: labels.add, exact: true })).toBeDisabled()
    await expectNoHorizontalOverflow(page)
    await activate(form.getByRole('button', { name: labels.clear, exact: true }))
    await expect(form.getByRole('textbox')).toHaveCount(0)
    const cleared = page.waitForResponse(value => new URL(value.url()).pathname === '/api/v1' + path + '/update')
    await activate(form.getByRole('button', { name: labels.save, exact: true }))
    expect((await (await cleared).json()).data.addresses).toEqual([])
    expect((await get<Policy>(request, path)).addresses).toEqual([])
    await addAddress(form, labels, '2001:db8::7')
    await checkUnknownSave(page, request, form, labels, info.outputPath('ip-save-unknown-' + language + '-' + width + '.png'))
    await expect(form.getByRole('textbox')).toHaveValue('2001:db8::7')
    await activate(form.getByRole('button', { name: labels.clear, exact: true }))
    const empty = page.waitForResponse(value => new URL(value.url()).pathname === '/api/v1' + path + '/update')
    await activate(form.getByRole('button', { name: labels.save, exact: true }))
    expect((await (await empty).json()).code).toBe(0)
    await expect(form.getByRole('textbox')).toHaveCount(0)
    expect((await get<Policy>(request, path)).addresses).toEqual([])
    await form.scrollIntoViewIfNeeded()
    await page.screenshot({ path: info.outputPath('ip-empty-' + language + '-' + width + '.png') })
  })
}

for (const [operation, language, width] of [['load', 'en', 390], ['save', 'zh-CN', 1280]] as const) {
  test('v0.69.0 ' + language + ' ' + width + 'px server revocation clears private IP ' + operation + ' draft', async ({ scenario }, info) => {
    const { page, request } = scenario, labels = text[language]
    await write(request, ['192.0.2.10'])
    await page.goto('/admin/setting')
    const form = page.getByRole('form', { name: labels.form, exact: true })
    await expect(form.getByRole('textbox')).toHaveValue('192.0.2.10')
    await form.getByRole('textbox').fill('192.0.2.11')
    const original = (await get<{ user: { id: string; username: string; nickname: string } }>(page.request, '/auth/me')).user
    const failures: unknown[] = []
    try {
      expect(original.id).toBe(scenario.userId)
      await post(request, '/admin/user/update', { id: original.id, nickname: original.nickname, status: 'disabled' })
      const rejected = page.waitForResponse(value => new URL(value.url()).pathname === '/api/v1' + path + (operation === 'save' ? '/update' : ''))
      const refreshed = page.waitForResponse(value => new URL(value.url()).pathname === '/api/v1/auth/me')
      await activate(form.getByRole('button', { name: operation === 'save' ? labels.save : labels.reload, exact: true }))
      expect((await (await rejected).json()).code).toBe(120001)
      expect((await (await refreshed).json()).data.user.group).toBe('guest')
      await expect(form).toBeHidden()
      await expect(page.locator('input[name^=target-ip-]')).toHaveCount(0)
      await info.attach('server-revocation', { body: JSON.stringify({ operation, code: 120001, confirmedGuest: true, privateFormRemoved: true }), contentType: 'application/json' })
      await page.screenshot({ path: info.outputPath('ip-revoked-' + operation + '-' + language + '-' + width + '.png') })
    } catch (error) { failures.push(error) } finally {
      try { await post(request, '/admin/user/update', { id: original.id, nickname: original.nickname, status: 'active' }); await post(page.request, '/auth/login', { username: original.username, password }) } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, 'IP revocation or owned account restoration failed')
    expect((await get<Policy>(request, path)).addresses).toEqual(['192.0.2.10'])
  })
}

for (const [operation, language, width] of [['load', 'en', 390], ['save', 'zh-CN', 1280]] as const) {
  test('v0.69.0 ' + language + ' ' + width + 'px same SPA account change retires delayed IP ' + operation, async ({ scenario }, info) => {
    const { page, request } = scenario, labels = text[language], failures: unknown[] = []
    let nextUser: { id: string; username: string } | undefined, release: (() => void) | undefined
    let held: Request | undefined, terminal: 'finished' | 'failed' | undefined
    let captured = false, fulfillReturned = false, fulfillError: unknown
    const onFinished = (value: Request) => { if (value === held) terminal = 'finished' }
    const onFailed = (value: Request) => { if (value === held) terminal = 'failed' }
    page.on('requestfinished', onFinished); page.on('requestfailed', onFailed)
    try {
      nextUser = (await post<{ user: { id: string; username: string } }>(request, '/admin/user/create', { username: 'ip69-next-' + randomBytes(7).toString('hex'), password, nickname: 'Next IP fixture', groupKey: 'admin', status: 'active' })).user
      await write(request, ['192.0.2.10'])
      await page.goto('/admin/setting')
      const form = page.getByRole('form', { name: labels.form, exact: true })
      await expect(form.getByRole('textbox')).toHaveValue('192.0.2.10')
      await form.getByRole('textbox').fill('192.0.2.11')
      const marker = randomBytes(12).toString('hex')
      await page.evaluate(value => { (window as Window & { ip69Marker?: string }).ip69Marker = value }, marker)
      const gate = new Promise<void>(resolve => { release = resolve })
      let processed!: () => void
      const handled = new Promise<void>(resolve => { processed = resolve })
      await page.route('**/api/v1' + path + (operation === 'save' ? '/update' : ''), async route => {
        held = route.request()
        try {
          const result = await route.fetch(), payload = await result.json()
          expect(payload.code).toBe(0)
          expect(payload.data.addresses).toEqual([operation === 'save' ? '192.0.2.11' : '192.0.2.10'])
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
      await expect(page.locator('input[name^=target-ip-]')).toHaveCount(0)
      expect(await page.evaluate(() => (window as Window & { ip69Marker?: string }).ip69Marker)).toBe(marker)
      await write(request, ['192.0.2.12'])
      await page.getByLabel(/^(账号|Username)$/).fill(nextUser.username)
      await page.getByLabel(/^(密码|Password)$/).fill(password)
      const signedIn = page.waitForResponse(value => new URL(value.url()).pathname === '/api/v1/auth/login')
      await page.getByRole('button', { name: /^(登录|Sign in)$/ }).click()
      expect((await (await signedIn).json()).data.user.id).toBe(nextUser.id)
      await expect(page).not.toHaveURL(url => url.pathname === '/login')
      if (new URL(page.url()).pathname === '/') {
        await page.getByRole('button', { name: 'Next IP fixture', exact: true }).click()
        await expect(page).toHaveURL(/\/profile$/)
      }
      if (new URL(page.url()).pathname !== '/admin/setting') {
        if (width === 390) await page.locator('button.console-topbar__menu').click()
        await page.locator('a[href="/admin/setting"]').filter({ visible: true }).click()
      }
      const currentForm = page.getByRole('form', { name: /^(目标 IP 黑名单设置|Blocked target IP settings)$/ })
      await expect(currentForm.getByRole('textbox')).toHaveValue('192.0.2.12')
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
      await expect(currentForm.getByRole('textbox')).toHaveValue('192.0.2.12')
      expect(await page.evaluate(() => (window as Window & { ip69Marker?: string }).ip69Marker)).toBe(marker)
      await expectNoHorizontalOverflow(page)
      await info.attach('ip-identity-network-terminal', { body: JSON.stringify({ from: scenario.userId, to: nextUser.id, operation, terminal, fulfillReturned, runtimeRetained: true, browserProcessingBoundary: 'two-animation-frames-after-network-terminal', currentValue: '192.0.2.12' }), contentType: 'application/json' })
      await page.screenshot({ path: info.outputPath('ip-identity-' + operation + '-' + language + '-' + width + '.png') })
    } catch (error) { failures.push(error) } finally {
      release?.(); page.off('requestfinished', onFinished); page.off('requestfailed', onFailed)
      if (nextUser) { try { await post(request, '/admin/user/update', { id: nextUser.id, nickname: 'Retired next IP fixture', status: 'disabled' }) } catch (error) { failures.push(error) } }
    }
    if (failures.length) throw new AggregateError(failures, 'Same SPA IP request or exact fixture cleanup failed')
  })
}

async function activate(control: Locator) { await control.focus(); await control.press('Enter') }
async function addAddress(form: Locator, labels: typeof text[keyof typeof text], address: string) {
  const index = await form.getByRole('textbox').count()
  await activate(form.getByRole('button', { name: labels.add, exact: true }))
  await form.getByRole('textbox', { name: labels.address + ' ' + (index + 1), exact: true }).fill(address)
}
async function create(page: Page, target: string, labels: typeof text[keyof typeof text]): Promise<Link> {
  await page.goto('/')
  const input = page.getByRole('textbox', { name: labels.target, exact: true })
  await expect(input).toBeEnabled(); await input.fill(target)
  const result = page.waitForResponse(value => new URL(value.url()).pathname === '/api/v1/short-link/create')
  await page.getByRole('button', { name: labels.create, exact: true }).click()
  const payload = await (await result).json(); expect(payload.code).toBe(0)
  return payload.data.shortLink as Link
}
async function batch(page: Page, mode: Mode, targets: string[]): Promise<Locator> {
  await activate(page.getByTestId('bulk-create-open'))
  const dialog = page.getByTestId('bulk-create-dialog')
  if (mode === 'targets') await dialog.getByRole('textbox').fill(targets.join('\n'))
  else {
    const header = mode === 'titles' ? 'target_url,title' : mode === 'metadata' ? 'target_url,title,tags' : 'target_url,title,tags,custom_slug'
    const fields = mode === 'titles' ? ',IP policy' : mode === 'metadata' ? ',IP policy,[]' : ',IP policy,[],'
    await dialog.locator('input[type=file]').setInputFiles({ name: 'ip-policy.csv', mimeType: 'text/csv', buffer: Buffer.from(header + '\n' + targets.map(target => target + fields).join('\n')) })
    await expect(page.getByTestId('bulk-create-imported-list')).toBeVisible()
  }
  await activate(page.getByTestId('bulk-create-preview'))
  return dialog
}
async function ownLinks(request: APIRequestContext): Promise<Link[]> { return (await get<{ items: Link[] }>(request, '/short-link/list?page=1&pageSize=100')).items }
async function write(request: APIRequestContext, addresses: string[]) { return post<Policy>(request, path + '/update', { addresses, expectedUpdatedAt: (await get<Policy>(request, path)).updatedAt }) }
async function writeDNS(request: APIRequestContext, resource: typeof dnsPaths[number], fields: Omit<DNSPolicy, 'updatedAt'>) { return post<DNSPolicy>(request, resource + '/update', { ...fields, expectedUpdatedAt: (await get<DNSPolicy>(request, resource)).updatedAt }) }
async function enableDNSAllowThroughUI(page: Page, language: keyof typeof text) {
  await page.goto('/admin/setting')
  const english = language === 'en'
  const form = page.getByRole('form', { name: english ? 'Allowed target host settings' : '目标主机白名单设置', exact: true })
  await expect(form.getByRole('button', { name: english ? 'Add host' : '添加主机', exact: true })).toBeEnabled()
  await expect(form.getByRole('textbox')).toHaveCount(0)
  await activate(form.getByRole('button', { name: english ? 'Add host' : '添加主机', exact: true }))
  await form.getByRole('textbox').fill('allowed.example')
  await form.getByLabel(english ? 'Enable target host allowlist' : '启用目标主机白名单', { exact: true }).check()
  const response = page.waitForResponse(value => new URL(value.url()).pathname === '/api/v1/admin/system/target-host-allowlist/update')
  await activate(form.getByRole('button', { name: english ? 'Save allowed hosts' : '保存白名单', exact: true }))
  expect((await (await response).json()).code).toBe(0)
}
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
        expect(committed.addresses).toEqual(['2001:db8::7'])
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
