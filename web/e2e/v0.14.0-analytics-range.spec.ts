import { randomBytes } from 'node:crypto'
import { expect, test as base } from '@playwright/test'
import type { APIResponse, Page, Response } from '@playwright/test'
import type { ShortLink, ShortLinkStatisticsResponse } from '../src/entities/short-link/model'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

const test = base.extend<{ link: ShortLink }>({
  link: async ({ page }, use) => {
    const login = await page.request.post('/api/v1/auth/login', {
      data: { username: e2eAdminUsername, password: e2eAdminPassword },
    })
    expect(await login.json()).toMatchObject({ code: 0 })
    const created = await page.request.post('/api/v1/short-link/create', {
      data: { targetUrl: `https://example.com/e2e-analytics-${randomBytes(8).toString('hex')}` },
    })
    const payload = await created.json() as { code: number; data: { shortLink: ShortLink } }
    expect(payload.code).toBe(0)
    const link = payload.data.shortLink
    try {
      await use(link)
    } finally {
      // Fixture teardown reports cleanup errors alongside any original test failure.
      const deleted = await page.request.post('/api/v1/short-link/delete', { data: { id: link.id } })
      expect(await deleted.json()).toMatchObject({ code: 0 })
    }
  },
})

test.use({ serviceWorkers: 'block' })

/** Moves a server-provided UTC calendar date without relying on the browser clock. */
function dateOffset(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

/** Checks the real response's business and private-cache contracts. */
async function statisticsPayload(response: APIResponse | Response): Promise<ShortLinkStatisticsResponse> {
  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toBe('no-store')
  const payload = await response.json() as { code: number; data: ShortLinkStatisticsResponse }
  expect(payload.code).toBe(0)
  return payload.data
}

/** Reads statistics through the same authenticated endpoint used by the current page. */
async function readStatistics(page: Page, endpoint: string, id: string): Promise<ShortLinkStatisticsResponse> {
  return statisticsPayload(await page.request.get(`${endpoint}?id=${encodeURIComponent(id)}`))
}

/** Waits for a browser-originated request with exactly the applied range. */
function nextStatistics(page: Page, endpoint: string, id: string, range: Record<string, string>) {
  return page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === endpoint && url.searchParams.get('id') === id
      && ['days', 'startDate', 'endDate'].every((key) => url.searchParams.get(key) === (range[key] ?? null))
  })
}

/** Selects the rendered Vuetify option rather than changing component state directly. */
async function chooseRange(page: Page, label: string) {
  await page.getByTestId('console-page-analytics').getByLabel('统计日期范围', { exact: true }).locator('..').click()
  await page.getByRole('option', { name: label, exact: true }).click()
}

/** Verifies inclusive dates, zero-filled trends, and consistent dimension totals. */
function expectRange(data: ShortLinkStatisticsResponse, days: number, visits: number, lifetime = 2) {
  expect(data.range.timeZone).toBe('UTC')
  expect(data.range.startDate).toBe(dateOffset(data.range.endDate, 1 - days))
  expect(data.stats.visitCount).toBe(lifetime)
  expect(data.stats.rangeVisitCount).toBe(visits)
  expect(data.stats.trend).toHaveLength(days)
  expect(data.stats.trend.map((point) => point.date)).toEqual(
    Array.from({ length: days }, (_, index) => dateOffset(data.range.startDate, index)),
  )
  expect(data.stats.trend.reduce((total, point) => total + point.visitCount, 0)).toBe(visits)
  expect(data.stats.trend.filter((point) => point.visitCount === 0).length).toBeGreaterThanOrEqual(days - visits)
  for (const items of [data.stats.referrers, data.stats.devices, data.stats.countries]) {
    expect(items.reduce((total, item) => total + item.visitCount, 0)).toBe(visits)
  }
}

