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

for (const language of ['zh-CN', 'en'] as const) {
  test('v0.75.2 ' + language + ' repeated local validation and malformed CSV feedback stays readable at 320px', async ({ browser }, info) => {
    const theme = language === 'en' ? 'dark' : 'light'
    const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 320, height: 500 }, locale: language, hasTouch: true, colorScheme: theme, reducedMotion: 'reduce', serviceWorkers: 'block' })
    const page = await context.newPage(), requests: { path: string; method: string }[] = []
    const actor = { id: '00000000-0000-0000-0000-000000007599', username: 'local-feedback', nickname: '', group: 'user', permissions: ['short_link:create', 'short_link:read_own', 'domain:use_default'] }
    const observations: unknown[] = []
    touchPages.add(page)
    try {
      await context.addInitScript(({ language, theme }) => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', theme) }, { language, theme })
      // Only external reads are fixtures; the actual dialog, parser, file and focus behavior run unchanged.
      await page.route('**/api/v1/**', route => {
        const path = new URL(route.request().url()).pathname
        requests.push({ path, method: route.request().method() })
        const data = path.endsWith('/auth/me') ? { user: actor } : { items: [], page: 1, pageSize: 20, total: 0 }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ code: 0, data, message: '', meta: {} }) })
      })
      await page.goto('/link')
      await activate(page.getByTestId('bulk-create-open'))
      const dialog = page.getByTestId('bulk-create-dialog'), input = dialog.locator('input[type=file]'), draft = dialog.getByRole('textbox')
      for (const kind of ['manual', 'oversized', 'malformed'] as const) {
        const retained = kind === 'manual' ? 'not a valid URL' : 'https://example.com/retained-local-draft'
        await draft.fill(retained)
        for (const attempt of [1, 2]) {
          if (kind === 'manual') await activate(page.getByTestId('bulk-create-preview'))
          else {
            await input.focus()
            await input.setInputFiles({ name: kind + '.csv', mimeType: 'text/csv', buffer: kind === 'oversized' ? Buffer.alloc(65_537, 'x') : Buffer.from('bad_header\r\nnot_a_url\r\n') })
          }
          await expect(page.getByTestId('bulk-create-error')).toBeVisible()
          await expect(page.getByTestId('bulk-create-error-feedback')).toBeFocused()
          await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
          const measured = await geometry(dialog)
          const shot = info.outputPath('local-feedback-' + language + '-' + kind + '-' + attempt + '.png')
          await page.screenshot({ path: shot, animations: 'disabled' })
          await info.attach('local-feedback-original', { path: shot, contentType: 'image/png' })
          observations.push({ kind, attempt, measured })
          expect(measured.error.fullyWithinVerticalClip).toBe(true)
          expect(measured.focus.containsError).toBe(true)
          expect(measured.pageScrollWidth).toBeLessThanOrEqual(320)
          await expect(draft).toHaveValue(retained)
          await expect(page.getByTestId('bulk-create-request-id')).toHaveCount(0)
        }
      }
      expect(requests.filter(request => request.method !== 'GET')).toEqual([])
      const path = info.outputPath('local-feedback-geometry.json')
      await writeFile(path, JSON.stringify({ language, browser: browser.version(), driverNode: process.version, externalAPIsMocked: true, writes: 0, observations, requests }, null, 2))
      await info.attach('local-feedback-geometry', { path, contentType: 'application/json' })
    } finally { await context.close() }
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
