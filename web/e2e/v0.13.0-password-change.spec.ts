import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'

import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

test.use({ serviceWorkers: 'block' })

for (const width of [1280, 390]) {
  test(`changes the original password and revokes every old session at ${width}px`, async ({ browser, page: admin }, testInfo) => {
    const baseURL = testInfo.project.use.baseURL
    if (typeof baseURL !== 'string') throw new Error('Password-change E2E requires a baseURL')
    const username = `password-${randomBytes(6).toString('hex')}`
    const currentPassword = ' old <&密码> " '
    const newPassword = ' new <&密码> "  '
    const contexts: BrowserContext[] = []
    const cleanupErrors: unknown[] = []
    let userID: string | undefined
    let scenarioFailed = false
    let scenarioError: unknown
    try {
      expect(await (await admin.request.post('/api/v1/auth/login', {
        data: { username: e2eAdminUsername, password: e2eAdminPassword },
      })).json()).toMatchObject({ code: 0 })
      const created = await admin.request.post('/api/v1/admin/user/create', {
        data: { username, password: currentPassword, nickname: 'Password test', groupKey: 'user', status: 'active' },
      })
      const user = await created.json() as { code: number; data: { user: { id: string } } }
      expect(user.code).toBe(0)
      userID = user.data.user.id

      for (let device = 0; device < 2; device++) {
        const context = await browser.newContext({ baseURL, locale: 'zh-CN', viewport: { width, height: 800 }, serviceWorkers: 'block' })
        contexts.push(context)
        expect(await (await context.request.post('/api/v1/auth/login', {
          data: { username, password: currentPassword },
        })).json()).toMatchObject({ code: 0 })
      }
      const editor = await contexts[0]!.newPage()
      await editor.goto('/profile')
      const current = editor.getByLabel('当前密码', { exact: true })
      const next = editor.getByLabel('新密码', { exact: true })
      const confirmation = editor.getByLabel('确认新密码', { exact: true })
      const save = editor.getByRole('button', { name: '修改密码并退出登录', exact: true })
      await expect(current).toBeVisible()
      await expectNoHorizontalOverflow(editor)

      await fillPasswords(editor, currentPassword, newPassword, 'different-password')
      await save.click()
      // A confirmation error stays local; it must not mutate credentials or consume the session.
      await expect(editor.getByText('两次输入的新密码不一致。', { exact: true })).toBeVisible()
      const unchanged = await contexts[0]!.request.get('/api/v1/auth/password/status')
      expect(await unchanged.json()).toMatchObject({ code: 0, data: { canChangePassword: true } })

      await fillPasswords(editor, 'wrong-password', newPassword, newPassword)
      let changed = editor.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/auth/password/change')
      await save.click()
      expect(await (await changed).json()).toMatchObject({ code: 110101 })
      await expect(current).toHaveValue('')
      await expect(next).toHaveValue('')
      await expect(confirmation).toHaveValue('')
      await expect(editor.locator('[data-sonner-toast]').filter({ hasText: '当前密码' })).toBeVisible()

      await fillPasswords(editor, currentPassword, newPassword, newPassword)
      await testInfo.attach(`password-change-${width}px`, { body: await editor.screenshot({ fullPage: true }), contentType: 'image/png' })
      changed = editor.waitForResponse((response) => new URL(response.url()).pathname === '/api/v1/auth/password/change')
      await save.click()
      const response = await changed
      expect(response.request().postDataJSON()).toEqual({ currentPassword, newPassword })
      expect(response.headers()['cache-control']).toBe('no-store')
      expect(await response.json()).toMatchObject({ code: 0, data: { changed: true } })
      await expect(editor).toHaveURL(/\/login\?redirect=(?:%2F|\/)profile$/)
      await expect(editor.locator('[data-sonner-toast]').filter({ hasText: /所有设备/ })).toBeVisible()

      const revoked = await contexts[1]!.request.get('/api/v1/auth/password/status')
      expect(revoked.status()).toBe(401)
      expect(await revoked.json()).toMatchObject({ code: 110101 })
      expect((await contexts[0]!.cookies()).filter(({ name }) => name === 'moeurl_session')).toEqual([])
      expect(await (await contexts[1]!.request.post('/api/v1/auth/login', {
        data: { username, password: currentPassword },
      })).json()).toMatchObject({ code: 110101 })

      // The real login form must preserve the same spaces, quotes, and Unicode too.
      await editor.getByLabel('账号', { exact: true }).fill(username)
      await editor.getByLabel('密码', { exact: true }).fill(newPassword)
      await editor.getByRole('button', { name: '登录', exact: true }).click()
      await expect(editor).toHaveURL(/\/profile$/)
      await expect(current).toBeVisible()
      await expectNoHorizontalOverflow(editor)
      expect(await (await contexts[0]!.request.get('/api/v1/auth/me')).json()).toMatchObject({ code: 0, data: { user: { username } } })
      expect(await (await admin.request.get('/api/v1/auth/me')).json()).toMatchObject({ code: 0, data: { user: { username: e2eAdminUsername } } })
    } catch (error) {
      scenarioFailed = true
      scenarioError = error
    } finally {
      // Managed users have no delete API; disable the fixture before the isolated suite environment is discarded.
      if (userID) {
        try {
          expect(await (await admin.request.post('/api/v1/admin/user/update', {
            data: { id: userID, nickname: 'Password test', status: 'disabled' },
          })).json()).toMatchObject({ code: 0 })
        } catch (error) {
          cleanupErrors.push(error)
        }
      }
      for (const context of contexts) {
        try {
          await context.close()
        } catch (error) {
          cleanupErrors.push(error)
        }
      }
    }
    if (scenarioFailed) {
      if (cleanupErrors.length) throw new AggregateError([scenarioError, ...cleanupErrors], 'Password-change scenario and cleanup failed')
      throw scenarioError
    }
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Password-change cleanup failed')
  })
}

/** Fills the three local fields without normalizing any password value. */
async function fillPasswords(page: Page, current: string, next: string, confirmation: string) {
  await page.getByLabel('当前密码', { exact: true }).fill(current)
  await page.getByLabel('新密码', { exact: true }).fill(next)
  await page.getByLabel('确认新密码', { exact: true }).fill(confirmation)
}
