import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Page, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

const batchPath = '/api/v1/admin/user/batch-change-group'
const openName = /^(Change selected groups|批量调整用户组)$/
const saveName = /^(Save group changes|保存用户组调整)$/
const confirmName = /^(I confirm the group changes|我确认这些用户组调整)$/
const groupLabel = /^(Target group|目标用户组)$/
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const width of [1280, 390]) {
  test(`v0.93 batch membership supports custom source and target groups at ${width}px`, async ({ browser, page }, info) => {
    info.setTimeout(240_000)
    const suffix = randomBytes(6).toString('hex')
    const password = 'custom-batch-' + suffix + '-password'
    const locale = width === 1280 ? 'en' : 'zh-CN'
    const viewport = { width, height: width === 1280 ? 800 : 844 }
    const text = locale === 'en'
      ? { username: 'Username', password: 'Password', signIn: 'Sign in', counts: '2 will change; 0 will remain unchanged.', rejected: 'The batch was not applied. Read the latest list and confirm again.' }
      : { username: '账号', password: '密码', signIn: '登录', counts: '将调整 2 个，保持不变 0 个。', rejected: '整批未应用。请读取最新列表并重新确认。' }
    const contexts: BrowserContext[] = []
    const createdUsers: Array<{ id: string; username: string }> = []
    const createdGroups: Array<{ key: string; name: string }> = []
    const cleanupErrors: unknown[] = []
    const batchWrites: unknown[] = []
    let scenarioError: unknown
    const root = await browser.newContext({ baseURL: info.project.use.baseURL, serviceWorkers: 'block' })
    contexts.push(root)
    try {
      await post(root.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      const sourceName = `Source ${suffix}`
      const targetName = `Target ${suffix}`
      const deletedTargetName = `Deleted ${suffix}`
      const source = await post<{ group: UserGroup }>(root.request, '/admin/user-group/create', { name: sourceName, description: 'v0.93 batch E2E source' })
      const target = await post<{ group: UserGroup }>(root.request, '/admin/user-group/create', { name: targetName, description: 'v0.93 batch E2E target' })
      const deletedTarget = await post<{ group: UserGroup }>(root.request, '/admin/user-group/create', { name: deletedTargetName, description: 'v0.93 deleted target E2E' })
      createdGroups.push({ key: source.group.key, name: source.group.name }, { key: target.group.key, name: target.group.name }, { key: deletedTarget.group.key, name: deletedTarget.group.name })

      const alice = await createUser(root.request, `batch-source-${suffix}`, source.group.key, password)
      const bob = await createUser(root.request, `batch-user-${suffix}`, 'user', password)
      const charlie = await createUser(root.request, `batch-reject-${suffix}`, source.group.key, password)
      const nextAdmin = await createUser(root.request, `batch-admin-${suffix}`, 'admin', password)
      createdUsers.push(alice, bob, charlie, nextAdmin)

      await page.setViewportSize(viewport)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.addInitScript(language => localStorage.setItem('moeurl.language', language), locale)
      page.on('request', request => {
        if (new URL(request.url()).pathname === batchPath && request.method() === 'POST') batchWrites.push(request.postDataJSON())
      })
      await post(page.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      await page.goto('/admin/user')
      await expect(page.getByTestId('console-page-admin-users')).toBeVisible()
      await expectNoHorizontalOverflow(page)

      const before = await users(page.request)
      const aliceRow = page.getByTestId('console-user-row').filter({ hasText: alice.username })
      await expect(aliceRow.locator('td').nth(2)).toHaveText(sourceName)
      await selectAccount(page, alice.username).check()
      await selectAccount(page, bob.username).check()
      await page.getByRole('button', { name: openName }).click()
      let dialog = page.getByRole('dialog')
      const aliceSummary = dialog.getByRole('listitem').filter({ hasText: alice.username })
      const bobSummary = dialog.getByRole('listitem').filter({ hasText: bob.username })
      await expect(aliceSummary.locator('span')).toHaveText(sourceName)
      await expect(bobSummary.locator('span')).toHaveText('User')
      const groupSelect = dialog.getByRole('combobox', { name: groupLabel })
      await groupSelect.press('Enter')
      await page.getByRole('option', { name: targetName, exact: true }).click()
      await expect(groupSelect).toHaveValue(targetName)
      await expect(dialog.getByRole('button', { name: saveName })).toBeDisabled()
      await dialog.getByRole('checkbox', { name: confirmName }).check()
      await expect(dialog).toContainText(text.counts)
      await expectNoHorizontalOverflow(page)

      const successRequest = page.waitForResponse(response => new URL(response.url()).pathname === batchPath && response.request().method() === 'POST')
      await dialog.getByRole('button', { name: saveName }).click()
      const successResponse = await successRequest
      expect(successResponse.headers()['cache-control']).toBe('no-store')
      expect(successResponse.request().postDataJSON()).toEqual({
        items: before.filter(item => [alice.id, bob.id].includes(item.id)).map(({ id, updatedAt }) => ({ id, expectedUpdatedAt: updatedAt })),
        groupKey: target.group.key,
      })
      expect(await successResponse.json()).toMatchObject({ code: 0, data: { changedCount: 2, unchangedCount: 0 } })
      await expect(dialog).toHaveCount(0)
      await expect(aliceRow.locator('td').nth(2)).toHaveText(targetName)
      await expectNoHorizontalOverflow(page)
      await attachScreenshot(page, info, `custom-batch-success-${width}-${locale}`)

      // A frozen empty target is deleted by the real admin API after confirmation opens.
      await selectAccount(page, charlie.username).check()
      await page.getByRole('button', { name: openName }).click()
      dialog = page.getByRole('dialog')
      const deletedTargetSelect = dialog.getByRole('combobox', { name: groupLabel })
      await deletedTargetSelect.press('Enter')
      await page.getByRole('option', { name: deletedTargetName, exact: true }).click()
      await dialog.getByRole('checkbox', { name: confirmName }).check()
      await expect(deletedTargetSelect).toHaveValue(deletedTargetName)
      const groupList = await get<{ groups: UserGroup[] }>(root.request, '/admin/user-group/list')
      const latestDeletedTarget = groupList.groups.find(group => group.key === deletedTarget.group.key)
      expect(latestDeletedTarget).toBeDefined()
      if (!latestDeletedTarget) throw new Error('Deleted-target fixture disappeared before concurrent delete')
      await post(root.request, '/admin/user-group/delete', { groupKey: latestDeletedTarget.key, expectedUpdatedAt: latestDeletedTarget.updatedAt })
      const readback = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/admin/user-group/list' && response.request().method() === 'GET')
      const rejectedRequest = page.waitForResponse(response => new URL(response.url()).pathname === batchPath && response.request().method() === 'POST')
      await dialog.getByRole('button', { name: saveName }).click()
      const rejectedResponse = await rejectedRequest
      expect(await rejectedResponse.json()).toMatchObject({ code: 100001, data: null })
      await readback
      await expect(page.getByText(text.rejected)).toBeVisible()
      await expect(dialog).toHaveCount(0)
      expect(batchWrites).toHaveLength(2)
      await expect(page.getByTestId('console-user-row').filter({ hasText: charlie.username }).locator('td').nth(2)).toHaveText(sourceName)

      // Refreshed directory no longer offers the deleted name; no stale target write is replayed.
      await selectAccount(page, charlie.username).check()
      await page.getByRole('button', { name: openName }).click()
      dialog = page.getByRole('dialog')
      await dialog.getByRole('combobox', { name: groupLabel }).press('Enter')
      await expect(page.getByRole('option', { name: deletedTargetName, exact: true })).toHaveCount(0)
      await expect(page.getByRole('option', { name: targetName, exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      await dialog.getByRole('button', { name: /^(Cancel|取消)$/ }).click()

      // A real logout/login epoch switch while the frozen dialog is mounted must discard that batch.
      await selectAccount(page, charlie.username).check()
      await page.getByRole('button', { name: openName }).click()
      await expect(page.getByRole('dialog')).toBeVisible()
      const signedOut = await page.request.post('/api/v1/auth/logout')
      expect(signedOut.status()).toBe(200)
      expect((await signedOut.json()).code).toBe(0)
      await page.goto('/login')
      await expect(page).toHaveURL(url => url.pathname === '/login')
      await page.getByLabel(text.username, { exact: true }).fill(nextAdmin.username)
      await page.getByLabel(text.password, { exact: true }).fill(password)
      const signedIn = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/login')
      await page.getByRole('button', { name: new RegExp(`^${locale === 'en' ? 'Sign in' : '登录'}$`) }).click()
      expect((await (await signedIn).json()).data.user.username).toBe(nextAdmin.username)
      await page.goto('/admin/user')
      await expect(page.getByTestId('console-user-row').filter({ hasText: charlie.username })).toBeVisible()
      await expect(page.getByText(/^(\d+ accounts selected|已选择 \d+ 个账号)$/)).toHaveCount(0)
      await expect(page.getByRole('button', { name: openName })).toBeDisabled()
      await expectNoHorizontalOverflow(page)
    } catch (error) {
      scenarioError = error
      try { await attachScreenshot(page, info, `custom-batch-failure-${width}-${locale}`) } catch (captureError) { cleanupErrors.push(captureError) }
    } finally {
      try {
        const currentUsers = await users(root.request)
        for (const created of createdUsers) {
          const current = currentUsers.find(user => user.id === created.id)
          if (!current) continue
          if (current.group !== 'user') {
            await post(root.request, '/admin/user/change-group', { id: current.id, groupKey: 'user', expectedUpdatedAt: current.updatedAt })
          }
          await post(root.request, '/admin/user/update', { id: current.id, nickname: 'v0.93 batch fixture', status: 'disabled' })
        }
      } catch (error) { cleanupErrors.push(error) }
      for (const created of createdGroups) {
        try {
          const current = await get<{ groups: UserGroup[] }>(root.request, '/admin/user-group/list')
          const group = current.groups.find(item => item.key === created.key)
          if (group) await post(root.request, '/admin/user-group/delete', { groupKey: group.key, expectedUpdatedAt: group.updatedAt })
        } catch (error) { cleanupErrors.push(error) }
      }
      for (const context of contexts) {
        try { await context.close() } catch (error) { cleanupErrors.push(error) }
      }
      await info.attach(`owned-fixtures-${width}`, {
        body: JSON.stringify({ users: createdUsers.map(user => user.id), groups: createdGroups.map(group => group.key), cleanupErrors: cleanupErrors.map(String) }),
        contentType: 'application/json',
      })
    }
    if (scenarioError || cleanupErrors.length) {
      throw new AggregateError([...(scenarioError ? [scenarioError] : []), ...cleanupErrors], 'v0.93 browser scenario or owned fixture cleanup failed')
    }
  })
}

interface UserGroup { key: string; name: string; updatedAt: string; memberCount: number }
interface BatchUser { id: string; username: string; group: string; updatedAt: string; builtin: boolean }

async function createUser(request: APIRequestContext, username: string, groupKey: string, password: string) {
  const result = await post<{ user: { id: string; username: string } }>(request, '/admin/user/create', { username, password, nickname: username, groupKey, status: 'active' })
  return result.user
}

function selectAccount(page: Page, username: string) {
  return page.getByRole('checkbox', { name: new RegExp('^(选择账号 |Select account )' + escapeRegExp(username) + '$') })
}

async function users(request: APIRequestContext) {
  return (await get<{ items: BatchUser[] }>(request, '/admin/user/list?page=1&pageSize=100')).items
}

async function rawPost<T = unknown>(request: APIRequestContext, path: string, data: unknown) {
  const response = await request.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200)
  return await response.json() as { code: number; data: T }
}

async function post<T = unknown>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const result = await rawPost<T>(request, path, data)
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

function escapeRegExp(value: string) { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') }

async function attachScreenshot(page: Page, info: TestInfo, name: string) {
  await info.attach(name, { body: await page.screenshot({ fullPage: true, animations: 'disabled' }), contentType: 'image/png' })
}
