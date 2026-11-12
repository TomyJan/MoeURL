import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Request } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

type Quota = { dailyLimit: number | null; updatedAt: string }
type Hosts = { hosts: string[]; updatedAt: string }
type Allow = Hosts & { enabled: boolean }
type Usage = { usageDay: string; used: string; dailyLimit: number | null; remaining: number | null }
const quotaPath = '/admin/system/account-daily-create-quota'
const denyPath = '/admin/system/target-host-denylist'
const allowPath = '/admin/system/target-host-allowlist'
const usagePath = '/api/v1/account/daily-create-usage'
const labels = {
  en: { heading: 'Today’s creation usage', refresh: 'Refresh usage', retry: 'Retry usage', recover: 'Check access again', unlimited: 'Unlimited', target: 'Enter link', create: 'Create short link', logout: 'Sign out', accountMenu: 'Open account menu' },
  'zh-CN': { heading: '今日创建用量', refresh: '刷新用量', retry: '重试读取用量', recover: '重新确认权限', unlimited: '无限额', target: '输入链接', create: '创建短链', logout: '退出登录', accountMenu: '打开账号菜单' },
} as const

async function get<T>(request: APIRequestContext, path: string): Promise<T> {
  const result = await request.get('/api/v1' + path)
  expect(result.status()).toBe(200)
  const value = await result.json()
  expect(value.code).toBe(0)
  return value.data as T
}
async function post<T = unknown>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const result = await request.post('/api/v1' + path, { data })
  expect(result.status()).toBe(200)
  const value = await result.json()
  expect(value.code).toBe(0)
  return value.data as T
}
async function setQuota(request: APIRequestContext, dailyLimit: number | null) {
  const current = await get<Quota>(request, quotaPath)
  return post<Quota>(request, quotaPath + '/update', { dailyLimit, expectedUpdatedAt: current.updatedAt })
}

