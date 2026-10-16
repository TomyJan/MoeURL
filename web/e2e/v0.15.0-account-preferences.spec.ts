import { randomBytes } from 'node:crypto'
import { expect, test as base } from '@playwright/test'
import type { APIRequestContext, Browser, BrowserContext, Page, TestInfo } from '@playwright/test'

import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

interface Preferences {
  language: 'zh-CN' | 'en' | null
  theme: 'system' | 'light' | 'dark' | null
  updatedAt: string | null
}
interface PreferenceUpdate extends Omit<Preferences, 'updatedAt'> {
  expectedUpdatedAt: string | null
}
interface Account { id: string; username: string }
interface Scenario {
  createAccount: () => Promise<Account>
  openBrowser: (width?: number) => Promise<Page>
}

const fixturePassword = 'account-preferences-password'
const languageLabel = /^(账号语言|Account language)$/
const themeLabel = /^(账号主题|Account theme)$/
const browserOption = /^(沿用浏览器设置|Use browser preferences)$/
const emptyPreferences: Preferences = { language: null, theme: null, updatedAt: null }

const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, page: admin }, use, testInfo) => {
    await withScenario(browser, admin.request, testInfo, use)
  }, { timeout: 30_000 }],
})

test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const width of [1280, 390]) {
  test(`restores account preferences across browsers without leaking to guests or other accounts at ${width}px`, async ({ scenario: { createAccount, openBrowser } }, testInfo) => {
    const accountA = await createAccount()
    const accountB = await createAccount()
    const editor = await openBrowser(width)
    const otherBrowser = await openBrowser(width)

    await signIn(editor, accountA)
    expect(await readPreferences(editor)).toEqual(emptyPreferences)
    await expectInterface(editor, 'zh-CN', 'light')
    await selectAccountOption(editor, languageLabel, 'English')
    await selectAccountOption(editor, themeLabel, '深色')
    // Unsaved account choices do not change the active interface.
    await expectInterface(editor, 'zh-CN', 'light')
    const saved = await savePreferences(editor, { language: 'en', theme: 'dark', expectedUpdatedAt: null })
    await expectInterface(editor, 'en', 'dark')
    await expectBrowserBaseline(editor)
    expect(await readPreferences(editor)).toEqual(saved)

    await signIn(otherBrowser, accountA)
    await expectInterface(otherBrowser, 'en', 'dark')
    expect(await readPreferences(otherBrowser)).toEqual(saved)
    await expectBrowserBaseline(otherBrowser)

    // The ordinary switchers change only this browser, even while an account override exists.
    await editor.getByRole('button', { name: 'Select language', exact: true }).filter({ visible: true }).first().click()
    await editor.getByRole('menuitemradio', { name: '中文', exact: true }).click()
    await editor.getByRole('button', { name: '选择主题', exact: true }).filter({ visible: true }).first().click()
    await editor.getByRole('menuitemradio', { name: '浅色', exact: true }).click()
    await expectInterface(editor, 'zh-CN', 'light')
    expect(await readPreferences(editor)).toEqual(saved)
    await expectInterface(otherBrowser, 'en', 'dark')

    await editor.reload()
    await expectInterface(editor, 'en', 'dark')
    await expectBrowserBaseline(editor)
    await expectNoHorizontalOverflow(editor)
    await capture(testInfo, `account-preferences-${width}px-en-dark`, editor)

    await signOut(editor)
    await expectInterface(editor, 'zh-CN', 'light', false)
    await expectBrowserBaseline(editor)
    await signIn(editor, accountB)
    expect(await readPreferences(editor)).toEqual(emptyPreferences)
    await expectInterface(editor, 'zh-CN', 'light')
    await expectDraft(editor, browserOption, browserOption)
    await signOut(editor)
    await signIn(editor, accountA)
    await expectInterface(editor, 'en', 'dark')
    expect(await readPreferences(editor)).toEqual(saved)

    if (width === 390) {
      await editor.setViewportSize({ width: 320, height: 800 })
      await expectNoHorizontalOverflow(editor)
      await capture(testInfo, 'account-preferences-320px-en-dark', editor)
    }
    await selectAccountOption(editor, languageLabel, '简体中文')
    await selectAccountOption(editor, themeLabel, 'System default')
    const system = await savePreferences(editor, { language: 'zh-CN', theme: 'system', expectedUpdatedAt: saved.updatedAt })
    await expectInterface(editor, 'zh-CN', 'light')
    await editor.emulateMedia({ colorScheme: 'dark' })
    await expectInterface(editor, 'zh-CN', 'dark')
    await editor.emulateMedia({ colorScheme: 'light' })
    await expectInterface(editor, 'zh-CN', 'light')

    await selectAccountOption(editor, languageLabel, '沿用浏览器设置')
    await selectAccountOption(editor, themeLabel, '沿用浏览器设置')
    const inherited = await savePreferences(editor, { language: null, theme: null, expectedUpdatedAt: system.updatedAt })
    await editor.reload()
    await expectInterface(editor, 'zh-CN', 'light')
    await expectDraft(editor, browserOption, browserOption)
    expect(await readPreferences(editor)).toEqual(inherited)
    await expectBrowserBaseline(editor)
    await expectNoHorizontalOverflow(editor)
    await capture(testInfo, `account-preferences-${width === 390 ? 320 : width}px-zh-inherited`, editor)
  })
}

