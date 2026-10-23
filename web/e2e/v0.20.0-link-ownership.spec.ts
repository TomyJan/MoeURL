import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { BrowserContext } from '@playwright/test'
import type { AdminShortLink, ShortLink } from '../src/entities/short-link/model'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

test.use({ actionTimeout: 10_000, serviceWorkers: 'block' })
for (const width of [1280, 390]) {
  test(`ownership handoff preserves the public address and history at ${width}px`, async ({ page, browser }, info) => {
    const suffix = randomBytes(8).toString('hex')
    const password = 'ownership-scenario-password'
    const users: Array<{ id: string; username: string }> = []
    const contexts: BrowserContext[] = []
    let link: ShortLink | undefined
    const errors: unknown[] = []
    try {
      expect(await (await page.request.post('/api/v1/auth/login', { data: { username: e2eAdminUsername, password: e2eAdminPassword } })).json()).toMatchObject({ code: 0 })
      for (const role of ['original', 'recipient']) {
        const username = `${role}-${suffix}`
        const account = await (await page.request.post('/api/v1/admin/user/create', { data: { username, password, nickname: role, groupKey: 'user', status: 'active' } })).json()
        expect(account.code).toBe(0)
        users.push(account.data.user)
        const context = await browser.newContext({ baseURL: info.project.use.baseURL, locale: 'zh-CN', serviceWorkers: 'block' })
        contexts.push(context)
        expect(await (await context.request.post('/api/v1/auth/login', { data: { username, password } })).json()).toMatchObject({ code: 0 })
      }
      const original = contexts[0]!, recipient = contexts[1]!
      const created = await (await original.request.post('/api/v1/short-link/create', { data: { targetUrl: `https://example.com/${suffix}`, metadata: { title: `Handoff ${suffix}`, tags: [suffix] } } })).json()
      expect(created.code).toBe(0); link = created.data.shortLink
      expect((await original.request.get(link!.url, { maxRedirects: 0 })).status()).toBe(302)
      await expect.poll(async () => (await (await original.request.get(`/api/v1/short-link/statistics?id=${link!.id}`)).json()).data.stats.visitCount).toBe(1)
      await page.setViewportSize({ width, height: width === 1280 ? 800 : 844 })
      await page.goto('/admin/link')
      const row = page.getByTestId('console-link-row').filter({ hasText: link!.slug })
      await row.getByRole('button', { name: '更多操作', exact: true }).click()
      await page.getByRole('menuitem', { name: '转移归属', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toContainText(users[0]!.username)
      await expect(dialog.getByRole('button', { name: '确认转移', exact: true })).toBeDisabled()
      await dialog.getByRole('textbox', { name: '接收账号的准确用户名', exact: true }).fill(users[1]!.username)
      await dialog.getByRole('checkbox', { name: '我已核对接收账号，并确认移交管理权及历史统计', exact: true }).check()
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: info.outputPath(`transfer-${width}.png`), fullPage: true })
      const transferred = page.waitForResponse('**/api/v1/admin/short-link/transfer')
      await dialog.getByRole('button', { name: '确认转移', exact: true }).click()
      expect(await (await transferred).json()).toMatchObject({ code: 0, data: { id: link!.id, ownerId: users[1]!.id } })
      await expect(dialog).toHaveCount(0)
      await expect(row).toContainText(users[1]!.username)
      const oldList = await (await original.request.get('/api/v1/short-link/list')).json()
      expect(oldList.code).toBe(0); expect(oldList.data.items).toHaveLength(0)
      const received = await (await recipient.request.get('/api/v1/short-link/list')).json()
      expect(received.code).toBe(0)
      expect(received.data.items).toEqual([expect.objectContaining({ id: link!.id, url: link!.url, title: `Handoff ${suffix}` })])
      expect(await (await original.request.get(`/api/v1/short-link/statistics?id=${link!.id}`)).json()).toMatchObject({ code: 200104 })
      expect(await (await original.request.post('/api/v1/short-link/update', { data: { id: link!.id, status: 'disabled' } })).json()).toMatchObject({ code: 200104 })
      expect(await (await recipient.request.get(`/api/v1/short-link/statistics?id=${link!.id}`)).json()).toMatchObject({ code: 0, data: { stats: { visitCount: 1 } } })
      expect((await recipient.request.get(link!.url, { maxRedirects: 0 })).headers().location).toBe(link!.targetUrl)
      const list = await (await page.request.get(`/api/v1/admin/short-link/list?q=${suffix}`)).json()
      const latest = list.data.items.find((item: AdminShortLink) => item.id === link!.id)
      expect(latest.owner.id).toBe(users[1]!.id)
      const audit = await (await page.request.get('/api/v1/admin/audit/list?resourceType=short_link&action=update')).json()
      expect(audit.code).toBe(0)
      expect(audit.data.items.some((item: { resourceId: string; changedFields: string[] }) => item.resourceId === link!.id && item.changedFields.includes('owner_id'))).toBe(true)
      if (width === 390) await page.getByRole('button', { name: '打开控制台菜单', exact: true }).click()
      await page.getByRole('button', { name: '选择语言', exact: true }).filter({ visible: true }).first().click()
      await page.getByRole('menuitemradio', { name: 'English', exact: true }).click()
      if (width === 390) await page.getByRole('button', { name: 'Close menu', exact: true }).click()
      await row.getByRole('button', { name: 'More actions', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Transfer ownership', exact: true }).click()
      await expect(dialog).toContainText(`Current owner: ${users[1]!.username}`)
      await dialog.getByRole('textbox', { name: 'Exact recipient username', exact: true }).fill(users[0]!.username)
      await dialog.getByRole('checkbox', { name: 'I verified the recipient and approve transferring management and historical statistics', exact: true }).check()
      await expectNoHorizontalOverflow(page)
      await page.screenshot({ path: info.outputPath(`transfer-${width}-en.png`), fullPage: true })
      await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
      await expect(dialog).toHaveCount(0)
    } catch (error) { errors.push(error) }
    finally {
      if (link) { try { expect(await (await page.request.post('/api/v1/admin/short-link/delete', { data: { id: link.id }, timeout: 5000 })).json()).toMatchObject({ code: 0 }) } catch (error) { errors.push(error) } }
      for (const user of users) {
        try { expect(await (await page.request.post('/api/v1/admin/user/update', { data: { id: user.id, nickname: 'Transfer fixture', status: 'disabled' }, timeout: 5000 })).json()).toMatchObject({ code: 0 }) } catch (error) { errors.push(error) }
      }
      for (const context of contexts) { try { await context.close() } catch (error) { errors.push(error) } }
    }
    if (errors.length) throw new AggregateError(errors, 'Ownership scenario or fixture cleanup failed')
  })
}
