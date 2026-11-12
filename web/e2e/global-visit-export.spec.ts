import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Request } from '@playwright/test'
import type { ShortLink } from '../src/entities/short-link/model'
import type { DashboardResult, VisitResult } from '../src/entities/insights/model'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'
import { dismissNotifications } from './notification-dismissal'

const endpoint = '/api/v1/admin/dashboard/visits/export'
const password = 'owned-global-visit66-fixture'
const columns = 'short_link_id,start_date,end_date,time_zone,event_id,occurred_at,referrer_host,device_type,browser_family,os_family,country_code'.split(',')
const labels = {
  en: { csv: 'Export site visits CSV', description: 'including deleted-link history', limit: 'Site visit export exceeds 1000 records or 8 MiB.', logout: 'Sign out', account: 'Open account menu' },
  'zh-CN': { csv: '导出全站访问 CSV', description: '含已删短链历史', limit: '全站访问导出超过 1000 条或 8 MiB', logout: '退出登录', account: '打开账号菜单' },
} as const

/** Requires the actual isolated API response instead of treating a denial as empty data. */
async function get<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get('/api/v1' + path)
  expect(response.status()).toBe(200)
  const body = await response.json()
  expect(body.code).toBe(0)
  return body.data as T
}
/** Performs only named fixture writes and preserves business failures. */
async function post<T = unknown>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await request.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200)
  const body = await response.json()
  expect(body.code).toBe(0)
  return body.data as T
}
/** Parses quoted CSV independently of the production Go encoder. */
function cells(content: string) {
  expect(content.startsWith('\uFEFF')).toBe(true)
  const rows: string[][] = []
  let row: string[] = [], value = '', quoted = false
  for (let i = 1; i < content.length; i++) {
    const char = content[i]!
    if (quoted) {
      if (char === '"' && content[i + 1] === '"') { value += '"'; i++ }
      else if (char === '"') quoted = false
      else value += char
    } else if (char === '"') { expect(value).toBe(''); quoted = true }
    else if (char === ',') { row.push(value); value = '' }
    else if (char === '\r' && content[i + 1] === '\n') { row.push(value); rows.push(row); row = []; value = ''; i++ }
    else { expect(char).not.toBe('\n'); value += char }
  }
  expect(quoted).toBe(false); expect(value).toBe(''); expect(row).toEqual([])
  expect(rows[0]).toEqual(columns)
  for (const record of rows) expect(record).toHaveLength(11)
  return rows
}
/** Retains PostgreSQL fractional precision while normalizing an instant to UTC. */
function utc(value: string) {
  const fraction = /\.(\d+)/.exec(value)?.[1]?.replace(/0+$/, '')
  return new Date(value).toISOString().slice(0, 19) + (fraction ? '.' + fraction : '') + 'Z'
}

