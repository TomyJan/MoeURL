import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Page, TestInfo } from '@playwright/test'
import type { ManagedDomain } from '../src/entities/domain/api'
import type { DomainRedirectDefaultSetting } from '../src/entities/domain/redirect-default'
import type { RedirectMode } from '../src/entities/short-link/model'
import type { UserGroup } from '../src/entities/user-group/api'
import { e2eAdminPassword, e2eAdminUsername, e2ePort, escapeRegExp, expectNoHorizontalOverflow, readVisitCount } from './support'
import { dismissNotifications as dismiss } from './notification-dismissal'

interface CreatedLink { id: string; slug: string; url: string; redirectMode: RedirectMode; intermediateDelaySeconds: number | null }
const choiceLabel = /^(短链域名|Short-link domain)$/
const modeSave = /^(保存默认跳转方式|Save redirect default)$/
const modeReload = /^(重新加载域名模式|Reload domain mode)$/
const target = 'https://example.com/domain-mode-e2e'
const modeNames = { direct: /^(直接跳转|Direct redirect)$/, intermediate: /^(中间页|Intermediate page)$/, confirmation: /^(确认页|Confirmation page)$/ }
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const width of [1280, 390]) {
  test('v0.29.0 preserves domain-mode defaults, explicit choices and published links at ' + width + 'px', async ({ browser, page: admin }, info) => {
    info.setTimeout(240_000)
    const suffix = randomBytes(6).toString('hex')
    const contexts: BrowserContext[] = []
    const links: CreatedLink[] = []
    let global: ManagedDomain | undefined
    let other: ManagedDomain | undefined
    let originalMode: RedirectMode | undefined
    let originalPermissions: string[] | undefined
    let userId = ''
    let scenarioError: unknown
    const cleanupErrors: unknown[] = []
    try {
      await post(admin.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      global = (await domains(admin.request)).find(({ isDefault }) => isDefault)!
      expect(global).toBeDefined()
      originalMode = (await setting(admin.request, global.id)).redirectMode
      originalPermissions = (await groups(admin.request)).find(({ key }) => key === 'user')!.permissions
      await permissions(admin.request, [...new Set([...originalPermissions, 'short_link:create', 'domain:use_default', 'domain:use_assigned', 'short_link:use_intermediate', 'short_link:use_confirmation'])])
      await setSetting(admin.request, global.id, 'direct')
      // Distinct loopback Hosts avoid the legacy localhost scenario and the other viewport's retained references.
      other = (await post<{ domain: ManagedDomain }>(admin.request, '/admin/domain/create', { host: 'http://127.0.0.' + (width === 1280 ? '2' : '3') + ':' + e2ePort, displayName: 'Mode ' + suffix, enabled: true, allowedGroups: ['user', 'admin'] })).domain
      userId = (await post<{ user: { id: string } }>(admin.request, '/admin/user/create', { username: 'mode-' + suffix, password: 'domain-mode-e2e-password', nickname: 'Domain mode E2E', status: 'active', groupKey: 'user' })).user.id
      const context = await browser.newContext({ baseURL: 'http://127.0.0.1:' + e2ePort, locale: width === 1280 ? 'en' : 'zh-CN', serviceWorkers: 'block', reducedMotion: 'reduce', viewport: { width, height: width === 1280 ? 800 : 844 } })
      contexts.push(context)
      const language = width === 1280 ? 'en' : 'zh-CN'
      await context.addInitScript((language) => localStorage.setItem('moeurl.language', language), language)
      await admin.addInitScript((language) => localStorage.setItem('moeurl.language', language), language)
      const member = await context.newPage()
      const publicPage = await context.newPage()
      await publicPage.route(target, (route) => route.fulfill({ contentType: 'text/plain', body: 'Reached the real redirect target' }))
      await post(member.request, '/auth/login', { username: 'mode-' + suffix, password: 'domain-mode-e2e-password' })
      await admin.setViewportSize({ width, height: width === 1280 ? 800 : 844 })
      await selectManaged(admin, global)
      await expect(admin.getByRole('heading', { name: width === 1280 ? 'Default redirect mode' : '域名默认跳转方式', exact: true })).toBeVisible()
      await saveMode(admin, global.id, 'confirmation')
      await reviewDraftRecovery(admin, global)
      await selectManaged(admin, other)
      await saveMode(admin, other.id, 'intermediate')
      await layout(admin, info, 'domain-mode-management-' + width, '.domain-mode')

      await member.goto('/')
      await advanced(member)
      await expect(member.getByRole('button', { name: modeNames.confirmation })).toHaveAttribute('aria-pressed', 'true')
      await expect(member.getByRole('button', { name: width === 1280 ? 'Confirmation page' : '确认页', exact: true })).toBeVisible()
      await layout(member, info, 'domain-mode-creator-' + width, '.short-link-create-panel')
      const confirmation = await create(member, global, 'confirmation', links)
      expect(await readVisitCount(member, confirmation.id)).toBe(0)
      await publicPage.goto(confirmation.url)
      await expect(publicPage.getByRole('heading', { name: /^(确认访问外部网站|Confirm external site visit)$/ })).toBeVisible()
      await expect(publicPage.locator('.redirect-page__countdown')).toHaveCount(0)
      expect(await readVisitCount(member, confirmation.id)).toBe(0)
      await layout(publicPage, info, 'domain-mode-confirmation-' + width, '.redirect-page__state')
      const continued = publicPage.waitForResponse((response) => new URL(response.url()).pathname === '/go/' + confirmation.slug + '/continue')
      // The real 302, destination URL and event count below own navigation synchronization.
      await publicPage.getByRole('button', { name: /^(继续访问|Continue to site)$/ }).click({ noWaitAfter: true })
      expect((await continued).status()).toBe(302)
      await expect(publicPage).toHaveURL(target)
      await expect.poll(() => readVisitCount(member, confirmation.id)).toBe(1)

      await setSetting(admin.request, global.id, 'direct')
      const saved = (await get<{ items: CreatedLink[] }>(member.request, '/short-link/list?page=1&pageSize=100')).items.find(({ id }) => id === confirmation.id)!
      expect(saved.redirectMode).toBe('confirmation')
      await publicPage.goto(confirmation.url)
      await expect(publicPage.getByRole('heading', { name: /^(确认访问外部网站|Confirm external site visit)$/ })).toBeVisible()
      expect(await readVisitCount(member, confirmation.id)).toBe(1)

      await member.goto('/')
      await chooseDomain(member, other)
      await advanced(member)
      await expect(member.getByRole('button', { name: modeNames.intermediate })).toHaveAttribute('aria-pressed', 'true')
      await expect(member.getByRole('slider')).toHaveAttribute('aria-valuenow', '5')
      const intermediate = await create(member, other, 'intermediate', links)
      const automaticContinue = publicPage.waitForResponse((response) => new URL(response.url()).pathname === '/go/' + intermediate.slug + '/continue')
      await publicPage.goto(intermediate.url)
      await expect(publicPage.locator('.redirect-page__countdown')).toBeVisible()
      expect(await readVisitCount(member, intermediate.id)).toBe(0)
      expect((await automaticContinue).status()).toBe(302)
      await expect(publicPage).toHaveURL(target)
      await expect.poll(() => readVisitCount(member, intermediate.id)).toBe(1)

      await member.goto('/')
      await chooseDomain(member, other)
      await advanced(member)
      await member.getByRole('button', { name: modeNames.direct }).click()
      await chooseDomain(member, global)
      await chooseDomain(member, other)
      await expect(member.getByRole('button', { name: modeNames.direct })).toHaveAttribute('aria-pressed', 'true')
      const manual = await create(member, other, 'direct', links)
      await publicPage.goto(manual.url)
      await expect(publicPage).toHaveURL(target)
      await expect.poll(() => readVisitCount(member, manual.id)).toBe(1)

      await chooseDomain(member, other)
      await expect(member.getByRole('button', { name: modeNames.intermediate })).toHaveAttribute('aria-pressed', 'true')
      await permissions(admin.request, [...new Set([...originalPermissions, 'short_link:create', 'domain:use_default', 'domain:use_assigned'])].filter((permission) => !['short_link:use_intermediate', 'short_link:use_confirmation'].includes(permission)))
      await member.getByLabel(/^(输入链接|Enter link)$/).fill(target)
      const deniedCreation = member.waitForResponse('**/api/v1/short-link/create')
      await member.getByRole('button', { name: /^(创建短链|Create short link)$/ }).click()
      const denial = await deniedCreation
      expect(denial.status()).toBe(200)
      expect((await denial.json()).code).toBe(120001)
      await expect(member.getByRole('alert').filter({ hasText: /跳转权限已变化，已清除无权模式|Redirect permissions changed/ })).toBeVisible()
      await expect(member.getByRole('button', { name: /^(创建短链|Create short link)$/ })).toBeDisabled()
      await expect(member.getByLabel(/^(输入链接|Enter link)$/)).toHaveValue(target)
      await member.getByRole('button', { name: /^(本次使用直接跳转|Use direct redirect for this link)$/ }).click()
      await create(member, other, 'direct', links, true)
      await dismiss(member)
      await member.goto('/')
      await chooseDomain(member, other)
      await advanced(member)
      await expect(member.getByRole('button', { name: modeNames.intermediate })).toHaveCount(0)
      await create(member, other, 'direct', links, true)

      // A separate real API save advances the same domain revision while this browser retains its dirty snapshot.
      await selectManaged(admin, other)
      await admin.locator('.domain-mode').getByRole('button', { name: modeNames.confirmation }).click()
      const before = await setting(admin.request, other.id)
      await setSetting(admin.request, other.id, 'direct')
      const conflict = admin.waitForResponse('**/api/v1/admin/domain/set-redirect-default')
      await admin.getByRole('button', { name: modeSave }).click()
      const failed = await conflict
      expect(failed.request().postDataJSON()).toEqual({ id: other.id, redirectMode: 'confirmation', expectedUpdatedAt: before.updatedAt })
      expect((await failed.json()).code).toBe(210103)
      await expect(admin.getByRole('button', { name: modeSave })).toBeDisabled()
      await admin.getByRole('button', { name: modeReload }).click()
      await expect(admin.locator('.domain-mode').getByRole('button', { name: modeNames.direct })).toHaveAttribute('aria-pressed', 'true')
      await saveMode(admin, other.id, 'confirmation')
      await info.attach('domain-mode-contract', { body: Buffer.from(JSON.stringify({ width, userId, global: global.id, other: other.id, links, final: await setting(admin.request, other.id) })), contentType: 'application/json' })
    } catch (error) { scenarioError = error } finally {
      if (originalPermissions) { try { await permissions(admin.request, originalPermissions) } catch (error) { cleanupErrors.push(error) } }
      if (global && originalMode) { try { await setSetting(admin.request, global.id, originalMode) } catch (error) { cleanupErrors.push(error) } }
      for (const link of links) { try { await post(admin.request, '/admin/short-link/delete', { id: link.id }) } catch (error) { cleanupErrors.push(error) } }
      if (other) {
        try {
          const current = (await domains(admin.request)).find(({ id }) => id === other!.id)!
          await post(admin.request, '/admin/domain/update', { id: current.id, host: current.host, displayName: current.displayName, allowedGroups: ['admin'], enabled: false, expectedUpdatedAt: current.updatedAt })
          const latest = (await domains(admin.request)).find(({ id }) => id === other!.id)!
          // Soft-deleted links keep their immutable domain until the owned Compose database is destroyed.
          expect([0, 210104]).toContain((await rawPost(admin.request, '/admin/domain/delete', { id: latest.id, expectedUpdatedAt: latest.updatedAt })).code)
        } catch (error) { cleanupErrors.push(error) }
      }
      if (userId) { try { await post(admin.request, '/admin/user/update', { id: userId, nickname: 'Domain mode E2E', status: 'disabled' }) } catch (error) { cleanupErrors.push(error) } }
      for (const context of contexts) { try { await context.close() } catch (error) { cleanupErrors.push(error) } }
    }
    if (scenarioError || cleanupErrors.length) throw new AggregateError([...(scenarioError ? [scenarioError] : []), ...cleanupErrors], 'Domain-mode scenario or owned fixture cleanup failed')
  })
}

/** Keeps genuine denial and conflict codes observable instead of treating them as fixture success. */
async function rawPost(request: APIRequestContext, path: string, data: unknown): Promise<{ code: number; data: unknown }> {
  const response = await request.post('/api/v1' + path, { data }); expect(response.status()).toBe(200); return response.json()
}
/** Consumes only a successful real API result during setup and cleanup. */
async function post<T = unknown>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const result = await rawPost(request, path, data); expect(result.code).toBe(0); return result.data as T
}
/** Reads an authenticated representation without synthesizing a server revision. */
async function get<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get('/api/v1' + path); expect(response.status()).toBe(200)
  const payload = await response.json(); expect(payload.code).toBe(0); return payload.data as T
}
/** Retains the exact shared revision used by legacy and mode mutations. */
async function domains(request: APIRequestContext) { return (await get<{ items: ManagedDomain[] }>(request, '/admin/domain/list')).items }
/** Reads builtin permissions before changing the isolated fixture group. */
async function groups(request: APIRequestContext) { return (await get<{ groups: UserGroup[] }>(request, '/admin/user-group/list')).groups }
/** Updates only permissions with the current complete group revision. */
async function permissions(request: APIRequestContext, values: string[]) {
  const group = (await groups(request)).find(({ key }) => key === 'user')!
  await post(request, '/admin/user-group/update-permissions', { groupKey: 'user', permissions: values, expectedUpdatedAt: group.updatedAt })
}
/** Reads the independent management resource rather than assuming a field in the old DTO. */
async function setting(request: APIRequestContext, id: string) { return (await get<{ setting: DomainRedirectDefaultSetting }>(request, '/admin/domain/redirect-default?id=' + id)).setting }
/** Restores or advances exactly one mode against its authoritative full timestamp. */
async function setSetting(request: APIRequestContext, id: string, redirectMode: RedirectMode) {
  await post(request, '/admin/domain/set-redirect-default', { id, redirectMode, expectedUpdatedAt: (await setting(request, id)).updatedAt })
}
/** Mounts a real selected editor with no previous page draft or query observer. */
async function selectManaged(page: Page, domain: ManagedDomain) {
  await page.goto('/admin/domain')
  await page.getByRole('button', { name: new RegExp(escapeRegExp(domain.displayName)) }).click()
  await expect(page.locator('.domain-mode')).toBeVisible()
  await expect(page.locator('.domain-mode').getByRole('button', { name: modeNames.direct })).toBeEnabled()
}
/** Verifies an actual UI mode write and waits for the refreshed authoritative editor. */
async function saveMode(page: Page, id: string, mode: RedirectMode) {
  const before = await setting(page.request, id)
  await page.locator('.domain-mode').getByRole('button', { name: modeNames[mode] }).click()
  const waiting = page.waitForResponse('**/api/v1/admin/domain/set-redirect-default')
  await page.getByRole('button', { name: modeSave }).click()
  const response = await waiting
  expect(response.headers()['cache-control']).toBe('no-store')
  expect(response.request().postDataJSON()).toEqual({ id, redirectMode: mode, expectedUpdatedAt: before.updatedAt })
  expect((await response.json()).code).toBe(0)
  await expect(page.locator('.domain-mode').getByRole('button', { name: modeNames[mode] })).toBeEnabled()
  await expect(page.getByRole('button', { name: modeSave })).toBeDisabled()
  await dismiss(page)
}
/** Verifies same-domain discard and local cancellation without clearing remote read barriers. */
async function reviewDraftRecovery(page: Page, domain: ManagedDomain) {
  const details = page.getByRole('textbox', { name: /^(显示名称|Display name)$/ })
  await page.locator('.domain-mode').getByRole('button', { name: modeNames.intermediate }).click()
  await expect(details).toBeDisabled()
  await page.locator('.domains-page__list').getByRole('button', { name: new RegExp(escapeRegExp(domain.displayName)) }).click()
  await page.getByRole('button', { name: /^(丢弃并载入|Discard and load)$/ }).click()
  await expect(page.locator('.domain-mode').getByRole('button', { name: modeNames.confirmation })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: modeSave })).toBeDisabled()
  await expect(details).toBeEnabled()
  await page.locator('.domain-mode').getByRole('button', { name: modeNames.intermediate }).click()
  await page.route('**/api/v1/admin/domain/redirect-default?*', (route) => route.abort('failed'))
  const failedRead = page.waitForEvent('requestfailed', (request) => new URL(request.url()).pathname === '/api/v1/admin/domain/redirect-default')
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')))
  await failedRead
  const cancel = page.getByRole('button', { name: /^(取消模式草稿|Cancel mode draft)$/ })
  await expect(page.getByRole('alert').filter({ hasText: /域名模式或共享版本尚未确认|The domain mode or shared revision is not confirmed/ })).toBeVisible()
  await expect(cancel).toBeEnabled()
  await cancel.click()
  await expect(page.locator('.domain-mode').getByRole('button', { name: modeNames.confirmation })).toHaveAttribute('aria-pressed', 'true')
  await expect(details).toBeEnabled()
  await expect(page.getByRole('button', { name: modeSave })).toBeDisabled()
  await page.unroute('**/api/v1/admin/domain/redirect-default?*')
  await page.getByRole('button', { name: modeReload }).click()
  await expect(page.locator('.domain-mode').getByRole('button', { name: modeNames.direct })).toBeEnabled()
}
/** Uses real Vuetify controls and preserves a manual mode across actual domain changes. */
async function chooseDomain(page: Page, domain: ManagedDomain) {
  await page.getByRole('combobox', { name: choiceLabel }).press('Enter')
  await page.getByRole('option', { name: domain.displayName + ' (' + domain.host + ')', exact: true }).click()
}
/** Opens advanced settings without toggling an already-visible control closed. */
async function advanced(page: Page) {
  const button = page.getByRole('button', { name: /^(高级设置|Advanced settings)$/ })
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click()
}
/** Asserts actual creation payload, immutable result and published domain origin. */
async function create(page: Page, domain: ManagedDomain, mode: RedirectMode, links: CreatedLink[], omitted = false) {
  await page.getByLabel(/^(输入链接|Enter link)$/).fill(target)
  const waiting = page.waitForResponse('**/api/v1/short-link/create')
  await page.getByRole('button', { name: /^(创建短链|Create short link)$/ }).click()
  const response = await waiting; const input = response.request().postDataJSON()
  if (domain.isDefault) expect(input).not.toHaveProperty('domainId')
  else expect(input.domainId).toBe(domain.id)
  if (omitted) expect(input).not.toHaveProperty('redirectMode')
  else expect(input.redirectMode).toBe(mode)
  if (mode === 'intermediate') expect(input.intermediateDelaySeconds).toBe(5)
  else expect(input).not.toHaveProperty('intermediateDelaySeconds')
  const result = await response.json(); expect(result.code).toBe(0)
  const link = result.data.shortLink as CreatedLink; links.push(link)
  expect(link.redirectMode).toBe(mode)
  expect(new URL(link.url).origin).toBe(domain.host)
  await expect(page.getByTestId('short-link-create-result')).toContainText(link.url)
  await dismiss(page)
  return link
}
/** Saves actual desktop/mobile screenshots after checking the business panel's viewport bounds. */
async function layout(page: Page, info: TestInfo, name: string, selector: string) {
  await expectNoHorizontalOverflow(page)
  const box = await page.locator(selector).boundingBox(); expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  const path = info.outputPath(name + '.png'); await page.screenshot({ path, fullPage: true, animations: 'disabled' })
  await info.attach(name, { path, contentType: 'image/png' })
}
