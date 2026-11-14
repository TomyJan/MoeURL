import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { e2eAdminUsername, e2eAdminPassword } from './support'

const touchPages = new WeakSet<Page>()
const endpoint = '/api/v1/short-link/batch-create-with-expirations'

for (const language of ['zh-CN', 'en'] as const) for (const { width, rows } of [{ width: 1280, rows: 1 }, { width: 390, rows: 1 }, { width: 320, rows: 1 }, { width: 320, rows: 20 }]) {
  test('v0.75.2 ' + language + ' ' + width + 'px ' + rows + ' rows reveals a real expiration refusal and preserves explicit correction', async ({ browser }, info) => {
    const theme = language === 'en' ? 'dark' : 'light'
    const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width, height: width === 320 ? 500 : width === 1280 ? 900 : 800 }, locale: language, hasTouch: width !== 1280, colorScheme: theme, reducedMotion: 'reduce', serviceWorkers: 'block' })
    const page = await context.newPage(), nonce = randomBytes(7).toString('hex'), password = 'phone-diagnostic-disposable-account'
    if (width !== 1280) touchPages.add(page)
    let userId: string | undefined
    const post = async (path: string, data: unknown) => {
      const response = await page.request.post('/api/v1' + path, { data, timeout: 10_000 })
      expect(response.status()).toBe(200)
      const result = await response.json(); expect(result.code).toBe(0); return result.data
    }
    try {
      await context.addInitScript(({ language, theme }) => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', theme) }, { language, theme })
      await post('/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      const { user } = await post('/admin/user/create', { username: 'phone-denial-' + nonce, password, nickname: 'Phone denial diagnostic', groupKey: 'admin', status: 'active' })
      userId = user.id
      await post('/auth/logout', {})
      await post('/auth/login', { username: user.username, password })
      await page.goto('/link')
      await activate(page.getByTestId('bulk-create-open'))
      const dialog = page.getByTestId('bulk-create-dialog')
      await expect(dialog).toBeVisible()
      const clock = await page.request.get('/api/v1/short-link/list?page=1&pageSize=100')
      expect(clock.status()).toBe(200)
      const serverTime = Date.parse(clock.headers().date ?? '')
      expect(Number.isFinite(serverTime)).toBe(true)
      const expiresAt = new Date(serverTime - 60_000).toISOString().replace('.000Z', 'Z')
      const targetUrl = 'https://example.com/phone-denial/' + nonce
      const csv = (deadline: string) => '\uFEFFtarget_url,title,tags,custom_slug,redirect_mode,expires_at\r\n' + Array.from({ length: rows }, (_, index) => [targetUrl + '/' + index, rows === 20 ? 'Retained long preview title ' + index : '', '[]', '', 'direct', deadline].map(value => '"' + value.replaceAll('"', '""') + '"').join(',')).join('\r\n') + '\r\n'
      await dialog.locator('input[type=file]').setInputFiles({ name: 'expired.csv', mimeType: 'text/csv', buffer: Buffer.from(csv(expiresAt)) })
      await expect(page.getByTestId('bulk-create-imported-list').locator('li')).toHaveCount(rows)
      await activate(page.getByTestId('bulk-create-preview'))
      const requestId = await page.getByTestId('bulk-create-request-id').innerText(), writes: unknown[] = []
      page.on('request', request => { if (new URL(request.url()).pathname === endpoint) writes.push(request.postDataJSON()) })
      const before = await geometry(dialog)
      const rejected = page.waitForResponse(response => new URL(response.url()).pathname === endpoint && response.request().method() === 'POST')
      await activate(page.getByTestId('bulk-create-submit'))
      const response = await rejected, payload = await response.json()
      expect(response.status()).toBe(200); expect(payload.code).toBe(200108)
      const error = page.getByTestId('bulk-create-error')
      await expect(error).toBeVisible()
      await expect(page.getByTestId('bulk-create-edit')).toBeEnabled()
      // Capture the rendered state without focusing or scrolling the alert first.
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
      const after = await geometry(dialog)
      const shot = info.outputPath('phone-denial-' + language + '-' + width + '.png')
      await page.screenshot({ path: shot, animations: 'disabled' })
      await info.attach('unmodified-phone-view', { path: shot, contentType: 'image/png' })
      const list = await page.request.get('/api/v1/short-link/list?page=1&pageSize=100')
      const stored = await list.json(); expect(stored.code).toBe(0); expect(stored.data.items).toEqual([])
      expect(writes).toHaveLength(1)
      await expect(page.getByTestId('bulk-create-request-id')).toHaveText(requestId)
      const result = { language, width, rows, theme, browser: browser.version(), driverNode: process.version, requestId, code: payload.code, writes, before, after, currentProductUnderTest: true, forcedErrorScroll: false, persistedRows: 0 }
      const path = info.outputPath('phone-denial-geometry.json')
      await writeFile(path, JSON.stringify(result, null, 2))
      await info.attach('phone-denial-geometry', { path, contentType: 'application/json' })
      expect(after.error.fullyWithinVerticalClip).toBe(true)
      expect(after.focus.containsError).toBe(true)
      expect(after.pageScrollWidth).toBeLessThanOrEqual(width)
      await expect(page.getByTestId('bulk-create-error-feedback')).toBeFocused()
      // Only explicit editing may replace the rejected batch; positioning cannot retry or change it.
      await activate(page.getByTestId('bulk-create-edit'))
      await dialog.locator('input[type=file]').setInputFiles({ name: 'corrected.csv', mimeType: 'text/csv', buffer: Buffer.from(csv('2030-01-01T00:00:00Z')) })
      await activate(page.getByTestId('bulk-create-preview'))
      const correctedId = await page.getByTestId('bulk-create-request-id').innerText()
      expect(correctedId).not.toBe(requestId)
      const created = page.waitForResponse(value => new URL(value.url()).pathname === endpoint && value.request().method() === 'POST')
      await activate(page.getByTestId('bulk-create-submit'))
      expect(await (await created).json()).toMatchObject({ code: 0, data: { requestId: correctedId, createdCount: rows } })
      await expect(dialog).toBeHidden()
      expect(writes).toHaveLength(2)
      const afterCreation = await (await page.request.get('/api/v1/short-link/list?page=1&pageSize=100')).json()
      expect(afterCreation.code).toBe(0); expect(afterCreation.data.items).toHaveLength(rows)
    } finally {
      try { if (userId) {
        const list = await (await page.request.get('/api/v1/short-link/list?page=1&pageSize=100')).json()
        expect(list.code).toBe(0)
        await post('/auth/logout', {})
        await post('/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
        for (const link of list.data.items) await post('/admin/short-link/delete', { id: link.id })
        await post('/admin/user/update', { id: userId, nickname: 'Phone denial diagnostic', status: 'disabled' })
      } } finally { await context.close() }
    }
  })
}