/** Confirms the server result is displayed with the correct labels and range. */
async function expectRenderedStatistics(page: Page, data: ShortLinkStatisticsResponse) {
  for (const [label, count] of [
    ['区间访问量', data.stats.rangeVisitCount],
    ['总访问量（全部历史）', data.stats.visitCount],
    ['今日访问量（UTC）', data.stats.todayVisitCount],
  ] as const) {
    const metric = page.getByTestId('analytics-summary').locator('.v-card').filter({
      has: page.getByText(label, { exact: true }),
    })
    await expect(metric.locator('strong')).toHaveText(String(count))
  }
  await expect(page.getByText(
    `区间访问量、趋势和来源分布：${data.range.startDate} 至 ${data.range.endDate}（UTC，含首尾日期）。`,
    { exact: true },
  )).toBeVisible()
  await expect(page.getByTestId('analytics-trend-chart')).toBeVisible()
}

for (const scope of ['own', 'admin'] as const) {
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 800 }]) {
    test(`${scope} analytics applies real UTC ranges and validates drafts at ${viewport.width}px`, async ({ page, link }, testInfo) => {
      await page.setViewportSize(viewport)
      const endpoint = `/api/v1/${scope === 'admin' ? 'admin/' : ''}short-link/statistics`
      const path = `${scope === 'admin' ? '/admin' : ''}/link/${encodeURIComponent(link.id)}/analytics`
      const before = await readStatistics(page, endpoint, link.id)
      expectRange(before, 7, 0, 0)
      for (const referrer of ['alpha.example.test', 'beta.example.test']) {
        const redirected = await page.request.get(link.url, {
          maxRedirects: 0,
          headers: { Referer: `https://${referrer}/campaign` },
        })
        expect(redirected.status()).toBe(302)
        expect(redirected.headers().location).toBe(link.targetUrl)
      }
      await expect.poll(async () => (await readStatistics(page, endpoint, link.id)).stats.visitCount).toBe(2)

      let response = nextStatistics(page, endpoint, link.id, { days: '7' })
      await page.goto(path)
      let data = await statisticsPayload(await response)
      expectRange(data, 7, 2)
      await expect(page.getByRole('heading', { name: scope === 'admin' ? '全站短链访问分析' : '短链访问分析', exact: true })).toBeVisible()
      await expectRenderedStatistics(page, data)
      for (const days of [30, 90]) {
        response = nextStatistics(page, endpoint, link.id, { days: String(days) })
        await chooseRange(page, `近 ${days} 天`)
        data = await statisticsPayload(await response)
        expectRange(data, days, 2)
        await expectRenderedStatistics(page, data)
      }

      // The seven-day interval includes both visits even if UTC midnight occurred during setup.
      const included = { startDate: dateOffset(data.range.endDate, -6), endDate: data.range.endDate }
      const requests: string[] = []
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === endpoint) requests.push(request.url())
      })
      await chooseRange(page, '自定义日期')
      await page.getByLabel('开始日期（UTC）', { exact: true }).fill(included.endDate)
      await page.getByLabel('结束日期（UTC）', { exact: true }).fill(included.startDate)
      await page.getByRole('button', { name: '应用', exact: true }).click()
      await expect(page.getByText('结束日期须不早于开始日期，区间最多 90 天（含首尾日期）', { exact: true })).toBeVisible()
      await expectRenderedStatistics(page, data)
      expect(requests).toEqual([])

      await page.getByLabel('开始日期（UTC）', { exact: true }).fill(included.startDate)
      await page.getByLabel('结束日期（UTC）', { exact: true }).fill(included.endDate)
      response = nextStatistics(page, endpoint, link.id, included)
      await page.getByRole('button', { name: '应用', exact: true }).click()
      data = await statisticsPayload(await response)
      expectRange(data, 7, 2)
      expect(data.range).toMatchObject(included)
      await expectRenderedStatistics(page, data)
      await expect(page.getByText('结束日期须不早于开始日期，区间最多 90 天（含首尾日期）', { exact: true })).not.toBeVisible()
      // The next successful request is also a barrier for the rejected draft: only this applied range was sent.
      expect(requests).toHaveLength(1)
      expect(new URL(requests[0]!).searchParams.get('startDate')).toBe(included.startDate)
      expect(new URL(requests[0]!).searchParams.get('endDate')).toBe(included.endDate)
      for (const referrer of ['alpha.example.test', 'beta.example.test']) {
        const item = page.locator('.analytics-page__dimensions .v-list-item').filter({ hasText: referrer })
        await expect(item).toBeVisible()
        await expect(item.locator('strong')).toHaveText('1')
      }
      await expectNoHorizontalOverflow(page)
      const customScreenshot = testInfo.outputPath(`analytics-${scope}-custom-${viewport.width}px.png`)
      await page.screenshot({ path: customScreenshot, fullPage: true, animations: 'disabled' })
      await testInfo.attach(`analytics-${scope}-custom-${viewport.width}px`, {
        path: customScreenshot, contentType: 'image/png',
      })

      const historical = { startDate: dateOffset(included.endDate, -20), endDate: dateOffset(included.endDate, -14) }
      await page.getByLabel('开始日期（UTC）', { exact: true }).fill(historical.startDate)
      await page.getByLabel('结束日期（UTC）', { exact: true }).fill(historical.endDate)
      response = nextStatistics(page, endpoint, link.id, historical)
      await page.getByRole('button', { name: '应用', exact: true }).click()
      const empty = await statisticsPayload(await response)
      expectRange(empty, 7, 0)
      expect(empty.range).toMatchObject(historical)
      expect(empty.stats.lastVisitedAt).toBe(data.stats.lastVisitedAt)
      await expectRenderedStatistics(page, empty)
      await expect(page.getByText('暂无统计数据', { exact: true })).toHaveCount(3)
      await expect(page.locator('.analytics-page__dimensions .v-list-item')).toHaveCount(0)
      await expectNoHorizontalOverflow(page)
      const emptyScreenshot = testInfo.outputPath(`analytics-${scope}-empty-${viewport.width}px.png`)
      await page.screenshot({ path: emptyScreenshot, fullPage: true, animations: 'disabled' })
      await testInfo.attach(`analytics-${scope}-empty-${viewport.width}px`, {
        path: emptyScreenshot, contentType: 'image/png',
      })
      if (viewport.width === 390) {
        await page.setViewportSize({ width: 320, height: 800 })
        await expectNoHorizontalOverflow(page)
        await expect(page.getByRole('button', { name: '应用', exact: true })).toBeVisible()
      }
    })
  }
}

