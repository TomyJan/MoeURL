import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { expect, test as base } from '@playwright/test'
import type { BrowserContext, Page, TestInfo } from '@playwright/test'
import type { ShortLink } from '../src/entities/short-link/model'
import type { VisitResult, VisitRecord } from '../src/entities/insights/model'
import type { UserGroup } from '../src/entities/user-group/api'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

type Scope = 'own' | 'admin'
type Filters = { deviceType?: string; countryCode?: string }
type DownloadObservation = { created: { url: string; type: string; size: number }[]; revoked: string[] }
interface Scenario { owner: Page; admin: Page; link: ShortLink; empty: ShortLink; foreign: ShortLink; username: string }
const password = 'visit-export-fixture-password'
const header = 'short_link_id,start_date,end_date,time_zone,event_id,occurred_at,referrer_host,device_type,browser_family,os_family,country_code'
const desktopUA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/144.0.0.0 Safari/537.36'
const mobileUA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'

const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, page: admin }, use, info) => {
    const baseURL = info.project.use.baseURL
    if (typeof baseURL !== 'string') throw new Error('Visit-export E2E requires an isolated Compose baseURL')
    const contexts: BrowserContext[] = []
    const links: ShortLink[] = []
    let ownerID: string | undefined
    const errors: unknown[] = []
    try {
      expect(await (await admin.request.post('/api/v1/auth/login', { data: { username: e2eAdminUsername, password: e2eAdminPassword } })).json()).toMatchObject({ code: 0 })
      const username = `visit-csv-${randomBytes(8).toString('hex')}`
      const account = await (await admin.request.post('/api/v1/admin/user/create', { data: { username, password, nickname: 'Visit CSV fixture', groupKey: 'user', status: 'active' } })).json() as { code: number; data: { user: { id: string } } }
      if (account.code === 0) ownerID = account.data.user.id
      expect(account.code).toBe(0)
      const context = await browser.newContext({ baseURL, locale: 'zh-CN', serviceWorkers: 'block', colorScheme: 'light', reducedMotion: 'reduce' })
      contexts.push(context)
      const owner = await context.newPage()
      expect(await (await owner.request.post('/api/v1/auth/login', { data: { username, password } })).json()).toMatchObject({ code: 0 })
      for (const creator of [owner, owner, admin]) {
        const result = await (await creator.request.post('/api/v1/short-link/create', { data: { targetUrl: `https://example.com/private/${username}?secret=destination`, metadata: { title: 'Private fixture title', tags: [username] } } })).json() as { code: number; data: { shortLink: ShortLink } }
        if (result.code === 0) links.push(result.data.shortLink)
        expect(result.code).toBe(0)
      }
      await use({ owner, admin, link: links[0]!, empty: links[1]!, foreign: links[2]!, username })
    } catch (error) { errors.push(error) }
    finally {
      for (const link of links) {
        try { expect(await (await admin.request.post('/api/v1/admin/short-link/delete', { data: { id: link.id }, timeout: 5_000 })).json()).toMatchObject({ code: 0 }) } catch (error) { errors.push(error) }
      }
      if (ownerID) {
        try { expect(await (await admin.request.post('/api/v1/admin/user/update', { data: { id: ownerID, nickname: 'Retired visit CSV fixture', status: 'disabled' }, timeout: 5_000 })).json()).toMatchObject({ code: 0 }) } catch (error) { errors.push(error) }
      }
      for (const context of contexts) { try { await context.close() } catch (error) { errors.push(error) } }
      await attachJSON(info, 'fixture-cleanup', { links: links.map(link => link.id), ownerID, errors: errors.map(String) })
    }
    if (errors.length) throw new AggregateError(errors, 'Visit-export scenario or independent cleanup failed')
  }, { timeout: 45_000 }],
})

test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

/** Persists machine-readable evidence even when Playwright uses its plain line reporter. */
async function attachJSON(info: TestInfo, name: string, value: unknown) {
  const path = info.outputPath(`${name}.json`)
  await writeFile(path, JSON.stringify(value, null, 2))
  await info.attach(name, { path, contentType: 'application/json' })
}

/** Reads persisted IDs/times through the real authorized records API, never the export formatter. */
async function records(page: Page, link: ShortLink): Promise<VisitResult> {
  const response = await page.request.get(`/api/v1/short-link/visits?id=${link.id}&pageSize=100`)
  expect(response.status()).toBe(200)
  const payload = await response.json() as { code: number; data: VisitResult }
  expect(payload.code).toBe(0)
  return payload.data
}