test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })
for (const language of ['en', 'zh-CN'] as const) for (const width of [1280, 390]) {
  test('v0.66.0 ' + language + ' ' + width + 'px global CSV history and identity retirement', async ({ browser, request }, info) => {
    test.setTimeout(150_000)
    const text = labels[language], errors: unknown[] = []
    const contexts: BrowserContext[] = [], links: ShortLink[] = [], accounts: { id: string; username: string }[] = []
    const deleted = new Set<string>()
    let releaseHeld: (() => void) | undefined
    try {
      await post(request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      const suffix = randomBytes(7).toString('hex')
      for (const [index, groupKey] of ['user', 'admin', 'admin'].entries()) {
        accounts.push((await post<{ user: { id: string; username: string } }>(request, '/admin/user/create', { username: 'global66-' + index + '-' + suffix, password, nickname: 'Global viewer ' + index, groupKey, status: 'active' })).user)
      }
      const sessions: BrowserContext[] = []
      for (const account of accounts) {
        const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width, height: 900 }, hasTouch: width === 390, serviceWorkers: 'block', reducedMotion: 'reduce', colorScheme: language === 'en' ? 'light' : 'dark' })
        contexts.push(context); sessions.push(context)
        await post(context.request, '/auth/login', { username: account.username, password })
        const preference = (await get<{ preferences: { updatedAt: string | null } }>(context.request, '/user/preferences')).preferences
        await post(context.request, '/user/preferences/update', { language, theme: language === 'en' ? 'light' : 'dark', expectedUpdatedAt: preference.updatedAt })
        await context.addInitScript(lang => { localStorage.setItem('moeurl.language', lang); localStorage.setItem('moeurl.theme', lang === 'en' ? 'light' : 'dark') }, language)
      }
      for (const context of sessions.slice(0, 2)) {
        const link = (await post<{ shortLink: ShortLink }>(context.request, '/short-link/create', { targetUrl: 'https://example.com/private-global66-' + suffix, metadata: { title: 'Private global ' + suffix, tags: [suffix] } })).shortLink
        links.push(link)
        const response = await context.request.get(link.url, { maxRedirects: 0, headers: { Referer: 'https://global66.example.test/private-path?secret=' + suffix, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/144.0.0.0 Safari/537.36', 'X-MoeURL-E2E-Country': 'SG' } })
        expect(response.status()).toBe(302); expect(response.headers().location).toBe(link.targetUrl)
      }
      const events = new Map<string, VisitResult>()
      for (const link of links) {
        await expect.poll(async () => (await get<VisitResult>(request, '/admin/short-link/visits?id=' + link.id)).items.length).toBe(1)
        const result = await get<VisitResult>(request, '/admin/short-link/visits?id=' + link.id)
        expect(result.items[0]).toMatchObject({ referrerHost: 'global66.example.test', deviceType: 'desktop', browserFamily: 'chrome', osFamily: 'windows', countryCode: 'SG' })
        events.set(link.id, result)
      }
      await post(request, '/admin/short-link/delete', { id: links[0]!.id }); deleted.add(links[0]!.id)
      const denied = await sessions[0]!.request.get(endpoint)
      expect(denied.status()).toBe(200); expect((await denied.json()).code).toBe(120001)
      expect(denied.headers()['cache-control']).toBe('no-store')
      const page = await sessions[1]!.newPage()
      const downloads: string[] = []
      page.on('download', value => downloads.push(value.suggestedFilename()))
      const loaded = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/admin/dashboard')
      await page.goto('/admin/dashboard')
      const snapshot = (await (await loaded).json()).data as DashboardResult
      expect(snapshot.summary.rangeVisitCount).toBeGreaterThanOrEqual(2)
      expect(snapshot.summary.rangeVisitCount).toBeLessThanOrEqual(1000)
      const button = page.getByRole('button', { name: text.csv, exact: true })
      // A real user can dismiss the transient toast and return above the sticky header.
      async function clickExport() {
        await dismissNotifications(page)
        await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }))
        await expect.poll(() => button.evaluate(element => {
          const box = element.getBoundingClientRect()
          const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
          return hit === element || element.contains(hit)
        })).toBe(true)
        await button.click()
      }
      await expect(button).toBeEnabled(); await expect(page.getByText(text.description, { exact: false })).toBeVisible()
      await button.scrollIntoViewIfNeeded(); await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: info.outputPath('site-visits-' + language + '-' + width + '.png') })
      await button.focus(); await expect(button).toBeFocused()
      const [response, saved] = await Promise.all([
        page.waitForResponse(value => new URL(value.url()).pathname === endpoint),
        page.waitForEvent('download'),
        button.press('Enter'),
      ])
      expect(response.status()).toBe(200); expect(response.headers()['cache-control']).toBe('no-store')
      expect(Object.fromEntries(new URL(response.url()).searchParams)).toEqual({ startDate: snapshot.range.startDate, endDate: snapshot.range.endDate })
      const payload = await response.json() as { code: number; data: { fileName: string; contentType: string; content: string } }
      expect(payload.code).toBe(0); expect(payload.data.contentType).toBe('text/csv;charset=utf-8')
      const expectedName = 'moeurl-site-visits-' + snapshot.range.startDate + '-' + snapshot.range.endDate + '.csv'
      expect(saved.suggestedFilename()).toBe(expectedName); expect(payload.data.fileName).toBe(expectedName)
      const path = info.outputPath(expectedName); await saved.saveAs(path); expect(await saved.failure()).toBeNull()
      const bytes = await readFile(path)
      expect([...bytes.subarray(0, 3)]).toEqual([239, 187, 191]); expect(bytes.equals(Buffer.from(payload.data.content, 'utf8'))).toBe(true)
      const rows = cells(bytes.toString('utf8'))
      expect(rows).toHaveLength(snapshot.summary.rangeVisitCount + 1)
      const ours = rows.slice(1).filter(row => events.has(row[0]!))
      expect(ours).toHaveLength(2)
      for (const row of ours) {
        const event = events.get(row[0]!)!.items[0]!
        expect(row).toEqual([row[0], snapshot.range.startDate, snapshot.range.endDate, 'UTC', event.id, utc(event.occurredAt), 'global66.example.test', 'desktop', 'chrome', 'windows', 'SG'])
      }
      for (const secret of [password, ...accounts.map(account => account.id), 'Private global ' + suffix, links[0]!.targetUrl, '/private-path', 'secret=' + suffix]) expect(payload.data.content).not.toContain(secret)
      await expect(page.locator('a[download]')).toHaveCount(0)
      await info.attach('actual-global-csv', { path, contentType: 'text/csv' })
      // Controlled capacity response checks UI framing; actual row/byte limits are exercised in real PG tests.
      await page.route('**' + endpoint + '?*', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 200120, message: 'Controlled capacity', data: null, meta: {} }) }), { times: 1 })
      await clickExport(); await expect(page.getByText(text.limit, { exact: false })).toBeVisible(); expect(downloads).toHaveLength(1)
      await expect(button).toBeEnabled()
      const [retry] = await Promise.all([page.waitForEvent('download'), clickExport()])
      expect(await retry.failure()).toBeNull(); expect(downloads).toHaveLength(2)
      // Keep one real A response held while the real SPA logs out and logs in as B.
      const marker = randomBytes(12).toString('hex')
      await page.evaluate(value => { (window as Window & { global66Marker?: string }).global66Marker = value }, marker)
      let heldRequest: Request | undefined, terminal: 'finished' | 'failed' | undefined, captured = false, fulfillReturned = false, fulfillError: unknown
      let handled!: () => void
      const processed = new Promise<void>(resolve => { handled = resolve })
      const gate = new Promise<void>(resolve => { releaseHeld = resolve })
      page.on('requestfinished', value => { if (value === heldRequest) terminal = 'finished' })
      page.on('requestfailed', value => { if (value === heldRequest) terminal = 'failed' })
      await page.route('**' + endpoint + '?*', async route => {
        heldRequest = route.request()
        const result = await route.fetch(); expect((await result.json()).code).toBe(0); captured = true
        await gate
        try { await route.fulfill({ response: result }); fulfillReturned = true }
        catch (error) { fulfillError = error }
        finally { handled() }
      }, { times: 1 })
      await clickExport(); await expect.poll(() => captured).toBe(true)
      const signedOut = page.waitForResponse(value => new URL(value.url()).pathname === '/api/v1/auth/logout')
      if (width === 390) {
        await page.getByRole('button', { name: text.account, exact: true }).click()
        await page.getByTestId('console-mobile-account-menu').getByRole('menuitem', { name: text.logout, exact: true }).click()
      } else await page.getByTestId('console-account').getByRole('button', { name: text.logout, exact: true }).click()
      expect((await (await signedOut).json()).code).toBe(0); await expect(page).toHaveURL(url => url.pathname === '/login')
      await expect(page.getByTestId('visit-export')).toHaveCount(0)
      await page.getByLabel(/^(账号|Username)$/).fill(accounts[2]!.username); await page.getByLabel(/^(密码|Password)$/).fill(password)
      const signedIn = page.waitForResponse(value => new URL(value.url()).pathname === '/api/v1/auth/login')
      await page.getByRole('button', { name: /^(登录|Sign in)$/ }).click()
      expect((await (await signedIn).json()).data.user.id).toBe(accounts[2]!.id)
      await expect(page).not.toHaveURL(url => url.pathname === '/login')
      if (new URL(page.url()).pathname === '/') { await page.getByRole('button', { name: 'Global viewer 2', exact: true }).click(); await expect(page).toHaveURL(/\/profile$/) }
      if (new URL(page.url()).pathname !== '/admin/dashboard') {
        if (width === 390) await page.locator('button.console-topbar__menu').click()
        await page.locator('a[href="/admin/dashboard"]').filter({ visible: true }).click()
      }
      await expect(button).toBeEnabled(); expect((await get<{ user: { id: string } }>(page.request, '/auth/me')).user.id).toBe(accounts[2]!.id)
      releaseHeld!(); await processed
      if (fulfillError) throw fulfillError
      await expect.poll(() => terminal).toMatch(/^(finished|failed)$/)
      if (terminal === 'finished') { expect(heldRequest!.failure()).toBeNull(); expect((await (await heldRequest!.response())!.json()).code).toBe(0) }
      else expect(heldRequest!.failure()).not.toBeNull()
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      expect(downloads).toHaveLength(2)
      expect(await page.evaluate(() => (window as Window & { global66Marker?: string }).global66Marker)).toBe(marker)
      await expectNoHorizontalOverflow(page)
      await info.attach('identity-network-terminal', { body: JSON.stringify({ language, width, browser: browser.version(), driverNode: process.version, terminal, fulfillReturned, oldComponentRetired: true, survivingIdentityProof: 'unit-controlled cache and date transitions', downloads: downloads.length }), contentType: 'application/json' })
    } catch (error) { errors.push(error) }
    finally {
      releaseHeld?.()
      for (const link of links.filter(value => !deleted.has(value.id))) {
        try { await post(request, '/admin/short-link/delete', { id: link.id }) } catch (error) { errors.push(error) }
      }
      for (const account of accounts) {
        try { await post(request, '/admin/user/update', { id: account.id, nickname: 'Retired global visit fixture', status: 'disabled' }) } catch (error) { errors.push(error) }
      }
      for (const context of contexts) { try { await context.close() } catch (error) { errors.push(error) } }
      await info.attach('owned-fixture-cleanup', { body: JSON.stringify({ accounts: accounts.map(value => value.id), links: links.map(value => value.id), errors: errors.map(String) }), contentType: 'application/json' })
    }
    if (errors.length) throw new AggregateError(errors, 'Global export scenario or independent fixture cleanup failed')
  })
}
