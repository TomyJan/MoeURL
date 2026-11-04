import { randomBytes, randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, Locator, Page } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

/** Makes one real fixture request; failed writes are never automatically retried. */
async function success(api: APIRequestContext, path: string, data?: unknown) {
  const response = data === undefined ? await api.get('/api/v1' + path) : await api.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200)
  const body = await response.json()
  expect(body.code).toBe(0)
  return body
}

/** Measures business content against the container's border and padding, independent of toast CSS. */
async function emptyPanelGeometry(panel: Locator, heading: string) {
  return panel.evaluate((element, selector) => {
    const style = getComputedStyle(element), panel = element.getBoundingClientRect()
    const first = element.querySelector(selector)!.getBoundingClientRect()
    const expectedTop = panel.top + Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.paddingTop)
    return { panelTop: panel.top, firstTop: first.top, expectedTop, extraGap: first.top - expectedTop, toasts: element.querySelectorAll('[data-sonner-toast]').length }
  }, heading)
}

test.describe('real shared component with real Vuetify modal fixtures', () => {
  let harness: string
  /** Serves exact UTF-8 fixture assets and reports boot failures before any interaction timeout. */
  async function openHarness(page: Page, query = '') {
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.route('http://feedback.test/**', async route => {
      const path = new URL(route.request().url()).pathname
      if (path === '/harness.js' || path === '/harness.css') return route.fulfill({ body: await readFile(harness + path, 'utf8'), contentType: path.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8' })
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/harness.css"></head><body><div id="app"></div><script src="/harness.js"></script></body></html>' })
    })
    await page.goto('http://feedback.test/?' + query)
    expect(errors, 'Fixture boot must not fail before testing shared feedback').toEqual([])
    await expect(page.getByRole('button', { name: 'Publish one', exact: true })).toBeVisible({ timeout: 5000 })
  }
  test.beforeAll(async ({ browserName }, info) => {
    expect(browserName).toBe('chromium')
    harness = process.env.MOEURL_E2E_FEEDBACK_HARNESS_DIR ?? info.outputPath('feedback-harness')
    if (!process.env.MOEURL_E2E_FEEDBACK_HARNESS_DIR) {
      const pnpm = process.env.npm_execpath
      if (!pnpm) throw new Error('Run the browser suite through the repository pnpm command')
      execFileSync(process.execPath, [pnpm, 'exec', 'vite', 'build', '--config', 'e2e/feedback-harness.config.ts', '--outDir', harness], { cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'pipe' })
    }
    await readFile(harness + '/harness.js')
    await readFile(harness + '/harness.css')
  })
  for (const layout of ['flex', 'grid']) {
    test('empty modal fixture preserves spacing and the live Toaster lifecycle: ' + layout, async ({ page }, info) => {
      const time = new Date('2026-11-04T00:00:00Z')
      await page.clock.install({ time })
      await page.clock.pauseAt(time)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await openHarness(page, 'language=en&layout=' + layout)
      const original = await page.locator('[data-sonner-toaster]').elementHandle()
      await page.getByRole('button', { name: 'Open custom', exact: true }).click()
      await page.clock.runFor(350)
      const panel = page.getByTestId('empty-panel'), heading = '[data-testid="empty-heading"]'
      await expect(panel.getByTestId('empty-cancel')).toBeFocused()
      // Finish the initial finite opening animation before measuring unscaled CSS pixels.
      await page.screenshot({ path: info.outputPath('empty-initial.png'), animations: 'disabled' })
      const initial = await emptyPanelGeometry(panel, heading)
      await writeFile(info.outputPath('empty-initial.json'), JSON.stringify(initial, null, 2))
      expect(Math.abs(initial.extraGap)).toBeLessThanOrEqual(1)
      const assertEmpty = async () => {
        await expect(panel.locator('[data-sonner-toast]')).toHaveCount(0)
        expect(Math.abs((await emptyPanelGeometry(panel, heading)).extraGap)).toBeLessThanOrEqual(1)
        expect(await page.locator('[data-sonner-toaster]').evaluate((node, original) => node === original, original)).toBe(true)
      }
      await panel.getByRole('button', { name: 'Publish inside', exact: true }).click()
      await page.clock.runFor(50)
      await expect(panel.locator('[data-sonner-toast]')).toBeVisible()
      expect((await emptyPanelGeometry(panel, heading)).extraGap).toBeGreaterThan(20)
      // Publishing focused its own button; deliberately establish the safe business return target.
      await panel.getByTestId('empty-cancel').focus()
      await panel.locator('[data-sonner-toast] button[data-close-button]').focus()
      await page.keyboard.press('Enter')
      // The removed flag starts Sonner's exit; the actual node must still occupy normal flow.
      await expect(panel.locator('[data-sonner-toast][data-removed="true"]')).toHaveCount(1)
      expect((await emptyPanelGeometry(panel, heading)).extraGap).toBeGreaterThan(20)
      await page.clock.runFor(250)
      await assertEmpty()
      await expect(panel.getByTestId('empty-cancel')).toBeFocused()
      await panel.getByRole('button', { name: 'Publish inside', exact: true }).click()
      await page.mouse.move(0, 0)
      await page.clock.runFor(50)
      await expect(panel.locator('[data-sonner-toast]')).toBeVisible()
      expect((await emptyPanelGeometry(panel, heading)).extraGap).toBeGreaterThan(20)
      // A newer business focus survives natural expiry; the old close button must not steal it.
      await panel.getByRole('button', { name: 'Publish inside', exact: true }).focus()
      await page.clock.runFor(6000)
      await expect(panel.locator('[data-sonner-toast][data-removed="true"]')).toHaveCount(1)
      expect((await emptyPanelGeometry(panel, heading)).extraGap).toBeGreaterThan(20)
      await page.clock.runFor(250)
      await assertEmpty()
      await expect(panel.getByRole('button', { name: 'Publish inside', exact: true })).toBeFocused()
      await page.screenshot({ path: info.outputPath('empty-after-expiry.png'), animations: 'disabled' })
    })
  }
  test('keeps the six-second lifetime when a message moves into a modal', async ({ page }) => {
    const time = new Date('2026-11-04T00:00:00Z')
    await page.clock.install({ time })
    await page.clock.pauseAt(time)
    await openHarness(page, 'language=en')
    await page.getByRole('button', { name: 'Publish one', exact: true }).dispatchEvent('click')
    await page.clock.runFor(4000)
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(1)
    await page.getByRole('button', { name: 'Open parent', exact: true }).dispatchEvent('click')
    await page.clock.runFor(350)
    await expect(page.getByRole('dialog', { name: 'Parent fixture', exact: true }).locator('[data-sonner-toast]')).toHaveCount(1)
    await page.clock.runFor(2200)
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
  })
  test('expires normally after a real touch scroll cancels its pointer', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 390, height: 700 }, hasTouch: true, reducedMotion: 'reduce' })
    try {
      const page = await context.newPage()
      await page.clock.install()
      await openHarness(page, 'language=en')
      await page.getByRole('button', { name: 'Publish five', exact: true }).click()
      await page.getByRole('button', { name: 'Open parent', exact: true }).focus()
      await page.keyboard.press('Enter')
      const modal = page.getByRole('dialog', { name: 'Parent fixture', exact: true })
      await expect(modal.getByTestId('fixture-cancel')).toBeFocused()
      await page.mouse.move(0, 699)
      await page.evaluate(() => {
        document.documentElement.dataset.fixturePointerCancels = '0'
        document.addEventListener('pointercancel', () => { document.documentElement.dataset.fixturePointerCancels = String(Number(document.documentElement.dataset.fixturePointerCancels) + 1) }, true)
      })
      const region = modal.locator('[data-toast-modal-region]'), box = await region.boundingBox()
      if (!box) throw new Error('A real scrollable notification region is required')
      const session = await context.newCDPSession(page), x = box.x + box.width / 2, start = box.y + box.height - 25, end = box.y + 25
      await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: start, id: 1 }] })
      for (let step = 1; step <= 6; step++) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: start + (end - start) * step / 6, id: 1 }] })
      await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await expect(page.locator('html')).toHaveAttribute('data-fixture-pointer-cancels', '1')
      expect(await region.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      await page.clock.runFor(10000)
      await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
    } finally { await context.close() }
  })
  for (const language of ['en', 'zh-CN']) {
    test('mobile page long notifications scroll, dismiss and expire: ' + language, async ({ browser }, info) => {
      const context = await browser.newContext({ viewport: { width: 320, height: 320 }, hasTouch: true, isMobile: true, reducedMotion: 'reduce' })
      try {
        const page = await context.newPage(), time = new Date()
        await page.clock.install({ time })
        await page.clock.pauseAt(time)
        await openHarness(page, 'navigation=1&language=' + language + '&theme=' + (language === 'en' ? 'dark' : 'light'))
        await page.getByRole('button', { name: 'Publish five', exact: true }).tap()
        await page.clock.runFor(50)
        const region = page.locator('.app-toasts--page')
        await expect(region.locator('[data-sonner-toast]')).toHaveCount(5)
        expect(await region.evaluate(element => { const r = element.getBoundingClientRect(); return r.top >= 80 && r.bottom <= innerHeight - 15 && element.scrollHeight > element.clientHeight })).toBe(true)
        await page.evaluate(() => {
          document.documentElement.dataset.fixturePageCancels = '0'
          document.documentElement.dataset.fixturePageScrollEnd = 'pending'
          document.documentElement.dataset.fixtureCloseClicks = '0'
          const events: Array<{ type: string; target: string; close: boolean; scrollTop: number; downConnected: boolean | undefined; sameTarget: boolean; prevented: boolean }> = []
          let downTarget: Element | undefined
          for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'touchstart', 'touchend', 'click', 'scroll', 'scrollend']) document.addEventListener(type, event => {
            const target = event.target as Element
            if (type === 'pointerdown') downTarget = target
            if (events.length < 80) events.push({ type, target: target.tagName, close: Boolean(target.closest?.('[data-close-button]')), scrollTop: document.querySelector('.app-toasts--page')!.scrollTop, downConnected: downTarget?.isConnected, sameTarget: downTarget === target, prevented: event.defaultPrevented })
            document.documentElement.dataset.fixtureTouchEvents = JSON.stringify(events)
          }, true)
          document.querySelector('.app-toasts--page')!.addEventListener('scrollend', () => { document.documentElement.dataset.fixturePageScrollEnd = 'ended' }, { once: true })
          document.addEventListener('click', event => { if ((event.target as Element).closest('[data-close-button]')) document.documentElement.dataset.fixtureCloseClicks = String(Number(document.documentElement.dataset.fixtureCloseClicks) + 1) }, true)
          document.addEventListener('pointercancel', () => { document.documentElement.dataset.fixturePageCancels = String(Number(document.documentElement.dataset.fixturePageCancels) + 1) }, true)
        })
        // Use the running-clock pattern of the existing native modal touch test.
        // Keep requiring all five live messages before dismissal, so waiting for expiry cannot pass this case.
        await page.clock.resume()
        const box = (await region.boundingBox())!, session = await context.newCDPSession(page)
        const x = box.x + box.width / 2, start = box.y + box.height - 25, end = box.y + 25
        // Give the real touch sequence a finite drag and stationary release, independent of protocol round-trip speed.
        const gestureTime = Date.now() / 1000 - 1
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: start, id: 1 }], timestamp: gestureTime })
        for (let step = 1; step <= 6; step++) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: start + (end - start) * step / 6, id: 1 }], timestamp: gestureTime + step * 0.05 })
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [], timestamp: gestureTime + 0.55 })
        await expect(page.locator('html')).toHaveAttribute('data-fixture-page-cancels', '1')
        expect(await region.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
        // Check every text segment, including the literal markup tail; a screenshot alone cannot prove this.
        const readback = await region.evaluate(container => {
          const pieces: Array<{ text: string; fits: boolean }> = []
          for (const title of container.querySelectorAll('[data-title]')) {
            const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT)
            let node: Node | null
            while ((node = walker.nextNode())) {
              for (let offset = 0; offset < (node.textContent?.length ?? 0); offset += 32) {
                const range = document.createRange()
                range.setStart(node, offset)
                range.setEnd(node, Math.min(offset + 32, node.textContent!.length))
                const before = range.getBoundingClientRect(), frame = container.getBoundingClientRect()
                container.scrollTop += (before.top + before.bottom - frame.top - frame.bottom) / 2
                const after = range.getBoundingClientRect()
                pieces.push({ text: range.toString(), fits: after.top >= frame.top - 1 && after.bottom <= frame.bottom + 1 && after.left >= frame.left - 1 && after.right <= frame.right + 1 })
              }
            }
          }
          return pieces
        })
        expect(readback.length).toBeGreaterThan(20)
        expect(readback.every(piece => piece.fits)).toBe(true)
        expect(readback.map(piece => piece.text).join('')).toContain('<script>literal text</script>')
        await writeFile(info.outputPath('page-long-text-readback.json'), JSON.stringify(readback, null, 2))
        await page.screenshot({ path: info.outputPath('page-long-text.png'), animations: 'disabled' })
        const close = region.locator('[data-sonner-toast] button[data-close-button]').last()
        await close.scrollIntoViewIfNeeded()
        // Range readback above scrolls synchronously; let those scroll commits reach the compositor before tapping.
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
        await writeFile(info.outputPath('page-close-hit.json'), JSON.stringify(await close.evaluate(button => {
          const r = button.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
          const chain = []
          for (let node: Element | null = button; node; node = node.parentElement) {
            const b = node.getBoundingClientRect(), s = getComputedStyle(node)
            chain.push({ tag: node.tagName, classes: node.className, rect: { x: b.x, y: b.y, width: b.width, height: b.height }, pointerEvents: s.pointerEvents, zIndex: s.zIndex, overflow: s.overflow, scrollTop: node.scrollTop })
          }
          return { hit: hit?.outerHTML.slice(0, 250), hitButton: hit !== null && button.contains(hit), chain }
        }), null, 2))
        await page.screenshot({ path: info.outputPath('page-close-before-tap.png'), animations: 'disabled' })
        await expect(region.locator('[data-sonner-toast]')).toHaveCount(5)
        await close.tap({ timeout: 1000 })
        await writeFile(info.outputPath('page-close-events.json'), JSON.stringify(await page.evaluate(() => ({ clicks: document.documentElement.dataset.fixtureCloseClicks, removed: document.querySelectorAll('[data-sonner-toast][data-removed="true"]').length, scrollEnd: document.documentElement.dataset.fixturePageScrollEnd, events: JSON.parse(document.documentElement.dataset.fixtureTouchEvents!) })), null, 2))
        await expect(page.locator('html')).toHaveAttribute('data-fixture-close-clicks', '1')
        await expect(region.locator('[data-sonner-toast]')).toHaveCount(4)
        const original = await region.locator('[data-sonner-toast]').first().elementHandle()
        await page.getByRole('button', { name: 'Review notification', exact: true }).tap({ timeout: 1000 })
        await page.clock.runFor(50)
        const modal = page.getByRole('dialog', { name: 'Parent fixture', exact: true })
        expect(await modal.locator('[data-sonner-toast]').first().evaluate((node, original) => node === original, original)).toBe(true)
        await modal.getByTestId('fixture-cancel').tap({ timeout: 1000 })
        await page.clock.runFor(50)
        await expect(region.locator('[data-sonner-toast]')).toHaveCount(4)
        expect(await region.locator('[data-sonner-toast]').first().evaluate((node, original) => node === original, original)).toBe(true)
        await page.mouse.move(0, 319)
        await page.clock.runFor(6500)
        await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
      } finally { await context.close() }
    })
  }
  test('preserves the same message and focus boundary through real nested dialogs', async ({ page }, info) => {
    await openHarness(page, 'language=en')
    await page.getByRole('button', { name: 'Publish one', exact: true }).click()
    const original = await page.locator('[data-sonner-toast]').elementHandle()
    await page.getByRole('button', { name: 'Open parent', exact: true }).click()
    const parent = page.getByRole('dialog', { name: 'Parent fixture', exact: true })
    await expect(parent.getByTestId('fixture-cancel')).toBeFocused()
    await expect(parent.locator('[data-sonner-toast]')).toHaveCount(1)
    await parent.locator('[data-toast-modal-region]').hover()
    await parent.getByRole('button', { name: 'Open child', exact: true }).click()
    const child = page.getByRole('dialog', { name: 'Child fixture', exact: true })
    await expect(child.getByRole('button', { name: 'Close child', exact: true })).toBeFocused()
    await expect(child.locator('[data-sonner-toast]')).toHaveCount(1)
    expect(await child.locator('[data-sonner-toast]').evaluate((node, original) => node === original, original)).toBe(true)
    await page.screenshot({ path: info.outputPath('nested-child.png'), animations: 'disabled' })
    await child.getByRole('button', { name: 'Close child', exact: true }).press('Enter')
    await expect(parent.locator('[data-sonner-toast]')).toHaveCount(1)
    await expect(child).toHaveCount(0)
    expect(await parent.locator('[data-sonner-toast]').evaluate((node, original) => node === original, original)).toBe(true)
    await parent.getByTestId('fixture-cancel').press('Enter')
    await expect(parent).toHaveCount(0)
    const toaster = page.locator('[data-sonner-toaster]')
    // Sonner's page list has zero height because its visible messages are absolutely positioned.
    await expect(toaster.locator('[data-sonner-toast]')).toBeVisible()
    expect(await toaster.evaluate(node => node.closest('[role="dialog"]') === null)).toBe(true)
    expect(await page.locator('[data-sonner-toast]').evaluate((node, original) => node === original, original)).toBe(true)
    await page.screenshot({ path: info.outputPath('nested-return-page.png'), animations: 'disabled' })
    await page.locator('[data-sonner-toast] button[data-close-button]').focus()
    await page.keyboard.press('Enter')
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
  })
  for (const scenario of [
    { name: 'narrow-light-zh', width: 320, height: 700, language: 'zh-CN', theme: 'light', scale: 1 },
    { name: 'short-dark-en', width: 568, height: 320, language: 'en', theme: 'dark', scale: 1 },
    { name: 'zoom200-light-en', width: 640, height: 360, language: 'en', theme: 'light', scale: 2 },
  ] as const) {
    test('five long messages remain readable and clear of safety controls: ' + scenario.name, async ({ browser }, info) => {
      // DPR2 + half-sized CSS viewport exercises the layout at 200% desktop zoom equivalence.
      const context = await browser.newContext({ viewport: { width: scenario.width, height: scenario.height }, deviceScaleFactor: scenario.scale, reducedMotion: 'reduce' })
      try {
        const page = await context.newPage()
        await openHarness(page, 'language=' + scenario.language + '&theme=' + scenario.theme)
        await page.getByRole('button', { name: 'Publish five', exact: true }).click()
        // Long page notices may cover the fixture trigger; open it through the real keyboard path.
        await page.getByRole('button', { name: 'Open parent', exact: true }).focus()
        await page.keyboard.press('Enter')
        const modal = page.getByRole('dialog', { name: 'Parent fixture', exact: true })
        const region = modal.locator('[data-toast-modal-region]')
        await expect(modal.locator('[data-sonner-toast][data-visible="true"]')).toHaveCount(5)
        await expect(modal.getByTestId('fixture-cancel')).toBeFocused()
        await region.hover()
        expect(await modal.locator('[data-sonner-toast] script').count()).toBe(0)
        await expect(modal.locator('[data-sonner-toaster]')).toHaveAttribute('data-sonner-theme', scenario.theme)
        await expectNoHorizontalOverflow(page)
        const geometry = await modal.evaluate(element => {
          const box = (e: Element) => { const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom } }
          const region = element.querySelector('[data-toast-modal-region]')!
          const bounds = box(region)
          const controls = Array.from(element.querySelectorAll('[data-testid^="fixture-"]')).map(box)
          const visible = Array.from(region.querySelectorAll('[data-sonner-toast][data-visible="true"]')).map(toast => {
            const r = box(toast)
            return { left: Math.max(r.left, bounds.left), right: Math.min(r.right, bounds.right), top: Math.max(r.top, bounds.top), bottom: Math.min(r.bottom, bounds.bottom) }
          }).filter(r => r.bottom > r.top && r.right > r.left)
          return { bounds, controls, visible, width: innerWidth, height: innerHeight, scrollable: region.scrollHeight > region.clientHeight }
        })
        expect(geometry.scrollable).toBe(true)
        expect(geometry.bounds.bottom).toBeLessThanOrEqual(geometry.height)
        for (const toast of geometry.visible) for (const control of geometry.controls) expect(toast.right > control.left && control.right > toast.left && toast.bottom > control.top && control.bottom > toast.top).toBe(false)
        for (const id of ['fixture-cancel', 'fixture-confirm']) {
          expect(await modal.getByTestId(id).evaluate(button => { const r = button.getBoundingClientRect(); const hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2); return r.top >= 0 && r.bottom <= innerHeight && hit !== null && button.contains(hit) })).toBe(true)
        }
        const readability = []
        for (const id of ['fixture-warning', 'fixture-summary']) {
          const element = modal.getByTestId(id)
          await element.scrollIntoViewIfNeeded()
          const readable = await element.evaluate(element => {
            const r = element.getBoundingClientRect(), body = element.closest('.v-card-text')!.getBoundingClientRect()
            const text = element.querySelector('.v-alert__content')?.getBoundingClientRect() ?? r
            return { id: element.getAttribute('data-testid'), fullyInBody: r.top >= body.top - 1 && r.bottom <= body.bottom + 1, textFits: text.top >= r.top - 1 && text.bottom <= r.bottom + 1 && element.scrollHeight <= element.clientHeight + 1 }
          })
          expect(readable.fullyInBody, id + ' must be fully readable by scrolling the body').toBe(true)
          expect(readable.textFits, id + ' must not clip its own text').toBe(true)
          readability.push(readable)
        }
        await modal.getByTestId('fixture-warning').scrollIntoViewIfNeeded()
        const proof = info.outputPath(scenario.name + '-geometry.json')
        await writeFile(proof, JSON.stringify({ ...geometry, readability }, null, 2))
        const image = info.outputPath(scenario.name + '.png')
        await page.screenshot({ path: image, animations: 'disabled' })
        await info.attach(scenario.name, { path: image, contentType: 'image/png' })
        for (let remaining = 5; remaining > 0; remaining--) {
          const button = modal.locator('[data-sonner-toast][data-removed="false"] button[data-close-button]').last()
          await button.scrollIntoViewIfNeeded()
          await button.focus()
          await button.click({ timeout: 1000 })
          await expect(modal.locator('[data-sonner-toast]')).toHaveCount(remaining - 1)
          await expect(modal.getByTestId('fixture-cancel')).toBeFocused()
        }
        await expect(modal.locator('[data-toast-modal-region]')).toHaveCount(0)
        await expect(modal.getByTestId('fixture-title')).toBeVisible()
      } finally { await context.close() }
    })
  }
})