/** Generates real successful redirects without making any request to the external destination. */
async function seedVisits(page: Page, link: ShortLink) {
  for (let index = 0; index < 28; index++) {
    const response = await page.request.get(link.url, {
      maxRedirects: 0,
      headers: index === 27 ? { 'User-Agent': '' } : {
        'User-Agent': index === 26 ? mobileUA : desktopUA,
        Referer: `https://${index === 26 ? 'mobile' : 'desktop'}.example.test/private-path?private-query=secret`,
        'X-MoeURL-E2E-Country': 'SG',
      },
    })
    expect(response.status()).toBe(302)
    expect(response.headers().location).toBe(link.targetUrl)
  }
  await expect.poll(async () => (await records(page, link)).items.length).toBe(28)
  const result = await records(page, link)
  // Literal fixture expectations must fail even if collection and export regress together.
  expect(result.items.map(({ referrerHost, deviceType, browserFamily, osFamily, countryCode }) =>
    [referrerHost, deviceType, browserFamily, osFamily, countryCode]).sort()).toEqual([
    ...Array.from({ length: 26 }, () => ['desktop.example.test', 'desktop', 'chrome', 'windows', 'SG']),
    ['mobile.example.test', 'mobile', 'safari', 'ios', 'SG'],
    [null, 'other', null, null, null],
  ].sort())
  return result
}

/** Observes native Blob URLs while preserving the actual browser implementation and downloads. */
async function observeDownloads(page: Page) {
  await page.addInitScript(() => {
    const observed: DownloadObservation = { created: [], revoked: [] }
    Object.assign(window, { visitDownloadObservation: observed })
    const create = URL.createObjectURL.bind(URL)
    const revoke = URL.revokeObjectURL.bind(URL)
    URL.createObjectURL = object => {
      const url = create(object)
      if (object instanceof Blob) observed.created.push({ url, type: object.type, size: object.size })
      return url
    }
    URL.revokeObjectURL = url => { observed.revoked.push(url); revoke(url) }
  })
}

/** Converts a persisted instant to UTC without throwing away database fractional precision. */
function utc(value: string) {
  const fraction = /\.(\d+)/.exec(value)?.[1]?.replace(/0+$/, '')
  return `${new Date(value).toISOString().slice(0, 19)}${fraction ? `.${fraction}` : ''}Z`
}

/** Downloads the real file and compares every cell to independent fixture dimensions and persisted IDs. */
async function download(page: Page, scope: Scope, link: ShortLink, result: VisitResult, expected: VisitRecord[], filters: Filters, info: TestInfo, name: string, expectedCount: number) {
  const endpoint = `/api/v1/${scope === 'admin' ? 'admin/' : ''}short-link/visits/export`
  const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === endpoint)
  const downloadPromise = page.waitForEvent('download')
  const button = page.getByTestId('visit-export')
  await expect(button).toBeEnabled()
  await button.click()
  const response = await responsePromise
  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toBe('no-store')
  expect(Object.fromEntries(new URL(response.url()).searchParams)).toEqual({ id: link.id, startDate: result.range.startDate, endDate: result.range.endDate, ...filters })
  const descriptor = await response.json() as { code: number; data: { contentType: string; fileName: string; content: string } }
  expect(descriptor.code).toBe(0)
  expect(descriptor.data.contentType).toBe('text/csv;charset=utf-8')
  const saved = await downloadPromise
  const fileName = `moeurl-visits-${link.id}-${result.range.startDate}-${result.range.endDate}.csv`
  expect(saved.suggestedFilename()).toBe(fileName)
  expect(descriptor.data.fileName).toBe(fileName)
  const path = info.outputPath(`${name}-${fileName}`)
  await saved.saveAs(path)
  expect(await saved.failure()).toBeNull()
  const bytes = await readFile(path)
  expect([...bytes.subarray(0, 3)]).toEqual([239, 187, 191])
  expect(bytes.equals(Buffer.from(descriptor.data.content, 'utf8'))).toBe(true)
  const content = bytes.toString('utf8').slice(1)
  expect(content.endsWith('\r\n')).toBe(true)
  expect(content.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/)
  const rows = content.slice(0, -2).split('\r\n').map(row => row.split(','))
  expect(expected).toHaveLength(expectedCount)
  expect(rows).toHaveLength(expectedCount + 1)
  expect(rows).toEqual([header.split(','), ...expected.map(item => {
    const kind = item.referrerHost === 'desktop.example.test' ? 'desktop' : item.referrerHost === 'mobile.example.test' ? 'mobile' : 'other'
    const dimensions = kind === 'desktop' ? ['desktop.example.test', 'desktop', 'chrome', 'windows', 'SG'] : kind === 'mobile' ? ['mobile.example.test', 'mobile', 'safari', 'ios', 'SG'] : ['', 'other', '', '', '']
    return [link.id, result.range.startDate, result.range.endDate, 'UTC', item.id, utc(item.occurredAt), ...dimensions]
  })])
  for (const secret of [link.targetUrl, 'Private fixture title', 'private-path', 'private-query', 'destination', password, desktopUA, mobileUA, '127.0.0.1', 'owner', 'username', 'password_hash', 'access_token']) expect(content).not.toContain(secret)
  const observation = await page.evaluate(() => (window as unknown as { visitDownloadObservation: DownloadObservation }).visitDownloadObservation)
  expect(observation.created.length).toBeGreaterThan(0)
  expect(observation.revoked).toEqual(observation.created.map(item => item.url))
  expect(observation.created.at(-1)).toMatchObject({ type: 'text/csv;charset=utf-8', size: bytes.length })
  await expect(page.locator('a[download]')).toHaveCount(0)
  await info.attach(`${name}-csv`, { path, contentType: 'text/csv' })
  await attachJSON(info, `${name}-browser-cleanup`, observation)
}

