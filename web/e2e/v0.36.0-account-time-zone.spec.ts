import { randomBytes } from 'node:crypto'
import { expect, test as base } from '@playwright/test'
import type { APIRequestContext, Browser, BrowserContext, Page, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

interface Account { id: string; username: string }
interface Preference { timeZone: string | null; updatedAt: string | null }
interface Link { id: string; slug: string; expiresAt: string }
interface Scenario {
  createAccount(): Promise<Account>
  openBrowser(width?: number, timezoneId?: string): Promise<Page>
  ownLink(id: string): void
}
const password = 'time-zone-preference-password'
const zoneLabel = /^(显示时区|Display time zone)$/
const deviceOption = /^(跟随设备|Follow device)$/
const instant = '2030-01-01T00:30:00Z'
const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, page: admin }, use, info) => {
    await withScenario(browser, admin.request, info, use)
  }, { timeout: 30_000 }],
})
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const width of [1280, 390]) {
  test('v0.36.0 preserves account time zones across devices and keeps UTC/input semantics at ' + width + 'px', async ({ scenario }, info) => {
    info.setTimeout(120_000)
    const account = await scenario.createAccount()
    const otherAccount = await scenario.createAccount()
    const editor = await scenario.openBrowser(width, 'Asia/Tokyo')
    const second = await scenario.openBrowser(width, 'America/Los_Angeles')
    await signIn(editor, account)
    expect(await read(editor)).toEqual({ timeZone: null, updatedAt: null })
    await expect(editor.getByTestId('console-time-zone')).toHaveText('时间显示：设备本地时区')
    const oldPreferences = await get(editor.request, '/user/preferences')
    const oldDomain = await get(editor.request, '/user/domain-preference')
    await choose(editor, / · America\/New_York$/)
    const saved = await save(editor, 'America/New_York', null)
    await expect(editor.getByTestId('console-time-zone')).toHaveText('时间显示：America/New_York')
    await capture(info, 'time-zone-' + width + '-zh', editor, true)

    // A real keyboard creation still interprets datetime-local using this device (Tokyo), not New York.
    await editor.goto('/')
    await editor.getByRole('button', { name: '高级设置', exact: true }).click()
    await editor.getByRole('checkbox', { name: '设置过期时间', exact: true }).check()
    const expiration = editor.locator('input[type="datetime-local"]')
    await expect(expiration).toHaveAccessibleName('过期时间（设备本地时间）')
    await expiration.fill('2030-01-01T09:30')
    const target = editor.locator('.short-link-create-panel__input input')
    await target.fill('https://example.com/time-zone-' + account.username)
    const createdResponse = editor.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/short-link/create' && response.request().method() === 'POST')
    await expect(editor.locator('.short-link-create-panel__submit')).toBeEnabled()
    await target.press('Enter')
    const created = await createdResponse
    const payload = await created.json() as { code: number; data: { shortLink: Link } }
    if (payload.code === 0 && payload.data.shortLink.id) scenario.ownLink(payload.data.shortLink.id)
    expect(payload.code).toBe(0)
    expect(created.request().postDataJSON().expiration).toEqual({ mode: 'at', expiresAt: '2030-01-01T00:30:00.000Z' })
    const link = payload.data.shortLink
    expect(link.expiresAt).toBe(instant)
    const rangeBefore = await statistics(editor, link.id)
    await editor.goto('/link')
    await switchEnglish(editor)
    const row = editor.getByTestId('console-link-row').filter({ hasText: link.slug })
    await expect(row).toContainText('Dec 31, 2029, 19:30')
    await expect(editor.getByTestId('console-time-zone')).toHaveText('Time display: America/New_York')
    await capture(info, 'time-zone-' + width + '-en-cross-day', editor)

    await signIn(second, account)
    expect(await read(second)).toEqual(saved)
    await expect(second.getByRole('combobox', { name: zoneLabel })).toHaveValue(/ · America\/New_York$/)
    await second.goto('/link')
    await expect(second.getByTestId('console-link-row').filter({ hasText: link.slug })).toContainText('2029年12月31日 19:30')

    // Use the real logout/login flows: the guest and a different account must not inherit this value.
    await editor.goto('/profile')
    await signOut(editor)
    await expect(editor.getByTestId('time-zone-preference-panel')).toHaveCount(0)
    await signIn(editor, otherAccount)
    expect(await read(editor)).toEqual({ timeZone: null, updatedAt: null })
    await expect(editor.getByRole('combobox', { name: zoneLabel })).toHaveValue(deviceOption)
    await expect(editor.getByTestId('console-time-zone')).toHaveText('Time display: device local time zone')
    await signOut(editor)
    await signIn(editor, account)
    await expect(editor.getByRole('combobox', { name: zoneLabel })).toHaveValue(/ · America\/New_York$/)
    expect(await read(editor)).toEqual(saved)
    await choose(editor, deviceOption)
    const cleared = await save(editor, null, saved.updatedAt)
    await expect(editor.getByTestId('console-time-zone')).toHaveText('Time display: device local time zone')
    const rangeAfter = await statistics(editor, link.id)
    expect(rangeAfter).toEqual(rangeBefore)
    await editor.goto('/link')
    await expect(editor.getByTestId('console-link-row').filter({ hasText: link.slug })).toContainText('Jan 1, 2030, 09:30')
    await second.reload()
    await expect(second.getByTestId('console-time-zone')).toHaveText('时间显示：设备本地时区')
    await expect(second.getByTestId('console-link-row').filter({ hasText: link.slug })).toContainText('2029年12月31日 16:30')
    expect(await read(second)).toEqual(cleared)
    expect(await get(editor.request, '/user/preferences')).toEqual(oldPreferences)
    expect(await get(editor.request, '/user/domain-preference')).toEqual(oldDomain)
    expect(await editor.evaluate(() => Object.keys(localStorage).filter(key => /time.?zone/i.test(key)))).toEqual([])
    await info.attach('time-zone-protocol', { body: Buffer.from(JSON.stringify({ width, saved, cleared, instant, rangeBefore, rangeAfter, deviceInput: '2030-01-01T09:30', devices: ['Asia/Tokyo', 'America/Los_Angeles'] })), contentType: 'application/json' })
  })
}

