import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test as base } from '@playwright/test'
import type { APIRequestContext, Browser, BrowserContext, Page, TestInfo } from '@playwright/test'
import type { ManagedDomain } from '../src/entities/domain/api'
import type { RedirectMode } from '../src/entities/short-link/model'
import type { DomainRedirectDefaultSetting } from '../src/entities/domain/redirect-default'
import type { UserGroup } from '../src/entities/user-group/api'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

interface Account { id: string; username: string }
interface Preference { redirectMode: RedirectMode | null; updatedAt: string | null }
interface Link { id: string; slug: string; redirectMode: RedirectMode; intermediateDelaySeconds: number }
interface Scenario { createAccount(): Promise<Account>; openBrowser(width: number): Promise<Page>; ownLink(id: string): void }
const password = 'personal-redirect-mode-password'
const modeLabel = /^(默认跳转方式|Default redirect mode)$/
const followDomain = /^(跟随域名默认|Follow domain default)$/
const personalConfirmation = /^(确认页跳转|Confirmation page)$/
const creationModes = { direct: /^(直接跳转|Direct redirect)$/, intermediate: /^(中间页|Intermediate page)$/, confirmation: /^(确认页|Confirmation page)$/ }
const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, page: admin }, use, info) => { await withScenario(browser, admin.request, info, use) }, { timeout: 45_000 }],
})
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const width of [1280, 390]) {
  test('v0.39.0 preserves personal redirect preferences, manual priority and existing links at ' + width + 'px', async ({ scenario }, info) => {
    info.setTimeout(150_000)
    const account = await scenario.createAccount()
    const other = await scenario.createAccount()
    const page = await scenario.openBrowser(width)
    await signIn(page, account)
    expect(await read(page)).toEqual({ redirectMode: null, updatedAt: null })
    const previous = {
      preferences: await get(page.request, '/user/preferences'),
      domain: await get(page.request, '/user/domain-preference'),
      timeZone: await get(page.request, '/user/time-zone-preference'),
    }
    // The old API's omitted mode remains direct even though this domain defaults to intermediate.
    const legacy = (await post<{ shortLink: Link }>(page.request, '/short-link/create', { targetUrl: 'https://example.com/legacy-' + account.username })).shortLink
    scenario.ownLink(legacy.id)
    expect(legacy.redirectMode).toBe('direct')

    await choose(page, personalConfirmation)
    const saved = await save(page, 'confirmation', null)
    await capture(info, 'personal-mode-' + width + '-zh-profile', page, true)
    await signOut(page)
    await signIn(page, account)
    expect(await read(page)).toEqual(saved)
    await expect(page.getByTestId('redirect-preference-form').locator('.v-select__selection-text')).toHaveText(personalConfirmation)

    await page.goto('/')
    await advanced(page)
    await expect(page.getByRole('button', { name: creationModes.confirmation })).toHaveAttribute('aria-pressed', 'true')
    const personal = await create(page, 'confirmation', scenario)
    await expect(page.getByRole('button', { name: creationModes.confirmation })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: creationModes.direct }).click()
    const manual = await create(page, 'direct', scenario)
    expect(manual.redirectMode).toBe('direct')

    await page.goto('/profile')
    await expect(page.getByTestId('redirect-preference-save')).toBeEnabled()
    await switchEnglish(page)
    await choose(page, followDomain)
    const cleared = await save(page, null, saved.updatedAt)
    await capture(info, 'personal-mode-' + width + '-en-profile', page, true)
    await page.goto('/')
    await advanced(page)
    await expect(page.getByRole('button', { name: creationModes.intermediate })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('slider', { name: 'Intermediate delay (seconds)' })).toHaveAttribute('aria-valuenow', '5')
    await capture(info, 'personal-mode-' + width + '-en-creator', page)
    const fallback = await create(page, 'intermediate', scenario)
    const links = (await get<{ items: Link[] }>(page.request, '/short-link/list?page=1&pageSize=100')).items
    expect(links.find(link => link.id === legacy.id)?.redirectMode).toBe('direct')
    expect(links.find(link => link.id === personal.id)?.redirectMode).toBe('confirmation')
    expect(links.find(link => link.id === fallback.id)?.redirectMode).toBe('intermediate')
    expect(await get(page.request, '/user/preferences')).toEqual(previous.preferences)
    expect(await get(page.request, '/user/domain-preference')).toEqual(previous.domain)
    expect(await get(page.request, '/user/time-zone-preference')).toEqual(previous.timeZone)

    await page.goto('/profile')
    await signOut(page)
    await signIn(page, other)
    expect(await read(page)).toEqual({ redirectMode: null, updatedAt: null })
    await expect(page.getByTestId('redirect-preference-form').locator('.v-select__selection-text')).toHaveText(followDomain)
    expect(await page.evaluate(() => Object.keys(localStorage).filter(key => /redirect.?preference/i.test(key)))).toEqual([])
    await captureJSON(info, 'personal-mode-protocol', { width, saved, cleared, previous, legacy, personal, manual, fallback, otherAccountUnchanged: true })
  })
}

