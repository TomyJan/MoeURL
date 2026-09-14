import { randomBytes } from 'node:crypto'

import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

import {
  e2eAdminPassword,
  e2eAdminUsername,
  e2eOIDCPort,
  expectNoHorizontalOverflow,
  serializedPayloadIncludesSecret,
} from './support'

const clientSecret = 'e2e-client-secret'
const issuerURL = `http://127.0.0.1:${e2eOIDCPort}`

test('test identity provider requires the openid authorization scope', async ({ request }) => {
  const params = new URLSearchParams({
    client_id: 'moeurl-allowed', redirect_uri: 'http://127.0.0.1/callback',
    response_type: 'code', state: 'state', nonce: 'nonce', code_challenge: 'challenge', code_challenge_method: 'S256',
  })
  const invalid = await request.get(`${issuerURL}/authorize?${params}`)
  expect(invalid.status()).toBe(400)
  params.set('scope', 'email openid profile')
  const valid = await request.get(`${issuerURL}/authorize?${params}`, { maxRedirects: 0 })
  expect(valid.status()).toBe(302)
})

test('configures multiple OIDC providers from the authentication page', async ({ page }) => {
  const allowedProviderKey = uniqueProviderKey('company')
  const deniedProviderKey = uniqueProviderKey('outside')
  try {
    await expect.poll(async () => (await page.request.get(`${issuerURL}/.well-known/openid-configuration`)).status()).toBe(200)
    await localLogin(page)
    await page.goto('/admin/setting')
    await expect(page.getByTestId('admin-authentication-page')).toBeVisible()

    await page.getByRole('button', { name: '新增提供商' }).click()
    await page.getByLabel('提供商标识').fill(allowedProviderKey)
    await page.getByLabel('显示名称').fill('Company SSO')
    await page.getByLabel('Issuer URL').fill(issuerURL)
    await page.getByLabel('Client ID').fill('moeurl-allowed')
    await page.getByLabel('Client Secret').fill(clientSecret)
    await page.getByLabel('允许的邮箱域名').fill('example.com')
    await page.getByRole('button', { name: '保存' }).click()
    await expect(page.getByText('身份认证配置已保存。')).toBeVisible()
    await expectNoHorizontalOverflow(page)

    const denied = await createProvider(page, {
      key: deniedProviderKey,
      displayName: 'Outside SSO',
      clientId: 'moeurl-denied',
    })
    expect(denied.code).toBe(0)
    expect(serializedPayloadIncludesSecret(denied, clientSecret)).toBe(false)

    await page.setViewportSize({ width: 390, height: 844 })
    await page.reload()
    await expect(page.getByRole('button', { name: /^Company SSO/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Outside SSO/ })).toBeVisible()
    await expectNoHorizontalOverflow(page)
  } finally {
    await cleanupProviders(page, [allowedProviderKey, deniedProviderKey])
  }
})

test('creates and reuses one local identity for repeated OIDC login', async ({ page }) => {
  const providerKey = uniqueProviderKey('repeat')
  const displayName = `Repeat SSO ${providerKey}`
  try {
    await localLogin(page)
    expect((await createProvider(page, { key: providerKey, displayName, clientId: 'moeurl-allowed' })).code).toBe(0)
    await logout(page)

    await page.goto('/login?redirect=/console')
    await page.getByText(displayName, { exact: true }).click()
    await expect(page).toHaveURL(/\/console$/)

    const firstLogin = await currentUser(page)
    expect(firstLogin.group).toBe('user')
    expect(firstLogin.nickname).toBe('OIDC Person')
    expect(firstLogin.username).toMatch(new RegExp(`^oidc-${providerKey}-[a-z2-7]{20}$`))

    await logout(page)
    await page.goto('/login?redirect=/console')
    await page.getByText(displayName, { exact: true }).click()
    await expect(page).toHaveURL(/\/console$/)
    expect((await currentUser(page)).id).toBe(firstLogin.id)
  } finally {
    await cleanupProviders(page, [providerKey])
  }
})

test('rejects a verified identity outside the provider domain allowlist', async ({ page }) => {
  const providerKey = uniqueProviderKey('denied')
  const displayName = `Outside SSO ${providerKey}`
  try {
    await localLogin(page)
    expect((await createProvider(page, { key: providerKey, displayName, clientId: 'moeurl-denied' })).code).toBe(0)
    await logout(page)

    await page.goto('/login')
    await page.getByText(displayName, { exact: true }).click()
    await expect(page).toHaveURL(/\/login\?oidcError=identity_not_allowed$/)
    await expect(page.getByText('当前身份不符合该登录方式的访问规则。')).toBeVisible()

    await localLogin(page)
    expect(await userNicknames(page)).not.toContain('Denied Person')
  } finally {
    await cleanupProviders(page, [providerKey])
  }
})

