import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test as base } from '@playwright/test'
import type { BrowserContext, Page, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

interface Preference { timeZone: string | null; updatedAt: string | null }
interface Account { id: string; username: string }
interface Scenario { account: Account; open(width?: number, language?: string, unsupported?: boolean): Promise<Page> }
const password = 'catalog-owned-test-password'
const zoneLabel = /^(显示时区|Display time zone)$/
const longZone = 'America/Argentina/Rio_Gallegos'
const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, page: admin }, use, info) => {
    const contexts: BrowserContext[] = []
    const accounts: Account[] = []
    const errors: unknown[] = []
    try {
      await post(admin, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      const username = 'tzcatalog-' + randomBytes(6).toString('hex')
      const response = await admin.request.post('/api/v1/admin/user/create', { data: { username, nickname: 'Catalog test', password, groupKey: 'user', status: 'active' } })
      const payload = await response.json() as { code: number; data: { user: Account } }
      if (payload.code === 0 && payload.data.user.id) accounts.push(payload.data.user)
      expect(response.status()).toBe(200)
      expect(payload).toMatchObject({ code: 0, data: { user: { id: expect.any(String), username } } })
      await use({ account: payload.data.user, async open(width = 1280, language = 'zh-CN', unsupported = false) {
        const context = await browser.newContext({ baseURL: info.project.use.baseURL, locale: language, timezoneId: 'Asia/Tokyo', colorScheme: 'light', reducedMotion: 'reduce', serviceWorkers: 'block', viewport: { width, height: width === 1280 ? 900 : 844 } })
        contexts.push(context)
        await context.addInitScript(({ language, unsupported }) => {
          localStorage.setItem('moeurl.language', language)
          localStorage.setItem('moeurl.theme', 'light')
          if (unsupported) {
            // Model a browser whose Intl lacks this saved directory member, without changing HTTP data.
            Intl.DateTimeFormat = new Proxy(Intl.DateTimeFormat, {
              construct(target, args) {
                if ((args[1] as Intl.DateTimeFormatOptions | undefined)?.timeZone === 'Asia/Katmandu') throw new RangeError('Unsupported test browser time zone')
                return Reflect.construct(target, args)
              },
              apply(target, receiver, args) {
                if ((args[1] as Intl.DateTimeFormatOptions | undefined)?.timeZone === 'Asia/Katmandu') throw new RangeError('Unsupported test browser time zone')
                return Reflect.apply(target, receiver, args)
              },
            })
          }
        }, { language, unsupported })
        return context.newPage()
      } })
    } catch (error) { errors.push(error) } finally {
      for (const account of accounts) {
        try { await post(admin, '/admin/user/update', { id: account.id, nickname: 'Catalog test', status: 'disabled' }) } catch (error) { errors.push(error) }
      }
      for (const context of contexts) {
        try { await context.close() } catch (error) { errors.push(error) }
      }
    }
    if (errors.length) throw new AggregateError(errors, 'Catalog scenario or owned cleanup failed')
  }, { timeout: 120_000 }],
})
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const width of [1280, 390]) for (const language of ['zh-CN', 'en']) {
  test(`v0.60.0 searches exact catalog values without saving search text at ${width}px ${language}`, async ({ scenario }, info) => {
    info.setTimeout(120_000)
    const page = await scenario.open(width, language)
    await signIn(page, scenario.account)
    const selector = page.getByRole('combobox', { name: zoneLabel })
    await page.getByTestId('time-zone-preference-panel').scrollIntoViewIfNeeded()
    await selector.fill('cHaThAm')
    await expect(page.getByRole('option', { name: 'Pacific/Chatham', exact: true })).toBeVisible()
    await selector.press('ArrowDown')
    await expect(page.getByRole('option', { name: 'Pacific/Chatham', exact: true })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.getByTestId('time-zone-preference-selection')).toContainText('Pacific/Chatham')
    expect(await read(page)).toEqual({ timeZone: null, updatedAt: null })
    const chatham = await save(page, 'Pacific/Chatham', null)
    await expect(page.getByTestId('console-time-zone')).toContainText('Pacific/Chatham')
    await capture(info, `catalog-${width}-${language}-saved`, page)

    await selector.fill('NoSuchCity')
    await expect(page.getByText(/^(没有匹配的时区，请换个关键词。|No matching time zone\. Try another search\.)$/)).toBeVisible()
    await selector.press('Enter')
    await selector.fill('')
    await selector.press('Escape')
    expect(await read(page)).toEqual(chatham)
    await expect(page.getByTestId('time-zone-preference-selection')).toContainText('Pacific/Chatham')
    await selector.fill('Rio_Gallegos')
    await expect(page.getByRole('option', { name: longZone, exact: true })).toBeVisible()
    await capture(info, `catalog-${width}-${language}-long-option`, page)
    await page.getByRole('option', { name: longZone, exact: true }).click()
    await expect(page.getByTestId('time-zone-preference-selection')).toContainText(longZone)
    expect(await read(page)).toEqual(chatham)
    await expect(page.getByTestId('console-time-zone')).toContainText('Pacific/Chatham')
    await choose(page, 'Asia/Katmandu')
    const katmandu = await save(page, 'Asia/Katmandu', chatham.updatedAt)
    await page.reload()
    await expect(selector).toHaveValue('Asia/Katmandu')
    expect(await read(page)).toEqual(katmandu)

    const fallback = await scenario.open(width, language, true)
    await signIn(fallback, scenario.account)
    await expect(fallback.getByTestId('time-zone-preference-panel').getByText(/此设备不支持已保存的时区|This device does not support your saved time zone/)).toBeVisible()
    const fallbackStatus = language === 'zh-CN'
      ? '时间显示：设备本地时区 此设备不支持已保存的时区，当前按设备时区显示；账号设置未改变。'
      : 'Time display: device local time zone This device does not support your saved time zone. Using device time without changing your account setting.'
    await expect(fallback.getByTestId('console-time-zone')).toHaveText(fallbackStatus)
    expect(await read(fallback)).toEqual(katmandu)
    await capture(info, `catalog-${width}-${language}-fallback`, fallback)

    const device = language === 'zh-CN' ? '跟随设备' : 'Follow device'
    await selector.fill(device)
    await page.getByRole('option', { name: device, exact: true }).click()
    expect(await read(page)).toEqual(katmandu)
    const deviceSaved = await save(page, null, katmandu.updatedAt)
    await page.reload()
    await expect(page.getByTestId('time-zone-preference-selection')).toHaveText(language === 'zh-CN' ? `已选：${device}` : `Selected: ${device}`)
    expect(await read(page)).toEqual(deviceSaved)
    await expect(page.getByTestId('console-time-zone')).toHaveText(/^(时间显示：设备本地时区|Time display: device local time zone)$/)
    await page.getByTestId('time-zone-preference-panel').scrollIntoViewIfNeeded()
    await capture(info, `catalog-${width}-${language}-device-restored`, page)
  })
}

