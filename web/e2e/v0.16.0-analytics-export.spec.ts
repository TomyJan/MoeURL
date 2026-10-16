import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test as base } from '@playwright/test'
import type { APIResponse, BrowserContext, Page, Response, TestInfo } from '@playwright/test'
import type { ShortLink, ShortLinkStatisticsResponse } from '../src/entities/short-link/model'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

interface Scenario { owner: Page; admin: Page; link: ShortLink; username: string }
const fixturePassword = 'analytics-export-password'
const privateTitle = 'Private export fixture title'
const privateTag = 'private-export-tag'

const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, page: admin }, use, testInfo) => {
    const baseURL = testInfo.project.use.baseURL
    if (typeof baseURL !== 'string') throw new Error('Analytics-export E2E requires a baseURL')
    let accountID: string | undefined
    let link: ShortLink | undefined
    let context: BrowserContext | undefined
    const cleanupErrors: unknown[] = []
    let failed = false
    let failure: unknown
    try {
      expect(await (await admin.request.post('/api/v1/auth/login', {
        data: { username: e2eAdminUsername, password: e2eAdminPassword },
      })).json()).toMatchObject({ code: 0 })
      const username = `csv-${randomBytes(8).toString('hex')}`
      const createdAccount = await admin.request.post('/api/v1/admin/user/create', {
        data: { username, password: fixturePassword, nickname: 'Private CSV owner', groupKey: 'user', status: 'active' },
      })
      const account = await createdAccount.json() as { code: number; data: { user: { id: string } } }
      if (account.code === 0) accountID = account.data.user.id
      expect(account).toMatchObject({ code: 0, data: { user: { id: expect.any(String) } } })
      context = await browser.newContext({ baseURL, locale: 'zh-CN', serviceWorkers: 'block', colorScheme: 'light', reducedMotion: 'reduce' })
      const owner = await context.newPage()
      await owner.goto('/login?redirect=/profile')
      await owner.getByLabel('账号', { exact: true }).fill(username)
      await owner.getByLabel('密码', { exact: true }).fill(fixturePassword)
      await owner.getByRole('button', { name: '登录', exact: true }).click()
      await expect(owner).toHaveURL((url) => url.pathname === '/profile')
      await expect(owner.getByTestId('account-preferences-save')).toBeEnabled()
      expect(await (await owner.request.get('/api/v1/auth/me')).json()).toMatchObject({
        code: 0, data: { user: { id: accountID, username, group: 'user', permissions: expect.arrayContaining([
          'short_link:create', 'short_link:read_own', 'short_link:export_statistics', 'short_link:set_metadata', 'domain:use_default',
        ]) } },
      })
      const createdLink = await owner.request.post('/api/v1/short-link/create', {
        data: {
          targetUrl: `https://example.com/private-target/${randomBytes(8).toString('hex')}?secret=hidden`,
          metadata: { title: privateTitle, tags: [privateTag] },
        },
      })
      const payload = await createdLink.json() as { code: number; data: { shortLink: ShortLink } }
      if (payload.code === 0) link = payload.data.shortLink
      expect(payload).toMatchObject({ code: 0, data: { shortLink: { id: expect.any(String) } } })
      await use({ owner, admin, link: payload.data.shortLink, username })
    } catch (error) {
      failed = true
      failure = error
    } finally {
      // The fixture has a separate 30-second teardown budget even after the test times out.
      // Restore every resource independently so one cleanup failure cannot skip the others.
      if (link) {
        try {
          expect(await (await admin.request.post('/api/v1/admin/short-link/delete', {
            data: { id: link.id }, timeout: 10_000,
          })).json()).toMatchObject({ code: 0 })
        } catch (error) { cleanupErrors.push(error) }
      }
      if (accountID) {
        try {
          expect(await (await admin.request.post('/api/v1/admin/user/update', {
            data: { id: accountID, nickname: 'Private CSV owner', status: 'disabled' }, timeout: 10_000,
          })).json()).toMatchObject({ code: 0, data: { user: { id: accountID, status: 'disabled' } } })
        } catch (error) { cleanupErrors.push(error) }
      }
      if (context) {
        try { await context.close() } catch (error) { cleanupErrors.push(error) }
      }
    }
    if (failed) {
      if (cleanupErrors.length) throw new AggregateError([failure, ...cleanupErrors], 'Analytics-export scenario and cleanup failed')
      throw failure
    }
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Analytics-export cleanup failed')
  }, { timeout: 30_000 }],
})

