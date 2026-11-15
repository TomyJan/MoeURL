import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, Locator, Page, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'
import { collectSettingsCleanupErrors } from './settings-dialog-cleanup'
import type { CreateShortLinkInput } from '../src/entities/short-link/model'

interface Link { id: string; targetUrl: string }
test.use({ actionTimeout: 10_000 })

async function api<T>(request: APIRequestContext, path: string, data?: unknown): Promise<T> {
  const response = data === undefined ? await request.get('/api/v1' + path) : await request.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200)
  const payload = await response.json(); expect(payload.code).toBe(0)
  return payload.data as T
}

/** Measures the viewport and every clipping ancestor, rather than DOM visibility alone. */
async function geometry(locator: Locator) {
  return locator.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const bounds = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }
    const intersection = { left: Math.max(0, rect.left), top: Math.max(0, rect.top), right: Math.min(innerWidth, rect.right), bottom: Math.min(innerHeight, rect.bottom) }
    const clips = []
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      // Root overflow applies to the viewport, already intersected above. Scroll locking
      // offsets the root box but does not move the fixed overlay's visible viewport.
      if (parent === document.documentElement) continue
      const style = getComputedStyle(parent), box = parent.getBoundingClientRect()
      const clipX = /auto|scroll|hidden|clip/.test(style.overflowX), clipY = /auto|scroll|hidden|clip/.test(style.overflowY)
      if (!clipX && !clipY) continue
      const left = box.left + parent.clientLeft, top = box.top + parent.clientTop
      clips.push({ tag: parent.tagName, className: parent.className, clipX, clipY, left, top, width: parent.clientWidth, height: parent.clientHeight })
      if (clipX) { intersection.left = Math.max(intersection.left, left); intersection.right = Math.min(intersection.right, left + parent.clientWidth) }
      if (clipY) { intersection.top = Math.max(intersection.top, top); intersection.bottom = Math.min(intersection.bottom, top + parent.clientHeight) }
    }
    const clipped = Math.max(0, intersection.left - rect.left, intersection.top - rect.top, rect.right - intersection.right, rect.bottom - intersection.bottom)
    return { viewport: { width: innerWidth, height: innerHeight }, bounds, intersection, clipped, clips }
  })
}

/** Keeps fixed controls fully inside the visible clip while the actual form body scrolls. */
async function inspectPositions(page: Page, info: TestInfo, en: boolean, blocked: boolean, records: unknown[]) {
  const dialog = page.getByRole('dialog'), body = dialog.locator('.short-link-settings-dialog__body')
  const save = dialog.getByRole('button', { name: en ? 'Save' : '保存', exact: true })
  const cancel = dialog.getByRole('button', { name: en ? 'Cancel' : '取消', exact: true })
  for (const fraction of [0, 0.5, 1]) {
    const scroll = await body.evaluate((element, fraction) => {
      element.scrollTop = (element.scrollHeight - element.clientHeight) * fraction
      return { top: element.scrollTop, range: element.scrollHeight - element.clientHeight, height: element.clientHeight }
    }, fraction)
    const controls = { save: await geometry(save), cancel: await geometry(cancel) }
    const warning = blocked ? await geometry(dialog.getByText(en ? 'The list or access state has changed. Wait for the list to recover, or cancel and reopen this editor.' : '列表或权限状态已变化。请等待列表恢复，或取消后重新打开访问配置。', { exact: true })) : undefined
    records.push({ blocked, fraction, scroll, controls, warning, body: await geometry(body), dialog: await geometry(dialog) })
    for (const [name, box] of Object.entries(controls)) {
      expect.soft(box.bounds.height, name + ' hit area').toBeGreaterThanOrEqual(44)
      expect.soft(box.bounds.width, name + ' nonempty width').toBeGreaterThan(0)
      expect.soft(box.clipped, name + ' clipped at scroll ' + fraction).toBeLessThanOrEqual(1)
    }
    if (warning) expect.soft(warning.clipped, 'unavailable feedback clipped at scroll ' + fraction).toBeLessThanOrEqual(1)
    expect.soft(scroll.height, 'remaining editable body').toBeGreaterThanOrEqual(80)
    if (scroll.range > 1) expect.soft(Math.abs(scroll.top - scroll.range * fraction), 'body can reach requested scroll position').toBeLessThanOrEqual(1)
    await expectNoHorizontalOverflow(page)
    if (fraction !== 0.5) {
      const file = info.outputPath((blocked ? 'blocked' : 'ready') + '-' + fraction + '.png')
      await page.screenshot({ path: file, animations: 'disabled' }); await info.attach((blocked ? 'blocked' : 'ready') + '-' + fraction, { path: file, contentType: 'image/png' })
    }
  }
}

