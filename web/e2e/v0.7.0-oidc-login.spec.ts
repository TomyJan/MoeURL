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
const allowedProviderKey = 'company'
const deniedProviderKey = 'outside'
let oidcUserID = ''

test.describe.configure({ mode: 'serial' })

test('configures multiple OIDC providers from the authentication page', async ({ page }) => {
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
})

test('creates a local user on the first allowed OIDC login', async ({ page }) => {
  await page.goto('/login?redirect=/console')
  await page.getByText('Company SSO', { exact: true }).click()
  await expect(page).toHaveURL(/\/console$/)

  const current = await currentUser(page)
  expect(current.group).toBe('user')
  expect(current.nickname).toBe('OIDC Person')
  expect(current.username).toMatch(/^oidc-company-[a-z2-7]{20}$/)
  oidcUserID = current.id
})

test('reuses the same local identity on a repeated OIDC login', async ({ page }) => {
  await logout(page)
  await page.goto('/login?redirect=/console')
  await page.getByText('Company SSO', { exact: true }).click()
  await expect(page).toHaveURL(/\/console$/)

  expect((await currentUser(page)).id).toBe(oidcUserID)
})

test('rejects a verified identity outside the provider domain allowlist', async ({ page }) => {
  await logout(page)
  await page.goto('/login')
  await page.getByText('Outside SSO', { exact: true }).click()
  await expect(page).toHaveURL(/\/login\?oidcError=identity_not_allowed$/)
  await expect(page.getByText('当前身份不符合该登录方式的访问规则。')).toBeVisible()

  await localLogin(page)
  expect(await userNicknames(page)).not.toContain('Denied Person')
})

test('removes a disabled provider from login and rejects direct start attempts', async ({ page }) => {
  await localLogin(page)
  const listed = await providerList(page)
  const company = listed.providers.find(({ key }) => key === allowedProviderKey)
  expect(company).toBeTruthy()
  if (!company) return

  const response = await page.request.post('/api/v1/admin/oidc/provider/update', {
    data: {
      id: company.id,
      displayName: company.displayName,
      issuerUrl: company.issuerUrl,
      clientId: company.clientId,
      clientSecret: { mode: 'preserve' },
      allowedEmailDomains: company.allowedEmailDomains,
      enabled: false,
      expectedUpdatedAt: company.updatedAt,
    },
  })
  expect((await response.json() as { code: number }).code).toBe(0)
  await logout(page)
  await page.goto('/login')
  await expect(page.getByText('Company SSO', { exact: true })).toHaveCount(0)

  const rejected = await page.request.get(`/api/v1/auth/oidc/${allowedProviderKey}/start`, { maxRedirects: 0 })
  expect(rejected.status()).toBe(303)
  expect(rejected.headers().location).toBe('/login?oidcError=provider_unavailable')
})

test('keeps local account login available after OIDC is configured', async ({ page }) => {
  await localLogin(page)
  await expect(page).toHaveURL(/\/$/)
  expect((await currentUser(page)).username).toBe(e2eAdminUsername)
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