/** Waits for the exact applied filter instead of accepting a stale successful records response. */
function nextRecords(page: Page, scope: Scope, filters: Filters, cursor = false) {
  return page.waitForResponse(response => {
    const url = new URL(response.url())
    return url.pathname === `/api/v1/${scope === 'admin' ? 'admin/' : ''}short-link/visits`
      && ['deviceType', 'countryCode'].every(key => url.searchParams.get(key) === (filters[key as keyof Filters] || null))
      && url.searchParams.has('cursor') === cursor
  })
}

/** Captures document and action geometry in addition to the real desktop/mobile image. */
async function capture(page: Page, info: TestInfo, name: string) {
  await expectNoHorizontalOverflow(page)
  const geometry = await page.getByTestId('visit-records').evaluate(element => {
    const box = element.getBoundingClientRect()
    const action = element.querySelector('[data-testid="visit-export"]')!.getBoundingClientRect()
    return { browser: navigator.userAgent, viewport: innerWidth, document: document.documentElement.scrollWidth, panel: { left: box.left, right: box.right }, action: { left: action.left, right: action.right }, footer: [...document.querySelectorAll('a')].filter(a => a.href.includes('github.com/TomyJan/MoeURL/commit/')).map(a => ({ label: a.textContent, url: a.href })) }
  })
  expect(geometry.action.left).toBeGreaterThanOrEqual(geometry.panel.left)
  expect(geometry.action.right).toBeLessThanOrEqual(geometry.panel.right + 1)
  expect(geometry.action.right).toBeLessThanOrEqual(geometry.viewport)
  const path = info.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true, animations: 'disabled' })
  await info.attach(name, { path, contentType: 'image/png' })
  await attachJSON(info, `${name}-geometry`, geometry)
}

for (const scope of ['own', 'admin'] as const) {
  for (const width of [1280, 390]) {
    test(`${scope} downloads complete anonymous visits with applied filters at ${width}px`, async ({ scenario }, info) => {
      const { owner, admin, link, foreign } = scenario
      const result = await seedVisits(owner, link)
      expect(result.items).toHaveLength(28)
      expect(await (await owner.request.get(`/api/v1/short-link/visits/export?id=${foreign.id}`)).json()).toMatchObject({ code: 200104, data: null })
      const page = scope === 'own' ? owner : admin
      await observeDownloads(page)
      await page.setViewportSize({ width, height: width === 390 ? 800 : 900 })
      await page.goto(`/${scope === 'admin' ? 'admin/' : ''}link/${link.id}/analytics`)
      const panel = page.getByTestId('visit-records')
      await expect(panel.getByRole('row')).toHaveCount(26)
      await expect(panel.getByText('导出完整筛选结果，最多 1000 条、8 MiB。', { exact: true })).toBeVisible()
      const second = nextRecords(page, scope, {}, true)
      await panel.getByRole('button', { name: '下一页', exact: true }).click()
      expect(await (await second).json()).toMatchObject({ code: 0 })
      await expect(panel.getByRole('row')).toHaveCount(4)
      await download(page, scope, link, result, result.items, {}, info, 'all-from-second-page', 28)
      await capture(page, info, `${scope}-${width}-complete`)

      let applied = nextRecords(page, scope, { deviceType: 'desktop' })
      await panel.getByRole('combobox', { name: '设备', exact: true }).press('Enter')
      await page.getByRole('option', { name: '桌面设备', exact: true }).click()
      expect(await (await applied).json()).toMatchObject({ code: 0 })
      await download(page, scope, link, result, result.items.filter(item => item.referrerHost === 'desktop.example.test'), { deviceType: 'desktop' }, info, 'desktop', 26)
      await panel.getByLabel('国家代码', { exact: true }).fill('SG')
      await expect(page.getByTestId('visit-export')).toBeDisabled()
      applied = nextRecords(page, scope, { deviceType: 'desktop', countryCode: 'SG' })
      await panel.getByRole('button', { name: '应用筛选', exact: true }).click()
      expect(await (await applied).json()).toMatchObject({ code: 0 })
      await download(page, scope, link, result, result.items.filter(item => item.referrerHost === 'desktop.example.test'), { deviceType: 'desktop', countryCode: 'SG' }, info, 'applied-country', 26)

      applied = nextRecords(page, scope, { countryCode: 'SG' })
      await panel.getByRole('combobox', { name: '设备', exact: true }).press('Enter')
      await page.getByRole('option', { name: '全部', exact: true }).click()
      expect(await (await applied).json()).toMatchObject({ code: 0 })
      await panel.getByLabel('国家代码', { exact: true }).fill('unknown')
      await expect(page.getByTestId('visit-export')).toBeDisabled()
      applied = nextRecords(page, scope, { countryCode: 'unknown' })
      await panel.getByRole('button', { name: '应用筛选', exact: true }).click()
      expect(await (await applied).json()).toMatchObject({ code: 0 })
      await download(page, scope, link, result, result.items.filter(item => item.referrerHost === null), { countryCode: 'unknown' }, info, 'unknown-country', 1)
      await capture(page, info, `${scope}-${width}-unknown`)
    })
  }
}