test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })
for (const language of ['en', 'zh-CN'] as const) for (const width of [1280, 390]) {
  test('v0.65.0 ' + language + ' ' + width + 'px own usage, refresh and identity retirement', async ({ browser, request }, info) => {
    test.setTimeout(150_000)
    const text = labels[language]
    const failures: unknown[] = []
    const links: string[] = []
    let original: Quota | undefined, deny: Hosts | undefined, allow: Allow | undefined
    let user: { id: string; username: string } | undefined, context: BrowserContext | undefined
    let nextUser: { id: string; username: string } | undefined
    try {
      await post(request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      // Register restoration before the first shared setting change.
      original = await get<Quota>(request, quotaPath)
      deny = await get<Hosts>(request, denyPath)
      allow = await get<Allow>(request, allowPath)
      await setQuota(request, null)
      await post(request, denyPath + '/update', { hosts: [], expectedUpdatedAt: deny.updatedAt })
      await post(request, allowPath + '/update', { enabled: false, hosts: [], expectedUpdatedAt: allow.updatedAt })
      const password = 'owned-usage65-fixture'
      user = (await post<{ user: { id: string; username: string } }>(request, '/admin/user/create', {
        username: 'usage65-' + randomBytes(7).toString('hex'), password, nickname: 'Usage fixture', groupKey: 'user', status: 'active',
      })).user
      context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width, height: 900 }, hasTouch: width === 390, serviceWorkers: 'block', reducedMotion: 'reduce', colorScheme: language === 'en' ? 'light' : 'dark' })
      await context.addInitScript(language => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', language === 'en' ? 'light' : 'dark') }, language)
      const page = await context.newPage()
      await post(page.request, '/auth/login', { username: user.username, password })
      const preference = (await get<{ preferences: { updatedAt: string | null } }>(page.request, '/user/preferences')).preferences
      await post(page.request, '/user/preferences/update', { language, theme: language === 'en' ? 'light' : 'dark', expectedUpdatedAt: preference.updatedAt })
      await info.attach('runtime', { body: JSON.stringify({ browser: browser.version(), driverNode: process.version, language, width, hasTouch: width === 390, isolatedDatabase: true }), contentType: 'application/json' })
      await page.goto('/console')
      const card = page.locator('section', { has: page.getByRole('heading', { name: text.heading, exact: true }) }).last()
      await expect(card.getByTestId('own-usage-used')).toHaveText('0')
      await expect(card.getByText(text.unlimited, { exact: true })).toHaveCount(2)
      const initial = await get<Usage>(page.request, '/account/daily-create-usage')
      expect(initial.used).toBe('0')
      await expect(card.locator('time')).toHaveText(initial.usageDay)
      await expect(card).toContainText('UTC')
      await setQuota(request, 2)
      const keyboardRefresh = card.getByRole('button', { name: text.refresh, exact: true })
      await keyboardRefresh.focus()
      await expect(keyboardRefresh).toBeFocused()
      await keyboardRefresh.press('Enter')
      await expect(card.getByTestId('own-usage-limit')).toHaveText('2')
      await expect(card.getByTestId('own-usage-remaining')).toHaveText('2')
      await page.goto('/')
      await page.getByRole('textbox', { name: text.target, exact: true }).fill('https://example.com/own-usage65')
      const created = page.waitForResponse(value => new URL(value.url()).pathname === '/api/v1/short-link/create')
      await page.getByRole('button', { name: text.create, exact: true }).click()
      const payload = await (await created).json()
      expect(payload.code).toBe(0); links.push(payload.data.shortLink.id as string)
      await page.goto('/console')
      await expect(card.getByTestId('own-usage-used')).toHaveText('1')
      await expect(card.getByTestId('own-usage-remaining')).toHaveText('1')
      const wrongOwner = await page.request.get(usagePath, { headers: { 'X-MoeURL-Expected-User-ID': '00000000-0000-0000-0000-000000000001' } })
      expect((await wrongOwner.json()).code).toBe(120001)
      // Controlled network failure is local to this card, never an invented server failure.
      await page.route('**' + usagePath, route => route.abort('failed'), { times: 1 })
      await card.getByRole('button', { name: text.refresh, exact: true }).click()
      await expect(card.getByTestId('own-usage-error')).toBeVisible()
      await expect(card.getByTestId('own-usage-used')).toHaveCount(0)
      await expect(page.getByTestId('overview-recent-error')).toHaveCount(0)
      await card.getByRole('button', { name: text.retry, exact: true }).click()
      await expect(card.getByTestId('own-usage-used')).toHaveText('1')
      await setQuota(request, 0)
      await card.getByRole('button', { name: text.refresh, exact: true }).click()
      await expect(card.getByTestId('own-usage-remaining')).toHaveText('0')
      await expect(card.getByRole('button', { name: text.refresh, exact: true })).toBeEnabled()
      await card.scrollIntoViewIfNeeded(); await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: info.outputPath('own-usage-zero-' + language + '-' + width + '.png') })
      // A controlled valid int64 payload checks narrow-screen layout; it is not a persisted meter claim.
      await page.route('**' + usagePath, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 0, message: 'Layout fixture', data: { usageDay: initial.usageDay, used: '9223372036854775807', dailyLimit: 0, remaining: 0 }, meta: {} }) }), { times: 1 })
      await card.getByRole('button', { name: text.refresh, exact: true }).click()
      await expect(card.getByTestId('own-usage-used')).toHaveText('9223372036854775807')
      await card.scrollIntoViewIfNeeded(); await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: info.outputPath('own-usage-long-fixture-' + language + '-' + width + '.png') })
      await card.getByRole('button', { name: text.refresh, exact: true }).click()
      await expect(card.getByTestId('own-usage-used')).toHaveText('1')
      await page.goto('/')
      await page.getByRole('textbox', { name: text.target, exact: true }).fill('https://example.com/exhausted-snapshot')
      await expect(page.getByRole('button', { name: text.create, exact: true })).toBeEnabled()
      await page.goto('/console')
      await expect(card.getByTestId('own-usage-used')).toHaveText('1')
      await page.route('**' + usagePath, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 120001, message: 'Controlled denial', data: null, meta: {} }) }), { times: 1 })
      await card.getByRole('button', { name: text.refresh, exact: true }).click()
      await expect(card.getByTestId('own-usage-denied')).toBeVisible()
      await expect(card.getByTestId('own-usage-used')).toHaveCount(0)
      await card.getByRole('button', { name: text.recover, exact: true }).click()
      await expect(card.getByTestId('own-usage-used')).toHaveText('1')
      // Keep the real application's runtime alive across UI logout and another account's login.
      nextUser = (await post<{ user: { id: string; username: string } }>(request, '/admin/user/create', {
        username: 'usage65-next-' + randomBytes(7).toString('hex'), password, nickname: 'Next usage fixture', groupKey: 'user', status: 'active',
      })).user
      const runtimeMarker = randomBytes(12).toString('hex')
      await page.evaluate(marker => { (window as Window & { usageRuntimeMarker?: string }).usageRuntimeMarker = marker }, runtimeMarker)
      const nextCard = page.locator('section', { has: page.getByRole('heading', { name: /^(今日创建用量|Today’s creation usage)$/ }) }).last()
      let release!: () => void
      let captured = false
      let heldRequest: Request | undefined
      let terminal: 'finished' | 'failed' | undefined
      let fulfillReturned = false
      let fulfillError: unknown
      const onFinished = (value: Request) => { if (value === heldRequest) terminal = 'finished' }
      const onFailed = (value: Request) => { if (value === heldRequest) terminal = 'failed' }
      page.on('requestfinished', onFinished)
      page.on('requestfailed', onFailed)
      let processed!: () => void
      const handled = new Promise<void>(resolve => { processed = resolve })
      const gate = new Promise<void>(resolve => { release = resolve })
      await page.route('**' + usagePath, async route => {
        heldRequest = route.request()
        const result = await route.fetch()
        expect(route.request().headers()['x-moeurl-expected-user-id']).toBe(user!.id)
        expect((await result.json()).data.used).toBe('1')
        captured = true
        await gate
        try { await route.fulfill({ response: result }); fulfillReturned = true }
        catch (error) { fulfillError = error }
        finally { processed() }
      }, { times: 1 })
      try {
        await card.getByRole('button', { name: text.refresh, exact: true }).click(); await expect.poll(() => captured).toBe(true)
        const signedOut = page.waitForResponse(value => new URL(value.url()).pathname === '/api/v1/auth/logout')
        if (width === 390) {
          await page.getByRole('button', { name: text.accountMenu, exact: true }).click()
          await page.getByTestId('console-mobile-account-menu').getByRole('menuitem', { name: text.logout, exact: true }).click()
        } else await page.getByTestId('console-account').getByRole('button', { name: text.logout, exact: true }).click()
        expect((await (await signedOut).json()).code).toBe(0)
        await expect(page).toHaveURL(url => url.pathname === '/login')
        expect((await get<{ user: { group: string } }>(page.request, '/auth/me')).user.group).toBe('guest')
        await expect(nextCard).toHaveCount(0)
        expect(await page.evaluate(() => (window as Window & { usageRuntimeMarker?: string }).usageRuntimeMarker)).toBe(runtimeMarker)
        // Guest and B can legitimately restore a different browser/account language from A.
        await page.getByLabel(/^(账号|Username)$/).fill(nextUser.username)
        await page.getByLabel(/^(密码|Password)$/).fill(password)
        const signedIn = page.waitForResponse(value => new URL(value.url()).pathname === '/api/v1/auth/login')
        const nextUsage = page.waitForResponse(value => new URL(value.url()).pathname === usagePath)
        await page.getByRole('button', { name: /^(登录|Sign in)$/ }).click()
        expect((await (await signedIn).json()).data.user.id).toBe(nextUser.id)
        await expect(page).toHaveURL(url => url.pathname === '/' || url.pathname === '/console')
        if (new URL(page.url()).pathname === '/') {
          await page.getByRole('button', { name: 'Next usage fixture', exact: true }).click()
          await expect(page).toHaveURL(/\/profile$/)
          if (width === 390) await page.locator('button.console-topbar__menu').click()
          await page.locator('a[href="/console"]').filter({ visible: true }).click()
        }
        const response = await nextUsage
        expect(response.request().headers()['x-moeurl-expected-user-id']).toBe(nextUser.id)
        expect((await response.json()).data.used).toBe('0')
        expect((await get<{ user: { id: string } }>(page.request, '/auth/me')).user.id).toBe(nextUser.id)
        await expect(nextCard.getByTestId('own-usage-used')).toHaveText('0')
        expect(await page.evaluate(() => (window as Window & { usageRuntimeMarker?: string }).usageRuntimeMarker)).toBe(runtimeMarker)
      } finally { release() }
      await handled
      if (fulfillError) throw fulfillError
      // Route completion is not a delivery oracle: Chromium can swallow fulfill protocol errors.
      await expect.poll(() => terminal, { message: 'The exact held A request must reach a browser network terminal event' }).toMatch(/^(finished|failed)$/)
      page.off('requestfinished', onFinished)
      page.off('requestfailed', onFailed)
      const failure = heldRequest!.failure()
      if (terminal === 'finished') {
        expect(failure).toBeNull()
        const heldResponse = await heldRequest!.response()
        expect(heldResponse).not.toBeNull()
        expect(await heldResponse!.finished()).toBeNull()
        expect((await heldResponse!.json()).data.used).toBe('1')
      } else expect(failure?.errorText).toBeTruthy()
      // Cross a browser rendering boundary after network completion before checking the already-visible B value.
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      await expect(nextCard.getByTestId('own-usage-used')).toHaveText('0')
      expect(await page.evaluate(() => (window as Window & { usageRuntimeMarker?: string }).usageRuntimeMarker)).toBe(runtimeMarker)
      await info.attach('same-runtime-identity', { body: JSON.stringify({ from: user.id, to: nextUser.id, originalUsed: '1', currentUsed: '0', runtimeRetained: true, routeFulfillReturned: fulfillReturned, routeFulfillError: fulfillError instanceof Error ? fulfillError.message : null, heldRequestTerminal: terminal, heldRequestFailure: failure?.errorText ?? null, browserProcessingBoundary: 'two-animation-frames-after-request-terminal', originalComponentUnmounted: true }), contentType: 'application/json' })
      await expectNoHorizontalOverflow(page)
    } catch (error) { failures.push(error) } finally {
      if (original) { try { await setQuota(request, original.dailyLimit); expect((await get<Quota>(request, quotaPath)).dailyLimit).toBe(original.dailyLimit) } catch (error) { failures.push(error) } }
      if (deny) { try { const now = await get<Hosts>(request, denyPath); await post(request, denyPath + '/update', { hosts: deny.hosts, expectedUpdatedAt: now.updatedAt }); expect((await get<Hosts>(request, denyPath)).hosts).toEqual(deny.hosts) } catch (error) { failures.push(error) } }
      if (allow) { try { const now = await get<Allow>(request, allowPath); await post(request, allowPath + '/update', { enabled: allow.enabled, hosts: allow.hosts, expectedUpdatedAt: now.updatedAt }); expect(await get<Allow>(request, allowPath)).toMatchObject({ hosts: allow.hosts, enabled: allow.enabled }) } catch (error) { failures.push(error) } }
      for (const id of links) { try { await post(request, '/admin/short-link/delete', { id }) } catch (error) { failures.push(error) } }
      for (const account of [user, nextUser]) { if (account) { try { await post(request, '/admin/user/update', { id: account.id, nickname: 'Retired usage fixture', status: 'disabled' }) } catch (error) { failures.push(error) } } }
      if (context) { try { await context.close() } catch (error) { failures.push(error) } }
    }
    if (failures.length) throw new AggregateError(failures, 'Usage scenario or exact restoration failed')
  })
}
