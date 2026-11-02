import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test as base } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Page, TestInfo } from '@playwright/test'
import type { ShortLink } from '../src/entities/short-link/model'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

interface Scenario { admin: Page; owner: Page; other: Page; first: ShortLink; keyword: string; shared: string; disabledOnly: string; otherOnly: string; literal: string; markup: string; longTag: string }
const password = 'admin-tag-browser-owned-fixture'
const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, page: manager }, use, info) => {
    const contexts: BrowserContext[] = [], owners: Page[] = [], users: string[] = [], failures: unknown[] = []
    try {
      const baseURL = info.project.use.baseURL
      if (typeof baseURL !== 'string') throw new Error('Requires disposable Compose baseURL')
      await post(manager.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      const keyword = 'c42' + randomBytes(5).toString('hex')
      const language = info.title.includes(' en ') ? 'en' : 'zh-CN', width = info.title.includes('1280px') ? 1280 : 390
      const theme = language === 'en' ? 'dark' : 'light'
      const makePage = async () => {
        const context = await browser.newContext({ baseURL, viewport: { width, height: width === 1280 ? 900 : 844 }, locale: language, hasTouch: width === 390, serviceWorkers: 'block', colorScheme: theme, reducedMotion: 'reduce' })
        contexts.push(context)
        await context.addInitScript(({ language, theme }) => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', theme) }, { language, theme })
        return context.newPage()
      }
      for (let index = 0; index < 2; index++) {
        const username = keyword + '-' + index
        const created = await post(manager.request, '/admin/user/create', { username, password, nickname: 'Admin tags fixture', groupKey: 'user', status: 'active' })
        users.push(created.data.user.id)
        const page = await makePage(); owners.push(page)
        await post(page.request, '/auth/login', { username, password })
      }
      const owner = owners[0]!, other = owners[1]!, admin = await makePage()
      await post(admin.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      const shared = keyword + ' Shared', disabledOnly = keyword + ' disabled', otherOnly = keyword + ' other'
      const literal = keyword + '%_\\文', markup = keyword + '<b>literal</b>', longTag = keyword + '长'.repeat(32 - keyword.length)
      const first = (await post(owner.request, '/short-link/create', { targetUrl: 'https://example.com/' + keyword + '/first', metadata: { title: keyword + ' first', tags: [shared, literal, markup, longTag] } })).data.shortLink as ShortLink
      const second = (await post(owner.request, '/short-link/create', { targetUrl: 'https://example.com/' + keyword + '/disabled', metadata: { title: keyword + ' disabled', tags: [shared, disabledOnly] } })).data.shortLink as ShortLink
      await post(owner.request, '/short-link/update', { id: second.id, status: 'disabled' })
      await post(other.request, '/short-link/create', { targetUrl: 'https://example.com/' + keyword + '/other', metadata: { title: keyword + ' other', tags: [shared, otherOnly] } })
      await attach(info, 'runtime', { browser: browser.version(), driverNode: process.version, width, language, theme, users, disposableDatabase: true })
      await use({ admin, owner, other, first, keyword, shared, disabledOnly, otherOnly, literal, markup, longTag })
    } catch (error) { failures.push(error) } finally {
      // Only these fresh accounts' links and the captured user IDs belong to this fixture.
      for (const page of owners) {
        try { for (const link of await list(page.request)) await post(manager.request, '/admin/short-link/delete', { id: link.id }) } catch (error) { failures.push(error) }
      }
      for (const id of users) {
        try { await post(manager.request, '/admin/user/update', { id, nickname: 'Admin tags fixture', status: 'disabled' }) } catch (error) { failures.push(error) }
      }
      for (const context of contexts) { try { await context.close() } catch (error) { failures.push(error) } }
    }
    if (failures.length) throw new AggregateError(failures, 'Admin tags scenario or exact owned cleanup failed')
  }, { timeout: 60_000 }],
})
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const language of ['zh-CN', 'en'] as const) for (const width of [1280, 390]) {
  test('v0.42.0 ' + language + ' ' + width + 'px discovers global tags and preserves safe list interactions', async ({ scenario }, info) => {
    const { admin: page, owner, other, first, keyword, shared, disabledOnly, otherOnly, literal, markup, longTag } = scenario
    const en = language === 'en', title = en ? 'All-site tags' : '全站标签'
    const panel = page.locator('.admin-tag-browser')
    const tagButton = (tag: string, count: number) => panel.getByRole('button', { name: tag + ' · ' + count, exact: true })
    const requests: string[] = []
    page.on('request', request => { if (new URL(request.url()).pathname === '/api/v1/admin/short-link/tags') requests.push(request.url()) })
    await page.goto('/admin/link')
    const toggle = panel.getByRole('button', { name: title, exact: true })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false'); expect(requests).toHaveLength(0)
    await toggle.focus(); await toggle.press('Enter')
    const directorySearch = panel.getByLabel(en ? 'Find all-site tags' : '查找全站标签', { exact: true })
    await directorySearch.fill(keyword)
    await expect(tagButton(shared, 3)).toBeVisible()
    await expect(tagButton(otherOnly, 1)).toBeVisible(); await expect(tagButton(disabledOnly, 1)).toBeVisible()
    await expect(tagButton(markup, 1).locator('b')).toHaveCount(0)
    await expect(tagButton(markup, 1)).toBeVisible(); await expect(tagButton(longTag, 1)).toBeVisible()
    expect(await get(page.request, '/short-link/tags?q=' + keyword)).toMatchObject({ data: { items: [], hasMore: false } })
    expect(await get(owner.request, '/short-link/tags?q=' + keyword)).toMatchObject({ data: { items: expect.arrayContaining([{ tag: shared, linkCount: 2 }]) } })
    expect(await get(other.request, '/short-link/tags?q=' + keyword)).toMatchObject({ data: { items: expect.arrayContaining([{ tag: shared, linkCount: 1 }]) } })
    await capture(info, page, 'admin-catalog-' + language + '-' + width)

    const status = page.getByRole('combobox', { name: en ? 'Status' : '状态筛选', exact: true })
    await status.press('Enter'); await page.getByRole('option', { name: en ? 'Active' : '启用', exact: true }).click()
    const search = page.getByLabel(en ? 'Keyword' : '关键词搜索', { exact: true }), filter = page.getByLabel(en ? 'Tag' : '标签', { exact: true })
    await search.fill(keyword)
    await expect(page.getByTestId('console-link-row')).toHaveCount(2)
    await expect(tagButton(disabledOnly, 1)).toBeEnabled()
    const selected = page.waitForResponse(result => { const url = new URL(result.url()); return url.pathname === '/api/v1/admin/short-link/list' && url.searchParams.get('tag') === disabledOnly && url.searchParams.get('q') === keyword && url.searchParams.get('status') === 'active' })
    await tagButton(disabledOnly, 1).focus(); await tagButton(disabledOnly, 1).press('Enter')
    expect(await (await selected).json()).toMatchObject({ code: 0 })
    await expect(filter).toHaveValue(disabledOnly); await expect(search).toHaveValue(keyword)
    await expect(page.getByTestId('console-link-row')).toHaveCount(0); await expect(tagButton(shared, 3)).toBeVisible()
    await filter.fill(''); await expect(page.getByTestId('console-link-row')).toHaveCount(2)
    const literalResponse = page.waitForResponse(result => { const url = new URL(result.url()); return url.pathname === '/api/v1/admin/short-link/tags' && url.searchParams.get('q') === literal })
    await directorySearch.fill(literal)
    expect(await (await literalResponse).json()).toMatchObject({ code: 0, data: { items: [{ tag: literal, linkCount: 1 }], hasMore: false } })
    await expect(tagButton(literal, 1)).toBeVisible(); await expect(tagButton(shared, 3)).toHaveCount(0)
    await directorySearch.fill(keyword); await expect(tagButton(shared, 3)).toBeVisible()

    const checkbox = page.getByRole('checkbox', { name: (en ? 'Select short link ' : '选择短链 ') + first.slug, exact: true })
    await checkbox.check(); await page.getByTestId('batch-tags').click()
    const dialog = page.getByTestId('batch-tags-dialog'), added = keyword + ' New'
    await expect(tagButton(shared, 3)).toBeDisabled(); await expect(directorySearch).toBeEnabled()
    await dialog.getByTestId('batch-tags-input').getByRole('textbox').fill(added)
    await dialog.getByLabel(en ? 'I confirm this tag operation for every selected link' : '我确认对全部所选短链执行此标签操作', { exact: true }).check()
    const saved = page.waitForResponse('**/api/v1/admin/short-link/batch-tags')
    await dialog.getByTestId('batch-tags-save').click()
    expect(await (await saved).json()).toMatchObject({ code: 0, data: { changedCount: 1, unchangedCount: 0 } })
    await expect(dialog).toHaveCount(0); await expect(tagButton(added, 1)).toBeVisible(); await expect(tagButton(shared, 3)).toBeEnabled()
    await expect(search).toHaveValue(keyword); await expect(filter).toHaveValue('')
    await capture(info, page, 'admin-catalog-after-write-' + language + '-' + width)
    await checkbox.check(); await page.getByTestId('batch-delete').click()
    await expect(tagButton(shared, 3)).toBeDisabled()
    const deleted = page.waitForResponse('**/api/v1/admin/short-link/batch')
    await page.getByTestId('batch-confirm-delete').click(); expect(await (await deleted).json()).toMatchObject({ code: 0 })
    await expect(page.getByTestId('console-link-row')).toHaveCount(1); await expect(tagButton(shared, 2)).toBeVisible()
    await expect(tagButton(added, 1)).toHaveCount(0); await expect(tagButton(longTag, 1)).toHaveCount(0)
    await toggle.focus(); await toggle.press('Enter'); await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await toggle.press('Enter'); await directorySearch.fill(keyword); await expect(tagButton(shared, 2)).toBeVisible()
    await attach(info, 'admin-catalog-proof', { width, language, requests, countsAcrossOwnersAndStatuses: true, adminPersonalDirectoryEmpty: true, originalFiltersPreserved: true, actualBatchTagAndDeleteRefreshed: true, parentWritesBlockSelection: true })
  })
}

