import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test as base } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Page, TestInfo } from '@playwright/test'
import type { ShortLink } from '../src/entities/short-link/model'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

interface Scenario { owner: Page; other: Page; first: ShortLink; second: ShortLink; keyword: string }
const password = 'personal-tags-fixture-password'
const shared = '共同 Shared', privateTag = 'Other account only', secondOnly = 'Disabled only'
const literal = '%_\\文', markup = '<b>literal</b>', longTag = '长'.repeat(32)
const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, page: manager }, use, info) => {
    const contexts: BrowserContext[] = [], users: string[] = [], pages: Page[] = [], failures: unknown[] = []
    try {
      const baseURL = info.project.use.baseURL
      if (typeof baseURL !== 'string') throw new Error('Requires disposable Compose baseURL')
      await post(manager.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      const keyword = 'catalog-' + randomBytes(7).toString('hex')
      const language = info.title.includes(' en ') ? 'en' : 'zh-CN'
      const width = info.title.includes('1280px') ? 1280 : 390
      const theme = language === 'en' ? 'dark' : 'light'
      for (let index = 0; index < 2; index++) {
        const username = keyword + '-' + index
        const result = await post(manager.request, '/admin/user/create', { username, password, nickname: 'Personal tags fixture', groupKey: 'user', status: 'active' })
        users.push(result.data.user.id)
        const context = await browser.newContext({ baseURL, viewport: { width, height: width === 1280 ? 900 : 844 }, locale: language, hasTouch: width === 390, serviceWorkers: 'block', colorScheme: theme, reducedMotion: 'reduce' })
        contexts.push(context)
        await context.addInitScript(({ language, theme }) => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', theme) }, { language, theme })
        const page = await context.newPage(); pages.push(page)
        await post(page.request, '/auth/login', { username, password })
      }
      const owner = pages[0]!, other = pages[1]!
      const first = (await post(owner.request, '/short-link/create', { targetUrl: 'https://example.com/' + keyword + '/first', metadata: { title: keyword + ' first', tags: [shared, literal, markup, longTag] } })).data.shortLink as ShortLink
      const second = (await post(owner.request, '/short-link/create', { targetUrl: 'https://example.com/' + keyword + '/second', metadata: { title: keyword + ' second', tags: [shared, secondOnly] } })).data.shortLink as ShortLink
      await post(owner.request, '/short-link/update', { id: second.id, status: 'disabled' })
      await post(other.request, '/short-link/create', { targetUrl: 'https://example.com/' + keyword + '/other', metadata: { title: keyword + ' other', tags: [shared, privateTag] } })
      await attach(info, 'runtime', { browser: browser.version(), driverNode: process.version, width, language, theme, users, disposableDatabase: true })
      await use({ owner, other, first, second, keyword })
    } catch (error) { failures.push(error) } finally {
      // Each account is fresh and exclusively owned; discover writes even after a lost response.
      for (const page of pages) {
        try { for (const link of await list(page.request)) await post(manager.request, '/admin/short-link/delete', { id: link.id }) } catch (error) { failures.push(error) }
      }
      for (const id of users) {
        try { await post(manager.request, '/admin/user/update', { id, nickname: 'Personal tags fixture', status: 'disabled' }) } catch (error) { failures.push(error) }
      }
      for (const context of contexts) { try { await context.close() } catch (error) { failures.push(error) } }
    }
    if (failures.length) throw new AggregateError(failures, 'Personal tags scenario or exact owned cleanup failed')
  }, { timeout: 60_000 }],
})
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const language of ['zh-CN', 'en'] as const) for (const width of [1280, 390]) {
  test('v0.41.0 ' + language + ' ' + width + 'px finds personal tags, preserves filters and refreshes after real writes', async ({ scenario }, info) => {
    const { owner: page, other, first, keyword } = scenario
    const en = language === 'en'
    const title = en ? 'My tags' : '我的标签'
    const panel = page.locator('.personal-tag-browser')
    const tagButton = (tag: string, count: number) => panel.getByRole('button', { name: tag + ' · ' + count, exact: true })
    const requests: string[] = []
    page.on('request', request => { if (new URL(request.url()).pathname === '/api/v1/short-link/tags') requests.push(request.url()) })
    await page.goto('/link')
    const toggle = panel.getByRole('button', { name: title, exact: true })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(requests).toHaveLength(0)
    await toggle.focus(); await toggle.press('Enter')
    await expect(tagButton(shared, 2)).toBeVisible()
    await expect(panel.getByRole('button', { name: privateTag + ' · 1', exact: true })).toHaveCount(0)
    await expect(tagButton(markup, 1)).toBeVisible()
    await expect(tagButton(markup, 1).locator('b')).toHaveCount(0)
    await expect(tagButton(longTag, 1)).toBeVisible()
    await capture(info, page, 'catalog-' + language + '-' + width)

    const status = page.getByRole('combobox', { name: en ? 'Status' : '状态筛选', exact: true })
    await status.press('Enter')
    await page.getByRole('option', { name: en ? 'Active' : '启用', exact: true }).click()
    const search = page.getByLabel(en ? 'Keyword' : '关键词搜索', { exact: true })
    const filter = page.getByLabel(en ? 'Tag' : '标签', { exact: true })
    await search.fill(keyword)
    await expect(page.getByTestId('console-link-row')).toHaveCount(1)
    const selected = page.waitForResponse(result => { const url = new URL(result.url()); return url.pathname === '/api/v1/short-link/list' && url.searchParams.get('tag') === secondOnly && url.searchParams.get('q') === keyword && url.searchParams.get('status') === 'active' })
    await tagButton(secondOnly, 1).focus(); await tagButton(secondOnly, 1).press('Enter')
    expect(await (await selected).json()).toMatchObject({ code: 0 })
    await expect(filter).toHaveValue(secondOnly); await expect(search).toHaveValue(keyword)
    await expect(page.getByTestId('console-link-row')).toHaveCount(0)
    await expect(tagButton(shared, 2)).toBeVisible()
    await filter.fill('')
    await expect(page.getByTestId('console-link-row')).toHaveCount(1)

    const directorySearch = panel.getByLabel(en ? 'Find my tags' : '查找我的标签', { exact: true })
    const literalResponse = page.waitForResponse(result => { const url = new URL(result.url()); return url.pathname === '/api/v1/short-link/tags' && url.searchParams.get('q') === literal })
    await directorySearch.fill(literal)
    expect(await (await literalResponse).json()).toMatchObject({ code: 0, data: { items: [{ tag: literal, linkCount: 1 }], hasMore: false } })
    await expect(tagButton(literal, 1)).toBeVisible()
    await expect(tagButton(shared, 2)).toHaveCount(0)
    await directorySearch.fill('')
    await expect(tagButton(shared, 2)).toBeVisible()

    const checkbox = page.getByRole('checkbox', { name: (en ? 'Select short link ' : '选择短链 ') + first.slug, exact: true })
    await checkbox.check()
    await page.getByTestId('batch-tags').click()
    const dialog = page.getByTestId('batch-tags-dialog')
    const added = 'New 分类'
    await dialog.getByTestId('batch-tags-input').getByRole('textbox').fill(added)
    await dialog.getByLabel(en ? 'I confirm this tag operation for every selected link' : '我确认对全部所选短链执行此标签操作', { exact: true }).check()
    const saved = page.waitForResponse('**/api/v1/short-link/batch-tags')
    await dialog.getByTestId('batch-tags-save').click()
    expect(await (await saved).json()).toMatchObject({ code: 0, data: { changedCount: 1, unchangedCount: 0 } })
    await expect(dialog).toHaveCount(0)
    await expect(tagButton(added, 1)).toBeVisible()
    await expect(tagButton(shared, 2)).toBeVisible()
    await expect(search).toHaveValue(keyword); await expect(filter).toHaveValue('')
    await capture(info, page, 'catalog-after-write-' + language + '-' + width)

    await checkbox.check()
    await page.getByTestId('batch-delete').click()
    const deleted = page.waitForResponse('**/api/v1/short-link/batch')
    await page.getByTestId('batch-confirm-delete').click()
    expect(await (await deleted).json()).toMatchObject({ code: 0 })
    await expect(page.getByTestId('console-link-row')).toHaveCount(0)
    await expect(tagButton(shared, 1)).toBeVisible()
    await expect(tagButton(added, 1)).toHaveCount(0)
    await expect(tagButton(longTag, 1)).toHaveCount(0)
    await toggle.focus(); await toggle.press('Enter')
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.press('Enter')
    await expect(tagButton(shared, 1)).toBeVisible()

    await other.goto('/link')
    const otherPanel = other.locator('.personal-tag-browser')
    await otherPanel.getByRole('button', { name: title, exact: true }).click()
    await expect(otherPanel.getByRole('button', { name: privateTag + ' · 1', exact: true })).toBeVisible()
    await expect(otherPanel.getByRole('button', { name: shared + ' · 1', exact: true })).toBeVisible()
    await expect(otherPanel.getByRole('button', { name: secondOnly + ' · 1', exact: true })).toHaveCount(0)
    await attach(info, 'catalog-proof', { width, language, requests, noMarkup: true, countsIndependentOfStatus: true, originalFiltersPreserved: true, actualBatchTagAndDeleteRefreshed: true, otherAccountIsolated: true })
  })
}

