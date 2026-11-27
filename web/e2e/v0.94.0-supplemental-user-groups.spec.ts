import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Page, TestInfo } from '@playwright/test'
import { cleanupCreatedUser } from './helpers/user-cleanup'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

const membershipPath = '/api/v1/admin/user/update-group-memberships'
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const width of [1280, 390]) {
  test(`v0.94 supplemental groups add and remove from the real admin user page at ${width}px`, async ({ browser, page }, info) => {
    info.setTimeout(240_000)
    const suffix = randomBytes(6).toString('hex')
    const password = 'supplemental-' + suffix + '-password'
    const locale = width === 1280 ? 'en' : 'zh-CN'
    const viewport = { width, height: width === 1280 ? 800 : 844 }
    const names = locale === 'en'
      ? { more: 'More actions', manage: 'Manage supplemental groups', save: 'Save supplemental groups', cancel: 'Cancel', confirm: 'I verified the account and complete supplemental group set, and approve revoking all existing sessions', primary: 'Primary', supplemental: 'Supplemental', none: 'None' }
      : { more: '更多操作', manage: '管理补充组', save: '保存补充组', cancel: '取消', confirm: '我已核对账号、补充组集合，并确认撤销全部旧登录会话', primary: '主组', supplemental: '补充组', none: '无' }
    const contexts: BrowserContext[] = []
    const createdUsers: Array<{ id: string; username: string }> = []
    const createdGroups: Array<{ key: string; name: string }> = []
    const cleanupErrors: unknown[] = []
    const membershipWrites: unknown[] = []
    let scenarioError: unknown
    const root = await browser.newContext({ baseURL: info.project.use.baseURL, serviceWorkers: 'block' })
    contexts.push(root)
    try {
      await post(root.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      const operations = await post<{ group: UserGroup }>(root.request, '/admin/user-group/create', { name: `Operations ${suffix}`, description: 'v0.94 supplemental membership fixture' })
      createdGroups.push({ key: operations.group.key, name: operations.group.name })
      const support = await post<{ group: UserGroup }>(root.request, '/admin/user-group/create', { name: `Support ${suffix}`, description: 'v0.94 supplemental membership fixture' })
      createdGroups.push({ key: support.group.key, name: support.group.name })
      const target = await createUser(root.request, `supplemental-${suffix}`, 'admin', password)
      createdUsers.push(target)

      await page.setViewportSize(viewport)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.addInitScript(language => localStorage.setItem('moeurl.language', language), locale)
      page.on('request', request => {
        if (new URL(request.url()).pathname === membershipPath && request.method() === 'POST') membershipWrites.push(request.postDataJSON())
      })
      await post(page.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      await page.goto('/admin/user')
      await expect(page.getByTestId('console-page-admin-users')).toBeVisible()
      await expectNoHorizontalOverflow(page)

      const beforeUsers = await users(page.request)
      const directory = await get<{ groups: UserGroup[] }>(page.request, '/admin/user-group/list')
      const adminGroupName = directory.groups.find(group => group.key === 'admin')?.name
      expect(adminGroupName).toBeTruthy()
      const before = beforeUsers.find(user => user.id === target.id)
      expect(before).toBeDefined()
      if (!before) throw new Error('Supplemental target account is missing from the admin list')
      const targetRow = page.getByTestId('console-user-row').filter({ hasText: target.username })
      await expect(targetRow.locator('td').nth(2)).toContainText(names.primary)
      await expect(targetRow.locator('td').nth(2)).toContainText(names.supplemental)
      await expect(targetRow.locator('td').nth(2)).toContainText(names.none)
      await targetRow.getByRole('button', { name: names.more }).click()
      const actions = page.getByTestId('console-user-actions')
      await expect(actions.getByRole('button', { name: names.manage })).toBeEnabled()
      await actions.getByRole('button', { name: names.manage }).click()
      let dialog = page.getByRole('dialog')
      await expect(dialog).toContainText(adminGroupName!)
      await expect(dialog.getByRole('checkbox', { name: operations.group.name, exact: true })).toBeVisible()
      await expect(dialog.getByRole('checkbox', { name: support.group.name, exact: true })).toBeVisible()
      await expectNoHorizontalOverflow(page)
      await attachScreenshot(page, info, `supplemental-groups-empty-${width}-${locale}`)

      await dialog.getByRole('checkbox', { name: operations.group.name, exact: true }).check()
      await expect(dialog.getByRole('button', { name: names.save })).toBeDisabled()
      await dialog.getByRole('checkbox', { name: names.confirm }).check()
      const addResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === membershipPath && response.request().method() === 'POST')
      await dialog.getByRole('button', { name: names.save }).click()
      const addResponse = await addResponsePromise
      expect(addResponse.status()).toBe(200)
      expect(addResponse.headers()['cache-control']).toBe('no-store')
      expect(addResponse.request().postDataJSON()).toEqual({ id: target.id, groupKeys: [operations.group.key], expectedUpdatedAt: before.updatedAt })
      expect(await addResponse.json()).toMatchObject({ code: 0, data: { user: { group: 'admin', supplementalGroups: [{ key: operations.group.key, name: operations.group.name }] } } })
      await expect(dialog).toHaveCount(0)
      await expect(targetRow.locator('td').nth(2)).toContainText(operations.group.name)
      await expect(targetRow.locator('td').nth(2)).not.toContainText(names.none)
      await expectNoHorizontalOverflow(page)
      await attachScreenshot(page, info, `supplemental-groups-added-${width}-${locale}`)

      const afterAdd = (await users(page.request)).find(user => user.id === target.id)
      expect(afterAdd?.supplementalGroups).toEqual([{ key: operations.group.key, name: operations.group.name }])
      expect(afterAdd?.updatedAt).not.toBe(before.updatedAt)
      if (!afterAdd) throw new Error('Supplemental target account disappeared after add')
      await expect(actions.getByRole('button', { name: names.manage })).toBeVisible()
      await actions.getByRole('button', { name: names.manage }).click()
      dialog = page.getByRole('dialog')
      await expect(dialog.getByRole('checkbox', { name: operations.group.name, exact: true })).toBeChecked()
      await dialog.getByRole('checkbox', { name: operations.group.name, exact: true }).uncheck()
      await dialog.getByRole('checkbox', { name: names.confirm }).check()
      const removeResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === membershipPath && response.request().method() === 'POST')
      await dialog.getByRole('button', { name: names.save }).click()
      const removeResponse = await removeResponsePromise
      expect(removeResponse.request().postDataJSON()).toEqual({ id: target.id, groupKeys: [], expectedUpdatedAt: afterAdd.updatedAt })
      expect(await removeResponse.json()).toMatchObject({ code: 0, data: { user: { supplementalGroups: [] } } })
      await expect(dialog).toHaveCount(0)
      await expect(targetRow.locator('td').nth(2)).toContainText(names.none)
      expect(membershipWrites).toHaveLength(2)

      const builtin = beforeUsers.find(user => user.builtin)
      if (builtin) {
        const builtinRow = page.getByTestId('console-user-row').filter({ hasText: builtin.username })
        await expect(builtinRow.getByRole('button', { name: names.more })).toBeDisabled()
        await expect(builtinRow).not.toContainText(names.manage)
      }
    } catch (error) {
      scenarioError = error
      try { await attachScreenshot(page, info, `supplemental-groups-failure-${width}-${locale}`) } catch (captureError) { cleanupErrors.push(captureError) }
    } finally {
      try {
        const currentUsers = await users(root.request)
        for (const created of createdUsers) {
          const current = currentUsers.find(user => user.id === created.id)
          if (current?.supplementalGroups.length) {
            await post(root.request, '/admin/user/update-group-memberships', { id: current.id, groupKeys: [], expectedUpdatedAt: current.updatedAt })
          }
          await cleanupCreatedUser(
            created.id,
            current ? { ...current, updatedAt: (await users(root.request)).find(user => user.id === created.id)?.updatedAt ?? current.updatedAt } : undefined,
            user => post(root.request, '/admin/user/change-group', { id: user.id, groupKey: 'user', expectedUpdatedAt: user.updatedAt }),
            userId => post(root.request, '/admin/user/update', { id: userId, nickname: 'v0.94 supplemental fixture', status: 'disabled' }),
            cleanupErrors,
          )
        }
      } catch (error) { cleanupErrors.push(error) }
      for (const created of createdGroups) {
        try {
          const current = await get<{ groups: UserGroup[] }>(root.request, '/admin/user-group/list')
          const group = current.groups.find(item => item.key === created.key)
          if (group) await post(root.request, '/admin/user-group/delete', { groupKey: group.key, expectedUpdatedAt: group.updatedAt })
        } catch (error) { cleanupErrors.push(error) }
      }
      await info.attach(`owned-fixtures-${width}`, { body: JSON.stringify({ users: createdUsers.map(user => user.id), groups: createdGroups.map(group => group.key), cleanupErrors: cleanupErrors.map(String) }), contentType: 'application/json' })
      for (const context of contexts) {
        try { await context.close() } catch (error) { cleanupErrors.push(error) }
      }
    }
    if (scenarioError || cleanupErrors.length) throw new AggregateError([...(scenarioError ? [scenarioError] : []), ...cleanupErrors], 'v0.94 supplemental group browser scenario or fixture cleanup failed')
  })
}

interface UserGroup { key: string; name: string; updatedAt: string; memberCount: number }
interface SupplementalUser { id: string; username: string; group: string; updatedAt: string; builtin: boolean; supplementalGroups: Array<{ key: string; name: string }> }

async function createUser(request: APIRequestContext, username: string, groupKey: string, password: string) {
  return (await post<{ user: { id: string; username: string } }>(request, '/admin/user/create', { username, password, nickname: username, groupKey, status: 'active' })).user
}

async function users(request: APIRequestContext) {
  return (await get<{ items: SupplementalUser[] }>(request, '/admin/user/list?page=1&pageSize=100')).items
}

async function post<T = unknown>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await request.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200)
  const result = await response.json() as { code: number; data: T }
  expect(result.code).toBe(0)
  return result.data
}

async function get<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get('/api/v1' + path)
  expect(response.status()).toBe(200)
  const result = await response.json() as { code: number; data: T }
  expect(result.code).toBe(0)
  return result.data
}

async function attachScreenshot(page: Page, info: TestInfo, name: string) {
  await info.attach(name, { body: await page.screenshot({ fullPage: true, animations: 'disabled' }), contentType: 'image/png' })
}