test('v0.36.0 preserves a real second-device conflict draft until explicit reload', async ({ scenario }, info) => {
  const account = await scenario.createAccount()
  const first = await scenario.openBrowser()
  const second = await scenario.openBrowser()
  await signIn(first, account)
  await signIn(second, account)
  await choose(second, / · Asia\/Tokyo$/)
  await choose(first, / · UTC$/)
  const saved = await save(first, 'UTC', null)
  const pending = second.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/user/time-zone-preference/update')
  await second.getByTestId('time-zone-preference-save').click()
  const response = await pending
  expect(response.request().postDataJSON()).toEqual({ timeZone: 'Asia/Tokyo', expectedUpdatedAt: null })
  expect(await response.json()).toMatchObject({ code: 300104 })
  await expect(second.getByRole('combobox', { name: zoneLabel })).toHaveValue(/ · Asia\/Tokyo$/)
  const panel = second.getByTestId('time-zone-preference-panel')
  await expect(second.getByTestId('time-zone-preference-save')).toBeDisabled()
  await expect(panel.getByRole('button', { name: '重新加载时区', exact: true })).toBeVisible()
  await capture(info, 'time-zone-conflict', second, true)
  const reloaded = second.waitForResponse(result => new URL(result.url()).pathname === '/api/v1/user/time-zone-preference' && result.request().method() === 'GET')
  await panel.getByRole('button', { name: '重新加载时区', exact: true }).click()
  expect(await (await reloaded).json()).toMatchObject({ code: 0, data: { preference: saved } })
  await expect(second.getByRole('combobox', { name: zoneLabel })).toHaveValue(/ · UTC$/)
  await expect(second.getByTestId('time-zone-preference-save')).toBeEnabled()
  await choose(second, / · Europe\/London$/)
  const updated = await save(second, 'Europe/London', saved.updatedAt)
  expect(await read(first)).toEqual(updated)
})

