import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, e2ePort, expectNoHorizontalOverflow } from './support'

interface UserGroup {
  key: string
  name: string
  updatedAt: string
  memberCount: number
}

interface ManagedDomain {
  id: string
  host: string
  displayName: string
  updatedAt: string
}

async function post<T>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await request.post(`/api/v1${path}`, { data })
  expect(response.status()).toBe(200)
  const payload = await response.json() as { code: number; data: T }
  expect(payload.code).toBe(0)
  return payload.data
}

async function get<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get(`/api/v1${path}`)
  expect(response.status()).toBe(200)
  const payload = await response.json() as { code: number; data: T }
  expect(payload.code).toBe(0)
  return payload.data
}

test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const width of [1280, 390]) {
  test(`v0.92 custom groups authorize real members and preserve deletion safety at ${width}px`, async ({ browser, page }, info) => {
    info.setTimeout(180_000)
    const suffix = randomBytes(6).toString('hex')
    const originalName = `Ops ${suffix}`
    const groupName = `Operations ${suffix}`
    const username = `ops-${suffix}`
    const password = `custom-group-${suffix}-password`
    const viewport = { width, height: width === 1280 ? 800 : 844 }
    await page.setViewportSize(viewport)

    const adminLogin = await post<{ user: { group: string } }>(page.request, '/auth/login', {
      username: e2eAdminUsername,
      password: e2eAdminPassword,
    })
    expect(adminLogin.user.group).toBe('admin')

    await page.goto('/admin/user/group')
    await expect(page.getByTestId('console-page-user-groups')).toBeVisible()
    await page.getByRole('button', { name: '创建自定义组', exact: true }).click()
    const createDialog = page.getByRole('dialog')
    await createDialog.getByRole('textbox', { name: '组名称', exact: true }).fill(originalName)
    await createDialog.getByRole('textbox', { name: '描述', exact: true }).fill('Real database acceptance')
    const createGroupResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/admin/user-group/create' && response.request().method() === 'POST',
    )
    await createDialog.getByRole('button', { name: '创建', exact: true }).click()
    const createdGroupResponse = await createGroupResponse
    expect(createdGroupResponse.ok()).toBe(true)
    const createdGroupPayload = await createdGroupResponse.json() as { code: number; data: { group: UserGroup } }
    expect(createdGroupPayload.code).toBe(0)
    const groupKey = createdGroupPayload.data.group.key
    expect(groupKey).not.toBe(originalName)
    await expect(page.getByRole('tab', { name: originalName, exact: true })).toBeVisible()

    await page.getByRole('button', { name: '编辑组信息', exact: true }).click()
    const editDialog = page.getByRole('dialog')
    await editDialog.getByRole('textbox', { name: '组名称', exact: true }).fill(groupName)
    const updateGroupResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/admin/user-group/update' && response.request().method() === 'POST',
    )
    await editDialog.getByRole('button', { name: '保存信息', exact: true }).click()
    expect((await updateGroupResponse).ok()).toBe(true)
    await expect(page.getByRole('tab', { name: groupName, exact: true })).toBeVisible()
    await expectNoHorizontalOverflow(page)

    let groups = await get<{ groups: UserGroup[] }>(page.request, '/admin/user-group/list')
    let group = groups.groups.find(({ key }) => key === groupKey)
    expect(group).toBeDefined()
    if (!group) throw new Error('Created custom group disappeared before permission setup')
    await post(page.request, '/admin/user-group/update-custom-permissions', {
      groupKey,
      permissions: ['short_link:create', 'domain:use_default', 'domain:use_assigned'],
      expectedUpdatedAt: group.updatedAt,
    })

    const domain = await post<{ domain: ManagedDomain }>(page.request, '/admin/domain/create', {
      host: `https://custom-${suffix}.example`,
      displayName: `Custom ${suffix}`,
      enabled: true,
      allowedGroups: ['admin', groupKey],
    })
    groups = await get<{ groups: UserGroup[] }>(page.request, '/admin/user-group/list')
    group = groups.groups.find(({ key }) => key === groupKey)
    expect(group).toBeDefined()
    if (!group) throw new Error('Created custom group disappeared before default-domain setup')
    await post(page.request, '/admin/user-group/set-domain-default', {
      groupKey,
      domainId: domain.domain.id,
      expectedUpdatedAt: group.updatedAt,
    })

    await page.reload()
    await page.getByRole('tab', { name: groupName, exact: true }).click()
    await expect(page.getByRole('checkbox', { name: '创建短链', exact: true })).toBeChecked()
    await expectNoHorizontalOverflow(page)

    await page.goto('/admin/user/new')
    await expect(page.getByTestId('console-page-create-user')).toBeVisible()
    await page.getByLabel('账号', { exact: true }).fill(username)
    await page.getByLabel('密码', { exact: true }).fill(password)
    await page.getByLabel('昵称', { exact: true }).fill(`Operator ${suffix}`)
    await page.getByRole('combobox', { name: '用户组', exact: true }).press('Enter')
    await page.getByRole('option', { name: groupName, exact: true }).click()
    const createUserResponse = page.waitForResponse((response) =>
      new URL(response.url()).pathname === '/api/v1/admin/user/create' && response.request().method() === 'POST',
    )
    await page.getByRole('button', { name: '创建用户', exact: true }).click()
    const createdUserResponse = await createUserResponse
    expect(createdUserResponse.ok()).toBe(true)
    const createdUserPayload = await createdUserResponse.json() as { code: number; data: { user: { id: string; group: string } } }
    expect(createdUserPayload).toMatchObject({ code: 0, data: { user: { group: groupKey } } })
    const userId = createdUserPayload.data.user.id

    const memberContext = await browser.newContext({
      baseURL: `http://127.0.0.1:${e2ePort}`,
      locale: 'zh-CN',
      serviceWorkers: 'block',
      viewport,
    })
    try {
      await post<{ user: { group: string } }>(memberContext.request, '/auth/login', { username, password })
      const member = await get<{ user: { group: string } }>(memberContext.request, '/auth/me')
      expect(member.user.group).toBe(groupKey)
      const available = await get<{ items: Array<{ id: string }> }>(memberContext.request, '/domain/available')
      expect(available.items.map(({ id }) => id)).toContain(domain.domain.id)
      const createdLink = await post<{ shortLink: { url: string } }>(memberContext.request, '/short-link/create', {
        targetUrl: `https://example.com/custom-group-${suffix}`,
        domainId: domain.domain.id,
      })
      expect(createdLink.shortLink.url).toContain(domain.domain.host)

      await page.goto('/admin/user/group')
      await page.getByRole('tab', { name: groupName, exact: true }).click()
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: info.outputPath(`custom-user-group-members-${width}-zh.png`), fullPage: true })
      await page.getByRole('button', { name: '删除组', exact: true }).click()
      await expect(page.getByText(/该组仍有 1 名成员/)).toBeVisible()
      const confirmDelete = page.getByRole('button', { name: '确认删除', exact: true })
      await expect(confirmDelete).toBeDisabled()
      await expectNoHorizontalOverflow(page)

      const users = await get<{ items: Array<{ id: string; username: string; updatedAt: string }> }>(page.request, '/admin/user/list?page=1&pageSize=100')
      const user = users.items.find((item) => item.id === userId && item.username === username)
      expect(user).toBeDefined()
      if (!user) throw new Error('Created custom-group member disappeared before migration')
      await post(page.request, '/admin/user/change-group', { id: userId, groupKey: 'user', expectedUpdatedAt: user.updatedAt })
      expect(await (await memberContext.request.get('/api/v1/auth/me')).json()).toMatchObject({ code: 0, data: { user: { group: 'guest' } } })

      await page.reload()
      await page.getByRole('tab', { name: groupName, exact: true }).click()
      await expect(page.getByRole('button', { name: '删除组', exact: true })).toBeVisible()
      await page.getByRole('button', { name: '删除组', exact: true }).click()
      const deleteGroupResponse = page.waitForResponse((response) =>
        new URL(response.url()).pathname === '/api/v1/admin/user-group/delete' && response.request().method() === 'POST',
      )
      await page.getByRole('button', { name: '确认删除', exact: true }).click()
      const deletedGroupResponse = await deleteGroupResponse
      expect(await deletedGroupResponse.json()).toMatchObject({ code: 0 })
      await expect(page.getByRole('tab', { name: groupName, exact: true })).toHaveCount(0)
    } finally {
      await memberContext.close()
    }
  })
}