test('v0.60.0 keeps a new catalog draft on a real second-device conflict until explicit reload', async ({ scenario }, info) => {
  const first = await scenario.open()
  const second = await scenario.open()
  await signIn(first, scenario.account)
  await signIn(second, scenario.account)
  await choose(first, 'Pacific/Chatham')
  await choose(second, 'Asia/Katmandu')
  const saved = await save(first, 'Pacific/Chatham', null)
  const pending = second.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/user/time-zone-preference/update')
  await second.getByTestId('time-zone-preference-save').click()
  const response = await pending
  expect(response.request().postDataJSON()).toEqual({ timeZone: 'Asia/Katmandu', expectedUpdatedAt: null })
  expect(await response.json()).toMatchObject({ code: 300104 })
  await expect(second.getByTestId('time-zone-preference-selection')).toContainText('Asia/Katmandu')
  await expect(second.getByTestId('time-zone-preference-save')).toBeDisabled()
  await second.getByTestId('time-zone-preference-panel').scrollIntoViewIfNeeded()
  await capture(info, 'catalog-real-conflict', second)
  await second.getByRole('button', { name: '重新加载时区', exact: true }).click()
  await expect(second.getByRole('combobox', { name: zoneLabel })).toHaveValue('Pacific/Chatham')
  await expect(second.getByTestId('time-zone-preference-save')).toBeEnabled()
  expect(await read(second)).toEqual(saved)
})

/** Uses real login to exercise authentication and preference hydration. */
async function signIn(page: Page, account: Account) {
  await page.goto('/login?redirect=/profile')
  await page.getByLabel(/^(账号|Username)$/, { exact: true }).fill(account.username)
  await page.getByLabel(/^(密码|Password)$/, { exact: true }).fill(password)
  await page.getByRole('button', { name: /^(登录|Sign in)$/, exact: true }).click()
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.getByTestId('time-zone-preference-save')).toBeEnabled()
}

/** Searches and selects the exact visible identifier without issuing a write. */
async function choose(page: Page, value: string) {
  await page.getByRole('combobox', { name: zoneLabel }).fill(value)
  await page.getByRole('option', { name: value, exact: true }).click()
  await expect(page.getByTestId('time-zone-preference-selection')).toContainText(value)
}

/** Checks the exact CAS request and authoritative response of one explicit save. */
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

/** Reads the saved value independently of the mounted editor and query cache. */
async function read(page: Page): Promise<Preference> {
  const response = await page.request.get('/api/v1/user/time-zone-preference')
  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toBe('no-store')
  const payload = await response.json() as { code: number; data: { preference: Preference } }
  expect(payload.code).toBe(0)
  return payload.data.preference
}

/** Verifies business success for setup and cleanup, without logging credentials. */
async function post(page: Page, path: string, data: unknown) {
  const response = await page.request.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200)
  expect(await response.json()).toMatchObject({ code: 0 })
}

/** Keeps unmodified screenshots and actual browser runtime alongside layout checks. */
async function capture(info: TestInfo, name: string, page: Page) {
  await expectNoHorizontalOverflow(page)
  const path = info.outputPath(name + '.png')
  await page.screenshot({ path, animations: 'disabled' })
  await info.attach(name, { path, contentType: 'image/png' })
  const runtime = info.outputPath(name + '-runtime.json')
  await writeFile(runtime, JSON.stringify({ browser: page.context().browser()!.version(), driverNode: process.version, viewport: page.viewportSize(), saved: await read(page) }, null, 2))
  await info.attach(name + '-runtime', { path: runtime, contentType: 'application/json' })
}
