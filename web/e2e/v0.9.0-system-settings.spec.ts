import { randomBytes } from 'node:crypto'

import { expect, test } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'

import { e2eAdminPassword, e2eAdminUsername, e2eOIDCPort } from './support'

const clientSecret = 'e2e-client-secret'
const issuerURL = `http://127.0.0.1:${e2eOIDCPort}`

type Settings = {
  siteName: string
  defaultLanguage: 'zh-CN' | 'en'
  defaultTheme: 'system' | 'light' | 'dark'
  footerText: string
  showPoweredBy: boolean
  localLoginEnabled: boolean
  updatedAt: string
}

type Provider = {
  id: string
  key: string
  displayName: string
  issuerUrl: string
  clientId: string
  allowedEmailDomains: string[]
  enabled: boolean
  updatedAt: string
}

test('applies system branding while preserving a recoverable OIDC-only login path', async ({ browser, page }, testInfo) => {
  testInfo.setTimeout(120_000)
  const baseURL = testInfo.project.use.baseURL
  if (typeof baseURL !== 'string') {
    throw new TypeError('Playwright baseURL is required for the system-settings E2E context')
  }

  const providerKey = `settings-${randomBytes(4).toString('hex')}`
  const providerName = `Settings SSO ${providerKey}`
  const siteName = `MoeURL Settings ${providerKey}`
  const footerText = `System settings E2E ${providerKey}`
  let originalSettings: Settings | undefined
  let providerCreated = false
  let visitorContext: BrowserContext | undefined
  let restoredContext: BrowserContext | undefined
  let scenarioFailed = false
  let scenarioError: unknown

  try {
    await expect.poll(async () => (await page.request.get(`${issuerURL}/.well-known/openid-configuration`)).status()).toBe(200)
    await localLogin(page, 'zh-CN')
    originalSettings = await readSettings(page)
    expect((await createProvider(page, providerKey, providerName)).code).toBe(0)
    providerCreated = true

    const updated = await updateSettings(page, {
      ...withoutRevision(originalSettings),
      siteName,
      defaultLanguage: 'en',
      defaultTheme: 'dark',
      footerText,
      showPoweredBy: true,
      localLoginEnabled: false,
      expectedUpdatedAt: originalSettings.updatedAt,
    })
    expect(updated.localLoginEnabled).toBe(false)

    const existingAdmin = await currentUser(page)
    expect(existingAdmin.username).toBe(e2eAdminUsername)

    const provider = await requireProvider(page, providerKey)
    expect((await disableProvider(page, provider)).code).toBe(340104)
    expect((await deleteProvider(page, provider)).code).toBe(340104)

    visitorContext = await browser.newContext({
      baseURL,
      locale: 'fr-FR',
      viewport: { width: 1280, height: 720 },
    })
    const visitor = await visitorContext.newPage()
    await visitor.goto('/login?redirect=/console')
    await expect(visitor).toHaveTitle(siteName)
    await expect(visitor.getByText(siteName, { exact: true })).toBeVisible()
    await expect(visitor.getByText(footerText, { exact: true })).toBeVisible()
    await expect(visitor.getByText('Powered by MoeURL', { exact: true })).toBeVisible()
    await expect(visitor.locator('.v-application')).toHaveClass(/v-theme--moeurlDark/)
    await expect(visitor.getByLabel('Username')).toHaveCount(0)
    await expect(visitor.getByLabel('Password')).toHaveCount(0)
    await expect(visitor.getByRole('button', { name: 'Sign in' })).toHaveCount(0)
    await visitor.getByText(providerName, { exact: true }).click()
    await expect(visitor).toHaveURL(/\/console$/)

    const firstOIDCUser = await currentUser(visitor)
    expect(firstOIDCUser.group).toBe('user')
    await logout(visitor)
    await visitor.goto('/login?redirect=/console')
    await visitor.getByText(providerName, { exact: true }).click()
    await expect(visitor).toHaveURL(/\/console$/)
    expect((await currentUser(visitor)).id).toBe(firstOIDCUser.id)

    await restoreSettings(page, originalSettings)
    await removeProviderIfPresent(page, providerKey)
    providerCreated = false

    restoredContext = await browser.newContext({
      baseURL,
      locale: 'zh-CN',
      viewport: { width: 1280, height: 720 },
    })
    const restored = await restoredContext.newPage()
    await localLogin(restored, 'zh-CN')
    expect((await currentUser(restored)).username).toBe(e2eAdminUsername)
  } catch (error) {
    scenarioFailed = true
    scenarioError = error
  }

  const cleanupErrors: unknown[] = []
  await collectCleanupError(cleanupErrors, async () => {
    if (originalSettings) {
      await restoreSettings(page, originalSettings)
    }
  })
  await collectCleanupError(cleanupErrors, async () => {
    if (providerCreated) {
      await removeProviderIfPresent(page, providerKey)
    }
  })
  await collectCleanupError(cleanupErrors, async () => visitorContext?.close())
  await collectCleanupError(cleanupErrors, async () => restoredContext?.close())

  if (scenarioFailed) {
    if (cleanupErrors.length) {
      throw new AggregateError([scenarioError, ...cleanupErrors], 'System-settings scenario and cleanup failed')
    }
    throw scenarioError
  }
  if (cleanupErrors.length) {
    throw new AggregateError(cleanupErrors, 'System-settings cleanup failed')
  }
})

