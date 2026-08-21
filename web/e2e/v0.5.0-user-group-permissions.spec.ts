import { expect, test as base } from '@playwright/test'
import type { BrowserContext, Locator, Page } from '@playwright/test'

import {
  attachScreenshot,
  e2eAdminPassword,
  e2eAdminUsername,
  expectNoHorizontalOverflow,
} from './support'

const memberUsername = 'permissione2e'
const memberPassword = 'permission-e2e-password'
const intermediatePermission = 'short_link:use_intermediate'

type UserGroup = {
  key: 'guest' | 'user' | 'admin'
  permissions: string[]
  updatedAt: string
}

type PermissionPreset = {
  key: 'restricted' | 'basic' | 'standard'
  permissions: string[]
}

type UserGroupCatalog = {
  groups: UserGroup[]
  permissions: Array<{ key: string }>
  presets: PermissionPreset[]
}

type CurrentUser = {
  permissions: string[]
  username: string
}

type PermissionFixtures = {
  memberContext: BrowserContext
}

const test = base.extend<PermissionFixtures>({
  memberContext: [async ({ browser, page }, use, testInfo) => {
    await restoreUserStandard(page)
    const baseURL = testInfo.project.use.baseURL
    if (typeof baseURL !== 'string') {
      throw new TypeError('Playwright baseURL is required for the permission E2E context')
    }
    const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 720 } })
    try {
      await use(context)
    } finally {
      try {
        await restoreUserStandard(page)
      } finally {
        await context.close()
      }
    }
  }, { timeout: 30_000 }],
})

test.describe.configure({ mode: 'serial' })

