import { randomBytes } from 'node:crypto'
import { expect, test as base } from '@playwright/test'
import type { APIRequestContext, Browser, BrowserContext, Locator, Page, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

type Link = { label: string; url: string }
type Settings = { links: Link[]; updatedAt: string }
type Preferences = { language: 'en' | 'zh-CN' | null; theme: 'system' | 'light' | 'dark' | null; updatedAt: string | null }
type Recovery = { request: APIRequestContext; context(value: BrowserContext): void; account(id: string): void }
const updatePath = '/api/v1/admin/system/footer-links/update'
const readPath = '/api/v1/admin/system/footer-links'
const text = {
  en: { form: 'Footer link settings', nav: 'Footer navigation', label: 'Label', url: 'URL', add: 'Add link', remove: 'Remove link', up: 'Move link up', down: 'Move link down', reload: 'Reload footer links', save: 'Save footer links', saved: 'Footer links saved.', conflict: 'Footer links changed elsewhere. Your draft is kept; explicitly reload before saving again. Writes are never replayed automatically.' },
  zh: { form: '页脚链接设置', nav: '页脚导航', label: '标签', url: '网址', add: '添加链接', remove: '删除链接', up: '上移链接', down: '下移链接', reload: '重新加载页脚链接', save: '保存页脚链接', saved: '页脚链接已保存。' },
} as const

const test = base.extend<{ footerRecovery: Recovery }>({
  footerRecovery: async ({ request }, use) => {
    // The independent request fixture remains usable even after every management page has closed.
    await login(request)
    const original = await read(request)
    const preferences = await readPreferences(request)
    const contexts: BrowserContext[] = []
    const accounts: string[] = []
    const failures: unknown[] = []
    try {
      await use({ request, context: value => { contexts.push(value) }, account: id => { accounts.push(id) } })
    } catch (error) { failures.push(error) } finally {
      try {
        await write(request, original.links)
        expect((await read(request)).links).toEqual(original.links)
      } catch (error) { failures.push(error) }
      try {
        await writePreferences(request, preferences.language, preferences.theme)
        expect(await readPreferences(request)).toMatchObject({ language: preferences.language, theme: preferences.theme })
      } catch (error) { failures.push(error) }
      for (const id of accounts) {
        try { await post(request, '/admin/user/update', { id, nickname: 'Retired footer fixture', status: 'disabled' }) } catch (error) { failures.push(error) }
      }
      for (const context of contexts) {
        try { await context.close() } catch (error) { failures.push(error) }
      }
    }
    if (failures.length) throw new AggregateError(failures, 'Independent footer, preferences and account recovery failed')
  },
})

test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

// Catches a lost/reordered draft, accidental legacy-form coupling, interpreted markup or unsafe new-window navigation.
test('v0.35.0 E01 English desktop keyboard replacement reaches a fresh visitor safely', async ({ page, browser, footerRecovery }, info) => {
  const request = footerRecovery.request
  const original: Link[] = [{ label: 'Original link', url: 'https://example.com/original' }]
  const initial = await write(request, original)
  const legacy = await get<unknown>(request, '/admin/system/settings')
  const home = await get<{ title: string; summary: string; updatedAt: string }>(request, '/admin/system/home-content')
  const appearance = await get<{ accentPreset: string; updatedAt: string }>(request, '/admin/system/appearance')
  await writePreferences(request, 'en', 'light')
  await prepareAdmin(page, 'en', { width: 1280, height: 720 })
  const form = page.getByRole('form', { name: text.en.form, exact: true })
  await expect(field(form, text.en.label, 1)).toHaveValue('Original link')
  const attribution = await page.locator('.site-footer > span').allTextContents()
  const buildURL = await page.locator('.site-footer > span a').getAttribute('href')

  await activate(form.getByRole('button', { name: text.en.add, exact: true }))
  await keyboardFill(field(form, text.en.label, 2), 'Temporary row')
  await keyboardFill(field(form, text.en.url, 2), 'https://example.com/temporary')
  await activate(form.getByRole('button', { name: text.en.remove + ' 2', exact: true }))
  await expect(form.locator('fieldset')).toHaveCount(1)
  const destination = new URL('/e2e-footer-destination?source=footer', info.project.use.baseURL).href
  await activate(form.getByRole('button', { name: text.en.add, exact: true }))
  await keyboardFill(field(form, text.en.label, 2), '<b>Docs & policy</b>')
  await keyboardFill(field(form, text.en.url, 2), destination)
  await activate(form.getByRole('button', { name: text.en.add, exact: true }))
  await keyboardFill(field(form, text.en.label, 3), 'Contact')
  await keyboardFill(field(form, text.en.url, 3), 'HTTPS://Example.COM:00443/help?A=b#FAQ')
  await activate(form.getByRole('button', { name: text.en.up + ' 3', exact: true }))
  await expect(field(form, text.en.label, 2)).toHaveValue('Contact')
  await activate(form.getByRole('button', { name: text.en.down + ' 2', exact: true }))
  await activate(form.getByRole('button', { name: text.en.up + ' 2', exact: true }))
  await expect(field(form, text.en.label, 1)).toHaveValue('<b>Docs & policy</b>')
  expect(await read(request)).toEqual(initial)
  const unsavedVisitor = await visitor(browser, footerRecovery, info, 'en', { width: 1280, height: 720 })
  await expectNavigation(unsavedVisitor, 'en', original)

  const expected: Link[] = [
    { label: '<b>Docs & policy</b>', url: destination },
    { label: 'Original link', url: 'https://example.com/original' },
    { label: 'Contact', url: 'https://example.com/help?A=b#FAQ' },
  ]
  const response = page.waitForResponse(value => new URL(value.url()).pathname === updatePath)
  await activate(form.getByRole('button', { name: text.en.save, exact: true }))
  const saved = await response
  expect(saved.request().postDataJSON()).toEqual({ links: expected, expectedUpdatedAt: initial.updatedAt })
  expect(saved.headers()['cache-control']).toBe('no-store')
  expect((await saved.json()).code).toBe(0)
  await expect(page.getByText(text.en.saved, { exact: true })).toBeVisible()
  const current = await read(request)
  expect(current.links).toEqual(expected)
  expect(current.updatedAt).not.toBe(initial.updatedAt)
  expect(await get(request, '/admin/system/settings')).toEqual(legacy)
  expect(await get(request, '/admin/system/home-content')).toEqual(home)
  expect(await get(request, '/admin/system/appearance')).toEqual(appearance)
  await expectNoHorizontalOverflow(page)
  await form.getByRole('button', { name: text.en.save, exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: info.outputPath('footer-en-admin.png') })

  const legacyResponse = page.waitForResponse('**/api/v1/admin/system/settings/update')
  await page.getByRole('button', { name: 'Save settings', exact: true }).click()
  expect((await (await legacyResponse).json()).code).toBe(0)
  await post(request, '/admin/system/home-content/update', { title: home.title, summary: home.summary, expectedUpdatedAt: home.updatedAt })
  await post(request, '/admin/system/appearance/update', { accentPreset: appearance.accentPreset, expectedUpdatedAt: appearance.updatedAt })
  expect(await read(request)).toEqual(current)

  const publicPage = await visitor(browser, footerRecovery, info, 'en', { width: 1280, height: 720 })
  await expectNavigation(publicPage, 'en', expected)
  expect(await publicPage.locator('.site-footer > span').allTextContents()).toEqual(attribution)
  await expect(publicPage.locator('.site-footer > span a')).toHaveAttribute('href', buildURL!)
  const destinationRequests: Array<Record<string, string>> = []
  // Only the destination is controlled: product APIs and the source document remain real Compose responses.
  await publicPage.context().route(destination, async route => {
    destinationRequests.push(await route.request().allHeaders())
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Controlled footer destination</title><p>Controlled destination reached</p>' })
  })
  const first = publicPage.getByRole('navigation', { name: text.en.nav, exact: true }).getByRole('link').first()
  await first.scrollIntoViewIfNeeded()
  await first.focus()
  await publicPage.keyboard.press('Tab')
  await publicPage.keyboard.press('Shift+Tab')
  await expect(first).toBeFocused()
  await expect(first).toHaveCSS('outline-style', 'solid')
  await expect(first).toHaveCSS('outline-width', '2px')
  await expectNoHorizontalOverflow(publicPage)
  await publicPage.screenshot({ path: info.outputPath('footer-en-public.png') })
  expect(destinationRequests).toHaveLength(0)
  const opened = publicPage.context().waitForEvent('page')
  await first.press('Enter')
  const popup = await opened
  await expect(popup.getByText('Controlled destination reached', { exact: true })).toBeVisible()
  expect(popup.url()).toBe(destination)
  expect(await popup.evaluate(() => window.opener)).toBeNull()
  expect(await popup.evaluate(() => document.referrer)).toBe('')
  expect(destinationRequests).toHaveLength(1)
  expect(destinationRequests[0]).not.toHaveProperty('referer')
  await page.close()
  expect((await read(request)).links).toEqual(expected)
})

// Catches UTF-16 length counting, oversized fixed fields, clipped actions and theme-specific invisible keyboard focus.
test('v0.35.0 E02 Chinese mobile keeps five maximum links usable in light and dark', async ({ page, browser, footerRecovery }, info) => {
  const request = footerRecovery.request
  const initial = await write(request, [])
  await writePreferences(request, 'zh-CN', 'light')
  await prepareAdmin(page, 'zh-CN', { width: 390, height: 800 })
  const form = page.getByRole('form', { name: text.zh.form, exact: true })
  const add = form.getByRole('button', { name: text.zh.add, exact: true })
  await expect(add).toBeEnabled()
  const maximum: Link[] = []
  for (let index = 1; index <= 5; index++) {
    const prefix = 'https://example.com/docs/' + index + '?q='
    const link = { label: '页脚' + index + '🌸'.repeat(37), url: prefix + 'a'.repeat(2048 - prefix.length) }
    expect([...link.label]).toHaveLength(40)
    expect(Buffer.byteLength(link.url, 'utf8')).toBe(2048)
    maximum.push(link)
    await activate(add)
    await keyboardFill(field(form, text.zh.label, index), link.label)
    await keyboardFill(field(form, text.zh.url, index), link.url)
  }
  await expect(add).toBeDisabled()
  await expect(form.locator('fieldset')).toHaveCount(5)
  expect(await read(request)).toEqual(initial)
  const response = page.waitForResponse(value => new URL(value.url()).pathname === updatePath)
  await activate(form.getByRole('button', { name: text.zh.save, exact: true }))
  const saved = await response
  expect(saved.request().postDataJSON()).toEqual({ links: maximum, expectedUpdatedAt: initial.updatedAt })
  expect((await saved.json()).code).toBe(0)
  await expect(page.getByText(text.zh.saved, { exact: true })).toBeVisible()
  expect((await read(request)).links).toEqual(maximum)
  for (let index = 1; index <= 5; index++) {
    for (const control of [field(form, text.zh.label, index), field(form, text.zh.url, index), ...[text.zh.up, text.zh.down, text.zh.remove].map(name => form.getByRole('button', { name: name + ' ' + index, exact: true }))]) {
      await control.scrollIntoViewIfNeeded()
      await expect(control).toBeInViewport()
    }
  }
  const lastURL = field(form, text.zh.url, 5)
  await lastURL.focus()
  await expect(form.locator('.v-field--focused')).toHaveCSS('box-shadow', /^(?!none$).+/)
  await page.keyboard.press('Tab')
  const up = form.getByRole('button', { name: text.zh.up + ' 5', exact: true })
  await expect(up).toBeFocused()
  await expect(up).toHaveCSS('outline-style', 'solid')
  await expect(up).toHaveCSS('outline-width', '3px')
  const save = form.getByRole('button', { name: text.zh.save, exact: true })
  await form.getByRole('button', { name: text.zh.reload, exact: true }).scrollIntoViewIfNeeded()
  await expect(form.getByRole('button', { name: text.zh.reload, exact: true })).toBeInViewport()
  await save.scrollIntoViewIfNeeded()
  await expect(save).toBeInViewport()
  const lastFieldBox = await lastURL.boundingBox()
  const actionsBox = await form.locator(':scope > .footer-links__actions').boundingBox()
  expect(lastFieldBox).not.toBeNull()
  expect(actionsBox).not.toBeNull()
  expect(lastFieldBox!.y + lastFieldBox!.height).toBeLessThanOrEqual(actionsBox!.y)
  await expectNoHorizontalOverflow(page)
  // Full-page capture retains all five rows and any real Toast; viewport reachability is asserted separately.
  await page.screenshot({ path: info.outputPath('footer-zh-admin.png'), fullPage: true })

  const publicPage = await visitor(browser, footerRecovery, info, 'zh-CN', { width: 390, height: 800 })
  await expectNavigation(publicPage, 'zh', maximum)
  await expect(publicPage.locator('.v-application')).toHaveClass(/v-theme--moeurlLight/)
  await expectFooterGeometry(publicPage)
  const links = publicPage.getByRole('navigation', { name: text.zh.nav, exact: true }).getByRole('link')
  await links.first().focus()
  await publicPage.keyboard.press('Tab')
  await expect(links.nth(1)).toBeFocused()
  await expect(links.nth(1)).toHaveCSS('outline-style', 'solid')
  await expect(links.nth(1)).toHaveCSS('outline-width', '2px')
  await publicPage.screenshot({ path: info.outputPath('footer-zh-light-public.png') })
  await publicPage.emulateMedia({ colorScheme: 'dark' })
  await expect(publicPage.locator('.v-application')).toHaveClass(/v-theme--moeurlDark/)
  await expectFooterGeometry(publicPage)
  await expect(links.nth(1)).toHaveCSS('outline-style', 'solid')
  await publicPage.screenshot({ path: info.outputPath('footer-zh-dark-public.png') })
  await page.close()
  expect((await read(request)).links).toEqual(maximum)
})

// Catches lost updates across genuinely different identities, discarded conflict drafts, and an empty navigation shell.
test('v0.35.0 E03 two distinct administrators conflict, reload and clear without losing attribution', async ({ page, browser, footerRecovery }, info) => {
  const request = footerRecovery.request
  const initial = await write(request, [{ label: 'Starting link', url: 'https://example.com/start' }])
  await writePreferences(request, 'en', 'light')
  const username = 'footer-admin-' + randomBytes(6).toString('hex')
  const password = 'footer-links-e2e-password'
  const created = await post<{ user: { id: string; username: string; group: string } }>(request, '/admin/user/create', { username, password, nickname: 'Second footer administrator', groupKey: 'admin', status: 'active' })
  footerRecovery.account(created.user.id)
  const secondContext = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 720 }, serviceWorkers: 'block', reducedMotion: 'reduce' })
  footerRecovery.context(secondContext)
  await login(secondContext.request, username, password)
  const second = await secondContext.newPage()
  const primaryRead = page.waitForResponse(value => new URL(value.url()).pathname === readPath)
  const secondaryRead = second.waitForResponse(value => new URL(value.url()).pathname === readPath)
  await Promise.all([prepareAdmin(page, 'en', { width: 1280, height: 720 }), prepareAdmin(second, 'en', { width: 1280, height: 720 }, false)])
  const primaryIdentity = (await get<{ user: { id: string; username: string; group: string } }>(page.request, '/auth/me')).user
  const secondaryIdentity = (await get<{ user: { id: string; username: string; group: string } }>(secondContext.request, '/auth/me')).user
  expect(primaryIdentity.group).toBe('admin')
  expect(secondaryIdentity).toMatchObject({ id: created.user.id, username, group: 'admin' })
  expect(primaryIdentity.id).not.toBe(secondaryIdentity.id)
  expect(primaryIdentity.username).not.toBe(secondaryIdentity.username)
  const primarySession = (await page.context().cookies()).find(value => value.name === 'moeurl_session')
  const secondarySession = (await secondContext.cookies()).find(value => value.name === 'moeurl_session')
  expect(primarySession).toBeDefined()
  expect(secondarySession).toBeDefined()
  expect(primarySession!.value).not.toBe(secondarySession!.value)
  expect((await (await primaryRead).json()).data).toEqual(initial)
  expect((await (await secondaryRead).json()).data).toEqual(initial)
  const primaryForm = page.getByRole('form', { name: text.en.form, exact: true })
  const secondaryForm = second.getByRole('form', { name: text.en.form, exact: true })
  await expect(field(primaryForm, text.en.label, 1)).toHaveValue('Starting link')
  await expect(field(secondaryForm, text.en.label, 1)).toHaveValue('Starting link')
  await keyboardFill(field(primaryForm, text.en.label, 1), 'First administrator draft')
  await keyboardFill(field(secondaryForm, text.en.label, 1), 'Second administrator draft')
  const drafts = [[{ label: 'First administrator draft', url: 'https://example.com/start' }], [{ label: 'Second administrator draft', url: 'https://example.com/start' }]]
  const writes: number[] = [0, 0]
  for (const [index, currentPage] of [page, second].entries()) currentPage.on('request', value => { if (new URL(value.url()).pathname === updatePath) writes[index]! += 1 })
  const waiting = [page, second].map(value => value.waitForResponse(response => new URL(response.url()).pathname === updatePath))
  await Promise.all([primaryForm, secondaryForm].map(form => activate(form.getByRole('button', { name: text.en.save, exact: true }))))
  const responses = await Promise.all(waiting)
  const payloads = await Promise.all(responses.map(response => response.json()))
  expect(payloads.map(value => value.code).sort((a, b) => a - b)).toEqual([0, 900209])
  for (const [index, response] of responses.entries()) expect(response.request().postDataJSON()).toEqual({ links: drafts[index], expectedUpdatedAt: initial.updatedAt })
  const winner = payloads[0].code === 0 ? 0 : 1
  const loser = winner === 0 ? 1 : 0
  const loserPage = [page, second][loser]!
  const loserForm = [primaryForm, secondaryForm][loser]!
  const current = await read(request)
  expect(current.links).toEqual(drafts[winner])
  await expect(field(loserForm, text.en.label, 1)).toHaveValue(drafts[loser]![0]!.label)
  await expect(loserForm.getByText(text.en.conflict, { exact: true })).toBeVisible()
  expect(writes).toEqual([1, 1])
  const reload = loserPage.waitForResponse(value => new URL(value.url()).pathname === readPath)
  await activate(loserForm.getByRole('button', { name: text.en.reload, exact: true }))
  expect((await (await reload).json()).data).toEqual(current)
  await expect(field(loserForm, text.en.label, 1)).toHaveValue(drafts[winner]![0]!.label)
  await expect(loserForm.getByText(text.en.conflict, { exact: true })).toHaveCount(0)
  expect(writes).toEqual([1, 1])
  await activate(loserForm.getByRole('button', { name: text.en.remove + ' 1', exact: true }))
  await expect(loserForm.locator('fieldset')).toHaveCount(0)
  const cleared = loserPage.waitForResponse(value => new URL(value.url()).pathname === updatePath)
  await activate(loserForm.getByRole('button', { name: text.en.save, exact: true }))
  const clearedResponse = await cleared
  expect(clearedResponse.request().postDataJSON()).toEqual({ links: [], expectedUpdatedAt: current.updatedAt })
  expect((await clearedResponse.json()).code).toBe(0)
  expect((await read(request)).links).toEqual([])
  const publicPage = await visitor(browser, footerRecovery, info, 'en', { width: 1280, height: 720 })
  await expectNavigation(publicPage, 'en', [])
  await expect(publicPage.locator('.site-footer')).toContainText('Powered by MoeURL')
  await expect(publicPage.locator('.site-footer > span a')).toHaveCount(1)
  await Promise.all([page.close(), second.close()])
  expect((await read(request)).links).toEqual([])
})

