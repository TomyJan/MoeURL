import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

test.use({ actionTimeout: 10_000, serviceWorkers: 'block' })

for (const width of [1280, 390]) {
  test(`managed group change revokes sessions and preserves permission boundaries at ${width}px`, async ({ page, browser }, info) => {
    const username = `group-${randomBytes(8).toString('hex')}`
    const password = 'group-change-password'
    const baseURL = info.project.use.baseURL
    const context = await browser.newContext({ baseURL, locale: 'zh-CN', serviceWorkers: 'block' })
    let id: string | undefined
    const errors: unknown[] = []
    try {
      expect(await (await page.request.post('/api/v1/auth/login', { data: { username: e2eAdminUsername, password: e2eAdminPassword } })).json()).toMatchObject({ code: 0 })
      const created = await (await page.request.post('/api/v1/admin/user/create', { data: { username, password, nickname: 'Group fixture', groupKey: 'user', status: 'active' } })).json()
      expect(created.code).toBe(0); id = created.data.user.id
      expect(await (await context.request.post(`${baseURL}/api/v1/auth/login`, { data: { username, password } })).json()).toMatchObject({ code: 0, data: { user: { group: 'user' } } })
      await page.setViewportSize({ width, height: width === 1280 ? 720 : 800 })
      await page.goto('/admin/user')
      const row = page.getByTestId('console-user-row').filter({ hasText: username })
      await row.getByRole('button', { name: '更多操作', exact: true }).click()
      await page.getByRole('button', { name: '调整用户组', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toContainText(username)
      await expect(dialog.getByRole('button', { name: '确认调整', exact: true })).toBeDisabled()
      await dialog.getByRole('combobox', { name: '目标用户组', exact: true }).press('Enter')
      await page.getByRole('option', { name: '管理员', exact: true }).click()
      await dialog.getByRole('checkbox', { name: '我确认调整权限并撤销所有旧登录会话', exact: true }).check()
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: info.outputPath(`membership-${width}-zh.png`), fullPage: true })
      const changed = page.waitForResponse('**/api/v1/admin/user/change-group')
      await dialog.getByRole('button', { name: '确认调整', exact: true }).click()
      expect(await (await changed).json()).toMatchObject({ code: 0, data: { user: { group: 'admin' } } })
      await expect(dialog).toHaveCount(0)
      expect(await (await context.request.get(`${baseURL}/api/v1/auth/me`)).json()).toMatchObject({ code: 0, data: { user: { group: 'guest' } } })
      expect(await (await context.request.post(`${baseURL}/api/v1/auth/login`, { data: { username, password } })).json()).toMatchObject({ code: 0, data: { user: { group: 'admin' } } })
      expect(await (await context.request.get(`${baseURL}/api/v1/admin/dashboard`)).json()).toMatchObject({ code: 0 })
      if (width === 390) await page.getByRole('button', { name: '打开控制台菜单', exact: true }).click()
      await page.getByRole('button', { name: '选择语言', exact: true }).filter({ visible: true }).first().click()
      await page.getByRole('menuitemradio', { name: 'English', exact: true }).click()
      if (width === 390) await page.getByRole('button', { name: 'Close menu', exact: true }).click()
      await page.getByRole('button', { name: 'Change user group', exact: true }).click()
      await dialog.getByRole('combobox', { name: 'Target group', exact: true }).press('Enter')
      await page.getByRole('option', { name: 'User', exact: true }).click()
      await dialog.getByRole('checkbox', { name: 'I confirm the permission change and revocation of all existing sessions', exact: true }).check()
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: info.outputPath(`membership-${width}-en.png`), fullPage: true })
      const demoted = page.waitForResponse('**/api/v1/admin/user/change-group')
      await dialog.getByRole('button', { name: 'Confirm change', exact: true }).click()
      expect(await (await demoted).json()).toMatchObject({ code: 0, data: { user: { group: 'user' } } })
      expect(await (await context.request.get(`${baseURL}/api/v1/auth/me`)).json()).toMatchObject({ code: 0, data: { user: { group: 'guest' } } })
      expect(await (await context.request.post(`${baseURL}/api/v1/auth/login`, { data: { username, password } })).json()).toMatchObject({ code: 0, data: { user: { group: 'user' } } })
      expect(await (await context.request.get(`${baseURL}/api/v1/admin/dashboard`)).json()).toMatchObject({ code: 120001 })
      const audit = await (await page.request.get(`/api/v1/admin/audit/list?resourceType=user&action=update`)).json()
      expect(audit.code).toBe(0)
      expect(audit.data.items.filter((item: { resourceId: string; changedFields: string[] }) => item.resourceId === id && item.changedFields.includes('group_id'))).toHaveLength(2)
    } catch (error) { errors.push(error) }
    finally {
      if (id) {
        try { expect(await (await page.request.post('/api/v1/admin/user/update', { data: { id, nickname: 'Group fixture', status: 'disabled' }, timeout: 5_000 })).json()).toMatchObject({ code: 0 }) } catch (error) { errors.push(error) }
      }
      try { await context.close() } catch (error) { errors.push(error) }
    }
    if (errors.length) throw new AggregateError(errors, 'Membership scenario or fixture cleanup failed')
  })
}