test('retains a stale account draft on conflict and saves only after an explicit reload', async ({ scenario: { createAccount, openBrowser } }, testInfo) => {
  const account = await createAccount()
  const first = await openBrowser()
  const second = await openBrowser()
  await signIn(first, account)
  await signIn(second, account)
  const original = await readPreferences(second)
  expect(original).toEqual(emptyPreferences)

  await selectAccountOption(second, languageLabel, '简体中文')
  await selectAccountOption(second, themeLabel, '浅色')
  await selectAccountOption(first, languageLabel, 'English')
  await selectAccountOption(first, themeLabel, '深色')
  const saved = await savePreferences(first, { language: 'en', theme: 'dark', expectedUpdatedAt: original.updatedAt })
  // A real second-device save leaves this editor's draft and editing version intact.
  expect(await readPreferences(second)).toEqual(saved)
  await expectDraft(second, '简体中文', '浅色')
  const conflictResponse = second.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/v1/user/preferences/update' && response.request().method() === 'POST',
  )
  await second.getByTestId('account-preferences-save').click()
  const conflict = await conflictResponse
  expect(conflict.status()).toBe(200)
  expect(conflict.headers()['cache-control']).toBe('no-store')
  expect(conflict.request().postDataJSON()).toEqual({ language: 'zh-CN', theme: 'light', expectedUpdatedAt: original.updatedAt })
  expect(await conflict.json()).toMatchObject({ code: 300104 })
  await expectDraft(second, '简体中文', '浅色')
  const reload = second.getByTestId('account-preferences-reload')
  await expect(reload).toBeVisible()
  await capture(testInfo, 'account-preferences-conflict-draft', second)

  const reloadedResponse = second.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/v1/user/preferences' && response.request().method() === 'GET',
  )
  await reload.click()
  expect(await (await reloadedResponse).json()).toMatchObject({ code: 0, data: { preferences: saved } })
  await expect(reload).toHaveCount(0)
  await expectDraft(second, 'English', '深色')
  await selectAccountOption(second, themeLabel, '浅色')
  const updated = await savePreferences(second, { language: 'en', theme: 'light', expectedUpdatedAt: saved.updatedAt })
  await expectInterface(second, 'en', 'light')
  expect(await readPreferences(first)).toEqual(updated)
  await first.reload()
  await expectInterface(first, 'en', 'light')
})