/** Exercises the real wheel entry point before later programmatic position checks. */
async function inspectWheel(page: Page, password: Locator, records: unknown[]) {
  const body = page.getByRole('dialog').locator('.short-link-settings-dialog__body')
  // Establish the starting position only; every measured move below comes from the mouse.
  await body.evaluate(element => { element.scrollTop = 0 })
  const before = await geometry(password), visible = (await geometry(body)).intersection
  expect(before.clipped, 'last input starts below the visible body').toBeGreaterThan(1)
  expect(visible.right - visible.left).toBeGreaterThan(0)
  expect(visible.bottom - visible.top).toBeGreaterThan(before.bounds.height)
  await page.mouse.move((visible.left + visible.right) / 2, (visible.top + visible.bottom) / 2)
  const delta = Math.max(1, Math.min(24, (visible.bottom - visible.top - before.bounds.height) / 2))
  const initial = await body.evaluate(element => ({ top: element.scrollTop, range: element.scrollHeight - element.clientHeight }))
  expect(initial.range).toBeGreaterThan(1)
  let field = before
  for (let step = 0; field.clipped > 1 && step <= Math.ceil(initial.range / delta); step++) {
    const previous = await body.evaluate(element => element.scrollTop)
    await page.mouse.wheel(0, delta)
    await expect.poll(() => body.evaluate(element => element.scrollTop), { message: 'native wheel scrolls the form body' }).toBeGreaterThan(previous)
    field = await geometry(password)
  }
  expect(field.clipped, 'native wheel makes the last input fully reachable').toBeLessThanOrEqual(1)
  const fieldScroll = await body.evaluate(element => element.scrollTop)
  await page.mouse.wheel(0, initial.range)
  await expect.poll(() => body.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop), { message: 'native wheel reaches the body bottom' }).toBeLessThanOrEqual(1)
  records.push({ wheel: true, initial, before, field, fieldScroll, bottom: await body.evaluate(element => ({ top: element.scrollTop, range: element.scrollHeight - element.clientHeight })), body: await geometry(body) })
}