test('removes a disabled provider from login and rejects direct start attempts', async ({ page }) => {
  const providerKey = uniqueProviderKey('disabled')
  const displayName = `Disabled SSO ${providerKey}`
  try {
    await localLogin(page)
    expect((await createProvider(page, { key: providerKey, displayName, clientId: 'moeurl-allowed' })).code).toBe(0)
    const listed = await providerList(page)
    const provider = listed.providers.find(({ key }) => key === providerKey)
    expect(provider).toBeTruthy()
    if (!provider) return

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
    expect((await response.json() as { code: number }).code).toBe(0)
    await logout(page)
    await page.goto('/login')
    await expect(page.getByText(displayName, { exact: true })).toHaveCount(0)

    const rejected = await page.request.get(`/api/v1/auth/oidc/${providerKey}/start`, { maxRedirects: 0 })
    expect(rejected.status()).toBe(303)
    expect(rejected.headers().location).toBe('/login?oidcError=provider_unavailable')
  } finally {
    await cleanupProviders(page, [providerKey])
  }
})

test('keeps local account login available after OIDC is configured', async ({ page }) => {
  const providerKey = uniqueProviderKey('local')
  try {
    await localLogin(page)
    expect((await createProvider(page, { key: providerKey, displayName: 'Local Login SSO', clientId: 'moeurl-allowed' })).code).toBe(0)
    await logout(page)

    await localLogin(page)
    await expect(page).toHaveURL(/\/$/)
    expect((await currentUser(page)).username).toBe(e2eAdminUsername)
  } finally {
    await cleanupProviders(page, [providerKey])
  }
})

async function localLogin(page: Page) {
  await page.goto('/login')
  await page.getByLabel('账号').fill(e2eAdminUsername)
  await page.getByLabel('密码').fill(e2eAdminPassword)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

async function logout(page: Page) {
  const response = await page.request.post('/api/v1/auth/logout', { data: {} })
  expect((await response.json() as { code: number }).code).toBe(0)
}

async function currentUser(page: Page) {
  const response = await page.request.get('/api/v1/auth/me')
  const payload = await response.json() as {
    code: number
    data: { user: { id: string; username: string; nickname: string; group: string } }
  }
  expect(payload.code).toBe(0)
  return payload.data.user
}

async function userNicknames(page: Page) {
  const response = await page.request.get('/api/v1/admin/user/list?page=1&pageSize=100')
  const payload = await response.json() as { code: number; data: { items: Array<{ nickname: string }> } }
  expect(payload.code).toBe(0)
  return payload.data.items.map(({ nickname }) => nickname)
}

async function providerList(page: Page) {
  const response = await page.request.get('/api/v1/admin/oidc/provider/list')
  const payload = await response.json() as {
    code: number
    data: { providers: Array<{ id: string; key: string; displayName: string; issuerUrl: string; clientId: string; allowedEmailDomains: string[]; updatedAt: string }> }
  }
  expect(payload.code).toBe(0)
  return payload.data
}

async function createProvider(page: Page, input: { key: string; displayName: string; clientId: string }) {
  const response = await page.request.post('/api/v1/admin/oidc/provider/create', {
    data: {
      ...input,
      issuerUrl: issuerURL,
      clientSecret,
      allowedEmailDomains: ['example.com'],
      enabled: true,
    },
  })
  return response.json() as Promise<{ code: number; data: unknown }>
}

async function cleanupProviders(page: Page, providerKeys: string[]) {
  await page.request.post('/api/v1/auth/logout', { data: {} })
  await localLogin(page)
  const listed = await providerList(page)
  for (const providerKey of providerKeys) {
    const provider = listed.providers.find(({ key }) => key === providerKey)
    if (!provider) continue
    const response = await page.request.post('/api/v1/admin/oidc/provider/delete', {
      data: { id: provider.id, expectedUpdatedAt: provider.updatedAt },
    })
    expect((await response.json() as { code: number }).code).toBe(0)
  }
}

function uniqueProviderKey(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString('hex')}`
}
