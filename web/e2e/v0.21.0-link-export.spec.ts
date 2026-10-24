import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test as base } from '@playwright/test'
import type { BrowserContext, Page, TestInfo } from '@playwright/test'
import type { AdminShortLink, ShortLink } from '../src/entities/short-link/model'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

type Scope = 'own' | 'admin'
type Filters = { q?: string; tag?: string; status?: string }
interface Scenario {
  owner: Page; admin: Page; links: AdminShortLink[]; tag: string; keyword: string
  username: string; nickname: string
}
const fixturePassword = 'list-export-fixture-password'
const linkPassword = 'never-export-this-password'
const headers = ['id', 'short_url', 'slug', 'target_url', 'title', 'tags', 'status', 'redirect_mode', 'intermediate_delay_seconds', 'expires_at', 'password_enabled', 'max_visits', 'visits_used', 'created_at', 'updated_at', 'owner_id', 'owner_username']

const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, page: admin }, use, testInfo) => {
    const baseURL = testInfo.project.use.baseURL
    if (typeof baseURL !== 'string') throw new Error('List-export E2E requires a baseURL')
    const contexts: BrowserContext[] = []
    const accountIDs: string[] = []
    const createdLinks: ShortLink[] = []
    const token = randomBytes(8).toString('hex')
    const tag = `list-${token}`
    const keyword = `needle-${token}`
    const username = `csv-${token}`
    const nickname = `名单 ${token}`
    const cleanupErrors: unknown[] = []
    let failed = false
    let failure: unknown
    try {
      expect(await (await admin.request.post('/api/v1/auth/login', {
        data: { username: e2eAdminUsername, password: e2eAdminPassword },
      })).json()).toMatchObject({ code: 0 })
      const owners: Page[] = []
      for (const [index, name] of [username, `other-${token}`].entries()) {
        const account = await (await admin.request.post('/api/v1/admin/user/create', {
          data: { username: name, password: fixturePassword, nickname: index === 0 ? nickname : 'Other CSV owner', groupKey: 'user', status: 'active' },
        })).json() as { code: number; data: { user: { id: string } } }
        if (account.code === 0) accountIDs.push(account.data.user.id)
        expect(account).toMatchObject({ code: 0, data: { user: { id: expect.any(String) } } })
        const context = await browser.newContext({ baseURL, locale: 'zh-CN', serviceWorkers: 'block', colorScheme: 'light', reducedMotion: 'reduce' })
        contexts.push(context)
        const owner = await context.newPage()
        expect(await (await owner.request.post('/api/v1/auth/login', {
          data: { username: name, password: fixturePassword },
        })).json()).toMatchObject({ code: 0 })
        expect(await (await owner.request.get('/api/v1/auth/me')).json()).toMatchObject({
          code: 0, data: { user: { id: account.data.user.id, permissions: expect.arrayContaining([
            'short_link:create', 'short_link:read_own', 'short_link:export', 'short_link:set_metadata',
          ]) } },
        })
        owners.push(owner)
      }
      // Each decoy violates exactly one filter; dropping q, tag, status or owner must change the CSV.
      for (let index = 0; index < 5; index++) {
        const creator = owners[index === 4 ? 1 : 0]!
        const payload = await (await creator.request.post('/api/v1/short-link/create', {
          data: {
            targetUrl: `https://example.com/list-export/${token}/${index}?comma=a,b&quote=%22`,
            metadata: { title: index === 3 ? 'Unrelated title' : `=SUM(1,2) "${keyword}"`, tags: [index === 2 ? `other-${token}` : tag, '=2+2', '逗号,引号"'] },
            ...(index === 0 ? { password: { mode: 'set', value: linkPassword }, maxVisits: 12 } : {}),
          },
        })).json() as { code: number; data: { shortLink: ShortLink } }
        if (payload.code === 0) createdLinks.push(payload.data.shortLink)
        expect(payload).toMatchObject({ code: 0, data: { shortLink: { id: expect.any(String) } } })
        if (index === 1) {
          expect(await (await creator.request.post('/api/v1/short-link/update', {
            data: { id: payload.data.shortLink.id, status: 'disabled' },
          })).json()).toMatchObject({ code: 0 })
        }
      }
      const persisted = await (await admin.request.get(`/api/v1/admin/short-link/list?q=${token}&pageSize=100`)).json() as { code: number; data: { items: AdminShortLink[] } }
      expect(persisted.code).toBe(0)
      const links = createdLinks.map(link => persisted.data.items.find(item => item.id === link.id)!)
      expect(links).toHaveLength(5)
      expect(links.every(Boolean)).toBe(true)
      await use({ owner: owners[0]!, admin, links, tag, keyword, username, nickname })
    } catch (error) {
      failed = true
      failure = error
    } finally {
      // Independent cleanup and a separate fixture timeout preserve teardown after assertion failures.
      for (const link of createdLinks) {
        try {
          expect(await (await admin.request.post('/api/v1/admin/short-link/delete', {
            data: { id: link.id }, timeout: 5_000,
          })).json()).toMatchObject({ code: 0 })
        } catch (error) { cleanupErrors.push(error) }
      }
      for (const id of accountIDs) {
        try {
          expect(await (await admin.request.post('/api/v1/admin/user/update', {
            data: { id, nickname: 'Retired CSV fixture', status: 'disabled' }, timeout: 5_000,
          })).json()).toMatchObject({ code: 0, data: { user: { id, status: 'disabled' } } })
        } catch (error) { cleanupErrors.push(error) }
      }
      for (const context of contexts) {
        try { await context.close() } catch (error) { cleanupErrors.push(error) }
      }
    }
    if (failed) {
      if (cleanupErrors.length) throw new AggregateError([failure, ...cleanupErrors], 'List-export scenario and cleanup failed')
      throw failure
    }
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'List-export cleanup failed')
  }, { timeout: 45_000 }],
})