test('empty visit range downloads a legal header-only file', async ({ scenario }, info) => {
  const { owner, empty } = scenario
  const result = await records(owner, empty)
  expect(result.items).toEqual([])
  await observeDownloads(owner)
  await owner.goto(`/link/${empty.id}/analytics`)
  await expect(owner.getByTestId('visit-records').getByText('已应用范围与筛选下暂无访问记录。', { exact: true })).toBeVisible()
  await download(owner, 'own', empty, result, [], {}, info, 'empty', 0)
})

test('revoking export on loaded analytics rejects the stale action and restores readable records', async ({ scenario }, info) => {
  const { owner, admin, link } = scenario
  const group = async () => {
    const payload = await (await admin.request.get('/api/v1/admin/user-group/list')).json() as { code: number; data: { groups: UserGroup[] } }
    expect(payload.code).toBe(0)
    return payload.data.groups.find(item => item.key === 'user')!
  }
  const original = await group()
  const errors: unknown[] = []
  try {
    await seedVisits(owner, link)
    await observeDownloads(owner)
    const downloads: string[] = []
    owner.on('download', download => { downloads.push(download.suggestedFilename()) })
    await owner.goto(`/link/${link.id}/analytics`)
    await expect(owner.getByTestId('visit-records').getByRole('row')).toHaveCount(26)
    await expect(owner.getByTestId('visit-export')).toBeEnabled()
    expect(await (await admin.request.post('/api/v1/admin/user-group/update-permissions', { data: { groupKey: 'user', expectedUpdatedAt: original.updatedAt, permissions: original.permissions.filter(permission => permission !== 'short_link:export_visits') } })).json()).toMatchObject({ code: 0 })
    const rejected = owner.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/short-link/visits/export')
    const refreshed = owner.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/me')
    await owner.getByTestId('visit-export').click()
    expect(await (await rejected).json()).toMatchObject({ code: 120001, data: null })
    const authorization = await (await refreshed).json() as { code: number; data: { user: { permissions: string[] } } }
    expect(authorization.code).toBe(0)
    expect(authorization.data.user.permissions).toEqual(original.permissions.filter(permission => permission !== 'short_link:export_visits'))
    await expect(owner.getByTestId('analytics-summary')).toBeVisible()
    await expect(owner.getByTestId('visit-records').getByRole('row')).toHaveCount(26)
    await expect(owner.getByTestId('visit-export')).toHaveCount(0)
    expect(downloads).toEqual([])
    const observation = await owner.evaluate(() => (window as unknown as { visitDownloadObservation: DownloadObservation }).visitDownloadObservation)
    expect(observation).toEqual({ created: [], revoked: [] })
    await attachJSON(info, 'permission-denial-recovery', { code: 120001, permissions: authorization.data.user.permissions, downloads, observation })
  } catch (error) { errors.push(error) }
  finally {
    try {
      const latest = await group()
      expect(await (await admin.request.post('/api/v1/admin/user-group/update-permissions', { data: { groupKey: 'user', expectedUpdatedAt: latest.updatedAt, permissions: original.permissions } })).json()).toMatchObject({ code: 0 })
      expect((await group()).permissions).toEqual(original.permissions)
    } catch (error) { errors.push(error) }
    await attachJSON(info, 'permission-restoration', { errors: errors.map(String) })
  }
  if (errors.length) throw new AggregateError(errors, 'Permission scenario or version-aware restoration failed')
})