test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

/** Uses a date from the server's actual UTC range as the calendar authority. */
function dateOffset(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

/** Normalizes the API instant to UTC while retaining PostgreSQL's fractional-second precision. */
function utcTimestamp(value: string | null) {
  if (!value) return ''
  const fraction = /\.(\d+)/.exec(value)?.[1]?.replace(/0+$/, '')
  return `${new Date(value).toISOString().slice(0, 19)}${fraction ? `.${fraction}` : ''}Z`
}

/** Checks the business envelope and private-cache contract on real API responses. */
async function statisticsPayload(response: APIResponse | Response): Promise<ShortLinkStatisticsResponse> {
  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toBe('no-store')
  const payload = await response.json() as { code: number; data: ShortLinkStatisticsResponse }
  expect(payload.code).toBe(0)
  return payload.data
}

/** Resolves only a browser request for the explicitly applied range. */
function nextStatistics(page: Page, endpoint: string, id: string, range: Record<string, string>) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === endpoint && url.searchParams.get('id') === id
      && ['days', 'startDate', 'endDate'].every((key) => url.searchParams.get(key) === (range[key] ?? null))
  })
}

/** Compares persisted CSV and stable aggregates without assuming requests share a UTC day. */
async function expectDownload(page: Page, endpoint: string, scenario: Scenario, displayed: ShortLinkStatisticsResponse, testInfo: TestInfo, name: string, english = false) {
  const exportResponse = page.waitForResponse((response) => new URL(response.url()).pathname === `${endpoint}/export`)
  const saved = page.waitForEvent('download')
  await expect(page.getByTestId('analytics-export')).toBeEnabled()
  await page.getByRole('button', { name: english ? 'Export CSV' : '导出 CSV', exact: true }).click()
  const response = await exportResponse
  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toBe('no-store')
  const url = new URL(response.url())
  expect(Object.fromEntries(url.searchParams)).toEqual({
    id: scenario.link.id, startDate: displayed.range.startDate, endDate: displayed.range.endDate,
  })
  const descriptor = await response.json() as { code: number; data: { fileName: string; contentType: string; content: string } }
  expect(descriptor.code).toBe(0)
  expect(descriptor.data.contentType).toBe('text/csv;charset=utf-8')
  const download = await saved
  const filename = `moeurl-statistics-${scenario.link.slug}-${displayed.range.startDate}-${displayed.range.endDate}.csv`
  expect(download.suggestedFilename()).toBe(filename)
  expect(descriptor.data.fileName).toBe(filename)
  const path = testInfo.outputPath(`${name}-${filename}`)
  await download.saveAs(path)
  expect(await download.failure()).toBeNull()
  const bytes = await readFile(path)
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
  expect(bytes.equals(Buffer.from(descriptor.data.content, 'utf8'))).toBe(true)
  const text = bytes.toString('utf8').slice(1)
  expect(text.startsWith('section,key,value,visit_count\r\n')).toBe(true)
  expect(text.endsWith('\r\n')).toBe(true)
  expect(text.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/)
  const fresh = await statisticsPayload(await page.request.get(`${endpoint}?${url.searchParams}`))
  expect(fresh.range).toEqual(displayed.range)
  // Independent requests can straddle UTC midnight; only today's count may change.
  expect(fresh.stats).toEqual({ ...displayed.stats, todayVisitCount: expect.any(Number) })
  const { stats, range } = fresh
  // This fixture deliberately uses delimiter-free values; escaping/injection is covered by CSV-reader unit tests.
  const rows = text.slice(0, -2).split('\r\n').map((row) => row.split(','))
  expect(rows).toEqual([
    ['section', 'key', 'value', 'visit_count'],
    ['metadata', 'short_link', scenario.link.url, ''],
    ['metadata', 'start_date', range.startDate, ''],
    ['metadata', 'end_date', range.endDate, ''],
    ['metadata', 'time_zone', 'UTC', ''],
    ['summary', 'range_visit_count', '', String(stats.rangeVisitCount)],
    ['summary', 'lifetime_visit_count', '', String(stats.visitCount)],
    ['summary', 'today_visit_count', '', expect.stringMatching(/^(0|[1-9]\d*)$/)],
    ['summary', 'last_visited_at', utcTimestamp(stats.lastVisitedAt), ''],
    ...stats.trend.map((point) => ['trend', 'date', point.date, String(point.visitCount)]),
    ...stats.referrers.map((item) => ['referrer', 'host', item.value, String(item.visitCount)]),
    ...stats.devices.map((item) => ['device', 'type', item.value, String(item.visitCount)]),
    ...stats.countries.map((item) => ['country', 'code', item.value, String(item.visitCount)]),
  ])
  for (const count of [displayed.stats.todayVisitCount, stats.todayVisitCount, Number(rows[7]?.[3])]) {
    expect(Number.isSafeInteger(count)).toBe(true)
    expect(count).toBeGreaterThanOrEqual(0)
    expect(count).toBeLessThanOrEqual(stats.visitCount)
  }
  for (const secret of [scenario.link.targetUrl, scenario.link.id, scenario.username, 'Private CSV owner', privateTitle, privateTag, fixturePassword, '/private-campaign?secret=referrer']) {
    expect(text).not.toContain(secret)
  }
  const message = page.getByText(english ? 'CSV download started. Confirm saving in your browser.' : '已发起 CSV 下载，请在浏览器中确认保存。', { exact: true })
  await expect(message).toBeVisible()
  // Dismiss through the real control before the next download; a hovered toast pauses its timeout.
  await page.getByRole('button', { name: english ? 'Dismiss notification' : '关闭提示', exact: true }).click()
  await expect(message).not.toBeVisible()
  await testInfo.attach(`${name}-csv`, { path, contentType: 'text/csv' })
}