test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

/** Mirrors the server's descending instant order, then UUID order. */
function compareListExportLinks(left: Pick<AdminShortLink, 'createdAt' | 'id'>, right: Pick<AdminShortLink, 'createdAt' | 'id'>) {
  const key = (value: string) => {
    const [seconds, fraction = ''] = utcTimestamp(value).slice(0, -1).split('.')
    return `${seconds}.${fraction.padEnd(9, '0')}`
  }
  return key(right.createdAt).localeCompare(key(left.createdAt)) || right.id.localeCompare(left.id)
}

test('list export ordering retains fractional-second precision', () => {
  const links = [
    { id: '00000000-0000-0000-0000-000000000001', createdAt: '2026-10-24T00:00:00.1Z' },
    { id: '00000000-0000-0000-0000-000000000002', createdAt: '2026-10-24T00:00:00.12Z' },
    { id: '00000000-0000-0000-0000-000000000003', createdAt: '2026-10-24T00:00:00Z' },
    { id: '00000000-0000-0000-0000-000000000004', createdAt: '2026-10-24T00:00:00.123001Z' },
    { id: '00000000-0000-0000-0000-000000000005', createdAt: '2026-10-24T00:00:00.123002Z' },
    { id: '00000000-0000-0000-0000-000000000006', createdAt: '2026-10-24T00:00:00.123001Z' },
  ]
  expect([...links].sort(compareListExportLinks).map(link => link.id.slice(-1))).toEqual(['5', '6', '4', '2', '1', '3'])
})

/** Reads standard CSV quoting, including doubled quotes and embedded delimiters, without dependencies. */
function readCSV(content: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < content.length; index++) {
    const value = content[index]
    if (value === '"') {
      if (quoted && content[index + 1] === '"') { field += '"'; index++ }
      else quoted = !quoted
    } else if (value === ',' && !quoted) {
      row.push(field); field = ''
    } else if (value === '\r' && content[index + 1] === '\n' && !quoted) {
      row.push(field); rows.push(row); row = []; field = ''; index++
    } else field += value
  }
  expect(quoted).toBe(false)
  expect(row).toEqual([])
  expect(field).toBe('')
  return rows
}