/** Runs one cleanup action without preventing later cleanup steps. */
async function collectCleanupError(errors: unknown[], action: () => Promise<unknown>) {
  try {
    await action()
  } catch (error) {
    errors.push(error)
  }
}

/** Authenticates through the real local-login form in the requested locale. */
async function localLogin(page: Page, locale: 'zh-CN' | 'en') {
  await page.goto('/login')
  await page.getByLabel(locale === 'zh-CN' ? '账号' : 'Username').fill(e2eAdminUsername)
  await page.getByLabel(locale === 'zh-CN' ? '密码' : 'Password').fill(e2eAdminPassword)
  await page.getByRole('button', { name: locale === 'zh-CN' ? '登录' : 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

/** Loads the complete administrative settings document. */
async function readSettings(page: Page): Promise<Settings> {
  const response = await page.request.get('/api/v1/admin/system/settings')
  await expect(response).toBeOK()
  const payload = await response.json() as { code: number; data: Settings }
  expect(payload.code).toBe(0)
  return payload.data
}

/** Replaces settings and returns the server-assigned revision. */
async function updateSettings(page: Page, input: Omit<Settings, 'updatedAt'> & { expectedUpdatedAt: string }): Promise<Settings> {
  const response = await page.request.post('/api/v1/admin/system/settings/update', { data: input })
  await expect(response).toBeOK()
  const payload = await response.json() as { code: number; data: Settings }
  expect(payload.code).toBe(0)
  return payload.data
}

/** Restores the original settings against the latest optimistic revision. */
async function restoreSettings(page: Page, original: Settings) {
  const current = await readSettings(page)
  if (sameSettings(current, original)) return
  await updateSettings(page, { ...withoutRevision(original), expectedUpdatedAt: current.updatedAt })
}

/** Creates one isolated enabled provider for this scenario. */
async function createProvider(page: Page, key: string, displayName: string) {
  const response = await page.request.post('/api/v1/admin/oidc/provider/create', {
    data: {
      key,
      displayName,
      issuerUrl: issuerURL,
      clientId: 'moeurl-allowed',
      clientSecret,
      allowedEmailDomains: ['example.com'],
      enabled: true,
    },
  })
  return response.json() as Promise<{ code: number; data: unknown }>
}

/** Loads one provider from the secret-free administrative list. */
async function requireProvider(page: Page, key: string): Promise<Provider> {
  const provider = (await providerList(page)).find((item) => item.key === key)
  if (!provider) throw new Error(`OIDC provider ${key} is missing`)
  return provider
}

/** Requests that the sole OIDC entry point be disabled. */
async function disableProvider(page: Page, provider: Provider) {
  const response = await page.request.post('/api/v1/admin/oidc/provider/update', {
    data: {
      id: provider.id,
      displayName: provider.displayName,
      issuerUrl: provider.issuerUrl,
      clientId: provider.clientId,
      clientSecret: { mode: 'preserve' },
      allowedEmailDomains: provider.allowedEmailDomains,
      enabled: false,
      expectedUpdatedAt: provider.updatedAt,
    },
  })
  return response.json() as Promise<{ code: number }>
}

/** Requests deletion of one provider at its current optimistic revision. */
async function deleteProvider(page: Page, provider: Provider) {
  const response = await page.request.post('/api/v1/admin/oidc/provider/delete', {
    data: { id: provider.id, expectedUpdatedAt: provider.updatedAt },
  })
  return response.json() as Promise<{ code: number }>
}

/** Removes the scenario provider after local login has been restored. */
async function removeProviderIfPresent(page: Page, key: string) {
  const provider = (await providerList(page)).find((item) => item.key === key)
  if (!provider) return
  expect((await deleteProvider(page, provider)).code).toBe(0)
}

/** Returns the current provider collection. */
async function providerList(page: Page): Promise<Provider[]> {
  const response = await page.request.get('/api/v1/admin/oidc/provider/list')
  await expect(response).toBeOK()
  const payload = await response.json() as { code: number; data: { providers: Provider[] } }
  expect(payload.code).toBe(0)
  return payload.data.providers
}

/** Terminates the current context's server-side session. */
async function logout(page: Page) {
  const response = await page.request.post('/api/v1/auth/logout', { data: {} })
  expect((await response.json() as { code: number }).code).toBe(0)
}

/** Reads the current authenticated identity. */
async function currentUser(page: Page) {
  const response = await page.request.get('/api/v1/auth/me')
  const payload = await response.json() as {
    code: number
    data: { user: { id: string; username: string; nickname: string; group: string } }
  }
  expect(payload.code).toBe(0)
  return payload.data.user
}

/** Omits the optimistic revision from a settings value. */
function withoutRevision(settings: Settings): Omit<Settings, 'updatedAt'> {
  return {
    siteName: settings.siteName,
    defaultLanguage: settings.defaultLanguage,
    defaultTheme: settings.defaultTheme,
    footerText: settings.footerText,
    showPoweredBy: settings.showPoweredBy,
    localLoginEnabled: settings.localLoginEnabled,
  }
}

/** Compares editable settings without considering the server revision. */
function sameSettings(left: Settings, right: Settings): boolean {
  return JSON.stringify(withoutRevision(left)) === JSON.stringify(withoutRevision(right))
}
