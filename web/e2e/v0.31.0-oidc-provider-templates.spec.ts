import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { Page, Request, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, e2eOIDCPort, expectNoHorizontalOverflow, serializedPayloadIncludesSecret } from './support'

test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })
const issuerURL = `http://127.0.0.1:${e2eOIDCPort}`
const clientSecret = 'e2e-client-secret'
const providerPath = '/api/v1/admin/oidc/provider/'
const labels = {
  en: { add: 'Add provider', key: 'Provider key', name: 'Display name', domains: 'Allowed email domains', enabled: 'Enabled', manual: 'Manual / blank', apply: 'Apply template', keep: 'Keep draft', replace: 'Replace draft', save: 'Save', template: 'Creation template' },
  zh: { add: '新增提供商', key: '提供商标识', name: '显示名称', domains: '允许的邮箱域名', enabled: '启用', manual: '手动／空白', apply: '应用模板', keep: '保留草稿', replace: '替换草稿', save: '保存', template: '创建模板' },
}

for (const language of ['en', 'zh'] as const) {
  const width = language === 'en' ? 1280 : 390
  test(`v0.31.0 explicitly replaces creation drafts and preserves real OIDC at ${width}px ${language}`, async ({ page }, info) => {
    info.setTimeout(180_000)
    const text = labels[language]
    const key = 'template-' + randomBytes(6).toString('hex')
    const name = 'Template SSO ' + key
    const observed: string[] = []
    const observe = (request: Request) => {
      if (request.url().includes(providerPath) || new URL(request.url()).hostname === 'accounts.google.com') observed.push(request.method() + ' ' + request.url())
    }
    try {
      await post(page, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      await page.addInitScript(value => localStorage.setItem('moeurl.language', value), language)
      await page.setViewportSize({ width, height: language === 'en' ? 720 : 800 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      const initialList = page.waitForResponse(response => response.url().includes(providerPath + 'list') && response.request().method() === 'GET')
      await page.goto('/admin/setting')
      await initialList
      const section = page.getByTestId('admin-authentication-page')
      await expect(section).toBeVisible()
      await section.getByRole('button', { name: text.add, exact: true }).click()
      await expect(section.getByRole('heading', { name: text.template, exact: true })).toBeVisible()
      const enabled = section.getByRole('checkbox', { name: text.enabled, exact: true })
      const keyField = section.getByLabel(text.key, { exact: true })
      const nameField = section.getByLabel(text.name, { exact: true })
      const issuer = section.getByLabel('Issuer URL', { exact: true })
      const client = section.getByLabel('Client ID', { exact: true })
      const secret = section.getByLabel('Client Secret', { exact: true })
      const domains = section.getByLabel(text.domains, { exact: true })
      await expect(enabled).toBeChecked()
      await keyField.fill('old-provider')
      await nameField.fill('Old draft')
      await issuer.fill('https://old.example.test')
      await client.fill('old-client')
      await secret.fill('old-secret-never-send')
      await domains.fill('old.example.test')
      page.on('request', observe)
      await section.getByRole('button', { name: 'Google', exact: true }).click()
      await expect(section.getByRole('button', { name: 'Google', exact: true })).toHaveAttribute('aria-pressed', 'true')
      await expect(keyField).toHaveValue('old-provider')
      await expect(issuer).toHaveValue('https://old.example.test')
      await expect(client).toHaveValue('old-client')
      await expect(secret).toHaveValue('old-secret-never-send')
      await expect(domains).toHaveValue('old.example.test')
      await expect(enabled).toBeChecked()
      await section.getByRole('heading', { name: text.template, exact: true }).scrollIntoViewIfNeeded()
      await capture(page, info, 'template-selection-' + width)
      await section.getByRole('button', { name: text.apply, exact: true }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toContainText('Client Secret')
      for (const action of [text.keep, text.replace]) await expect(dialog.getByRole('button', { name: action, exact: true })).toBeInViewport({ ratio: 1 })
      await capture(page, info, 'template-confirmation-' + width)
      await dialog.getByRole('button', { name: text.keep, exact: true }).click()
      await expect(dialog).toHaveCount(0)
      for (const [field, value] of [[keyField, 'old-provider'], [nameField, 'Old draft'], [issuer, 'https://old.example.test'], [client, 'old-client'], [secret, 'old-secret-never-send'], [domains, 'old.example.test']] as const) await expect(field).toHaveValue(value)
      await expect(enabled).toBeChecked()
      await section.getByRole('button', { name: text.apply, exact: true }).click()
      await page.getByRole('dialog').getByRole('button', { name: text.replace, exact: true }).click()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(keyField).toHaveValue('google')
      await expect(nameField).toHaveValue('Google')
      await expect(issuer).toHaveValue('https://accounts.google.com')
      for (const field of [client, secret, domains]) await expect(field).toHaveValue('')
      await expect(enabled).not.toBeChecked()
      await section.getByRole('heading', { name: text.template, exact: true }).scrollIntoViewIfNeeded()
      await capture(page, info, 'template-applied-' + width)
      await section.getByRole('button', { name: text.manual, exact: true }).click()
      await expect(keyField).toHaveValue('google')
      await section.getByRole('button', { name: text.apply, exact: true }).click()
      await page.getByRole('dialog').getByRole('button', { name: text.replace, exact: true }).click()
      for (const field of [keyField, nameField, issuer, client, secret, domains]) await expect(field).toHaveValue('')
      await expect(enabled).toBeChecked()
      // All local selections, both confirmation paths and manual reset have now rendered.
      expect(observed, 'Templates neither save nor contact Google / the provider backend').toEqual([])
      page.off('request', observe)
      await keyField.fill(key)
      await nameField.fill(name)
      await issuer.fill(issuerURL)
      await client.fill('moeurl-allowed')
      await secret.fill(clientSecret)
      await domains.fill('example.com')
      const saved = page.waitForResponse(response => response.url().includes(providerPath + 'create') && response.request().method() === 'POST')
      await section.getByRole('button', { name: text.save, exact: true }).click()
      const response = await saved
      const body = response.request().postDataJSON() as Record<string, unknown>
      expect(Object.keys(body).sort()).toEqual(['allowedEmailDomains', 'clientId', 'clientSecret', 'displayName', 'enabled', 'issuerUrl', 'key'])
      expect(body).toEqual({ key, displayName: name, issuerUrl: issuerURL, clientId: 'moeurl-allowed', clientSecret, allowedEmailDomains: ['example.com'], enabled: true })
      const payload: unknown = await response.json()
      expect((payload as { code: number }).code).toBe(0)
      expect(serializedPayloadIncludesSecret(payload, clientSecret)).toBe(false)
      await expect(keyField).toBeDisabled()
      await expect(section.getByRole('heading', { name: text.template, exact: true })).toHaveCount(0)
      await expect(secret).toHaveValue('')
      await page.reload()
      await expect(page.getByTestId('admin-authentication-page').getByRole('button', { name: new RegExp('^' + name) })).toBeVisible()
      await expect(page.getByRole('button', { name: text.apply, exact: true })).toHaveCount(0)
      await expectNoHorizontalOverflow(page)
      await post(page, '/auth/logout', {})
      await page.goto('/login?redirect=/console')
      await page.getByText(name, { exact: true }).click()
      await expect(page).toHaveURL(/\/console$/)
      const current = await page.request.get('/api/v1/auth/me')
      const identity = await current.json() as { code: number; data: { user: { username: string; group: string; nickname: string } } }
      expect(identity.code).toBe(0)
      expect(identity.data.user.group).toBe('user')
      expect(identity.data.user.nickname).toBe('OIDC Person')
      expect(identity.data.user.username).toMatch(new RegExp('^oidc-' + key + '-[a-z2-7]{20}$'))
    } finally {
      page.off('request', observe)
      await post(page, '/auth/logout', {})
      await post(page, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      const response = await page.request.get(providerPath + 'list')
      const listed = await response.json() as { code: number; data: { providers: Array<{ id: string; key: string; updatedAt: string }> } }
      expect(listed.code).toBe(0)
      for (const provider of listed.data.providers.filter(item => item.key === key)) await post(page, '/admin/oidc/provider/delete', { id: provider.id, expectedUpdatedAt: provider.updatedAt })
    }
  })
}

async function post(page: Page, path: string, data: unknown) {
  const response = await page.request.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200)
  const payload = await response.json() as { code: number }
  expect(payload.code).toBe(0)
}

async function capture(page: Page, info: TestInfo, name: string) {
  await expectNoHorizontalOverflow(page)
  const path = info.outputPath(name + '.png')
  await page.screenshot({ path, fullPage: true, animations: 'disabled' })
  await info.attach(name, { path, contentType: 'image/png' })
}