test('v0.5.0 built-in user-group permissions apply to subsequent requests', async ({ memberContext, page }, testInfo) => {
  testInfo.setTimeout(120_000)
  page.setDefaultTimeout(10_000)
  await ensureMember(page)

  await page.setViewportSize({ width: 1280, height: 720 })
  await page.goto('/admin/user/group')
  await expect(page.getByRole('heading', { name: '用户组与权限' })).toBeVisible()

  await test.step('guest remains fully read only', async () => {
    await selectGroup(page, 'Guest')
    const editor = page.getByTestId('user-group-permission-editor')
    await expect(editor.getByText('只读', { exact: true })).toBeVisible()
    await expect(editor.getByLabel('权限预设')).toBeDisabled()
    await expect(editor.getByRole('button', { name: '保存权限' })).toBeDisabled()

    const checkboxes = editor.getByRole('checkbox')
    const catalog = await readUserGroupCatalog(page)
    await expect(checkboxes).toHaveCount(catalog.permissions.length)
    for (const checkbox of await checkboxes.all()) {
      await expect(checkbox).toBeDisabled()
    }
  })

  const memberPage = await memberContext.newPage()
  memberPage.setDefaultTimeout(10_000)
  await login(memberPage, memberUsername, memberPassword)

  await test.step('basic remains a local draft until explicitly saved', async () => {
    await selectGroup(page, 'User')
    await applyPreset(page, '基础')
    await expect(page.getByRole('checkbox', { name: '使用中间页' })).not.toBeChecked()
    await expect(page.getByRole('button', { name: '保存权限' })).toBeEnabled()

    const beforeSaveIdentity = await readCurrentUser(memberPage)
    expect(beforeSaveIdentity.permissions).toContain(intermediatePermission)
    await memberPage.goto('/')
    await expect(memberPage.getByRole('button', { name: '高级设置' })).toBeVisible()
    expect(await createIntermediate(memberPage, 'before-save')).toBe(0)
  })

  await test.step('saving refreshes auth/me and revokes enhanced access for new requests', async () => {
    const updateResponsePromise = page.waitForResponse('**/api/v1/admin/user-group/update-permissions')
    const identityRefreshPromise = page.waitForResponse('**/api/v1/auth/me')
    await page.getByRole('button', { name: '保存权限' }).click()
    const [updateResponse, identityRefresh] = await Promise.all([updateResponsePromise, identityRefreshPromise])
    expect(updateResponse.ok()).toBe(true)
    expect(identityRefresh.ok()).toBe(true)
    expect((await updateResponse.json() as { code: number }).code).toBe(0)
    await expect(page.getByText('权限已保存并刷新当前身份。')).toBeVisible()

    const afterSaveIdentity = await readCurrentUser(memberPage)
    expect(afterSaveIdentity.permissions).not.toContain(intermediatePermission)
    const memberIdentityRefresh = memberPage.waitForResponse('**/api/v1/auth/me')
    await memberPage.reload()
    expect((await memberIdentityRefresh).ok()).toBe(true)
    await expect(memberPage.getByLabel('输入链接')).toBeEnabled()
    await expect(memberPage.getByRole('button', { name: '高级设置' })).toHaveCount(0)
    expect(await createIntermediate(memberPage, 'after-revocation')).toBe(120001)
  })

  await test.step('standard restores the user baseline through the administrator page', async () => {
    await applyPreset(page, '标准')
    const updateResponsePromise = page.waitForResponse('**/api/v1/admin/user-group/update-permissions')
    const identityRefreshPromise = page.waitForResponse('**/api/v1/auth/me')
    await page.getByRole('button', { name: '保存权限' }).click()
    const [updateResponse, identityRefresh] = await Promise.all([updateResponsePromise, identityRefreshPromise])
    expect(updateResponse.ok()).toBe(true)
    expect(identityRefresh.ok()).toBe(true)
    expect((await updateResponse.json() as { code: number }).code).toBe(0)
    await expect.poll(async () => (await readCurrentUser(memberPage)).permissions).toContain(intermediatePermission)
    expect(await createIntermediate(memberPage, 'after-restoration')).toBe(0)
  })

  await test.step('admin protected permissions remain visible and immutable', async () => {
    await selectGroup(page, 'Admin')
    for (const label of ['进入管理后台', '查看全部短链', '编辑全部短链', '删除全部短链']) {
      const checkbox = page.getByRole('checkbox', { name: label })
      await expect(checkbox).toBeChecked()
      await expect(checkbox).toBeDisabled()
    }
  })

  await test.step('desktop and mobile layouts preserve visible action order without overflow', async () => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await expectPermissionPageLayout(page)
    await attachScreenshot(testInfo, 'user-group-permissions-desktop', page)

    await page.setViewportSize({ width: 390, height: 800 })
    await expectPermissionPageLayout(page)
    await attachScreenshot(testInfo, 'user-group-permissions-mobile', page)
  })
})

/** Authenticates one isolated browser context through the real API. */
async function login(page: Page, username: string, password: string) {
  const response = await page.request.post('/api/v1/auth/login', { data: { username, password } })
  await expect(response).toBeOK()
  const payload = await response.json() as { code: number; data: { user: CurrentUser } }
  expect(payload.code).toBe(0)
  expect(payload.data.user.username).toBe(username)
}

/** Creates the stable E2E member while accepting an earlier identical setup. */
async function ensureMember(page: Page) {
  const response = await page.request.post('/api/v1/admin/user/create', {
    data: {
      groupKey: 'user',
      nickname: 'Permission E2E',
      password: memberPassword,
      status: 'active',
      username: memberUsername,
    },
  })
  await expect(response).toBeOK()
  const payload = await response.json() as { code: number }
  expect([0, 300101]).toContain(payload.code)
}

/** Reads current permissions from an uncached authenticated API request. */
async function readCurrentUser(page: Page): Promise<CurrentUser> {
  const response = await page.request.get('/api/v1/auth/me')
  await expect(response).toBeOK()
  const payload = await response.json() as { code: number; data: { user: CurrentUser } }
  expect(payload.code).toBe(0)
  return payload.data.user
}

/** Applies one visible preset without saving its local draft. */
async function applyPreset(page: Page, presetName: '基础' | '标准') {
  await page.getByTestId('user-group-preset').locator('.v-field').click()
  await page.getByRole('option', { name: presetName, exact: true }).click()
}

