import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Page, TestInfo } from '@playwright/test'
import type { ManagedDomain } from '../src/entities/domain/api'
import type { UserGroup, UserGroupKey } from '../src/entities/user-group/api'
import type { UserGroupDomainDefault } from '../src/entities/user-group/domain-default'
import { e2eAdminPassword, e2eAdminUsername, e2ePort, expectNoHorizontalOverflow } from './support'

const password = 'group-default-domain-e2e-password'
const groupLabel = /^(用户组默认域名|Group default domain)$/
const choiceLabel = /^(短链域名|Short-link domain)$/
const personalLabel = /^(个人默认域名|Personal default domain)$/
const groupSave = /^(保存组默认域名|Save group default domain)$/
const groupReload = /^(重新加载组配置|Reload group configuration)$/
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const width of [1280, 390]) {
  test(`v0.28.0 applies group defaults, independent choices and shared revisions at ${width}px`, async ({ browser, page: admin }, info) => {
    info.setTimeout(180_000)
    const suffix = randomBytes(6).toString('hex')
    const contexts: BrowserContext[] = []
    const accounts: string[] = []
    const owned: string[] = []
    const deleted = new Set<string>()
    const links: string[] = []
    const originals = new Map<'user' | 'admin', { permissions: string[]; domainId: string | null }>()
    let global: ManagedDomain | undefined
    let member: Page | undefined
    let scenarioError: unknown
    const cleanupErrors: unknown[] = []
    try {
      await post(admin.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      global = (await domains(admin.request)).find(({ isDefault }) => isDefault)!
      expect(global).toBeDefined()
      for (const key of ['user', 'admin'] as const) {
        const group = (await groups(admin.request)).find((group) => group.key === key)!
        originals.set(key, { permissions: group.permissions, domainId: (await setting(admin.request, key)).setting.domainId })
      }
      const baseline = originals.get('user')!.permissions
      await permissions(admin.request, 'user', [...new Set([...baseline, 'short_link:create', 'domain:use_default', 'domain:use_assigned'])])
      const created: ManagedDomain[] = []
      for (const name of ['Group', 'Personal', 'Unused']) {
        const result = await post<{ domain: ManagedDomain }>(admin.request, '/admin/domain/create', { host: `https://${name.toLowerCase()}-${suffix}.example`, displayName: `${name} ${suffix}`, enabled: true, allowedGroups: ['user', 'admin'] })
        created.push(result.domain); owned.push(result.domain.id)
      }
      const [groupDomain, personal, unused] = created as [ManagedDomain, ManagedDomain, ManagedDomain]
      const people: Array<{ username: string; groupKey: 'user' | 'admin' }> = [
        { username: `groupuser-${suffix}`, groupKey: 'user' }, { username: `groupadmin-${suffix}`, groupKey: 'admin' },
      ]
      const pages: Page[] = []
      for (const person of people) {
        accounts.push((await post<{ user: { id: string } }>(admin.request, '/admin/user/create', { ...person, nickname: 'Group default E2E', password, status: 'active' })).user.id)
        const context = await browser.newContext({ baseURL: `http://127.0.0.1:${e2ePort}`, locale: 'zh-CN', serviceWorkers: 'block', reducedMotion: 'reduce', viewport: { width, height: width === 1280 ? 720 : 800 } })
        contexts.push(context)
        const page = await context.newPage(); pages.push(page)
        await post(page.request, '/auth/login', { username: person.username, password })
      }
      member = pages[0]!
      const secondAdmin = pages[1]!
      await admin.setViewportSize({ width, height: width === 1280 ? 720 : 800 })
      await admin.goto('/admin/user/group')
      await expect(admin.getByTestId('group-default-editor')).toBeVisible()
      await expect(admin.getByTestId('group-default-editor').getByRole('combobox')).toHaveCount(0)
      await selectGroup(admin, 'user')
      await saveSetting(admin, 'user', groupDomain)
      await layout(admin, info, `group-default-management-${width}`)
      await member.goto('/')
      await expectChoice(member, groupDomain)
      await create(member, groupDomain, groupDomain.id, links)

      // The administrator group has a distinct persisted setting and a real separate Cookie owner.
      await selectGroup(admin, 'admin')
      await saveSetting(admin, 'admin', personal)
      await secondAdmin.goto('/')
      await expectChoice(secondAdmin, personal)
      await create(secondAdmin, personal, personal.id, links)
      await member.reload(); await expectChoice(member, groupDomain)

      // A personal preference and a manual global choice both override the group setting.
      await member.goto('/profile')
      await expect(member.getByTestId('domain-preference-save')).toBeEnabled()
      await choose(member, personalLabel, option(personal))
      const preferenceSave = member.waitForResponse('**/api/v1/user/domain-preference/update')
      await member.getByTestId('domain-preference-save').click()
      expect((await (await preferenceSave).json()).code).toBe(0)
      await dismiss(member)
      await member.goto('/'); await expectChoice(member, personal)
      await create(member, personal, personal.id, links)
      await choose(member, choiceLabel, option(global))
      await create(member, global, null, links)
      await expectChoice(member, personal)
      await clearPersonal(member.request)
      await member.reload(); await expectChoice(member, groupDomain)

      // Hold only real GETs in one context, keeping its original snapshot while the other saves.
      await admin.goto('/admin/user/group'); await selectGroup(admin, 'user')
      await secondAdmin.goto('/admin/user/group'); await selectGroup(secondAdmin, 'user')
      const original = (await setting(admin.request, 'user')).setting.updatedAt
      await choose(admin, groupLabel, option(personal))
      await expect(admin.getByRole('button', { name: /^(保存权限|Save permissions)$/ })).toBeDisabled()
      let releaseReads!: () => void
      const readGate = new Promise<void>((resolve) => { releaseReads = resolve })
      const readPattern = /\/api\/v1\/admin\/user-group\/(?:list|domain-default)(?:\?|$)/
      await admin.route(readPattern, async (route) => { await readGate; await route.continue() })
      try {
        await saveSetting(secondAdmin, 'user', global)
        const conflict = admin.waitForResponse('**/api/v1/admin/user-group/set-domain-default')
        await admin.getByRole('button', { name: groupSave }).click()
        const failed = await conflict
        expect(failed.request().postDataJSON()).toEqual({ groupKey: 'user', domainId: personal.id, expectedUpdatedAt: original })
        expect((await failed.json()).code).toBe(300202)
        await expect(admin.getByRole('combobox', { name: groupLabel })).toHaveValue(option(personal))
        await expect(admin.getByRole('button', { name: groupSave })).toBeDisabled()
      } finally { releaseReads(); await admin.unroute(readPattern) }
      await dismiss(admin)
      await admin.getByRole('button', { name: groupReload }).click()
      await expect(admin.getByRole('combobox', { name: groupLabel })).toHaveValue(option(global))
      await expect(admin.getByRole('combobox', { name: groupLabel })).toBeEnabled()

      // An already-mounted creator refreshes from the new group setting on a genuine online event.
      await member.reload(); await expectChoice(member, global)
      await saveSetting(admin, 'user', groupDomain)
      await reconnect(member)
      await expectChoice(member, groupDomain)
      await create(member, groupDomain, groupDomain.id, links)
      await layout(member, info, `group-default-create-${width}`)

      // Grant revocation and disabled domains mask the saved UUID and fall back without rewriting it.
      await updateDomain(admin.request, groupDomain.id, { allowedGroups: ['admin'] })
      await member.reload(); await unavailable(member, groupDomain.id)
      await expectChoice(member, global); await create(member, global, null, links)
      await updateDomain(admin.request, groupDomain.id, { allowedGroups: ['admin', 'user'], enabled: false })
      await member.reload(); await unavailable(member, groupDomain.id)
      await updateDomain(admin.request, groupDomain.id, { enabled: true })
      await member.reload(); await expectChoice(member, groupDomain)
      await permissions(admin.request, 'user', [...new Set([...baseline, 'short_link:create', 'domain:use_default'])].filter((key) => key !== 'domain:use_assigned'))
      await member.reload(); await unavailable(member, groupDomain.id); await expectChoice(member, global)
      await create(member, global, null, links)
      await permissions(admin.request, 'user', [...new Set([...baseline, 'short_link:create', 'domain:use_default', 'domain:use_assigned'])])

      // With no group/personal/global candidate, the initial choice follows authoritative ordering.
      await setSetting(admin.request, 'user', null)
      await updateDomain(admin.request, global.id, { allowedGroups: global.allowedGroups.filter((key) => key !== 'user') })
      for (const [domain, sortOrder] of [[personal, -10000], [groupDomain, -9999]] as const) {
        const current = (await domains(admin.request)).find(({ id }) => id === domain.id)!
        await post(admin.request, '/admin/domain/set-order', { id: domain.id, sortOrder, expectedUpdatedAt: current.updatedAt })
      }
      await member.reload(); await expectChoice(member, personal)
      await create(member, personal, personal.id, links)
      await updateDomain(admin.request, global.id, { allowedGroups: global.allowedGroups })

      // Deleting an unused domain clears both references atomically; a stale shared version conflicts.
      await setSetting(admin.request, 'user', unused.id)
      const personalBefore = await get<{ preference: { updatedAt: string | null } }>(member.request, '/user/domain-preference')
      await post(member.request, '/user/domain-preference/update', { domainId: unused.id, expectedUpdatedAt: personalBefore.preference.updatedAt })
      const beforeDelete = await setting(admin.request, 'user')
      const currentUnused = (await domains(admin.request)).find(({ id }) => id === unused.id)!
      await post(admin.request, '/admin/domain/delete', { id: unused.id, expectedUpdatedAt: currentUnused.updatedAt })
      deleted.add(unused.id)
      const afterDelete = await setting(admin.request, 'user')
      expect(afterDelete.setting.domainId).toBeNull()
      expect(afterDelete.setting.updatedAt).not.toBe(beforeDelete.setting.updatedAt)
      expect((await rawPost(admin.request, '/admin/user-group/set-domain-default', { groupKey: 'user', domainId: null, expectedUpdatedAt: beforeDelete.setting.updatedAt })).code).toBe(300202)
      expect(await get(member.request, '/user/domain-preference')).toMatchObject({ preference: { domainId: null } })
      await member.reload(); await expectChoice(member, global)
      await create(member, global, null, links)
      await info.attach('group-default-contract', { body: Buffer.from(JSON.stringify({ width, accounts, owned, links, deleted: [...deleted], beforeDelete, afterDelete })), contentType: 'application/json' })
    } catch (error) { scenarioError = error } finally {
      if (member) { try { await clearPersonal(member.request) } catch (error) { cleanupErrors.push(error) } }
      if (global) { try { await updateDomain(admin.request, global.id, { allowedGroups: global.allowedGroups, enabled: global.enabled }) } catch (error) { cleanupErrors.push(error) } }
      for (const [key, original] of originals) {
        try { await permissions(admin.request, key, original.permissions); await setSetting(admin.request, key, original.domainId) } catch (error) { cleanupErrors.push(error) }
      }
      for (const id of links) { try { await post(admin.request, '/admin/short-link/delete', { id }) } catch (error) { cleanupErrors.push(error) } }
      for (const id of owned.filter((id) => !deleted.has(id))) {
        try {
          await updateDomain(admin.request, id, { allowedGroups: ['admin'], enabled: false })
          const current = (await domains(admin.request)).find((item) => item.id === id)!
          // Published soft-deleted links retain immutable domain references until this owned DB is removed.
          expect([0, 210104]).toContain((await rawPost(admin.request, '/admin/domain/delete', { id, expectedUpdatedAt: current.updatedAt })).code)
        } catch (error) { cleanupErrors.push(error) }
      }
      for (const id of accounts) { try { await post(admin.request, '/admin/user/update', { id, nickname: 'Group default E2E', status: 'disabled' }) } catch (error) { cleanupErrors.push(error) } }
      for (const context of contexts) { try { await context.close() } catch (error) { cleanupErrors.push(error) } }
    }
    if (scenarioError || cleanupErrors.length) throw new AggregateError([...(scenarioError ? [scenarioError] : []), ...cleanupErrors], 'Group default scenario or owned fixture cleanup failed')
  })
}

/** Keeps real business failures visible while requiring the documented HTTP boundary. */
async function rawPost(request: APIRequestContext, path: string, data: unknown): Promise<{ code: number; data: unknown }> {
  const result = await request.post(`/api/v1${path}`, { data }); expect(result.status()).toBe(200); return result.json()
}
/** Uses only a successful real response as fixture or cleanup state. */
async function post<T = unknown>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const result = await rawPost(request, path, data); expect(result.code).toBe(0); return result.data as T
}
/** Reads a complete authenticated representation instead of reconstructing server state. */
async function get<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(`/api/v1${path}`); expect(response.status()).toBe(200)
  const payload = await response.json(); expect(payload.code).toBe(0); return payload.data as T
}
/** Reads current domain revisions for grant, status and deletion operations. */
async function domains(request: APIRequestContext) { return (await get<{ items: ManagedDomain[] }>(request, '/admin/domain/list')).items }
/** Reads the original strict permission projection independently of the new resource. */
async function groups(request: APIRequestContext) { return (await get<{ groups: UserGroup[] }>(request, '/admin/user-group/list')).groups }
/** Preserves the group's shared full timestamp across the real default endpoint. */
async function setting(request: APIRequestContext, groupKey: UserGroupKey) { return get<UserGroupDomainDefault>(request, `/admin/user-group/domain-default?groupKey=${groupKey}`) }
/** Saves or restores only one setting against a freshly read shared version. */
async function setSetting(request: APIRequestContext, groupKey: 'user' | 'admin', domainId: string | null) {
  await post(request, '/admin/user-group/set-domain-default', { groupKey, domainId, expectedUpdatedAt: (await setting(request, groupKey)).setting.updatedAt })
}
/** Changes existing fixture permissions without adding permissions or overwriting the default field. */
async function permissions(request: APIRequestContext, groupKey: 'user' | 'admin', permissions: string[]) {
  const current = (await groups(request)).find((group) => group.key === groupKey)!
  await post(request, '/admin/user-group/update-permissions', { groupKey, permissions, expectedUpdatedAt: current.updatedAt })
}
/** Updates only requested fixture details while preserving the latest unrelated values. */
async function updateDomain(request: APIRequestContext, id: string, changes: Partial<Pick<ManagedDomain, 'allowedGroups' | 'enabled'>>) {
  const current = (await domains(request)).find((item) => item.id === id)!
  await post(request, '/admin/domain/update', { id, host: current.host, displayName: current.displayName, enabled: current.enabled, allowedGroups: current.allowedGroups, ...changes, expectedUpdatedAt: current.updatedAt })
}
/** Clears only this dedicated account's preference using its current optimistic revision. */
async function clearPersonal(request: APIRequestContext) {
  const { preference } = await get<{ preference: { domainId: string | null; updatedAt: string | null } }>(request, '/user/domain-preference')
  if (preference.domainId) await post(request, '/user/domain-preference/update', { domainId: null, expectedUpdatedAt: preference.updatedAt })
}
/** Resolves the builtin tab and waits for both versioned editor snapshots. */
async function selectGroup(page: Page, key: 'user' | 'admin') {
  await page.getByRole('tab', { name: key === 'user' ? 'User' : 'Admin', exact: true }).click()
  await expect(page.getByRole('combobox', { name: groupLabel })).toBeEnabled()
}
/** Formats the exact accessible option from real server-returned public metadata. */
function option(domain: ManagedDomain) { return `${domain.displayName} (${domain.host})` }
/** Chooses through the actual Vuetify overlay without forcing disabled controls. */
async function choose(page: Page, label: RegExp, title: string) {
  await page.getByRole('combobox', { name: label }).press('Enter')
  await page.getByRole('option', { name: title, exact: true }).click()
}
/** Verifies an actual page save carries the target and exact shared revision. */
async function saveSetting(page: Page, key: 'user' | 'admin', domain: ManagedDomain) {
  const before = await setting(page.request, key)
  await choose(page, groupLabel, option(domain))
  const waiting = page.waitForResponse('**/api/v1/admin/user-group/set-domain-default')
  await page.getByRole('button', { name: groupSave }).click()
  const result = await waiting
  expect(result.request().postDataJSON()).toEqual({ groupKey: key, domainId: domain.id, expectedUpdatedAt: before.setting.updatedAt })
  expect(result.headers()['cache-control']).toBe('no-store')
  expect((await result.json()).code).toBe(0)
  await expect(page.getByText(/^(用户组默认域名已保存。|Group default domain saved\.)$/)).toBeVisible()
  await expect(page.getByRole('combobox', { name: groupLabel })).toBeEnabled()
  await dismiss(page)
}
/** Checks the current initial selection only once its loading barrier has resolved. */
async function expectChoice(page: Page, domain: ManagedDomain) {
  await expect(page.getByRole('button', { name: /^(创建短链|Create short link)$/ })).toBeEnabled()
  const { items } = await get<{ items: Array<{ id: string }> }>(page.request, '/domain/available')
  if (items.length === 1) {
    expect(items[0]!.id).toBe(domain.id)
    await expect(page.getByRole('combobox', { name: choiceLabel })).toHaveCount(0)
  } else await expect(page.getByRole('combobox', { name: choiceLabel })).toHaveValue(option(domain))
}
/** Confirms unavailable saved metadata never appears in the self projection or options. */
async function unavailable(page: Page, hiddenId: string) {
  expect(await get(page.request, '/domain/group-default')).toEqual({ selection: { domainId: null, status: 'unavailable' } })
  await expect(page.getByText(/^(用户组默认域名当前不可用|The group default domain is unavailable)/)).toBeVisible()
  await expect(page.locator('body')).not.toContainText(hiddenId)
}
/** Refreshes the mounted creator's real queries through an online transition. */
async function reconnect(page: Page) {
  await page.context().setOffline(true)
  const read = page.waitForResponse('**/api/v1/domain/group-default')
  await page.context().setOffline(false)
  expect((await (await read).json()).code).toBe(0)
}
/** Checks both request omission/UUID and the actual server-generated URL rendered by the creator. */
async function create(page: Page, domain: ManagedDomain, domainId: string | null, links: string[]) {
  await page.getByLabel(/^(输入链接|Enter link)$/).fill('https://example.com/group-default-e2e')
  const waiting = page.waitForResponse('**/api/v1/short-link/create')
  await page.getByRole('button', { name: /^(创建短链|Create short link)$/ }).click()
  const result = await waiting; const input = result.request().postDataJSON()
  if (domainId) expect(input.domainId).toBe(domainId)
  else expect(input).not.toHaveProperty('domainId')
  const payload = await result.json(); expect(payload.code).toBe(0)
  links.push(payload.data.shortLink.id)
  expect(new URL(payload.data.shortLink.url).origin).toBe(new URL(domain.host.includes('://') ? domain.host : `https://${domain.host}`).origin)
  await expect(page.getByTestId('short-link-create-result')).toContainText(payload.data.shortLink.url)
  await dismiss(page)
}
/** Removes old notifications so a later assertion cannot accidentally match an earlier outcome. */
async function dismiss(page: Page) {
  const buttons = page.getByRole('button', { name: /^(关闭提示|Dismiss notification)$/ })
  while (await buttons.count()) {
    const count = await buttons.count()
    // Keyboard activation does not wait for the toaster's moving exit animation.
    await buttons.first().press('Enter')
    await expect.poll(() => buttons.count()).toBeLessThan(count)
  }
  await expect(buttons).toHaveCount(0)
}
/** Records full rendered layouts and verifies desktop/mobile horizontal bounds. */
async function layout(page: Page, info: TestInfo, name: string) {
  await expectNoHorizontalOverflow(page)
  const panel = page.getByTestId('group-default-editor').or(page.locator('.short-link-create-panel'))
  const box = await panel.boundingBox(); expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  const path = info.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true, animations: 'disabled' })
  await info.attach(name, { path, contentType: 'image/png' })
}
