import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, Locator } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

const labels = {
  en: { more: 'More actions', settings: 'Access settings', mode: 'Redirect mode', direct: 'Direct redirect', intermediate: 'Intermediate page', confirmation: 'Confirmation page', save: 'Save', cancel: 'Cancel' },
  'zh-CN': { more: '更多操作', settings: '访问配置', mode: '跳转方式', direct: '直接跳转', intermediate: '中间页', confirmation: '确认页', save: '保存', cancel: '取消' },
} as const

for (const [language, width] of [['en', 320], ['en', 390], ['zh-CN', 390], ['en', 1280]] as const) {
  for (const entry of ['own', 'admin'] as const) {
    test(`v0.61.1 ${language} ${width}px ${entry} readable redirect buttons and keyboard save/cancel`, async ({ browser, request }, info) => {
      const text = labels[language], errors: unknown[] = []
      const password = 'owned-mobile-layout-fixture-61'
      let userId: string | undefined, linkId: string | undefined
      await post(request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width, height: width === 320 ? 568 : 900 }, serviceWorkers: 'block', reducedMotion: 'reduce', colorScheme: language === 'en' ? 'light' : 'dark' })
      try {
        const username = 'layout61-' + randomBytes(7).toString('hex')
        const created = await post<{ user: { id: string } }>(request, '/admin/user/create', { username, password, nickname: 'Owned mobile editor fixture', groupKey: 'admin', status: 'active' })
        userId = created.user.id
        await context.addInitScript(language => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', language === 'en' ? 'light' : 'dark') }, language)
        const page = await context.newPage()
        await post(page.request, '/auth/login', { username, password })
        const preferences = await get<{ preferences: { updatedAt: string | null } }>(page.request, '/user/preferences')
        await post(page.request, '/user/preferences/update', { language, theme: language === 'en' ? 'light' : 'dark', expectedUpdatedAt: preferences.preferences.updatedAt })
        const createdLink = await post<{ shortLink: { id: string; slug: string } }>(page.request, '/short-link/create', { targetUrl: 'https://layout.example/' + randomBytes(8).toString('hex'), redirectMode: 'direct' })
        const link = createdLink.shortLink
        linkId = link.id
        const updatePath = '/api/v1/' + (entry === 'admin' ? 'admin/' : '') + 'short-link/update'
        const writes: unknown[] = []
        page.on('request', value => { if (new URL(value.url()).pathname === updatePath && value.method() === 'POST') writes.push(value.postDataJSON()) })
        await page.goto(entry === 'admin' ? '/admin/link' : '/link')
        const row = page.getByTestId('console-link-row').filter({ hasText: link.slug })
        async function open() {
          await row.getByRole('button', { name: text.more, exact: true }).click()
          await page.getByRole('menuitem', { name: text.settings, exact: true }).click()
          await expect(page.getByRole('dialog')).toBeVisible()
        }
        await open()
        const dialog = page.getByRole('dialog'), card = dialog.locator('.short-link-settings-dialog')
        const toggle = dialog.locator('.v-btn-toggle')
        await expect(toggle.getByRole('button')).toHaveCount(3)
        await expect(toggle.getByRole('button', { name: text.confirmation, exact: true })).toBeEnabled()
        await expectNoHorizontalOverflow(page)
        const geometry = await card.evaluate(card => {
          const rect = (element: Element) => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height } }
          const group = card.querySelector('.v-btn-toggle')!
          return { card: rect(card), body: rect(card.querySelector('.v-card-text')!), group: rect(group), viewport: innerWidth, clientWidth: card.clientWidth, scrollWidth: card.scrollWidth, buttons: Array.from(group.querySelectorAll('button')).map(button => {
            const range = document.createRange(); range.selectNodeContents(button.querySelector('.v-btn__content')!)
            const r = range.getBoundingClientRect()
            return { text: button.textContent?.trim(), box: rect(button), textBox: { left: r.left, right: r.right, top: r.top, bottom: r.bottom } }
          }) }
        })
        await info.attach('editor-geometry', { body: JSON.stringify({ language, width, entry, browser: browser.version(), geometry }), contentType: 'application/json' })
        await page.screenshot({ path: info.outputPath('editor-' + language + '-' + width + '-' + entry + '.png'), animations: 'disabled' })
        expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1)
        for (const button of geometry.buttons) {
          for (const box of [button.box, button.textBox]) {
            expect(box.left).toBeGreaterThanOrEqual(geometry.group.left - 1)
            expect(box.right).toBeLessThanOrEqual(geometry.group.right + 1)
            expect(box.top).toBeGreaterThanOrEqual(geometry.group.top - 1)
            expect(box.bottom).toBeLessThanOrEqual(geometry.group.bottom + 1)
          }
          expect(button.box.left).toBeGreaterThanOrEqual(Math.max(geometry.body.left, geometry.card.left, 0) - 1)
          expect(button.box.right).toBeLessThanOrEqual(Math.min(geometry.body.right, geometry.card.right, geometry.viewport) + 1)
          expect(button.textBox.left).toBeGreaterThanOrEqual(button.box.left - 1)
          expect(button.textBox.right).toBeLessThanOrEqual(button.box.right + 1)
          expect(button.textBox.top).toBeGreaterThanOrEqual(button.box.top - 1)
          expect(button.textBox.bottom).toBeLessThanOrEqual(button.box.bottom + 1)
          if (width <= 480) expect(button.box.height).toBeGreaterThanOrEqual(44)
        }
        await activate(toggle.getByRole('button', { name: text.confirmation, exact: true }))
        await expect(toggle.getByRole('button', { name: text.confirmation, exact: true })).toHaveAttribute('aria-pressed', 'true')
        const saved = page.waitForResponse(response => new URL(response.url()).pathname === updatePath)
        await activate(dialog.getByRole('button', { name: text.save, exact: true }))
        const response = await saved
        expect(response.request().postDataJSON()).toEqual({ id: link.id, redirectMode: 'confirmation', expiration: { mode: 'never' } })
        expect((await response.json()).code).toBe(0)
        await expect(dialog).toBeHidden()
        await open()
        await expect(toggle.getByRole('button', { name: text.confirmation, exact: true })).toHaveAttribute('aria-pressed', 'true')
        await activate(toggle.getByRole('button', { name: text.intermediate, exact: true }))
        await expect(dialog.getByRole('slider')).toBeVisible()
        await activate(dialog.getByRole('button', { name: text.cancel, exact: true }))
        await expect(dialog).toBeHidden()
        await open()
        await expect(toggle.getByRole('button', { name: text.confirmation, exact: true })).toHaveAttribute('aria-pressed', 'true')
        await activate(toggle.getByRole('button', { name: text.direct, exact: true }))
        await activate(dialog.getByRole('button', { name: text.cancel, exact: true }))
        await expect(dialog).toBeHidden()
        await open()
        await expect(toggle.getByRole('button', { name: text.confirmation, exact: true })).toHaveAttribute('aria-pressed', 'true')
        await expect(toggle.getByRole('button', { name: text.direct, exact: true })).toHaveAttribute('aria-pressed', 'false')
        await expect(dialog.getByRole('slider')).toHaveCount(0)
        await activate(dialog.getByRole('button', { name: text.cancel, exact: true }))
        await expect(dialog).toBeHidden()
        const stored = (await get<{ items: Array<{ id: string; redirectMode: string }> }>(page.request, '/short-link/list?page=1&pageSize=100')).items.find(value => value.id === link.id)
        expect(stored?.redirectMode).toBe('confirmation')
        expect(writes).toEqual([{ id: link.id, redirectMode: 'confirmation', expiration: { mode: 'never' } }])
      } catch (error) { errors.push(error) } finally {
        if (linkId) { try { await post(request, '/admin/short-link/delete', { id: linkId }) } catch (error) { errors.push(error) } }
        if (userId) { try { await post(request, '/admin/user/update', { id: userId, nickname: 'Retired mobile editor fixture', status: 'disabled' }) } catch (error) { errors.push(error) } }
        try { await context.close() } catch (error) { errors.push(error) }
      }
      if (errors.length) throw new AggregateError(errors, 'Mobile editor behavior or exact owned fixture cleanup failed')
    })
  }
}

/** Requires the real focused control to be fully visible before keyboard activation. */
async function activate(button: Locator) {
  await button.focus()
  await expect(button).toBeFocused()
  await expect(button).toBeInViewport({ ratio: 1 })
  await expect.poll(() => button.evaluate(element => {
    const rect = element.getBoundingClientRect()
    return rect.left >= -1 && rect.right <= innerWidth + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1
  }), { message: 'Focused editor action must fit the viewport, including the short phone screen' }).toBe(true)
  await button.press('Enter')
}
async function get<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get('/api/v1' + path, { timeout: 10_000 }); expect(response.status()).toBe(200)
  const payload = await response.json(); expect(payload.code).toBe(0); return payload.data as T
}
async function post<T = unknown>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await request.post('/api/v1' + path, { data, timeout: 10_000 }); expect(response.status()).toBe(200)
  const payload = await response.json(); expect(payload.code).toBe(0); return payload.data as T
}