/** Selects one built-in group tab and waits for its summary to become active. */
async function selectGroup(page: Page, groupName: 'Guest' | 'User' | 'Admin') {
  await page.getByRole('tab', { name: groupName, exact: true }).click()
  await expect(page.getByTestId('user-group-summary').getByRole('heading', { name: groupName, exact: true })).toBeVisible()
}

/** Creates an intermediate link and returns the public business result code. */
async function createIntermediate(page: Page, suffix: string): Promise<number> {
  const response = await page.request.post('/api/v1/short-link/create', {
    data: {
      intermediateDelaySeconds: 3,
      redirectMode: 'intermediate',
      targetUrl: `https://example.com/permission-e2e-${suffix}`,
    },
  })
  await expect(response).toBeOK()
  return (await response.json() as { code: number }).code
}

/** Restores the standard user preset from the latest optimistic version and is safe to call repeatedly. */
async function restoreUserStandard(page: Page) {
  await login(page, e2eAdminUsername, e2eAdminPassword)
  const catalog = await readUserGroupCatalog(page)
  const userGroup = requiredItem(catalog.groups, ({ key }) => key === 'user', 'user group')
  const standard = requiredItem(catalog.presets, ({ key }) => key === 'standard', 'standard preset')
  if (samePermissions(userGroup.permissions, standard.permissions)) {
    return
  }
  const response = await page.request.post('/api/v1/admin/user-group/update-permissions', {
    data: {
      expectedUpdatedAt: userGroup.updatedAt,
      groupKey: 'user',
      permissions: standard.permissions,
    },
  })
  await expect(response).toBeOK()
  expect((await response.json() as { code: number }).code).toBe(0)
}

/** Loads the live user-group catalog for setup and cleanup. */
async function readUserGroupCatalog(page: Page): Promise<UserGroupCatalog> {
  const response = await page.request.get('/api/v1/admin/user-group/list')
  await expect(response).toBeOK()
  const payload = await response.json() as { code: number; data: UserGroupCatalog }
  expect(payload.code).toBe(0)
  return payload.data
}

/** Returns one required catalog item or fails with a useful setup error. */
function requiredItem<T>(items: T[], predicate: (item: T) => boolean, label: string): T {
  const item = items.find(predicate)
  if (!item) {
    throw new Error(`${label} is missing from the user-group catalog`)
  }
  return item
}

/** Compares permission sets without relying on server ordering. */
function samePermissions(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((permission) => right.includes(permission))
}

/** Verifies document containment, section order, and a usable action area at the current viewport. */
async function expectPermissionPageLayout(page: Page) {
  await expectNoHorizontalOverflow(page)
  const selectors = [
    '.user-groups-page__header',
    '.user-groups-page__tabs',
    '.permission-editor__summary',
    '.permission-editor__preset',
    '.permission-editor__permissions',
    '.permission-editor__actions',
  ]
  const sections = page.locator(selectors.join(','))
  await expect(sections).toHaveCount(selectors.length)
  const positions = await Promise.all(selectors.map(async (selector) => {
    const section = page.locator(selector)
    await expect(section).toBeVisible()
    return section.evaluate((element) => {
      const box = element.getBoundingClientRect()
      return { bottom: box.bottom + globalThis.scrollY, top: box.top + globalThis.scrollY }
    })
  }))
  for (let index = 0; index < positions.length - 1; index += 1) {
    expect(positions[index].bottom).toBeLessThanOrEqual(positions[index + 1].top + 1)
  }

  const actions = page.getByTestId('user-group-actions')
  await actions.scrollIntoViewIfNeeded()
  await expect(actions).toBeVisible()
  const save = actions.getByRole('button', { name: '保存权限' })
  await expect(save).toBeVisible()
  await expectLocatorWithinViewport(page, save)
}

/** Verifies one control remains horizontally contained by the active viewport. */
async function expectLocatorWithinViewport(page: Page, locator: Locator) {
  const [box, viewport] = await Promise.all([locator.boundingBox(), Promise.resolve(page.viewportSize())])
  expect(box).not.toBeNull()
  expect(viewport).not.toBeNull()
  if (!box || !viewport) {
    return
  }
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
}