// A scrolling whole card or an alert left inside the form clips controls in these real viewports.
for (const language of ['zh-CN', 'en']) for (const [width, height] of [[320, 500], [390, 800], [1280, 900]] as const) {
  test('v0.80.1 ' + language + ' ' + width + 'x' + height + ' keeps settings actions and feedback reachable', async ({ browser, request }, info) => {
    test.setTimeout(150_000)
    const baseURL = info.project.use.baseURL
    if (typeof baseURL !== 'string') throw new Error('Isolated product required')
    const en = language === 'en', keyword = 'layout81-' + randomBytes(6).toString('hex')
    const context = await browser.newContext({ baseURL, viewport: { width, height }, locale: language, colorScheme: en ? 'dark' : 'light', hasTouch: width < 400, serviceWorkers: 'block', reducedMotion: 'reduce' })
    const records: unknown[] = [], errors: unknown[] = []
    let link: Link | undefined, releaseList: (() => void) | undefined
    try {
      await context.addInitScript(language => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', language === 'en' ? 'dark' : 'light') }, language)
      await api(request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      await api(context.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      const create: CreateShortLinkInput = { targetUrl: 'https://example.com/' + keyword, metadata: { title: keyword, tags: ['layout', 'long-form'] }, redirectMode: 'intermediate', intermediateDelaySeconds: 10, expiration: { mode: 'at', expiresAt: new Date(Date.now() + 86_400_000).toISOString() }, password: { mode: 'set', value: 'original-' + keyword }, maxVisits: 100 }
      link = (await api<{ shortLink: Link }>(request, '/short-link/create', create)).shortLink
      const page = await context.newPage(), writes: unknown[] = []
      page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/v1/admin/short-link/update') writes.push(request.postDataJSON()) })
      await page.goto('/admin/link')
      const listed = page.waitForResponse(response => { const url = new URL(response.url()); return url.pathname === '/api/v1/admin/short-link/list' && url.searchParams.get('q') === keyword })
      await page.getByRole('textbox', { name: en ? 'Keyword' : '关键词搜索', exact: true }).fill(keyword)
      expect((await (await listed).json()).meta.total).toBe(1)
      const row = page.getByTestId('console-link-row')
      const open = async () => {
        await row.getByRole('button', { name: en ? 'More actions' : '更多操作', exact: true }).click()
        await page.getByRole('menuitem', { name: en ? 'Access settings' : '访问配置', exact: true }).click()
      }
      await open()
      const dialog = page.getByRole('dialog'), target = 'https://example.com/' + keyword + '/' + 'long-path-'.repeat(20)
      await dialog.getByRole('textbox', { name: en ? 'Target URL' : '目标链接', exact: true }).fill(target)
      const password = dialog.getByLabel(en ? 'New access password' : '新访问密码', { exact: true }), newPassword = 'replacement-' + keyword
      if (en && width === 320) await inspectWheel(page, password, records)
      await password.fill(newPassword)
      await expect(password).toBeFocused()
      await inspectPositions(page, info, en, false, records)
      const listURL = '**/api/v1/admin/short-link/list?**'
      let observeList!: () => void
      const observed = new Promise<void>(resolve => { observeList = resolve }), released = new Promise<void>(resolve => { releaseList = resolve })
      await page.route(listURL, async route => { const response = await route.fetch(); observeList(); await released; await route.fulfill({ response }) })
      try {
        await context.setOffline(true); await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false)
        await context.setOffline(false); await observed
        await expect(dialog.getByRole('button', { name: en ? 'Save' : '保存', exact: true })).toBeDisabled()
        await expect(dialog.getByRole('button', { name: en ? 'Cancel' : '取消', exact: true })).toBeEnabled()
        await expect(password).toHaveValue(newPassword); await expect(password).toBeFocused()
        await inspectPositions(page, info, en, true, records)
        expect(writes).toHaveLength(0)
      } finally { releaseList?.(); await context.setOffline(false) }
      await expect(dialog.getByRole('button', { name: en ? 'Save' : '保存', exact: true })).toBeEnabled()
      await expect(password).toHaveValue(newPassword); await expect(password).toBeFocused()
      await page.unroute(listURL)
      const saved = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/v1/admin/short-link/update')
      await dialog.getByRole('button', { name: en ? 'Save' : '保存', exact: true }).click()
      const response = await saved
      expect(response.request().postDataJSON()).toStrictEqual({ id: link.id, targetUrl: target, redirectMode: 'intermediate', intermediateDelaySeconds: 10, password: { mode: 'set', value: newPassword } })
      expect((await response.json()).code).toBe(0); await expect(dialog).toHaveCount(0)
      await expect(row.locator('a.link-table__target')).toHaveAttribute('href', target)
      await open()
      await dialog.getByRole('textbox', { name: en ? 'Target URL' : '目标链接', exact: true }).fill('https://example.com/cancel-' + keyword)
      await dialog.getByRole('button', { name: en ? 'Cancel' : '取消', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      expect(writes).toHaveLength(1)
      await expect(row.locator('a.link-table__target')).toHaveAttribute('href', target)
    } catch (error) { errors.push(error) } finally {
      await collectSettingsCleanupErrors(errors, [
        async () => { releaseList?.(); await context.setOffline(false) },
        async () => {
          const file = info.outputPath('geometry.json')
          await writeFile(file, JSON.stringify({ browser: browser.version(), driverNode: process.version, language, width, height, records }, null, 2)); await info.attach('geometry', { path: file, contentType: 'application/json' })
        },
        async () => { if (link) await api(request, '/admin/short-link/delete', { id: link.id }) },
        () => context.close(),
      ])
    }
    if (errors.length) throw new AggregateError(errors, 'Settings geometry or owned fixture cleanup failed')
  })
}