/** Converts an API instant to UTC while retaining PostgreSQL fractional-second precision. */
function utcTimestamp(value: string) {
  const fraction = /\.(\d+)/.exec(value)?.[1]?.replace(/0+$/, '')
  return `${new Date(value).toISOString().slice(0, 19)}${fraction ? `.${fraction}` : ''}Z`
}

/** Waits for the exact applied browser query, rather than a debounce delay or a stale row. */
function nextList(page: Page, scope: Scope, filters: Filters) {
  return page.waitForResponse(response => {
    const url = new URL(response.url())
    return url.pathname === `/api/v1/${scope === 'admin' ? 'admin/' : ''}short-link/list`
      && ['q', 'tag', 'status'].every(key => url.searchParams.get(key) === (filters[key as keyof Filters] || null))
  })
}

/** Saves the browser's actual download and checks independently expected rows against its decoded cells. */
async function expectDownload(page: Page, scope: Scope, filters: Filters, links: AdminShortLink[], testInfo: TestInfo, name: string, english = false) {
  const endpoint = `/api/v1/${scope === 'admin' ? 'admin/' : ''}short-link/export`
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === endpoint)
  const saved = page.waitForEvent('download')
  const button = page.getByTestId('short-link-list-export')
  await expect(button).toBeEnabled()
  await expect(button).toHaveText(english ? 'Export CSV' : '导出 CSV')
  const pageURL = page.url()
  await button.click()
  const response = await responsePromise
  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toBe('no-store')
  expect(Object.fromEntries(new URL(response.url()).searchParams)).toEqual(filters)
  const descriptor = await response.json() as { code: number; data: { fileName: string; contentType: string; content: string } }
  expect(descriptor.code).toBe(0)
  expect(descriptor.data.contentType).toBe('text/csv;charset=utf-8')
  const download = await saved
  const message = page.getByText(english ? 'CSV download started. Confirm saving in your browser.' : '已发起 CSV 下载，请在浏览器中确认保存。', { exact: true })
  await expect(message).toBeVisible()
  await page.getByRole('button', { name: english ? 'Dismiss notification' : '关闭提示', exact: true }).click()
  await expect(message).not.toBeVisible()
  const filename = scope === 'admin' ? 'moeurl-links-all.csv' : 'moeurl-links-own.csv'
  expect(download.suggestedFilename()).toBe(filename)
  expect(descriptor.data.fileName).toBe(filename)
  const path = testInfo.outputPath(`${name}-${filename}`)
  await download.saveAs(path)
  expect(await download.failure()).toBeNull()
  const bytes = await readFile(path)
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  expect(bytes.equals(Buffer.from(descriptor.data.content, 'utf8'))).toBe(true)
  const text = bytes.toString('utf8').slice(1)
  expect(text.endsWith('\r\n')).toBe(true)
  expect(text.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/)
  const rows = readCSV(text)
  const ordered = [...links].sort(compareListExportLinks)
  expect(rows).toEqual([headers, ...ordered.map(link => [
    link.id, link.url, link.slug, link.targetUrl,
    link.title.startsWith('=') ? `'${link.title}` : link.title,
    JSON.stringify(link.tags), link.status, link.redirectMode, String(link.intermediateDelaySeconds), '',
    String(link.passwordEnabled), link.maxVisits === null ? '' : String(link.maxVisits), '0',
    utcTimestamp(link.createdAt), utcTimestamp(link.updatedAt), link.owner.id, link.owner.username,
  ])])
  for (const secret of [fixturePassword, linkPassword, 'password_hash', 'access_token']) expect(text).not.toContain(secret)
  expect(page.url()).toBe(pageURL)
  await expect(page.getByTestId('console-link-row')).toHaveCount(links.length)
  await testInfo.attach(`${name}-csv`, { path, contentType: 'text/csv' })
}