/** Registers fixture ownership immediately and aggregates cleanup with the original scenario failure. */
async function withScenario(browser: Browser, admin: APIRequestContext, info: TestInfo, run: (scenario: Scenario) => Promise<void>) {
  const baseURL = info.project.use.baseURL
  if (typeof baseURL !== 'string') throw new Error('Timezone E2E requires a baseURL')
  const accounts: Account[] = []
  const links: string[] = []
  const contexts: BrowserContext[] = []
  const errors: unknown[] = []
  let failed = false
  let originalError: unknown
  try {
    await info.attach('browser-runtime', { body: Buffer.from(JSON.stringify({ browserVersion: browser.version(), driverNode: process.version, isolatedContexts: true })), contentType: 'application/json' })
    await post(admin, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
    await run({
      async createAccount() {
        const username = 'timezone-' + randomBytes(6).toString('hex')
        const response = await admin.post('/api/v1/admin/user/create', { data: { username, nickname: 'Time-zone test', password, groupKey: 'user', status: 'active' } })
        const payload = await response.json() as { code: number; data: { user: Account } }
        if (payload.code === 0 && payload.data.user.id) accounts.push(payload.data.user)
        expect(response.status()).toBe(200)
        expect(payload).toMatchObject({ code: 0, data: { user: { id: expect.any(String), username } } })
        return payload.data.user
      },
      async openBrowser(width = 1280, timezoneId = 'Asia/Tokyo') {
        const context = await browser.newContext({ baseURL, timezoneId, locale: 'zh-CN', colorScheme: 'light', reducedMotion: 'reduce', serviceWorkers: 'block', viewport: { width, height: width === 1280 ? 800 : 844 } })
        contexts.push(context)
        await context.addInitScript(() => {
          if (localStorage.getItem('moeurl.language') === null) localStorage.setItem('moeurl.language', 'zh-CN')
          if (localStorage.getItem('moeurl.theme') === null) localStorage.setItem('moeurl.theme', 'light')
        })
        return context.newPage()
      },
      ownLink(id) { links.push(id) },
    })
  } catch (error) { failed = true; originalError = error } finally {
    for (const id of links) {
      try { await post(admin, '/admin/short-link/delete', { id }) } catch (error) { errors.push(error) }
    }
    // The product has no user-delete API; disable only owned accounts before Compose drops its database.
    for (const account of accounts) {
      try { await post(admin, '/admin/user/update', { id: account.id, nickname: 'Time-zone test', status: 'disabled' }) } catch (error) { errors.push(error) }
    }
    for (const context of contexts) {
      try { await context.close() } catch (error) { errors.push(error) }
    }
  }
  if (failed) {
    if (errors.length) throw new AggregateError([originalError, ...errors], 'Timezone scenario and cleanup failed')
    throw originalError
  }
  if (errors.length) throw new AggregateError(errors, 'Timezone cleanup failed')
}

/** Uses production login so the shared account epoch and private query hydration both run. */
async function signIn(page: Page, account: Account) {
  await page.goto('/login?redirect=/profile')
  await page.getByLabel(/^(账号|Username)$/, { exact: true }).fill(account.username)
  await page.getByLabel(/^(密码|Password)$/, { exact: true }).fill(password)
  await page.getByRole('button', { name: /^(登录|Sign in)$/, exact: true }).click()
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.getByTestId('time-zone-preference-save')).toBeEnabled()
}

/** Exercises real logout rather than just replacing browser cookies. */
async function signOut(page: Page) {
  if ((page.viewportSize()?.width ?? 1280) < 960) {
    await page.getByRole('button', { name: /^(打开账号菜单|Open account menu)$/ }).click()
    await page.getByRole('menuitem', { name: /^(退出登录|Sign out)$/ }).click()
  } else await page.getByRole('button', { name: /^(退出登录|Sign out)$/, exact: true }).click()
  await expect(page).toHaveURL(/\/login(?:\?redirect=(?:%2F|\/)profile)?$/)
}

