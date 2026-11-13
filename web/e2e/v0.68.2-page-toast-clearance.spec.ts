import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { APIRequestContext } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

type Policy = { enabled: boolean; suffixes: string[]; updatedAt: string }
const path = '/admin/system/target-host-suffix-allowlist'
const viewports = [{ width: 390, height: 844 }, { width: 320, height: 568 }, { width: 320, height: 320 }, { width: 800, height: 900 }, { width: 1280, height: 900 }]

// Reverting the measured page region to a top overlay must fail the live heading intersection check.
for (const language of ['en', 'zh-CN'] as const) for (const viewport of viewports) {
  test('v0.68.2 ' + language + ' ' + viewport.width + 'x' + viewport.height + ' keeps a live saved policy heading clear of page notifications', async ({ browser, request }, info) => {
    test.setTimeout(90_000)
    const theme = language === 'en' ? 'light' : 'dark'
    const labels = language === 'en'
      ? { form: 'Allowed target DNS suffix settings', field: 'DNS suffix 1', save: 'Save allowed suffixes' }
      : { form: '目标 DNS 后缀白名单设置', field: 'DNS 后缀 1', save: '保存后缀白名单' }
    await post(request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
    const original = await get<Policy>(request, path)
    const password = randomBytes(24).toString('hex')
    const user = (await post<{ user: { id: string; username: string } }>(request, '/admin/user/create', { username: 'clear682-' + randomBytes(7).toString('hex'), password, nickname: 'Page notification fixture', groupKey: 'admin', status: 'active' })).user
    const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport, hasTouch: viewport.width < 1000, reducedMotion: 'reduce', colorScheme: theme, serviceWorkers: 'block' })
    const failures: unknown[] = []
    try {
      await context.addInitScript(({ language, theme }) => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', theme) }, { language, theme })
      const page = await context.newPage()
      await post(page.request, '/auth/login', { username: user.username, password })
      const preferences = (await get<{ preferences: { updatedAt: string | null } }>(page.request, '/user/preferences')).preferences
      await post(page.request, '/user/preferences/update', { language, theme, expectedUpdatedAt: preferences.updatedAt })
      await write(request, ['before.example'])
      await page.goto('/admin/setting')
      const form = page.getByRole('form', { name: labels.form, exact: true })
      const field = form.getByRole('textbox', { name: labels.field, exact: true })
      await expect(field).toHaveValue('before.example'); await field.fill('clear.example')
      await page.clock.install()
      const saved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1' + path + '/update' && response.request().method() === 'POST')
      const save = form.getByRole('button', { name: labels.save, exact: true })
      await save.focus(); await save.press('Enter')
      const response = await saved, payload = await response.json()
      expect(response.status()).toBe(200); expect(payload.code).toBe(0)
      expect(payload.data.suffixes).toEqual(['clear.example']); expect(await get<Policy>(request, path)).toEqual(payload.data)
      const toasts = page.locator('[data-sonner-toast]')
      await expect(toasts).toHaveCount(1); await expect(toasts).toBeVisible()
      const originalToast = await toasts.elementHandle()
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 100))
      const heading = page.locator('#target-suffix-allowlist-heading')
      await heading.evaluate(element => {
        const nav = document.querySelector('[data-toast-page-header]')!
        const navBox = nav.getBoundingClientRect(), visible = getComputedStyle(nav).display !== 'none' && navBox.height > 0
        const text = document.createRange(); text.selectNodeContents(element)
        window.scrollBy({ top: text.getBoundingClientRect().top - (visible ? navBox.bottom + 8 : 16), behavior: 'instant' })
      })
      await page.clock.runFor(100)
      const geometry = await heading.evaluate(element => {
        const range = document.createRange(); range.selectNodeContents(element)
        const title = range.getBoundingClientRect(), navElement = document.querySelector('[data-toast-page-header]')!
        const navBox = navElement.getBoundingClientRect(), navVisible = getComputedStyle(navElement).display !== 'none' && navBox.height > 0
        const rect = (r: DOMRect) => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height })
        const overlap = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
        const boxes = [...document.querySelectorAll<HTMLElement>('[data-sonner-toast]')].map(toast => toast.getBoundingClientRect())
        const centre = document.elementFromPoint((title.left + title.right) / 2, (title.top + title.bottom) / 2)
        return { title: rect(title), nav: navVisible ? rect(navBox) : null, toasts: boxes.map(rect), titleClear: boxes.every(box => !overlap(box, title)), navClear: !navVisible || boxes.every(box => !overlap(box, navBox)), titleBelowNav: !navVisible || title.top >= navBox.bottom + 7, centreHit: centre === element || element.contains(centre), inViewport: title.top >= 0 && title.bottom <= innerHeight, removed: [...document.querySelectorAll('[data-sonner-toast]')].some(node => node.getAttribute('data-removed') === 'true') }
      })
      await info.attach('live-heading-geometry', { body: JSON.stringify({ language, viewport, theme, browser: browser.version(), driverNode: process.version, responseStatus: response.status(), code: payload.code, ...geometry }), contentType: 'application/json' })
      await page.screenshot({ path: info.outputPath('live-heading-' + language + '-' + viewport.width + 'x' + viewport.height + '.png'), animations: 'disabled' })
      expect(await toasts.evaluate((node, original) => node === original, originalToast)).toBe(true)
      expect(geometry.removed).toBe(false); expect(geometry.inViewport).toBe(true); expect(geometry.titleBelowNav).toBe(true)
      expect(geometry.navClear).toBe(true); expect(geometry.titleClear, 'Live success toast must not cover actual policy title text').toBe(true)
      expect(geometry.centreHit).toBe(true); await expectNoHorizontalOverflow(page)
    } catch (error) { failures.push(error) } finally {
      try { const restored = await write(request, original.suffixes, original.enabled); expect(restored.suffixes).toEqual(original.suffixes); expect(restored.enabled).toBe(original.enabled); expect(await get<Policy>(request, path)).toEqual(restored) } catch (error) { failures.push(error) }
      try { await post(request, '/admin/user/update', { id: user.id, nickname: 'Retired notification fixture', status: 'disabled' }) } catch (error) { failures.push(error) }
      try { await context.close() } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, 'Live notification layout or owned fixture restoration failed')
  })
}

async function write(request: APIRequestContext, suffixes: string[], enabled = false) {
  const current = await get<Policy>(request, path)
  return post<Policy>(request, path + '/update', { suffixes, enabled, expectedUpdatedAt: current.updatedAt })
}
async function get<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get('/api/v1' + path, { timeout: 10_000 }); expect(response.status()).toBe(200)
  const payload = await response.json(); expect(payload.code).toBe(0); return payload.data as T
}
async function post<T = unknown>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await request.post('/api/v1' + path, { data, timeout: 10_000 }); expect(response.status()).toBe(200)
  const payload = await response.json(); expect(payload.code).toBe(0); return payload.data as T
}