/** Uses actual keyboard insertion and activation, without DOM mutation or forced clicks. */
async function keyboardFill(input: Locator, value: string) {
  await input.focus()
  await input.press('ControlOrMeta+A')
  await input.press('Backspace')
  await input.page().keyboard.insertText(value)
  await expect(input).toHaveValue(value)
}
async function activate(button: Locator) { await expect(button).toBeEnabled(); await button.focus(); await button.press('Enter') }
function field(form: Locator, label: string, index: number) { return form.getByRole('textbox', { name: label + ' ' + index, exact: true }) }
async function prepareAdmin(page: Page, language: 'en' | 'zh-CN', viewport: { width: number; height: number }, authenticate = true) {
  if (authenticate) await login(page.request)
  await page.addInitScript(value => { localStorage.setItem('moeurl.language', value); localStorage.setItem('moeurl.theme', 'light') }, language)
  await page.setViewportSize(viewport)
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
  await page.goto('/admin/setting')
}
async function visitor(browser: Browser, recovery: Recovery, info: TestInfo, language: 'en' | 'zh-CN', viewport: { width: number; height: number }) {
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport, colorScheme: 'light', reducedMotion: 'reduce', serviceWorkers: 'block' })
  recovery.context(context)
  await context.addInitScript(value => { localStorage.setItem('moeurl.language', value); localStorage.setItem('moeurl.theme', 'system') }, language)
  const page = await context.newPage()
  await page.goto('/')
  return page
}
async function expectNavigation(page: Page, language: 'en' | 'zh', expected: Link[]) {
  const response = await page.request.get('/api/v1/system/footer-links', { timeout: 5000 })
  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toBe('no-store')
  expect((await response.json()).data).toEqual({ links: expected })
  const nav = page.getByRole('navigation', { name: text[language].nav, exact: true })
  if (!expected.length) { await expect(nav).toHaveCount(0); return }
  await expect(nav).toBeVisible()
  const anchors = nav.getByRole('link')
  await expect(anchors).toHaveCount(expected.length)
  for (const [index, link] of expected.entries()) {
    const anchor = anchors.nth(index)
    expect(await anchor.evaluate(element => element.childNodes[0]?.textContent)).toBe(link.label)
    await expect(anchor).toHaveAttribute('href', link.url)
    await expect(anchor).toHaveAttribute('target', '_blank')
    await expect(anchor).toHaveAttribute('rel', 'noopener noreferrer')
    await expect(anchor).toHaveAttribute('referrerpolicy', 'no-referrer')
    await expect(anchor.locator('.site-footer__sr-only')).toHaveText(language === 'en' ? '(opens in a new window)' : '（在新窗口打开）')
  }
  await expect(nav.locator('b')).toHaveCount(0)
  await expect(page.locator('.site-footer')).toContainText('Powered by MoeURL')
}
async function expectFooterGeometry(page: Page) {
  await page.locator('.site-footer').scrollIntoViewIfNeeded()
  await expectNoHorizontalOverflow(page)
  const boxes = await page.locator('.site-footer li').evaluateAll(elements => elements.map(element => {
    const box = element.getBoundingClientRect()
    return { x: box.x, right: box.right, y: box.y, bottom: box.bottom }
  }))
  for (const [index, box] of boxes.entries()) {
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.right).toBeLessThanOrEqual(390)
    for (const previous of boxes.slice(0, index)) expect(box.x >= previous.right || box.right <= previous.x || box.y >= previous.bottom || box.bottom <= previous.y).toBe(true)
  }
}
async function login(request: APIRequestContext, username = e2eAdminUsername, password = e2eAdminPassword) { await post(request, '/auth/login', { username, password }) }
async function read(request: APIRequestContext) { return get<Settings>(request, '/admin/system/footer-links') }
async function write(request: APIRequestContext, links: Link[]) { return post<Settings>(request, '/admin/system/footer-links/update', { links, expectedUpdatedAt: (await read(request)).updatedAt }) }
async function readPreferences(request: APIRequestContext) { return (await get<{ preferences: Preferences }>(request, '/user/preferences')).preferences }
async function writePreferences(request: APIRequestContext, language: Preferences['language'], theme: Preferences['theme']) {
  return (await post<{ preferences: Preferences }>(request, '/user/preferences/update', { language, theme, expectedUpdatedAt: (await readPreferences(request)).updatedAt })).preferences
}
async function get<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get('/api/v1' + path, { timeout: 5000 })
  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toBe('no-store')
  const payload = await response.json()
  expect(payload.code).toBe(0)
  return payload.data as T
}
async function post<T = unknown>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await request.post('/api/v1' + path, { data, timeout: 5000 })
  expect(response.status()).toBe(200)
  const payload = await response.json()
  expect(payload.code).toBe(0)
  return payload.data as T
}