/** Captures real responsive geometry after requiring the header action to fit its container. */
async function captureLayout(page: Page, testInfo: TestInfo, name: string) {
  await expectNoHorizontalOverflow(page)
  const button = page.getByTestId('short-link-list-export')
  await expect(button).toBeVisible()
  await expect.poll(() => page.locator('.console-page__header').evaluate(element => {
    const action = element.querySelector('[data-testid="short-link-list-export"]')
    if (!action) return false
    const header = element.getBoundingClientRect()
    const box = action.getBoundingClientRect()
    return box.left >= header.left && box.right <= header.right + 1 && box.bottom <= header.bottom + 1
  })).toBe(true)
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true, animations: 'disabled' })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

/** Changes language through the real desktop or mobile console control. */
async function switchToEnglish(page: Page, width: number) {
  if (width === 390) await page.getByRole('button', { name: '打开控制台菜单', exact: true }).click()
  await page.getByRole('button', { name: '选择语言', exact: true }).filter({ visible: true }).first().click()
  await page.getByRole('menuitemradio', { name: 'English', exact: true }).click()
  if (width === 390) {
    await page.getByRole('button', { name: 'Close menu', exact: true }).click()
    await expect(page.getByTestId('console-mobile-nav')).not.toBeVisible()
  }
}

for (const scope of ['own', 'admin'] as const) {
  for (const width of [1280, 390]) {
    test(`${scope} downloads filtered list CSV with real content at ${width}px`, async ({ scenario }, testInfo) => {
      const { owner, admin, links, keyword, tag, username, nickname } = scenario
      const page = scope === 'own' ? owner : admin
      await page.setViewportSize({ width, height: width === 1280 ? 720 : 800 })
      await page.goto(scope === 'admin' ? '/admin/link' : '/link')
      await expect(page.getByText('导出筛选结果，最多 1000 条。', { exact: true })).toBeVisible()
      let filters: Filters = { q: keyword, tag }
      let listed = nextList(page, scope, filters)
      await page.getByLabel('关键词搜索', { exact: true }).fill(keyword)
      await page.getByLabel('标签', { exact: true }).fill(tag)
      expect(await (await listed).json()).toMatchObject({ code: 0 })
      await expect(page.getByTestId('console-link-row')).toHaveCount(scope === 'own' ? 2 : 3)
      filters = { ...filters, status: 'active' }
      listed = nextList(page, scope, filters)
      await page.getByRole('combobox', { name: '状态筛选', exact: true }).press('Enter')
      await page.getByRole('option', { name: '启用', exact: true }).click()
      expect(await (await listed).json()).toMatchObject({ code: 0 })
      await expectDownload(page, scope, filters, scope === 'own' ? [links[0]!] : [links[0]!, links[4]!], testInfo, 'active-filtered')
      await captureLayout(page, testInfo, `list-export-${scope}-${width}px-zh`)

      filters = { ...filters, status: 'disabled' }
      listed = nextList(page, scope, filters)
      await page.getByRole('combobox', { name: '状态筛选', exact: true }).press('Enter')
      await page.getByRole('option', { name: '禁用', exact: true }).click()
      expect(await (await listed).json()).toMatchObject({ code: 0 })
      await switchToEnglish(page, width)
      await expect(page.getByText('Export filtered results, up to 1000 links.', { exact: true })).toBeVisible()
      await expectDownload(page, scope, filters, [links[1]!], testInfo, 'disabled-filtered', true)
      await captureLayout(page, testInfo, `list-export-${scope}-${width}px-en`)

      // Account-only keywords must work for administrators and remain outside personal search.
      for (const q of [username, nickname]) {
        filters = { q, tag, status: 'disabled' }
        listed = nextList(page, scope, filters)
        await page.getByLabel('Keyword', { exact: true }).fill(q)
        expect(await (await listed).json()).toMatchObject({ code: 0 })
        await expectDownload(page, scope, filters, scope === 'admin' ? [links[1]!] : [], testInfo, q === username ? 'username' : 'nickname', true)
      }
      await captureLayout(page, testInfo, `list-export-${scope}-${width}px-en-account`)
    })
  }
}