/** Owns all created resources and restores shared isolated fixture settings even on assertion failure. */
async function withScenario(browser: Browser, admin: APIRequestContext, info: TestInfo, run: (scenario: Scenario) => Promise<void>) {
  const baseURL = info.project.use.baseURL
  if (typeof baseURL !== 'string') throw new Error('Personal redirect E2E requires baseURL')
  const accounts: Account[] = [], links: string[] = [], contexts: BrowserContext[] = []
  const cleanupErrors: unknown[] = []
  let global: ManagedDomain | undefined
  let originalMode: RedirectMode | undefined
  let originalPermissions: string[] | undefined
  let scenarioFailed = false
  let scenarioError: unknown
  try {
    await captureJSON(info, 'browser-runtime', { browserVersion: browser.version(), driverNode: process.version, isolatedContexts: true })
    await post(admin, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
    global = (await get<{ items: ManagedDomain[] }>(admin, '/admin/domain/list')).items.find(domain => domain.isDefault)
    expect(global).toBeDefined()
    originalMode = (await domainSetting(admin, global!.id)).redirectMode
    originalPermissions = [...(await userGroup(admin)).permissions]
    await setPermissions(admin, [...new Set([...originalPermissions, 'short_link:create', 'domain:use_default', 'short_link:read_own', 'short_link:use_intermediate', 'short_link:use_confirmation'])])
    await setDomainMode(admin, global!.id, 'intermediate')
    await run({
      async createAccount() {
        const username = 'redirect-' + randomBytes(6).toString('hex')
        const response = await admin.post('/api/v1/admin/user/create', { data: { username, nickname: 'Personal redirect test', password, groupKey: 'user', status: 'active' } })
        const payload = await response.json() as { code: number; data: { user: Account } }
        if (payload.code === 0 && payload.data.user.id) accounts.push(payload.data.user)
        expect(response.status()).toBe(200)
        expect(payload).toMatchObject({ code: 0, data: { user: { id: expect.any(String), username } } })
        return payload.data.user
      },
      async openBrowser(width) {
        const context = await browser.newContext({ baseURL, locale: 'zh-CN', colorScheme: 'light', reducedMotion: 'reduce', serviceWorkers: 'block', viewport: { width, height: width === 1280 ? 720 : 800 } })
        contexts.push(context)
        await context.addInitScript(() => {
          if (localStorage.getItem('moeurl.language') === null) localStorage.setItem('moeurl.language', 'zh-CN')
          if (localStorage.getItem('moeurl.theme') === null) localStorage.setItem('moeurl.theme', 'light')
        })
        return context.newPage()
      },
      ownLink(id) { links.push(id) },
    })
  } catch (error) { scenarioFailed = true; scenarioError = error } finally {
    for (const id of links) {
      try { await post(admin, '/admin/short-link/delete', { id }) } catch (error) { cleanupErrors.push(error) }
    }
    for (const account of accounts) {
      try { await post(admin, '/admin/user/update', { id: account.id, nickname: 'Personal redirect test', status: 'disabled' }) } catch (error) { cleanupErrors.push(error) }
    }
    if (global && originalMode !== undefined) {
      try { await setDomainMode(admin, global.id, originalMode); expect((await domainSetting(admin, global.id)).redirectMode).toBe(originalMode) } catch (error) { cleanupErrors.push(error) }
    }
    if (originalPermissions) {
      try { await setPermissions(admin, originalPermissions); expect([...(await userGroup(admin)).permissions].sort()).toEqual([...originalPermissions].sort()) } catch (error) { cleanupErrors.push(error) }
    }
    for (const context of contexts) {
      try { await context.close() } catch (error) { cleanupErrors.push(error) }
    }
  }
  if (scenarioFailed) {
    if (cleanupErrors.length) throw new AggregateError([scenarioError, ...cleanupErrors], 'Personal redirect scenario and cleanup failed')
    throw scenarioError
  }
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Personal redirect cleanup failed')
}

async function signIn(page: Page, account: Account) {
  await page.goto('/login?redirect=/profile')
  await page.getByLabel(/^(账号|Username)$/, { exact: true }).fill(account.username)
  await page.getByLabel(/^(密码|Password)$/, { exact: true }).fill(password)
  await page.getByRole('button', { name: /^(登录|Sign in)$/, exact: true }).click()
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.getByTestId('redirect-preference-save')).toBeEnabled()
}
async function signOut(page: Page) {
  if ((page.viewportSize()?.width ?? 1280) < 960) {
    await page.getByRole('button', { name: /^(打开账号菜单|Open account menu)$/ }).click()
    await page.getByRole('menuitem', { name: /^(退出登录|Sign out)$/ }).click()
  } else await page.getByRole('button', { name: /^(退出登录|Sign out)$/, exact: true }).click()
  await expect(page).toHaveURL(/\/login(?:\?redirect=(?:%2F|\/)profile)?$/)
}
async function choose(page: Page, name: RegExp) {
  const form = page.getByTestId('redirect-preference-form')
  await form.getByRole('combobox', { name: modeLabel }).press('Enter')
  await page.getByRole('option', { name, exact: true }).click()
  await expect(form.locator('.v-select__selection-text')).toHaveText(name)
}
async function save(page: Page, redirectMode: RedirectMode | null, expectedUpdatedAt: string | null): Promise<Preference> {
  const pending = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/user/redirect-preference/update' && response.request().method() === 'POST')
  await page.getByTestId('redirect-preference-save').click()
  const response = await pending
  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toBe('no-store')
  expect(response.request().postDataJSON()).toEqual({ redirectMode, expectedUpdatedAt })
  const payload = await response.json() as { code: number; data: { preference: Preference } }
  expect(payload).toMatchObject({ code: 0, data: { preference: { redirectMode, updatedAt: expect.any(String) } } })
  expect(payload.data.preference.updatedAt).not.toBe(expectedUpdatedAt)
  await expect(page.getByTestId('redirect-preference-save')).toBeEnabled()
  return payload.data.preference
}
async function read(page: Page) { return (await get<{ preference: Preference }>(page.request, '/user/redirect-preference')).preference }
async function advanced(page: Page) {
  const toggle = page.getByRole('button', { name: /^(高级设置|Advanced settings)$/ })
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click()
}
/** Sends via a real keyboard Enter, then verifies the exact payload and persisted result. */
async function create(page: Page, mode: RedirectMode, scenario: Scenario): Promise<Link> {
  const input = page.getByRole('textbox', { name: /^(输入链接|Enter link)$/ })
  await input.fill('https://example.com/personal-' + mode)
  await expect(page.locator('.short-link-create-panel__submit')).toBeEnabled()
  const waiting = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/short-link/create' && response.request().method() === 'POST')
  await input.press('Enter')
  const response = await waiting
  const payload = await response.json() as { code: number; data: { shortLink: Link } }
  if (payload.code === 0 && payload.data.shortLink.id) scenario.ownLink(payload.data.shortLink.id)
  expect(payload.code).toBe(0)
  expect(response.request().postDataJSON()).toEqual({ targetUrl: 'https://example.com/personal-' + mode, redirectMode: mode, ...mode === 'intermediate' ? { intermediateDelaySeconds: 5 } : {} })
  expect(payload.data.shortLink.redirectMode).toBe(mode)
  await expect(page.getByTestId('short-link-create-result')).toBeVisible()
  return payload.data.shortLink
}
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
async function capture(info: TestInfo, name: string, page: Page, panel = false) {
  const section = panel ? page.getByTestId('redirect-preference-panel') : page.locator('.short-link-create-panel')
  await section.scrollIntoViewIfNeeded()
  await expectNoHorizontalOverflow(page)
  const saveButton = panel ? page.getByTestId('redirect-preference-save') : page.locator('.short-link-create-panel__submit')
  const box = await saveButton.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  const path = info.outputPath(name + '.png')
  await page.screenshot({ path, animations: 'disabled' })
  await info.attach(name, { path, contentType: 'image/png' })
}
async function captureJSON(info: TestInfo, name: string, value: unknown) {
  const path = info.outputPath(name + '.json')
  await writeFile(path, JSON.stringify(value, null, 2))
  await info.attach(name, { path, contentType: 'application/json' })
}
async function userGroup(api: APIRequestContext) { return (await get<{ groups: UserGroup[] }>(api, '/admin/user-group/list')).groups.find(group => group.key === 'user')! }
async function setPermissions(api: APIRequestContext, permissions: string[]) { await post(api, '/admin/user-group/update-permissions', { groupKey: 'user', permissions, expectedUpdatedAt: (await userGroup(api)).updatedAt }) }
async function domainSetting(api: APIRequestContext, id: string) { return (await get<{ setting: DomainRedirectDefaultSetting }>(api, '/admin/domain/redirect-default?id=' + id)).setting }
async function setDomainMode(api: APIRequestContext, id: string, redirectMode: RedirectMode) { await post(api, '/admin/domain/set-redirect-default', { id, redirectMode, expectedUpdatedAt: (await domainSetting(api, id)).updatedAt }) }
async function get<T = unknown>(api: APIRequestContext, path: string): Promise<T> {
  const response = await api.get('/api/v1' + path)
  expect(response.status()).toBe(200)
  const payload = await response.json() as { code: number; data: T }
  expect(payload.code).toBe(0)
  return payload.data
}
async function post<T = unknown>(api: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await api.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200)
  const payload = await response.json() as { code: number; data: T }
  expect(payload.code).toBe(0)
  return payload.data
}