test.use({ serviceWorkers: 'block' })
for (const kind of ['drawer', 'create'] as const) {
  test('empty modal business content starts at its own padding: ' + kind, async ({ browser }, info) => {
    const baseURL = info.project.use.baseURL
    if (typeof baseURL !== 'string') throw new Error('Requires disposable Compose baseURL')
    const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 }, locale: 'zh-CN', serviceWorkers: 'block', reducedMotion: 'reduce' })
    try {
      const page = await context.newPage()
      await context.addInitScript(() => { localStorage.setItem('moeurl.language', 'zh-CN'); localStorage.setItem('moeurl.theme', 'light') })
      await success(page.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      await page.goto('/console')
      await page.locator('.console-topbar__menu').click()
      const drawer = page.getByTestId('console-mobile-nav')
      await expect(drawer).toBeVisible()
      if (kind === 'create') await drawer.getByRole('button', { name: '新建短链', exact: true }).click()
      const panel = kind === 'drawer' ? drawer.locator('[data-toast-modal-root]') : page.getByTestId('console-create-transition')
      await expect(panel).toBeVisible()
      await expect(panel.locator('.app-toasts')).toHaveCount(1)
      await expect(panel.locator('[data-sonner-toast]')).toHaveCount(0)
      const geometry = await emptyPanelGeometry(panel, kind === 'drawer' ? '.console-shell__mobile-head' : '.console-shell__dialog-heading')
      await writeFile(info.outputPath('empty-business-geometry.json'), JSON.stringify(geometry, null, 2))
      await page.screenshot({ path: info.outputPath('empty-business.png'), animations: 'disabled' })
      expect(Math.abs(geometry.extraGap), 'Empty notification infrastructure must not add a business layout gap').toBeLessThanOrEqual(1)
    } finally { await context.close() }
  })
}
// Leaving the page notification at the top-right must fail a genuine touch, before its timer can expire.
for (const width of [390, 320, 800]) {
test('mobile live notice keeps navigation touchable before expiry at ' + width + 'px', async ({ browser }, info) => {
  const baseURL = info.project.use.baseURL
  if (typeof baseURL !== 'string') throw new Error('Requires disposable Compose baseURL')
  const context = await browser.newContext({ baseURL, viewport: { width, height: width === 320 ? 320 : 844 }, hasTouch: true, isMobile: true, locale: 'zh-CN', serviceWorkers: 'block', reducedMotion: 'reduce' })
  const page = await context.newPage(), keyword = 'navigation493-' + randomBytes(6).toString('hex')
  const links = new Set<string>(), failures: unknown[] = []
  try {
    await context.addInitScript(dark => { localStorage.setItem('moeurl.language', 'zh-CN'); localStorage.setItem('moeurl.theme', dark ? 'dark' : 'light') }, width !== 390)
    await success(page.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
    await success(page.request, '/short-link/batch-create', { requestId: randomUUID(), targetUrls: ['https://example.com/' + keyword] })
    const found = await success(page.request, '/admin/short-link/list?q=' + keyword + '&page=1&pageSize=20')
    expect(found.data.items).toHaveLength(1)
    const id: string = found.data.items[0].id
    links.add(id)
    const note = (await success(page.request, '/admin/short-link/note?id=' + id)).data
    await success(page.request, '/admin/short-link/note/update', { id, note: 'Disposable navigation fixture', expectedUpdatedAt: note.updatedAt })
    await page.goto('/admin/link')
    const listed = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/admin/short-link/list' && new URL(r.url()).searchParams.get('q') === keyword)
    await page.getByRole('textbox', { name: '关键词搜索', exact: true }).fill(keyword)
    expect((await (await listed).json()).code).toBe(0)
    await expect(page.getByTestId('console-link-row')).toHaveCount(1)
    const time = new Date()
    await page.clock.install({ time })
    await page.clock.pauseAt(time)
    await page.getByRole('checkbox').first().check()
    await page.getByTestId('batch-note-clear').click()
    await page.clock.runFor(350)
    const cleared = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/admin/short-link/note/batch-clear')
    await page.getByTestId('batch-note-clear-confirm').click()
    expect((await (await cleared).json()).code).toBe(0)
    await page.clock.runFor(350)
    await expect(page.getByTestId('batch-note-clear-dialog')).toHaveCount(0)
    await page.getByRole('checkbox').first().check()
    await page.getByTestId('batch-note-clear').click()
    await page.clock.runFor(350)
    const dialog = page.getByTestId('batch-note-clear-dialog')
    await expect(page.locator('.v-overlay__content [data-sonner-toast]')).toHaveCount(1)
    const message = await page.locator('[data-sonner-toast]').elementHandle()
    await page.getByTestId('batch-note-clear-cancel').click()
    await page.clock.runFor(350)
    await expect(dialog).toHaveCount(0)
    const menu = page.locator('.console-topbar__menu')
    await writeFile(info.outputPath('navigation-before-tap.json'), JSON.stringify(await menu.evaluate(button => {
      const rect = (node: Element) => { const r = node.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom } }
      const r = button.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
      return { menu: rect(button), toasts: Array.from(document.querySelectorAll('[data-sonner-toast]')).map(rect), interceptedByNotification: Boolean(hit?.closest('[data-sonner-toast]')) }
    }), null, 2))
    await expect(page.locator('[data-sonner-toast]')).toHaveCount(1)
    await menu.tap({ timeout: 1000 })
    await page.clock.runFor(350)
    const drawer = page.getByTestId('console-mobile-nav')
    await expect(drawer).toBeVisible()
    expect(await drawer.locator('[data-sonner-toast]').evaluate((node, original) => node === original, message)).toBe(true)
    await page.screenshot({ path: info.outputPath('navigation-live-notice.png'), animations: 'disabled' })
    const drawerText = await drawer.locator('[data-sonner-toast]').evaluate(toast => {
      const title = toast.querySelector('[data-title]')!
      const range = document.createRange()
      range.selectNodeContents(title)
      const text = range.getBoundingClientRect()
      const region = toast.closest('[data-toast-modal-region]')!.getBoundingClientRect()
      const panel = toast.closest('[data-toast-modal-root]')!.getBoundingClientRect()
      return { textHeight: text.height, visibleHeight: Math.max(0, Math.min(text.bottom, region.bottom, panel.bottom, innerHeight) - Math.max(text.top, region.top, panel.top, 0)) }
    })
    await writeFile(info.outputPath('navigation-drawer-text.json'), JSON.stringify(drawerText, null, 2))
    expect(drawerText.textHeight).toBeGreaterThan(0)
    expect(drawerText.visibleHeight, 'The same live notification must remain readable inside the short drawer').toBeGreaterThanOrEqual(drawerText.textHeight - 1)
    await drawer.locator('.console-shell__mobile-close').tap({ timeout: 1000 })
    await page.clock.runFor(50)
    await expect(drawer).toHaveCount(0)
    const assertMessage = async () => {
      await expect(page.locator('[data-sonner-toast]')).toHaveCount(1)
      expect(await page.locator('[data-sonner-toast]').evaluate((node, original) => node === original, message)).toBe(true)
    }
    await assertMessage()
    await page.locator('.console-topbar > .v-btn').tap({ timeout: 1000 })
    await page.clock.runFor(50)
    const create = page.getByTestId('console-create-transition')
    await expect(create).toBeVisible()
    await assertMessage()
    await create.locator('.console-shell__dialog-heading button').tap({ timeout: 1000 })
    await page.clock.runFor(50)
    await expect(create).toHaveCount(0)
    await assertMessage()
    if (width === 800) {
      const preferences = page.locator('.console-topbar__preferences')
      await preferences.locator('button:has(.preference-switcher__mark--language)').tap({ timeout: 1000 })
      await page.clock.runFor(50)
      await preferences.getByRole('menuitemradio', { name: 'English', exact: true }).tap({ timeout: 1000 })
      await page.clock.runFor(50)
      await assertMessage()
      await preferences.locator('button:has(.preference-switcher__mark--theme)').tap({ timeout: 1000 })
      await page.clock.runFor(50)
      await preferences.getByTestId('theme-choice').last().tap({ timeout: 1000 })
      await page.clock.runFor(50)
      await assertMessage()
    }
    await page.locator('.console-topbar__avatar').tap({ timeout: 1000 })
    await page.clock.runFor(50)
    const account = page.getByTestId('console-mobile-account-menu')
    await expect(account).toBeVisible()
    const accountGeometry = () => account.evaluate(menu => ({ bottom: menu.getBoundingClientRect().bottom, toastTop: document.querySelector('[data-sonner-toast]')!.getBoundingClientRect().top }))
    const initialGeometry = await accountGeometry()
    // The paused notification clock does not commit native CSS transitions, including reduced motion.
    // Wait for the actual non-overlap while the same live message remains; never wait for expiry.
    await expect.poll(async () => { const geometry = await accountGeometry(); return geometry.toastTop - geometry.bottom }, { timeout: 1000 }).toBeGreaterThanOrEqual(0)
    await assertMessage()
    await writeFile(info.outputPath('navigation-account-geometry.json'), JSON.stringify({ initial: initialGeometry, settled: await accountGeometry() }, null, 2))
    await page.screenshot({ path: info.outputPath('navigation-expanded-account.png'), animations: 'disabled' })
    await account.locator('a[href="/profile"]').tap({ timeout: 1000 })
    await page.clock.runFor(50)
    await expect(page).toHaveURL(/\/profile$/)
    await assertMessage()
    await page.setViewportSize({ width: 1000, height: 844 })
    await page.clock.runFor(50)
    await expect(page.locator('.app-toasts--page')).toHaveCount(0)
    await assertMessage()
    await page.setViewportSize({ width, height: width === 320 ? 320 : 844 })
    await page.clock.runFor(50)
    await writeFile(info.outputPath('navigation-resize.json'), JSON.stringify(await page.evaluate(() => {
      const header = document.querySelector<HTMLElement>('[data-toast-page-header]')!
      return { width: innerWidth, display: getComputedStyle(header).display, headerBottom: header.getBoundingClientRect().bottom, pageRegion: Boolean(document.querySelector('.app-toasts--page')) }
    }), null, 2))
    await expect(page.locator('.app-toasts--page')).toHaveCount(1)
    await page.locator('.console-topbar__brand').tap({ timeout: 1000 })
    await page.clock.runFor(50)
    await expect(page).toHaveURL(/\/$/)
    await expect(page.locator('.app-toasts--page')).toHaveCount(0)
    await assertMessage()
    // Every critical tap above used a paused clock. Let native history and its asynchronous guard run;
    // the same still-live message is required afterwards, so expiry cannot make this pass falsely.
    await page.locator('[data-sonner-toast]').hover()
    await page.clock.resume()
    await page.goBack()
    await expect(page).toHaveURL(/\/profile$/)
    await expect(page.locator('[data-toast-page-header]')).toBeVisible()
    await writeFile(info.outputPath('navigation-return.json'), JSON.stringify(await page.evaluate(() => ({ url: location.pathname, headerCount: document.querySelectorAll('[data-toast-page-header]').length, transition: document.querySelector('[data-testid="app-route-transition"]')?.innerHTML.slice(0, 500) })), null, 2))
    await expect(page.locator('.app-toasts--page')).toHaveCount(1)
    await assertMessage()
  } catch (error) { failures.push(error) } finally {
    try {
      const found = await success(page.request, '/admin/short-link/list?q=' + keyword + '&page=1&pageSize=20')
      for (const link of found.data.items) links.add(link.id)
    } catch (error) { failures.push(error) }
    for (const id of links) { try { await success(page.request, '/admin/short-link/delete', { id }) } catch (error) { failures.push(error) } }
    try { await context.close() } catch (error) { failures.push(error) }
  }
  if (failures.length) throw new AggregateError(failures, 'Navigation scenario or exact fixture cleanup failed')
})
}