/** Chooses a real accessible Vuetify option and verifies selection actually committed. */
async function choose(page: Page, name: RegExp) {
  const selector = page.getByTestId('time-zone-preference-form').getByRole('combobox', { name: zoneLabel })
  await selector.press('Enter')
  // The virtual list starts near the saved item; Home brings its first/device option into view.
  await selector.press('Home')
  await page.getByRole('option', { name }).click()
  await expect(selector).toHaveValue(name)
}

/** Records the complete original CAS token and authoritative no-store response. */
async function save(page: Page, timeZone: string | null, expectedUpdatedAt: string | null): Promise<Preference> {
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/user/time-zone-preference/update' && response.request().method() === 'POST')
  await page.getByTestId('time-zone-preference-save').click()
  const response = await pending
  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toBe('no-store')
  expect(response.request().postDataJSON()).toEqual({ timeZone, expectedUpdatedAt })
  const payload = await response.json() as { code: number; data: { preference: Preference } }
  expect(payload).toMatchObject({ code: 0, data: { preference: { timeZone, updatedAt: expect.any(String) } } })
  expect(payload.data.preference.updatedAt).not.toBe(expectedUpdatedAt)
  await expect(page.getByTestId('time-zone-preference-save')).toBeEnabled()
  return payload.data.preference
}

/** Reads the real server value independently of the application's private query cache. */
async function read(page: Page): Promise<Preference> {
  const result = await get<{ preference: Preference }>(page.request, '/user/time-zone-preference')
  return result.preference
}

/** Checks both the original UTC calendar range request and its applied server response. */
async function statistics(page: Page, id: string) {
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/short-link/statistics')
  await page.goto('/link/' + encodeURIComponent(id) + '/analytics')
  const response = await pending
  expect(Object.fromEntries(new URL(response.url()).searchParams)).toEqual({ id, days: '7' })
  const payload = await response.json() as { code: number; data: { range: { startDate: string; endDate: string; timeZone: 'UTC' } } }
  expect(payload.code).toBe(0)
  await expect(page.getByTestId('analytics-summary')).toBeVisible()
  await expect(page.locator('.analytics-page__description').filter({ hasText: payload.data.range.startDate }).filter({ hasText: 'UTC' })).toBeVisible()
  expect(payload.data.range.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(payload.data.range.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  expect(payload.data.range.timeZone).toBe('UTC')
  return payload.data.range
}

/** Switches only this browser's language; it must not rewrite any account preference resource. */
async function switchEnglish(page: Page) {
  const mobile = (page.viewportSize()?.width ?? 1280) < 720
  if (mobile) await page.getByRole('button', { name: /^(打开控制台菜单|Open console menu)$/, exact: true }).click()
  await page.getByRole('button', { name: /^(选择语言|Select language)$/, exact: true }).filter({ visible: true }).first().click()
  await page.getByRole('menuitemradio', { name: 'English', exact: true }).click()
  if (mobile) {
    await page.getByRole('button', { name: 'Close menu', exact: true }).click()
    await expect(page.getByTestId('console-mobile-nav')).not.toBeVisible()
  }
}

/** Captures the untouched viewport, including any real notifications; checks layout before capture. */
async function capture(info: TestInfo, name: string, page: Page, panel = false) {
  if (panel) await page.getByTestId('time-zone-preference-panel').scrollIntoViewIfNeeded()
  await expectNoHorizontalOverflow(page)
  if (panel) {
    const box = await page.getByTestId('time-zone-preference-save').boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  }
  const path = info.outputPath(name + '.png')
  await page.screenshot({ path, animations: 'disabled' })
  await info.attach(name, { path, contentType: 'image/png' })
}

/** Makes only the documented authenticated API calls and verifies business success. */
async function post<T = unknown>(api: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await api.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200)
  const payload = await response.json() as { code: number; data: T }
  expect(payload.code).toBe(0)
  return payload.data
}

/** Preserves raw independent preference snapshots without changing their versions. */
async function get<T = unknown>(api: APIRequestContext, path: string): Promise<T> {
  const response = await api.get('/api/v1' + path)
  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toBe('no-store')
  const payload = await response.json() as { code: number; data: T }
  expect(payload.code).toBe(0)
  return payload.data
}