test('both HTTP statistics endpoints reject ambiguous and invalid ranges', async ({ page, link }) => {
  const initial = await readStatistics(page, '/api/v1/short-link/statistics', link.id)
  const today = initial.range.endDate
  const invalidQueries = [
    'days=', 'days=14', 'days=7&days=30',
    `days=7&startDate=${today}&endDate=${today}`,
    `startDate=${today}`, `endDate=${today}`, `startDate=&endDate=${today}`,
    `startDate=${today}&startDate=${today}&endDate=${today}`,
    `startDate=${today}&endDate=${today}&endDate=${today}`,
    'startDate=2026-02-30&endDate=2026-03-01',
    `startDate=${dateOffset(today, -90)}&endDate=${today}`,
    `startDate=${today}&endDate=${dateOffset(today, -1)}`,
    `startDate=${dateOffset(today, 10)}&endDate=${dateOffset(today, 10)}`,
  ]
  for (const endpoint of ['/api/v1/short-link/statistics', '/api/v1/admin/short-link/statistics']) {
    for (const query of invalidQueries) {
      const response = await page.request.get(`${endpoint}?id=${encodeURIComponent(link.id)}&${query}`)
      expect(response.status(), query).toBe(200)
      expect(response.headers()['cache-control'], query).toBe('no-store')
      expect(await response.json(), query).toMatchObject({ code: 100001 })
    }
    const unchanged = await readStatistics(page, endpoint, link.id)
    expectRange(unchanged, 7, 0, 0)
  }
})