/** Reads only the fresh account's non-deleted resources for exact cleanup. */
async function list(api: APIRequestContext): Promise<ShortLink[]> {
  const response = await api.get('/api/v1/short-link/list?page=1&pageSize=100')
  expect(response.status()).toBe(200)
  const payload = await response.json(); expect(payload.code).toBe(0)
  return payload.data.items
}
/** Validates both HTTP and business success in the disposable database. */
async function post(api: APIRequestContext, path: string, data: unknown) {
  const response = await api.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200)
  const payload = await response.json(); expect(payload.code).toBe(0)
  return payload
}
/** Captures actual long-label layout without hiding notifications or product guidance. */
async function capture(info: TestInfo, page: Page, name: string) {
  await page.locator('.personal-tag-browser').scrollIntoViewIfNeeded()
  await expectNoHorizontalOverflow(page)
  await expect.poll(() => page.locator('.personal-tag-browser').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  const path = info.outputPath(name + '.png')
  await page.screenshot({ path, animations: 'disabled' }); await info.attach(name, { path, contentType: 'image/png' })
}
/** Stores runtime and real protocol observations beside original images. */
async function attach(info: TestInfo, name: string, value: unknown) {
  const path = info.outputPath(name + '.json')
  await writeFile(path, JSON.stringify(value, null, 2)); await info.attach(name, { path, contentType: 'application/json' })
}
