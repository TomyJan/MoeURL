import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

const labels = {
  en: { target: 'Enter link', create: 'Create short link', qr: 'QR code', title: 'Short-link QR code', colors: ['Black and white', 'Iris blue', 'Forest green'], levels: ['M (standard)', 'Q (higher)', 'H (highest)'], size: 'Export size: 320 px', png: 'Download PNG', svg: 'Download SVG', close: 'Close', more: 'More actions' },
  'zh-CN': { target: '输入链接', create: '创建短链', qr: '二维码', title: '短链二维码', colors: ['黑白', '鸢尾蓝', '森林绿'], levels: ['M（标准）', 'Q（较高）', 'H（最高）'], size: '导出尺寸: 320 px', png: '下载 PNG', svg: '下载 SVG', close: '关闭', more: '更多操作' },
} as const

// A skipped middle button or a non-scrollable card must break these real-input checks.
for (const language of ['zh-CN', 'en'] as const) {
  test(`v0.59.1 ${language} 375px reaches every QR control with continuous Tab and scrolls back with the wheel`, async ({ browser }, info) => {
    const text = labels[language], failures: unknown[] = [], ids: string[] = [], pageErrors: string[] = []
    const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 375, height: 667 }, locale: language, reducedMotion: 'reduce', colorScheme: language === 'en' ? 'light' : 'dark', serviceWorkers: 'block' })
    const page = await context.newPage()
    page.on('pageerror', error => pageErrors.push(error.message))
    try {
      await context.addInitScript(value => localStorage.setItem('moeurl.language', value), language)
      await post(page.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      await page.goto('/')
      await page.getByLabel(text.target, { exact: true }).fill('https://example.org/keyboard-scroll-' + randomBytes(6).toString('hex'))
      const pending = page.waitForResponse(response => response.url().endsWith('/api/v1/short-link/create') && response.request().method() === 'POST')
      await page.getByRole('button', { name: text.create, exact: true }).click()
      const response = await pending
      expect(response.status()).toBe(200)
      const payload = await response.json() as { code: number; data: { shortLink: { id: string; slug: string } } }
      expect(payload.code).toBe(0)
      ids.push(payload.data.shortLink.id)
      const dialog = page.getByRole('dialog', { name: text.title, exact: true })
      let actualScrolls = 0
      for (const [entry, path] of [['home', ''], ['own', '/link'], ['admin', '/admin/link']] as const) {
        await page.setViewportSize({ width: 375, height: 667 })
        if (path) {
          await page.goto(path)
          const row = page.getByTestId('console-link-row').filter({ hasText: payload.data.shortLink.slug })
          await row.getByRole('button', { name: text.more, exact: true }).click()
          await page.getByRole('menuitem', { name: text.qr, exact: true }).click()
        } else {
          await page.getByRole('button', { name: text.qr, exact: true }).click()
        }
        await expect(dialog.getByRole('link', { name: text.svg, exact: true })).toBeVisible()
        await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
        const controls = [
          ...text.colors.map(name => dialog.getByRole('button', { name, exact: true })),
          ...text.levels.map(name => dialog.getByRole('button', { name, exact: true })),
          dialog.getByRole('button', { name: text.size, exact: true }),
          dialog.getByRole('link', { name: text.png, exact: true }),
          dialog.getByRole('link', { name: text.svg, exact: true }),
          dialog.getByRole('button', { name: text.close, exact: true }),
        ]
        const initial = await dialog.evaluate(element => ({ tag: document.activeElement?.tagName, role: document.activeElement?.getAttribute('role'), container: document.activeElement === element || document.activeElement === element.querySelector('.v-overlay__content') }))
        await info.attach(`keyboard-${language}-${entry}-initial-focus`, { body: JSON.stringify(initial), contentType: 'application/json' })
        if (initial.container) await page.keyboard.press('Tab')
        const names: string[] = []
        for (const [index, control] of controls.entries()) {
          if (index) await page.keyboard.press('Tab')
          await expect(control, `continuous Tab at ${entry} control ${index + 1}`).toBeFocused()
          await expect(control).toBeInViewport({ ratio: 1 })
          names.push((await control.textContent())!.trim())
        }
        const card = dialog.locator('.short-link-qr-dialog'), title = dialog.getByText(text.title, { exact: true })
        const keyboardGeometry = await card.evaluate(element => ({ top: element.scrollTop, height: element.clientHeight, content: element.scrollHeight }))
        await page.screenshot({ path: info.outputPath(`keyboard-${language}-${entry}-bottom.png`) })
        // Natural notification expiry must finish before measuring the independent wheel phase.
        await page.mouse.move(1, 666)
        await expect(page.locator('[data-sonner-toast]')).toHaveCount(0, { timeout: 10_000 })
        await page.setViewportSize({ width: 375, height: 600 })
        await expect.poll(() => card.evaluate(element => element.scrollHeight - element.clientHeight), { message: 'Shorter wheel viewport must overflow without a notification' }).toBeGreaterThan(1)
        await page.keyboard.press('Shift+Tab')
        await expect(controls[8]!).toBeFocused()
        await page.keyboard.press('Tab')
        await expect(controls[9]!).toBeFocused()
        await expect(controls[9]!).toBeInViewport({ ratio: 1 })
        const geometry = await card.evaluate(element => ({ top: element.scrollTop, height: element.clientHeight, content: element.scrollHeight }))
        const before = geometry.top
        expect(before, 'Real Tab to bottom must scroll the stable overflowing card').toBeGreaterThan(0)
        await expect(title).not.toBeInViewport({ ratio: 1 })
        await page.screenshot({ path: info.outputPath(`wheel-${language}-${entry}-bottom.png`) })
        const box = await card.boundingBox()
        expect(box).not.toBeNull()
        const x = Math.max(1, Math.min(374, box!.x + box!.width / 2))
        const y = Math.max(1, Math.min(599, box!.y + box!.height / 2))
        await page.mouse.move(x, y)
        expect(await card.evaluate(element => element.scrollTop), 'Card must remain at the bottom until wheel input').toBe(before)
        await page.mouse.wheel(0, -1200)
        await expect.poll(() => card.evaluate(element => ({ top: element.scrollTop, height: element.clientHeight, content: element.scrollHeight })), { message: 'Wheel returns to top with stable geometry after natural notification exit' }).toEqual({ top: 0, height: geometry.height, content: geometry.content })
        actualScrolls++
        await expect(title).toBeInViewport({ ratio: 1 })
        await expectNoHorizontalOverflow(page)
        await page.screenshot({ path: info.outputPath(`wheel-${language}-${entry}-top.png`) })
        await info.attach(`keyboard-${language}-${entry}-input-proof`, { body: JSON.stringify({ initial, names, keyboardViewport: { width: 375, height: 667 }, keyboardGeometry, wheelViewport: page.viewportSize(), naturalNotificationsRemaining: await page.locator('[data-sonner-toast]').count(), geometry, before, after: await card.evaluate(element => ({ top: element.scrollTop, height: element.clientHeight, content: element.scrollHeight })), wheel: { x, y, deltaY: -1200 }, noProgrammaticControlFocus: true, noProgrammaticScroll: true }), contentType: 'application/json' })
        await dialog.getByRole('button', { name: text.close, exact: true }).click()
        await expect(dialog).toBeHidden()
      }
      expect(actualScrolls, 'Each entry must exercise real wheel input without a notification').toBe(3)
      expect(pageErrors).toEqual([])
    } catch (error) { failures.push(error) } finally {
      for (const id of ids) { try { await post(page.request, '/admin/short-link/delete', { id }) } catch (error) { failures.push(error) } }
      try { await context.close() } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, 'Continuous keyboard/wheel scenario or owned cleanup failed')
  })
}

/** Uses the real envelope for login and exact owned-link cleanup. */
async function post(request: APIRequestContext, path: string, data: unknown) {
  const response = await request.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200)
  expect((await response.json() as { code: number }).code).toBe(0)
}
