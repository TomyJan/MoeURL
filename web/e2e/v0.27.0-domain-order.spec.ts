import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Page, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, e2ePort, escapeRegExp, expectNoHorizontalOverflow } from './support'

interface Domain { id: string; host: string; displayName: string; enabled: boolean; isDefault: boolean; allowedGroups: string[]; sortOrder: number; updatedAt: string }
const password = 'domain-order-test-password'
const orderField = /^(排序值|Order value)$/
const orderSave = /^(保存排序|Save order)$/
const choiceLabel = /^(短链域名|Short-link domain)$/
const preferenceLabel = /^(个人默认域名|Personal default domain)$/

test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })
for (const width of [1280, 390]) {
  test(`v0.27.0 orders authorized domains without replacing personal or manual choices at ${width}px`, async ({ browser, page: admin }, info) => {
    const suffix = randomBytes(6).toString('hex')
    const owned: string[] = []
    const links: string[] = []
    const contexts: BrowserContext[] = []
    let accountId: string | undefined
    let original: Domain | undefined
    let member: Page | undefined
    let secondAdmin: Page | undefined
    let authenticated = false
    let scenarioError: unknown
    const cleanupErrors: unknown[] = []
    try {
      await post(admin.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      original = (await domains(admin.request)).find((item) => item.isDefault)!
      expect(original).toBeDefined()
      const account = await post<{ user: { id: string } }>(admin.request, '/admin/user/create', { username: `order-${suffix}`, nickname: 'Domain order test', password, groupKey: 'user', status: 'active' })
      accountId = account.user.id
      const created: Domain[] = []
      for (const name of ['First', 'Second', 'Third']) {
        const domain = (await post<{ domain: Domain }>(admin.request, '/admin/domain/create', { host: `https://${name.toLowerCase()}-${suffix}.example`, displayName: `Order ${name} ${suffix}`, enabled: true, allowedGroups: ['user', 'admin'] })).domain
        expect(domain.sortOrder).toBe(0)
        created.push(domain); owned.push(domain.id)
      }
      const [first, second, third] = created as [Domain, Domain, Domain]
      await admin.setViewportSize({ width, height: width === 1280 ? 720 : 800 })
      await admin.goto('/admin/domain')
      await selectManaged(admin, second)
      await writeOrder(admin, second, -20, true)
      await selectManaged(admin, first)
      await writeOrder(admin, first, -20, false)
      const tied = await domains(admin.request)
      expect(tied.filter(({ id }) => owned.includes(id)).map(({ id }) => id)).toEqual([first.id, second.id, third.id])
      await selectManaged(admin, original)
      await writeOrder(admin, original, 10000, false)
      expect((await domains(admin.request))[0]?.id).toBe(original.id)
      await layout(admin, info, `domain-order-${width}`)

      const context = await browser.newContext({ baseURL: `http://127.0.0.1:${e2ePort}`, locale: 'zh-CN', reducedMotion: 'reduce', colorScheme: 'light', serviceWorkers: 'block', viewport: { width, height: width === 1280 ? 720 : 800 } })
      contexts.push(context)
      member = await context.newPage()
      await member.goto('/login?redirect=/')
      await member.getByLabel('账号', { exact: true }).fill(`order-${suffix}`)
      await member.getByLabel('密码', { exact: true }).fill(password)
      await member.getByRole('button', { name: '登录', exact: true }).click()
      await expect(member).toHaveURL(/\/$/)
      authenticated = true
      await expect(member.getByRole('combobox', { name: choiceLabel })).toHaveValue(option(original))
      expect((await available(member.request))[0]?.id).toBe(original.id)
      await create(member, original, null, links)

      // Remove only the global user's grant so an implicit UI fallback must use server ordering.
      await update(admin.request, original.id, { allowedGroups: original.allowedGroups.filter((key) => key !== 'user') })
      await member.reload()
      await expect(member.getByRole('combobox', { name: choiceLabel })).toHaveValue(option(first))
      expect((await available(member.request)).filter(({ id }) => owned.includes(id)).map(({ id }) => id)).toEqual([first.id, second.id, third.id])
      await create(member, first, first.id, links)

      // Save a real personal preference, then change the order while its creator remains mounted.
      await member.goto('/profile')
      await expect(member.getByTestId('domain-preference-save')).toBeEnabled()
      await choose(member, preferenceLabel, second)
      const preference = member.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/user/domain-preference/update')
      await member.getByTestId('domain-preference-save').click()
      expect((await (await preference).json()).code).toBe(0)
      await expect(member.getByText(/^(域名偏好已保存|Domain preference saved)$/)).toBeVisible()
      await dismiss(member)
      await member.goto('/')
      await expect(member.getByRole('combobox', { name: choiceLabel })).toHaveValue(option(second))
      await selectManaged(admin, third)
      await writeOrder(admin, third, -30, false)
      await reconnect(member)
      expect((await available(member.request))[0]?.id).toBe(third.id)
      await expect(member.getByRole('combobox', { name: choiceLabel })).toHaveValue(option(second))
      await create(member, second, second.id, links)
      await choose(member, choiceLabel, first)
      const secondCurrent = (await domains(admin.request)).find(({ id }) => id === second.id)!
      await selectManaged(admin, secondCurrent)
      await writeOrder(admin, secondCurrent, -40, false)
      await reconnect(member)
      expect((await available(member.request))[0]?.id).toBe(second.id)
      await expect(member.getByRole('combobox', { name: choiceLabel })).toHaveValue(option(first))
      await layout(member, info, `domain-order-create-${width}`)
      await create(member, first, first.id, links)
      const denied = await rawPost(member.request, '/admin/domain/set-order', { id: first.id, sortOrder: 999, expectedUpdatedAt: (await domains(admin.request)).find(({ id }) => id === first.id)!.updatedAt })
      expect(denied.code).toBe(120001)

      // Both genuine browser editors start with one revision; a dirty draft survives automatic reads.
      const base = (await domains(admin.request)).find(({ id }) => id === first.id)!
      secondAdmin = await admin.context().newPage()
      await secondAdmin.goto('/admin/domain')
      await selectManaged(secondAdmin, base)
      await selectManaged(admin, base)
      await admin.getByRole('textbox', { name: orderField }).fill('-23')
      await writeOrder(secondAdmin, base, -22, false)
      await writeOrder(admin, base, -23, false, 210103)
      await expect(admin.getByRole('textbox', { name: orderField })).toHaveValue('-23')
      await expect(admin.getByRole('button', { name: /^(重新加载排序|Reload order)$/ })).toBeEnabled()
      await admin.getByRole('button', { name: /^(重新加载排序|Reload order)$/ }).click()
      await expect(admin.getByRole('textbox', { name: orderField })).toHaveValue('-22')
      const latest = (await domains(admin.request)).find(({ id }) => id === first.id)!
      await admin.getByRole('textbox', { name: orderField }).fill('-24')
      await expect(admin.getByLabel(/^(显示名称|Display name)$/)).toBeDisabled()
      await admin.getByRole('button', { name: new RegExp(escapeRegExp(second.displayName)) }).click()
      await expect(admin.getByRole('dialog')).toBeVisible()
      await admin.getByRole('dialog').getByRole('button', { name: /^(取消|Cancel)$/ }).click()
      await expect(admin.getByRole('textbox', { name: orderField })).toHaveValue('-24')
      await writeOrder(admin, latest, -24, true)
      await info.attach('domain-order-contract', { body: Buffer.from(JSON.stringify({ width, accountId, original: original.id, domains: owned, links, final: await domains(admin.request) })), contentType: 'application/json' })
    } catch (error) { scenarioError = error } finally {
      if (member && authenticated) {
        try {
          const payload = await member.request.get('/api/v1/user/domain-preference').then((response) => response.json())
          expect(payload.code).toBe(0)
          if (payload.data.preference.domainId) await post(member.request, '/user/domain-preference/update', { domainId: null, expectedUpdatedAt: payload.data.preference.updatedAt })
        } catch (error) { cleanupErrors.push(error) }
      }
      for (const id of links) {
        try { await post(admin.request, '/admin/short-link/delete', { id }) } catch (error) { cleanupErrors.push(error) }
      }
      if (original) {
        try {
          await update(admin.request, original.id, { allowedGroups: original.allowedGroups, enabled: original.enabled })
          const current = (await domains(admin.request)).find(({ id }) => id === original!.id)!
          if (!current.isDefault) await post(admin.request, '/admin/domain/set-default', { id: current.id, expectedUpdatedAt: current.updatedAt })
          const version = (await domains(admin.request)).find(({ id }) => id === original!.id)!
          await post(admin.request, '/admin/domain/set-order', { id: version.id, sortOrder: original.sortOrder, expectedUpdatedAt: version.updatedAt })
        } catch (error) { cleanupErrors.push(error) }
      }
      for (const id of owned) {
        try {
          await update(admin.request, id, { allowedGroups: ['admin'], enabled: false })
          const current = (await domains(admin.request)).find((item) => item.id === id)!
          // Soft-deleted published links retain their immutable domain until the disposable DB is removed.
          expect([0, 210104]).toContain((await rawPost(admin.request, '/admin/domain/delete', { id, expectedUpdatedAt: current.updatedAt })).code)
        } catch (error) { cleanupErrors.push(error) }
      }
      if (accountId) {
        try { await post(admin.request, '/admin/user/update', { id: accountId, nickname: 'Domain order test', status: 'disabled' }) } catch (error) { cleanupErrors.push(error) }
      }
      if (secondAdmin) { try { await secondAdmin.close() } catch (error) { cleanupErrors.push(error) } }
      for (const context of contexts) { try { await context.close() } catch (error) { cleanupErrors.push(error) } }
    }
    if (scenarioError || cleanupErrors.length) throw new AggregateError([...(scenarioError ? [scenarioError] : []), ...cleanupErrors], 'Domain order scenario or fixture cleanup failed')
  })
}

/** Retains business failures for denial/conflict assertions while requiring the real HTTP 200 boundary. */
async function rawPost(request: APIRequestContext, path: string, data: unknown): Promise<{ code: number; data: unknown }> {
  const response = await request.post(`/api/v1${path}`, { data })
  expect(response.status()).toBe(200)
  return response.json()
}
/** Requires business success before fixture setup or cleanup can consume a response. */
async function post<T = unknown>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const payload = await rawPost(request, path, data)
  expect(payload.code).toBe(0)
  return payload.data as T
}
/** Reads authoritative managed revisions and ordering rather than reusing a browser draft. */
async function domains(request: APIRequestContext): Promise<Domain[]> {
  const response = await request.get('/api/v1/admin/domain/list')
  const payload = await response.json()
  expect(payload.code).toBe(0)
  return payload.data.items
}
/** Checks the authorized candidate projection still hides administrator-only priority values. */
async function available(request: APIRequestContext): Promise<Array<{ id: string }>> {
  const response = await request.get('/api/v1/domain/available')
  const payload = await response.json()
  expect(payload.code).toBe(0)
  for (const item of payload.data.items) expect(item).not.toHaveProperty('sortOrder')
  return payload.data.items
}
/** Changes fixture grants or status against a freshly read version without overwriting other details. */
async function update(request: APIRequestContext, id: string, changes: Partial<Pick<Domain, 'enabled' | 'allowedGroups'>>) {
  const current = (await domains(request)).find((item) => item.id === id)!
  await post(request, '/admin/domain/update', { id, host: current.host, displayName: current.displayName, allowedGroups: current.allowedGroups, enabled: current.enabled, ...changes, expectedUpdatedAt: current.updatedAt })
}
/** Uses both label and authority to distinguish real Vuetify domain options. */
function option(domain: Domain) { return `${domain.displayName} (${domain.host})` }
/** Waits for the selected editor to display its saved priority before the next interaction. */
async function selectManaged(page: Page, domain: Domain) {
  await page.getByRole('button', { name: new RegExp(escapeRegExp(domain.displayName)) }).click()
  await expect(page.getByRole('textbox', { name: orderField })).toHaveValue(String(domain.sortOrder))
}
/** Verifies button/native-Enter writes preserve the exact revision, no-store policy and conflict feedback. */
async function writeOrder(page: Page, domain: Domain, value: number, keyboard: boolean, code = 0) {
  await page.getByRole('textbox', { name: orderField }).fill(String(value))
  const waiting = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/admin/domain/set-order')
  if (keyboard) await page.getByRole('textbox', { name: orderField }).press('Enter')
  else await page.getByRole('button', { name: orderSave }).click()
  const response = await waiting
  expect(response.request().postDataJSON()).toEqual({ id: domain.id, sortOrder: value, expectedUpdatedAt: domain.updatedAt })
  expect(response.headers()['cache-control']).toBe('no-store')
  const payload = await response.json()
  expect(payload.code).toBe(code)
  if (code === 0) {
    expect(payload.data.domain.sortOrder).toBe(value)
    await expect(page.getByText(/^(排序已保存。|Order saved\.)$/)).toBeVisible()
  } else await expect(page.getByText(/排序或域名详情已在其他位置更新|This domain changed elsewhere/).first()).toBeVisible()
  await dismiss(page)
}
/** Makes an explicit user selection through the actual combobox overlay. */
async function choose(page: Page, label: RegExp, domain: Domain) {
  await page.getByRole('combobox', { name: label }).press('Enter')
  await page.getByRole('option', { name: option(domain), exact: true }).click()
}
/** Triggers a genuine online refresh and waits for the available-domain response without reloading the creator. */
async function reconnect(page: Page) {
  await page.context().setOffline(true)
  const waiting = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/domain/available')
  await page.context().setOffline(false)
  expect((await (await waiting).json()).code).toBe(0)
}
/** Checks the submitted selection and published origin, recording created links for owned cleanup. */
async function create(page: Page, domain: Domain, domainId: string | null, links: string[]) {
  await page.getByLabel(/^(输入链接|Enter link)$/).fill('https://example.com/domain-order-e2e')
  const waiting = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/short-link/create')
  await page.getByRole('button', { name: /^(创建短链|Create short link)$/ }).click()
  const response = await waiting
  const input = response.request().postDataJSON()
  if (domainId) expect(input.domainId).toBe(domainId)
  else expect(input).not.toHaveProperty('domainId')
  const payload = await response.json()
  expect(payload.code).toBe(0)
  links.push(payload.data.shortLink.id)
  expect(new URL(payload.data.shortLink.url).origin).toBe(new URL(domain.host.includes('://') ? domain.host : `https://${domain.host}`).origin)
  await expect(page.getByTestId('short-link-create-result')).toBeVisible()
  await expect(page.getByText(/^(创建成功|Created)$/).first()).toBeVisible()
  await dismiss(page)
}
/** Clears visible notifications before the next assertion so an older toast cannot satisfy it. */
async function dismiss(page: Page) {
  const buttons = page.getByRole('button', { name: /^(关闭提示|Dismiss notification)$/ })
  for (const button of await buttons.all()) await button.click()
  await expect(buttons).toHaveCount(0)
}
/** Checks viewport bounds and saves the actual rendered ordering/creation panel for visual verification. */
async function layout(page: Page, info: TestInfo, name: string) {
  await expectNoHorizontalOverflow(page)
  const panel = page.locator('.domain-order').or(page.locator('.short-link-create-panel'))
  const box = await panel.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  const path = info.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true, animations: 'disabled' })
  await info.attach(name, { path, contentType: 'image/png' })
}