/** Reads only a fixture owner's resources, including writes whose response might have been lost. */
async function list(api: APIRequestContext): Promise<ShortLink[]> { return (await get(api, '/short-link/list?page=1&pageSize=100')).data.items }
/** Asserts both transport and business success for a read in the disposable database. */
async function get(api: APIRequestContext, path: string) { const response = await api.get('/api/v1' + path); expect(response.status()).toBe(200); const payload = await response.json(); expect(payload.code).toBe(0); return payload }
/** Asserts both transport and business success for an owned fixture or explicit UI write. */
async function post(api: APIRequestContext, path: string, data: unknown) { const response = await api.post('/api/v1' + path, { data }); expect(response.status()).toBe(200); const payload = await response.json(); expect(payload.code).toBe(0); return payload }
/** Captures original layout and measures the panel, filters and batch tools independently. */
async function capture(info: TestInfo, page: Page, name: string) {
  await page.locator('.admin-tag-browser').scrollIntoViewIfNeeded(); await expectNoHorizontalOverflow(page)
  await expect.poll(() => page.locator('.admin-tag-browser').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  const geometry = () => page.getByTestId('console-page-admin-links').evaluate(element => {
    const selectors = ['.admin-tag-browser', '[data-testid="batch-toolbar"]', ...Array.from({ length: 3 }, (_, index) => `.console-page__metadata-filters .v-input:nth-child(${index + 1}) .v-field`)]
    const boxes = selectors.map(selector => { const rect = element.querySelector(selector)!.getBoundingClientRect(); return { selector, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } })
    const overlaps = boxes.flatMap((a, index) => boxes.slice(index + 1).filter(b => a.right > b.left + 1 && b.right > a.left + 1 && a.bottom > b.top + 1 && b.bottom > a.top + 1).map(b => [a.selector, b.selector]))
    return { boxes, overlaps }
  })
  await expect.poll(async () => (await geometry()).overlaps).toEqual([])
  await attach(info, name + '-geometry', await geometry())
  const path = info.outputPath(name + '.png'); await page.screenshot({ path, animations: 'disabled' }); await info.attach(name, { path, contentType: 'image/png' })
}
/** Stores actual runtime and protocol observations with the original screenshots. */
async function attach(info: TestInfo, name: string, value: unknown) { const path = info.outputPath(name + '.json'); await writeFile(path, JSON.stringify(value, null, 2)); await info.attach(name, { path, contentType: 'application/json' }) }