/** Checks header geometry and captures the real responsive layout for visual review. */
async function captureLayout(page: Page, testInfo: TestInfo, name: string) {
  await expectNoHorizontalOverflow(page)
  const header = page.locator('.analytics-page__header')
  await expect(header.getByRole('heading')).toBeVisible()
  const button = page.getByTestId('analytics-export')
  await expect(button).toBeVisible()
  const headerBox = await header.boundingBox()
  const buttonBox = await button.boundingBox()
  expect(headerBox).not.toBeNull()
  expect(buttonBox).not.toBeNull()
  expect(buttonBox!.x).toBeGreaterThanOrEqual(headerBox!.x)
  expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(headerBox!.x + headerBox!.width + 1)
  expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(headerBox!.y + headerBox!.height + 1)
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true, animations: 'disabled' })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

for (const scope of ['own', 'admin'] as const) {
  for (const width of [1280, 390]) {
    test(`${scope} downloads real aggregate CSV for applied UTC ranges at ${width}px`, async ({ scenario }, testInfo) => {
      const { owner, admin, link } = scenario
      const page = scope === 'own' ? owner : admin
      await page.setViewportSize({ width, height: width === 1280 ? 720 : 800 })
      const endpoint = `/api/v1/${scope === 'admin' ? 'admin/' : ''}short-link/statistics`
      const initial = await statisticsPayload(await owner.request.get(`/api/v1/short-link/statistics?id=${link.id}`))
      expect(initial.stats.visitCount).toBe(0)
      for (const host of ['alpha.example.test', 'beta.example.test']) {
        const redirected = await owner.request.get(link.url, {
          maxRedirects: 0, headers: { Referer: `https://${host}/private-campaign?secret=referrer` },
        })
        expect(redirected.status()).toBe(302)
        expect(redirected.headers().location).toBe(link.targetUrl)
      }
      await expect.poll(async () => (await statisticsPayload(await owner.request.get(`/api/v1/short-link/statistics?id=${link.id}`))).stats.visitCount).toBe(2)
      let response = nextStatistics(page, endpoint, link.id, { days: '7' })
      await page.goto(`${scope === 'admin' ? '/admin' : ''}/link/${link.id}/analytics`)
      const defaultData = await statisticsPayload(await response)
      expect(defaultData.stats.rangeVisitCount).toBe(2)
      expect(defaultData.stats.referrers).toEqual([
        { value: 'alpha.example.test', visitCount: 1 }, { value: 'beta.example.test', visitCount: 1 },
      ])
      await expect(page.getByText('导出当前已应用日期范围的聚合统计。', { exact: true })).toBeVisible()
      await page.getByRole('combobox', { name: '统计日期范围', exact: true }).press('Enter')
      await page.getByRole('option', { name: '自定义日期', exact: true }).click()
      const included = { startDate: dateOffset(defaultData.range.endDate, -1), endDate: defaultData.range.endDate }
      await page.getByLabel('开始日期（UTC）', { exact: true }).fill(included.startDate)
      await page.getByLabel('结束日期（UTC）', { exact: true }).fill(included.endDate)
      response = nextStatistics(page, endpoint, link.id, included)
      await page.getByRole('button', { name: '应用', exact: true }).click()
      const applied = await statisticsPayload(await response)
      expect(applied.range).toMatchObject(included)
      expect(applied.stats.rangeVisitCount).toBe(2)
      expect(applied.stats.trend).toHaveLength(2)
      await expectDownload(page, endpoint, scenario, applied, testInfo, 'applied')
      await captureLayout(page, testInfo, `csv-${scope}-${width}px-zh`)

      const historical = { startDate: dateOffset(defaultData.range.endDate, -20), endDate: dateOffset(defaultData.range.endDate, -14) }
      await page.getByLabel('开始日期（UTC）', { exact: true }).fill(historical.startDate)
      await page.getByLabel('结束日期（UTC）', { exact: true }).fill(historical.endDate)
      // Editing an unapplied draft must keep exporting the last successful applied range.
      await expectDownload(page, endpoint, scenario, applied, testInfo, 'unapplied-draft')
      response = nextStatistics(page, endpoint, link.id, historical)
      await page.getByRole('button', { name: '应用', exact: true }).click()
      const empty = await statisticsPayload(await response)
      expect(empty.range).toMatchObject(historical)
      expect(empty.stats).toMatchObject({ rangeVisitCount: 0, visitCount: 2, referrers: [], devices: [], countries: [] })
      expect(empty.stats.trend).toHaveLength(7)
      expect(empty.stats.trend.every((point) => point.visitCount === 0)).toBe(true)
      if (width === 390) await page.getByRole('button', { name: '打开控制台菜单', exact: true }).click()
      await page.getByRole('button', { name: '选择语言', exact: true }).filter({ visible: true }).first().click()
      await page.getByRole('menuitemradio', { name: 'English', exact: true }).click()
      if (width === 390) {
        await page.getByRole('button', { name: 'Close menu', exact: true }).click()
        await expect(page.getByTestId('console-mobile-nav')).not.toBeVisible()
      }
      await expect(page.getByText('Export aggregate statistics for the currently applied date range.', { exact: true })).toBeVisible()
      await expectDownload(page, endpoint, scenario, empty, testInfo, 'historical-zero', true)
      await captureLayout(page, testInfo, `csv-${scope}-${width}px-en-zero`)
      await page.setViewportSize({ width: width === 1280 ? 800 : 320, height: 800 })
      await captureLayout(page, testInfo, `csv-${scope}-${width === 1280 ? 800 : 320}px-en-zero`)
      // Export requests never create additional successful redirect events.
      expect((await statisticsPayload(await owner.request.get(`/api/v1/short-link/statistics?id=${link.id}`))).stats.visitCount).toBe(2)
    })
  }
}
