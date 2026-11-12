import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Page, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

interface Preference { pageSize: 20 | 50 | 100 | null; updatedAt: string | null }
interface Link { id: string; slug: string }
const resource = '/api/v1/user/list-preference'
const defaultLabel = /^(默认每页条数|Default rows per page)$/
const sizeLabel = /^(每页条数|Rows per page)$/

/** Uses real Cookie Session transport and fails on infrastructure or business errors. */
async function api<T>(request: APIRequestContext, path: string, data?: unknown): Promise<T> {
  const response = data === undefined ? await request.get('/api/v1' + path) : await request.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200)
  const body = await response.json() as { code: number; data: T }
  expect(body.code).toBe(0)
  return body.data
}
async function read(request: APIRequestContext) { return (await api<{ preference: Preference }>(request, '/user/list-preference')).preference }
async function write(request: APIRequestContext, pageSize: Preference['pageSize']) {
  const original = await read(request)
  return (await api<{ preference: Preference }>(request, '/user/list-preference/update', { pageSize, expectedUpdatedAt: original.updatedAt })).preference
}

/** Restores this account's independent document and deletes only exact owned fixture links. */
async function scenario(context: BrowserContext, info: TestInfo, run: (page: Page, keyword: string, links: Link[]) => Promise<void>) {
  const baseURL = info.project.use.baseURL
  if (typeof baseURL !== 'string') throw new Error('Requires disposable Compose baseURL')
  const keyword = 'list53-' + randomBytes(6).toString('hex'), links: Link[] = [], errors: unknown[] = []
  let original: Preference | undefined
  const page = await context.newPage()
  try {
    await api(context.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
    original = await read(context.request)
    for (let index = 0; index < 2; index++) {
      links.push((await api<{ shortLink: Link }>(context.request, '/short-link/create', {
        targetUrl: 'https://example.com/' + keyword + '/' + index, metadata: { title: keyword, tags: [] },
      })).shortLink)
    }
    await run(page, keyword, links)
  } catch (error) { errors.push(error) } finally {
    try { await page.unrouteAll({ behavior: 'wait' }) } catch (error) { errors.push(error) }
    if (original) {
      try { await write(context.request, original.pageSize); expect((await read(context.request)).pageSize).toBe(original.pageSize) } catch (error) { errors.push(error) }
    }
    for (const link of links) {
      try { await api(context.request, '/admin/short-link/delete', { id: link.id }) } catch (error) { errors.push(error) }
    }
    try {
      const response = await context.request.get('/api/v1/admin/short-link/list?q=' + keyword)
      expect(await response.json()).toMatchObject({ code: 0, meta: { total: 0 } })
    } catch (error) { errors.push(error) }
    try { await page.close() } catch (error) { errors.push(error) }
  }
  if (errors.length) throw new AggregateError(errors, 'List preference scenario or owned cleanup failed')
}

/** Tests the first request, rather than accepting a later corrected request with the desired size. */
function firstList(page: Page, admin: boolean, pageSize: number, keyword?: string) {
  const path = '/api/v1' + (admin ? '/admin' : '') + '/short-link/list'
  return page.waitForResponse(response => new URL(response.url()).pathname === path).then(async response => {
    const url = new URL(response.url())
    expect(url.searchParams.get('page')).toBe('1')
    expect(url.searchParams.get('pageSize')).toBe(String(pageSize))
    if (keyword !== undefined) expect(url.searchParams.get('q')).toBe(keyword)
    expect(await response.json()).toMatchObject({ code: 0, meta: { page: 1, pageSize } })
  })
}

/** Chooses through the real Vuetify listbox without writing account preferences implicitly. */
async function choose(page: Page, label: RegExp, value: string | RegExp) {
  const control = page.getByRole('combobox', { name: label, exact: true })
  await control.scrollIntoViewIfNeeded()
  await control.press('Enter')
  await page.getByRole('option', { name: value, exact: true }).click()
  await expect(page.locator('.v-select').filter({ has: control }).locator('.v-select__selection-text')).toHaveText(value)
}
async function save(page: Page, pageSize: Preference['pageSize'], expectedUpdatedAt: string | null) {
  const waiting = page.waitForResponse(response => new URL(response.url()).pathname === resource + '/update')
  await page.getByTestId('list-preference-save').click()
  const response = await waiting
  expect(response.request().postDataJSON()).toEqual({ pageSize, expectedUpdatedAt })
  expect(response.headers()['cache-control']).toBe('no-store')
  const body = await response.json() as { code: number; data: { preference: Preference } }
  expect(body).toMatchObject({ code: 0, data: { preference: { pageSize, updatedAt: expect.any(String) } } })
  expect(body.data.preference.updatedAt).not.toBe(expectedUpdatedAt)
  await expect(page.getByTestId('list-preference-save')).toBeEnabled()
  return body.data.preference
}
async function capture(page: Page, info: TestInfo, name: string, panel = false) {
  await (panel ? page.getByTestId('list-preference-panel') : page.getByRole('navigation', { name: /短链列表分页|Short link list pages/ })).scrollIntoViewIfNeeded()
  await expectNoHorizontalOverflow(page)
  const path = info.outputPath(name + '.png')
  await page.screenshot({ path, animations: 'disabled' })
  await info.attach(name, { path, contentType: 'image/png' })
}

test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

// Wrong CAS, missing persistence, eager list requests or implicit saves break these real UI flows.
for (const en of [false, true]) {
  test('v0.53.0 saves rows per page across login and keeps list choices temporary ' + (en ? 'en 390px dark' : 'zh-CN 1280px light'), async ({ browser }, info) => {
    const language = en ? 'en' : 'zh-CN'
    const context = await browser.newContext({ baseURL: info.project.use.baseURL as string, viewport: { width: en ? 390 : 1280, height: en ? 844 : 900 }, locale: language, colorScheme: en ? 'dark' : 'light', serviceWorkers: 'block', reducedMotion: 'reduce' })
    await context.addInitScript(({ en, language }) => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', en ? 'dark' : 'light') }, { en, language })
    try { await scenario(context, info, async (page, keyword, links) => {
      const initial = await read(context.request)
      await page.goto('/profile')
      await expect(page.getByTestId('list-preference-save')).toBeEnabled()
      await choose(page, defaultLabel, '50')
      const saved = await save(page, 50, initial.updatedAt)
      await capture(page, info, 'default-size-saved-' + language, true)
      if (en) {
        await page.getByRole('button', { name: 'Open account menu', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Sign out', exact: true }).click()
      } else await page.getByRole('button', { name: '退出登录', exact: true }).click()
      await expect(page).toHaveURL(/\/login(?:\?.*)?$/)
      await page.getByLabel(en ? 'Username' : '账号', { exact: true }).fill(e2eAdminUsername)
      await page.getByLabel(en ? 'Password' : '密码', { exact: true }).fill(e2eAdminPassword)
      await page.getByRole('button', { name: en ? 'Sign in' : '登录', exact: true }).click()
      await expect(page).not.toHaveURL(/\/login(?:\?.*)?$/)
      expect(await read(context.request)).toEqual(saved)
      let writes = 0
      page.on('request', request => { if (new URL(request.url()).pathname === resource + '/update') writes++ })
      for (const admin of [false, true]) {
        const initialRead = firstList(page, admin, 50)
        await page.goto(admin ? '/admin/link' : '/link'); await initialRead
        const filtered = firstList(page, admin, 50, keyword)
        await page.getByRole('textbox', { name: en ? 'Keyword' : '关键词搜索', exact: true }).fill(keyword); await filtered
        await expect(page.getByTestId('console-link-row')).toHaveCount(links.length)
        const changed = firstList(page, admin, 100, keyword)
        await choose(page, sizeLabel, '100'); await changed
        expect(await read(context.request)).toEqual(saved)
        await capture(page, info, 'temporary-size-' + (admin ? 'admin-' : 'own-') + language)
      }
      expect(writes).toBe(0)
      await page.goto('/profile')
      await expect(page.getByTestId('list-preference-save')).toBeEnabled()
      await choose(page, defaultLabel, en ? 'Use default (20 rows)' : '使用默认值（20 条）')
      await save(page, null, saved.updatedAt)
      await capture(page, info, 'default-size-cleared-' + language, true)
      for (const admin of [false, true]) {
        const cleared = firstList(page, admin, 20)
        await page.goto(admin ? '/admin/link' : '/link'); await cleared
      }
    }) } finally { await context.close() }
  })
}

// A missing deadline, stale-response overwrite or ignored pending filters fails these cases.
for (const mode of ['failure', 'deadline', 'manual'] as const) {
  test('v0.53.0 list initialization is bounded and late preferences cannot replace ' + mode, async ({ context }, info) => {
    await scenario(context, info, async (page, keyword) => {
      await write(context.request, 50)
      let release!: () => void, arrived!: () => void
      const gate = new Promise<void>(resolve => { release = resolve })
      const requested = new Promise<void>(resolve => { arrived = resolve })
      const admin = mode === 'deadline'
      try {
        await page.clock.install()
        await page.route('**/api/v1/user/list-preference', async route => {
          const actual = await route.fetch()
          arrived()
          if (mode === 'failure') await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ code: 100000, message: 'Controlled unavailable read', data: null }) })
          else { await gate; await route.fulfill({ response: actual }) }
        })
        const listed = firstList(page, admin, mode === 'manual' ? 100 : 20, mode === 'deadline' ? keyword : undefined)
        await page.goto(admin ? '/admin/link' : '/link', { waitUntil: 'domcontentloaded' })
        await requested
        if (mode === 'deadline') {
          await page.getByRole('textbox', { name: /^(关键词搜索|Keyword)$/, exact: true }).fill(keyword)
          await page.clock.runFor(3001)
        } else if (mode === 'manual') await choose(page, sizeLabel, '100')
        await listed
        if (mode !== 'failure') {
          const finished = page.waitForResponse(response => new URL(response.url()).pathname === resource)
          release(); await finished
          await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
        }
        await expect(page.getByRole('navigation', { name: /短链列表分页|Short link list pages/ }).locator('.v-select__selection-text')).toHaveText(mode === 'manual' ? '100' : '20')
        expect((await read(context.request)).pageSize).toBe(50)
      } finally { release(); await page.clock.resume() }
    })
  })
}
