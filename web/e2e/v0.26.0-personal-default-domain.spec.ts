import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Page, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, e2ePort, expectNoHorizontalOverflow } from './support'

interface Preference { domainId: string | null; updatedAt: string | null }
interface Domain { id: string; host: string; displayName: string; enabled: boolean; isDefault: boolean; allowedGroups: string[]; updatedAt: string }
const password = 'domain-preference-test-password'
const domainLabel = /^(个人默认域名|Personal default domain)$/
const createDomainLabel = /^(短链域名|Short-link domain)$/
const systemOption = /^(使用系统选择|Use system selection)$/

test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })
for (const width of [1280, 390]) {
  test(`v0.26.0 preserves personal domain choices across devices and authorization changes at ${width}px`, async ({ browser, page: admin }, info) => {
    info.setTimeout(120_000)
    const contexts: BrowserContext[] = []
    const suffix = randomBytes(6).toString('hex')
    const owned: string[] = []
    let accountId: string | undefined
    let scenarioError: unknown
    const cleanupErrors: unknown[] = []
    try {
      await post(admin.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      const initial = await domains(admin.request)
      const global = initial.find((item) => item.isDefault)!
      expect(global).toBeDefined()
      const account = await post<{ user: { id: string } }>(admin.request, '/admin/user/create', { username: `domainpref-${suffix}`, nickname: 'Domain preference test', password, groupKey: 'user', status: 'active' })
      accountId = account.user.id
      const personal = (await post<{ domain: Domain }>(admin.request, '/admin/domain/create', { host: `https://personal-${suffix}.example`, displayName: `Personal ${suffix}`, enabled: true, allowedGroups: ['user', 'admin'] })).domain
      owned.push(personal.id)
      const unused = (await post<{ domain: Domain }>(admin.request, '/admin/domain/create', { host: `https://unused-${suffix}.example`, displayName: `Unused ${suffix}`, enabled: true, allowedGroups: ['user', 'admin'] })).domain
      owned.push(unused.id)
      const pages: Page[] = []
      for (let index = 0; index < 2; index++) {
        const context = await browser.newContext({ baseURL: `http://127.0.0.1:${e2ePort}`, locale: 'zh-CN', reducedMotion: 'reduce', colorScheme: 'light', serviceWorkers: 'block', viewport: { width, height: width === 1280 ? 720 : 800 } })
        contexts.push(context)
        pages.push(await context.newPage())
      }
      const first = pages[0]!
      const second = pages[1]!
      await signIn(first, `domainpref-${suffix}`)
      expect(await read(first)).toEqual({ domainId: null, updatedAt: null })
      await choose(first, domainLabel, `${personal.displayName} (${personal.host})`)
      const saved = await save(first, personal.id, null)
      await layout(first, info, `domain-preference-${width}-zh`)

      await signIn(second, `domainpref-${suffix}`)
      await expect(second.getByRole('combobox', { name: domainLabel })).toHaveValue(`${personal.displayName} (${personal.host})`)
      await second.goto('/')
      await expect(second.getByRole('combobox', { name: createDomainLabel })).toHaveValue(`${personal.displayName} (${personal.host})`)
      await create(second, personal.host, personal.id)
      await choose(second, createDomainLabel, `${global.displayName} (${global.host})`)
      await create(second, global.host, null)
      await expect(second.getByRole('combobox', { name: createDomainLabel })).toHaveValue(`${personal.displayName} (${personal.host})`)
      await choose(second, createDomainLabel, `${global.displayName} (${global.host})`)
      await second.getByRole('button', { name: /^(继续创建|Create another)$/ }).click()
      await expect(second.getByRole('combobox', { name: createDomainLabel })).toHaveValue(`${personal.displayName} (${personal.host})`)
      await layout(second, info, `domain-create-${width}-zh`)

      // Two independent, real editors hold the same original version.
      await second.goto('/profile')
      await expect(second.getByTestId('domain-preference-save')).toBeEnabled()
      await choose(first, domainLabel, systemOption)
      const cleared = await save(first, null, saved.updatedAt)
      await choose(second, domainLabel, systemOption)
      const conflict = second.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/user/domain-preference/update')
      await second.getByTestId('domain-preference-save').click()
      expect(await (await conflict).json()).toMatchObject({ code: 300104 })
      await expect(second.getByRole('combobox', { name: domainLabel })).toHaveValue(systemOption)
      await expect(second.getByText(/域名偏好已在其他位置更新|Your domain preference changed elsewhere/).first()).toBeVisible()
      await dismiss(second)
      await second.getByRole('button', { name: /^(重新加载域名偏好|Reload domain preference)$/ }).click()
      await expect(second.getByTestId('domain-preference-save')).toBeEnabled()
      await choose(second, domainLabel, `${personal.displayName} (${personal.host})`)
      const restored = await save(second, personal.id, cleared.updatedAt)

      // Existing language replacement neither changes nor clears this independent resource.
      const language = await post<{ preferences: { updatedAt: string } }>(second.request, '/user/preferences/update', { language: 'en', theme: null, expectedUpdatedAt: null })
      expect(await read(second)).toEqual(restored)
      await second.reload()
      await expect(second.getByRole('heading', { name: 'Default short-link domain' })).toBeVisible()
      await layout(second, info, `domain-preference-${width}-en`)

      // Revoke only this fixture domain's grant; no shared group/default settings change.
      await updateDomain(admin.request, personal.id, { allowedGroups: ['admin'] })
      await second.goto('/')
      await expect(second.getByText('The previous domain is unavailable. Using an available system selection.')).toBeVisible()
      await expect(second.getByRole('combobox', { name: createDomainLabel })).not.toHaveValue(`${personal.displayName} (${personal.host})`)
      expect(await rawPost(second.request, '/user/domain-preference/update', { domainId: personal.id, expectedUpdatedAt: restored.updatedAt })).toMatchObject({ code: 120001 })
      expect(await rawPost(second.request, '/short-link/create', { targetUrl: 'https://example.com/domainpref-denied', domainId: personal.id })).toMatchObject({ code: 200114 })
      await create(second, global.host, null)
      await updateDomain(admin.request, personal.id, { allowedGroups: ['user', 'admin'], enabled: false })
      await second.reload()
      await expect(second.getByText('The previous domain is unavailable. Using an available system selection.')).toBeVisible()
      await layout(second, info, `domain-fallback-${width}-en`)
      await updateDomain(admin.request, personal.id, { enabled: true })

      // A preference-only domain can be deleted; clearing and revision advancement are atomic.
      await second.goto('/profile')
      await expect(second.getByTestId('domain-preference-save')).toBeEnabled()
      await choose(second, domainLabel, `${unused.displayName} (${unused.host})`)
      const beforeDelete = await save(second, unused.id, restored.updatedAt)
      const deletion = (await domains(admin.request)).find((item) => item.id === unused.id)!
      await post(admin.request, '/admin/domain/delete', { id: deletion.id, expectedUpdatedAt: deletion.updatedAt })
      const afterDelete = await read(second)
      expect(afterDelete.domainId).toBeNull()
      expect(afterDelete.updatedAt).not.toBe(beforeDelete.updatedAt)
      expect(await rawPost(second.request, '/user/domain-preference/update', { domainId: null, expectedUpdatedAt: beforeDelete.updatedAt })).toMatchObject({ code: 300104 })
      const unchangedLanguage = await second.request.get('/api/v1/user/preferences').then((response) => response.json())
      expect(unchangedLanguage).toMatchObject({ code: 0, data: { preferences: { language: 'en', updatedAt: language.preferences.updatedAt } } })
      await second.reload()
      await expect(second.getByRole('combobox', { name: domainLabel })).toHaveValue(systemOption)
      await info.attach('domain-preference-contract', { body: Buffer.from(JSON.stringify({ width, accountId, saved, cleared, restored, beforeDelete, afterDelete, global: global.id, personal: personal.id, unused: unused.id })), contentType: 'application/json' })
    } catch (error) { scenarioError = error } finally {
      for (const id of owned) {
        try {
          const current = (await domains(admin.request)).find((item) => item.id === id)
          if (!current) continue
          if (current.allowedGroups.join(',') !== 'user,admin' || !current.enabled) await updateDomain(admin.request, id, { allowedGroups: ['user', 'admin'], enabled: true })
          const latest = (await domains(admin.request)).find((item) => item.id === id)!
          // Published links intentionally retain their immutable domain in the disposable database.
          const result = await rawPost(admin.request, '/admin/domain/delete', { id, expectedUpdatedAt: latest.updatedAt })
          expect([0, 210104]).toContain(result.code)
        } catch (error) { cleanupErrors.push(error) }
      }
      if (accountId) {
        try { await post(admin.request, '/admin/user/update', { id: accountId, nickname: 'Domain preference test', status: 'disabled' }) } catch (error) { cleanupErrors.push(error) }
      }
      for (const context of contexts) { try { await context.close() } catch (error) { cleanupErrors.push(error) } }
    }
    if (scenarioError || cleanupErrors.length) throw new AggregateError([...(scenarioError ? [scenarioError] : []), ...cleanupErrors], 'Domain preference scenario or fixture cleanup failed')
  })
}

/** Makes a real POST and checks its transport and business envelope. */
async function rawPost(request: APIRequestContext, path: string, data: unknown): Promise<{ code: number; data: unknown }> {
  const response = await request.post(`/api/v1${path}`, { data })
  expect(response.status()).toBe(200)
  return response.json()
}
/** Returns data only from an actual successful business response. */
async function post<T = unknown>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const payload = await rawPost(request, path, data)
  expect(payload.code).toBe(0)
  return payload.data as T
}
/** Lists current domain versions before every fixture administration action. */
async function domains(request: APIRequestContext): Promise<Domain[]> {
  const response = await request.get('/api/v1/admin/domain/list')
  const payload = await response.json()
  expect(payload.code).toBe(0)
  return payload.data.items
}
/** Updates only a domain created by this scenario, preserving every other current field. */
async function updateDomain(request: APIRequestContext, id: string, changes: Partial<Pick<Domain, 'enabled' | 'allowedGroups'>>) {
  const current = (await domains(request)).find((item) => item.id === id)!
  await post(request, '/admin/domain/update', { id, host: current.host, displayName: current.displayName, allowedGroups: current.allowedGroups, enabled: current.enabled, ...changes, expectedUpdatedAt: current.updatedAt })
}
/** Signs in through the browser so normal account hydration and identity guards execute. */
async function signIn(page: Page, username: string) {
  await page.goto('/login?redirect=/profile')
  await page.getByLabel('账号', { exact: true }).fill(username)
  await page.getByLabel('密码', { exact: true }).fill(password)
  await page.getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL(/\/profile$/)
  await expect(page.getByTestId('domain-preference-save')).toBeEnabled()
}
/** Selects an accessible real Vuetify option, without forcing pointer actions. */
async function choose(page: Page, label: RegExp, option: string | RegExp) {
  await page.getByRole('combobox', { name: label }).press('Enter')
  await page.getByRole('option', { name: option, exact: true }).click()
}
/** Reads the authoritative independent resource and private cache policy. */
async function read(page: Page): Promise<Preference> {
  const response = await page.request.get('/api/v1/user/domain-preference')
  expect(response.headers()['cache-control']).toBe('no-store')
  const payload = await response.json()
  expect(payload.code).toBe(0)
  return payload.data.preference
}
/** Saves via the real form and verifies identity-free payload plus exact original version. */
async function save(page: Page, domainId: string | null, expectedUpdatedAt: string | null): Promise<Preference> {
  const waiting = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/user/domain-preference/update')
  await page.getByTestId('domain-preference-save').click()
  const response = await waiting
  expect(response.request().postDataJSON()).toEqual({ domainId, expectedUpdatedAt })
  expect(response.headers()['cache-control']).toBe('no-store')
  const payload = await response.json()
  expect(payload.code).toBe(0)
  await expect(page.getByText(/^(域名偏好已保存|Domain preference saved)$/)).toBeVisible()
  await dismiss(page)
  return payload.data.preference
}
/** Checks the published response URL and legacy omitted-global request contract. */
async function create(page: Page, origin: string, domainId: string | null) {
  await page.getByLabel(/^(输入链接|Enter link)$/).fill('https://example.com/personal-domain-e2e')
  const waiting = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/short-link/create')
  await page.getByRole('button', { name: /^(创建短链|Create short link)$/ }).click()
  const response = await waiting
  const input = response.request().postDataJSON()
  if (domainId) expect(input.domainId).toBe(domainId)
  else expect(input).not.toHaveProperty('domainId')
  const payload = await response.json()
  expect(payload.code).toBe(0)
  expect(new URL(payload.data.shortLink.url).origin).toBe(new URL(origin.includes('://') ? origin : `https://${origin}`).origin)
  await expect(page.getByTestId('short-link-create-result')).toBeVisible()
  await expect(page.getByText(/^(创建成功|Created)$/).first()).toBeVisible()
  await dismiss(page)
}
/** Dismisses real success/error Toasts before subsequent pointer actions. */
async function dismiss(page: Page) {
  const buttons = page.getByRole('button', { name: /^(关闭提示|Dismiss notification)$/ })
  for (const button of await buttons.all()) await button.click()
  await expect(buttons).toHaveCount(0)
}
/** Records viewport geometry and an actual screenshot in both languages and sizes. */
async function layout(page: Page, info: TestInfo, name: string) {
  await expectNoHorizontalOverflow(page)
  const panel = page.getByTestId('domain-preference-panel').or(page.locator('.short-link-create-panel'))
  const box = await panel.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  await info.attach(`${name}-geometry`, { body: Buffer.from(JSON.stringify({ viewport: page.viewportSize(), box })), contentType: 'application/json' })
  const path = info.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true, animations: 'disabled' })
  await info.attach(name, { path, contentType: 'image/png' })
}