async function geometry(dialog: Locator) {
  return dialog.evaluate(card => {
    const rect = (node: Element | null) => { if (!node) return null; const value = node.getBoundingClientRect(); return { x: value.x, y: value.y, width: value.width, height: value.height, top: value.top, bottom: value.bottom, left: value.left, right: value.right } }
    const body = card.querySelector('.bulk-create-body'), actions = card.querySelector('.bulk-create-actions'), error = card.querySelector('[data-testid=bulk-create-error]')
    const alertRect = error?.getBoundingClientRect(), bodyRect = body?.getBoundingClientRect(), view = window.visualViewport
    const clipTop = Math.max(0, bodyRect?.top ?? 0, view?.offsetTop ?? 0)
    const clipBottom = Math.min(window.innerHeight, bodyRect?.bottom ?? window.innerHeight, (view?.offsetTop ?? 0) + (view?.height ?? window.innerHeight))
    const visibleErrorHeight = alertRect ? Math.max(0, Math.min(alertRect.bottom, clipBottom) - Math.max(alertRect.top, clipTop)) : 0
    return { viewport: { innerWidth, innerHeight, visualTop: view?.offsetTop, visualHeight: view?.height }, card: rect(card), body: { rect: rect(body), scrollTop: body?.scrollTop, scrollHeight: body?.scrollHeight, clientHeight: body?.clientHeight, overflowY: body ? getComputedStyle(body).overflowY : null }, actions: rect(actions), error: { rect: rect(error), text: error?.textContent, visibleHeight: visibleErrorHeight, fullyWithinVerticalClip: !!alertRect && alertRect.top >= clipTop && alertRect.bottom <= clipBottom }, focus: { tag: document.activeElement?.tagName, testId: document.activeElement?.getAttribute('data-testid'), containsError: !!error && document.activeElement !== document.body && !!document.activeElement?.contains(error) }, pageScrollWidth: document.documentElement.scrollWidth }
  })
}


/** Uses a real touch or keyboard activation without scrolling the feedback into view. */
async function activate(control: Locator) { if (touchPages.has(control.page())) await control.tap(); else { await control.focus(); await control.press('Enter') } }