// A fixed toast covering the reopened title must fail even when every business request succeeds.
for (const width of [1280, 390]) {
  test('feedback keeps a real success notification clear of the reopened title at ' + width + 'px', async ({ browser }, info) => {
    const baseURL = info.project.use.baseURL
    if (typeof baseURL !== 'string') throw new Error('Requires disposable Compose baseURL')
    const context = await browser.newContext({ baseURL, viewport: { width, height: width === 390 ? 844 : 900 }, hasTouch: width === 390, locale: 'zh-CN', serviceWorkers: 'block', reducedMotion: 'reduce' })
    const page = await context.newPage(), keyword = 'feedback491-' + randomBytes(6).toString('hex')
    const links = new Set<string>(), failures: unknown[] = []
    try {
      await context.addInitScript(() => { localStorage.setItem('moeurl.language', 'zh-CN'); localStorage.setItem('moeurl.theme', 'light') })
      await success(page.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      await success(page.request, '/short-link/batch-create', { requestId: randomUUID(), targetUrls: ['https://example.com/' + keyword] })
      const found = await success(page.request, '/admin/short-link/list?q=' + keyword + '&page=1&pageSize=20')
      expect(found.data.items).toHaveLength(1)
      const id: string = found.data.items[0].id
      links.add(id)
      const note = (await success(page.request, '/admin/short-link/note?id=' + id)).data
      await success(page.request, '/admin/short-link/note/update', { id, note: 'Disposable notification fixture', expectedUpdatedAt: note.updatedAt })
      await page.goto('/admin/link')
      const listed = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/admin/short-link/list' && new URL(r.url()).searchParams.get('q') === keyword)
      await page.getByRole('textbox', { name: '关键词搜索', exact: true }).fill(keyword)
      expect((await (await listed).json()).code).toBe(0)
      await expect(page.getByTestId('console-link-row')).toHaveCount(1)
      await page.getByRole('checkbox').first().check()
      await page.getByTestId('batch-note-clear').click()
      await expect(page.getByTestId('batch-note-clear-confirm')).toBeEnabled()
      const cleared = page.waitForResponse(r => new URL(r.url()).pathname === '/api/v1/admin/short-link/note/batch-clear')
      await page.getByTestId('batch-note-clear-confirm').click()
      expect((await (await cleared).json()).code).toBe(0)
      await expect(page.getByTestId('batch-note-clear-dialog')).toHaveCount(0)
      await page.getByRole('checkbox').first().check()
      await page.getByTestId('batch-note-clear').click()
      await expect(page.getByTestId('batch-note-clear-summary')).toBeVisible()
      await expect(page.getByTestId('batch-note-clear-cancel')).toBeFocused()
      await expect(page.locator('[data-sonner-toast]:visible')).toHaveCount(1)
      await expectNoHorizontalOverflow(page)
      const geometry = await page.getByTestId('batch-note-clear-dialog').evaluate(card => {
        const rect = (element: Element) => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom } }
        return { title: rect(card.querySelector('.v-card-title')!), toasts: Array.from(document.querySelectorAll('[data-sonner-toast]')).map(rect) }
      })
      const proof = info.outputPath('notification-title-geometry.json')
      await writeFile(proof, JSON.stringify(geometry, null, 2))
      await info.attach('notification-title-geometry', { path: proof, contentType: 'application/json' })
      const image = info.outputPath('notification-title.png')
      await page.screenshot({ path: image, animations: 'disabled' })
      await info.attach('notification-title', { path: image, contentType: 'image/png' })
      for (const toast of geometry.toasts) {
        const title = geometry.title
        expect(toast.right > title.left && title.right > toast.left && toast.bottom > title.top && title.bottom > toast.top, 'Notification overlaps the real reopened dialog title').toBe(false)
      }
      const dialog = page.getByTestId('batch-note-clear-dialog')
      if (width === 390) {
        // Exercise the real 220ms drawer-to-create overlap with normal motion and the same live message.
        await page.emulateMedia({ reducedMotion: 'no-preference' })
        await expect(page.locator('[data-sonner-toast]')).toHaveCount(1)
        const message = await page.locator('[data-sonner-toast]').elementHandle()
        await dialog.getByTestId('batch-note-clear-cancel').click()
        await expect(dialog).toHaveCount(0)
        const menu = page.locator('.console-topbar__menu')
        const menuEntry = await menu.evaluate(button => {
          const r = button.getBoundingClientRect(), hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2)
          return { messageCount: document.querySelectorAll('[data-sonner-toast]').length, interceptedByNotification: Boolean(hit?.closest('[data-sonner-toast]')) }
        })
        await menu.tap({ timeout: 1000 })
        const drawer = page.getByTestId('console-mobile-nav')
        await writeFile(info.outputPath('drawer-handoff-start.json'), JSON.stringify({ menuEntry, ...await page.evaluate(() => ({
          messages: document.querySelectorAll('[data-sonner-toast]').length,
          owners: Array.from(document.querySelectorAll('[data-sonner-toast]')).map(node => node.closest('[data-toast-modal-root]')?.className ?? 'page'),
          panels: Array.from(document.querySelectorAll('[data-toast-modal-root], .v-dialog.v-overlay--active .v-overlay__content')).map(node => ({ classes: node.className, parent: node.parentElement?.className, hidden: node.closest('[inert], [aria-hidden="true"]')?.className })),
        })) }, null, 2))
        await expect(drawer.locator('[data-sonner-toast]')).toHaveCount(1)
        await page.evaluate(() => {
          document.documentElement.dataset.fixtureHandoff = 'pending'
          const observer = new MutationObserver(() => {
            const leaving = document.querySelector('.console-shell__mobile-nav.moe-overlay-leave-active')
            const current = document.querySelector('.console-shell__dialog [data-sonner-toast]')
            if (leaving && current) { document.documentElement.dataset.fixtureHandoff = 'observed'; observer.disconnect() }
          })
          observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] })
        })
        await drawer.getByRole('button', { name: '新建短链', exact: true }).click()
        await expect(page.locator('html')).toHaveAttribute('data-fixture-handoff', 'observed')
        const create = page.getByTestId('console-create-transition')
        await expect(create.locator('[data-sonner-toast]')).toHaveCount(1)
        expect(await create.locator('[data-sonner-toast]').evaluate((node, original) => node === original, message)).toBe(true)
        await expect(drawer).toHaveCount(0)
        await page.keyboard.press('Escape')
        await expect(create).toHaveCount(0)
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await page.getByTestId('batch-note-clear').click()
        await expect(dialog.getByTestId('batch-note-clear-cancel')).toBeFocused()
      }
      await page.locator('[data-sonner-toast]').hover()
      await page.setViewportSize({ width, height: 320 })
      const warning = dialog.locator('.v-alert').first()
      await warning.scrollIntoViewIfNeeded()
      await page.screenshot({ path: info.outputPath('notification-short-height.png'), animations: 'disabled' })
      const warningLayout = await warning.evaluate(element => {
        const r = element.getBoundingClientRect(), text = element.querySelector('.v-alert__content')!.getBoundingClientRect()
        return { height: r.height, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight, textFits: text.top >= r.top - 1 && text.bottom <= r.bottom + 1 }
      })
      await writeFile(info.outputPath('real-short-warning-geometry.json'), JSON.stringify(warningLayout, null, 2))
      expect(warningLayout.scrollHeight).toBeLessThanOrEqual(warningLayout.clientHeight + 1)
      expect(warningLayout.textFits, 'The real safety warning must not clip its own text at 320px height').toBe(true)
      for (const paragraph of await dialog.getByTestId('batch-note-clear-summary').locator('p').all()) {
        await paragraph.scrollIntoViewIfNeeded()
        expect(await paragraph.evaluate(element => {
          const r = element.getBoundingClientRect(), body = element.closest('.v-card-text')!.getBoundingClientRect()
          return r.top >= body.top - 1 && r.bottom <= body.bottom + 1
        }), 'Each real summary line must remain readable by scrolling the body').toBe(true)
      }
    } catch (error) { failures.push(error) } finally {
      try {
        const found = await success(page.request, '/admin/short-link/list?q=' + keyword + '&page=1&pageSize=20')
        for (const link of found.data.items) links.add(link.id)
      } catch (error) { failures.push(error) }
      for (const id of links) { try { await success(page.request, '/admin/short-link/delete', { id }) } catch (error) { failures.push(error) } }
      try { await context.close() } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, 'Notification scenario or exact fixture cleanup failed')
  })
}