/** Owns all accounts and contexts from creation onward, including partially failed setup. */
async function withScenario(browser: Browser, admin: APIRequestContext, testInfo: TestInfo, run: (scenario: Scenario) => Promise<void>) {
  const baseURL = testInfo.project.use.baseURL
  if (typeof baseURL !== 'string') throw new Error('Account-preferences E2E requires a baseURL')
  const accounts: Account[] = []
  const contexts: BrowserContext[] = []
  const cleanupErrors: unknown[] = []
  let scenarioFailed = false
  let scenarioError: unknown
  try {
    expect(await (await admin.post('/api/v1/auth/login', {
      data: { username: e2eAdminUsername, password: e2eAdminPassword },
    })).json()).toMatchObject({ code: 0 })
    await run({
      async createAccount() {
        const username = `preferences-${randomBytes(6).toString('hex')}`
        const response = await admin.post('/api/v1/admin/user/create', {
          data: { username, password: fixturePassword, nickname: 'Preferences test', groupKey: 'user', status: 'active' },
        })
        const payload = await response.json() as { code: number; data: { user: Account } }
        if (payload.code === 0 && payload.data.user.id) accounts.push(payload.data.user)
        await expect(response).toBeOK()
        expect(payload).toMatchObject({ code: 0, data: { user: { id: expect.any(String), username } } })
        return payload.data.user
      },
      async openBrowser(width = 1280) {
        const context = await browser.newContext({
          baseURL, locale: 'zh-CN', colorScheme: 'light', reducedMotion: 'reduce',
          viewport: { width, height: width === 1280 ? 720 : 800 }, serviceWorkers: 'block',
        })
        contexts.push(context)
        // Seed a guest baseline once; reloads must retain the browser's real persisted choices.
        await context.addInitScript(() => {
          if (localStorage.getItem('moeurl.language') === null) localStorage.setItem('moeurl.language', 'zh-CN')
          if (localStorage.getItem('moeurl.theme') === null) localStorage.setItem('moeurl.theme', 'light')
        })
        return context.newPage()
      },
    })
  } catch (error) {
    scenarioFailed = true
    scenarioError = error
  } finally {
    // No user-delete API exists. Disable fixtures before the suite discards its isolated database.
    for (const account of accounts) {
      try {
        expect(await (await admin.post('/api/v1/admin/user/update', {
          data: { id: account.id, nickname: 'Preferences test', status: 'disabled' },
        })).json()).toMatchObject({ code: 0, data: { user: { id: account.id, status: 'disabled' } } })
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
    for (const context of contexts) {
      try {
        await context.close()
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
  }
  if (scenarioFailed) {
    if (cleanupErrors.length) throw new AggregateError([scenarioError, ...cleanupErrors], 'Account-preferences scenario and cleanup failed')
    throw scenarioError
  }
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Account-preferences cleanup failed')
}

/** Enters through the real login form so identity epochs and account hydration both run. */
async function signIn(page: Page, account: Account) {
  await page.goto('/login?redirect=/profile')
  await page.getByLabel(/^(账号|Username)$/, { exact: true }).fill(account.username)
  await page.getByLabel(/^(密码|Password)$/, { exact: true }).fill(fixturePassword)
  await page.getByRole('button', { name: /^(登录|Sign in)$/, exact: true }).click()
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.getByTestId('account-preferences-save')).toBeEnabled()
}

/** Uses the responsive account menu so logout clears the in-memory account overlay. */
async function signOut(page: Page) {
  if ((page.viewportSize()?.width ?? 1280) < 960) {
    await page.getByRole('button', { name: /^(打开账号菜单|Open account menu)$/ }).click()
    await page.getByRole('menuitem', { name: /^(退出登录|Sign out)$/ }).click()
  } else {
    await page.getByRole('button', { name: /^(退出登录|Sign out)$/, exact: true }).click()
  }
  await expect(page).toHaveURL(/\/login(?:\?redirect=(?:%2F|\/)profile)?$/)
}

/** Selects a real Vuetify option through its accessible combobox. */
async function selectAccountOption(page: Page, label: RegExp, option: string) {
  await page.getByTestId('account-preferences-form').getByRole('combobox', { name: label }).press('Enter')
  await page.getByRole('option', { name: option, exact: true }).click()
}

/** Checks the real combobox values without depending on Vuetify's internal selection markup. */
async function expectDraft(page: Page, language: string | RegExp, theme: string | RegExp) {
  const form = page.getByTestId('account-preferences-form')
  await expect(form.getByRole('combobox', { name: languageLabel })).toHaveValue(language)
  await expect(form.getByRole('combobox', { name: themeLabel })).toHaveValue(theme)
}

/** Reads the server's current account value without relying on the application's query cache. */
async function readPreferences(page: Page): Promise<Preferences> {
  const response = await page.request.get('/api/v1/user/preferences')
  await expect(response).toBeOK()
  expect(response.headers()['cache-control']).toBe('no-store')
  const payload = await response.json() as { code: number; data: { preferences: Preferences } }
  expect(payload.code).toBe(0)
  return payload.data.preferences
}

/** Verifies the complete wire payload and fresh server version from an actual form save. */
async function savePreferences(page: Page, input: PreferenceUpdate): Promise<Preferences> {
  const savedResponse = page.waitForResponse((response) =>
    new URL(response.url()).pathname === '/api/v1/user/preferences/update' && response.request().method() === 'POST',
  )
  await page.getByTestId('account-preferences-save').click()
  const response = await savedResponse
  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toBe('no-store')
  expect(response.request().postDataJSON()).toEqual(input)
  const payload = await response.json() as { code: number; data: { preferences: Preferences } }
  expect(payload).toMatchObject({ code: 0, data: { preferences: { language: input.language, theme: input.theme, updatedAt: expect.any(String) } } })
  expect(payload.data.preferences.updatedAt).not.toBe(input.expectedUpdatedAt)
  expect(Number.isFinite(Date.parse(payload.data.preferences.updatedAt!))).toBe(true)
  await expect(page.getByTestId('account-preferences-save')).toBeEnabled()
  return payload.data.preferences
}

/** Observes the localized account controls (or guest login form) and the active Vuetify theme. */
async function expectInterface(page: Page, language: 'zh-CN' | 'en', theme: 'light' | 'dark', signedIn = true) {
  await expect(page.locator('.v-application')).toHaveClass(new RegExp(`v-theme--moeurl${theme === 'dark' ? 'Dark' : 'Light'}`))
  if (signedIn) {
    await expect(page.getByRole('combobox', { name: language === 'en' ? 'Account language' : '账号语言', exact: true })).toBeEnabled()
    await expect(page.getByTestId('account-preferences-save')).toHaveText(language === 'en' ? 'Save to account' : '保存到账号')
  } else {
    await expect(page.getByLabel(language === 'en' ? 'Username' : '账号', { exact: true })).toBeVisible()
  }
}

/** Proves account hydration and saves never persist account values into guest preferences. */
async function expectBrowserBaseline(page: Page) {
  expect(await page.evaluate(() => ({ language: localStorage.getItem('moeurl.language'), theme: localStorage.getItem('moeurl.theme') })))
    .toEqual({ language: 'zh-CN', theme: 'light' })
}

/** Saves a stable PNG as well as attaching it for review after the disposable environment is gone. */
async function capture(testInfo: TestInfo, name: string, page: Page) {
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true, animations: 'disabled' })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}
