import { randomBytes, randomUUID } from 'node:crypto'
import { expect, test as base } from '@playwright/test'
import type { BrowserContext, Page, TestInfo } from '@playwright/test'
import type { ShortLink } from '../src/entities/short-link/model'
import type { AuditResult, DashboardResult, VisitResult } from '../src/entities/insights/model'
import type { UserGroup } from '../src/entities/user-group/api'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

interface Scenario { owner: Page; admin: Page; ownerId: string; link: ShortLink; foreign: ShortLink; deleted: Set<string> }
const password = 'insights-scenario-password'
const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, page: admin }, use, testInfo) => {
    const baseURL = testInfo.project.use.baseURL
    if (typeof baseURL !== 'string') throw new Error('Insight scenarios require the isolated Compose baseURL')
    const links: ShortLink[] = []
    const deleted = new Set<string>()
    let ownerId: string | undefined
    let context: BrowserContext | undefined
    const errors: unknown[] = []
    try {
      expect(await (await admin.request.post('/api/v1/auth/login', { data: { username: e2eAdminUsername, password: e2eAdminPassword } })).json()).toMatchObject({ code: 0 })
      const username = `insight-${randomBytes(8).toString('hex')}`
      const account = await (await admin.request.post('/api/v1/admin/user/create', { data: { username, password, nickname: 'Insight fixture', groupKey: 'user', status: 'active' } })).json() as { code: number; data: { user: { id: string } } }
      if (account.code === 0) ownerId = account.data.user.id
      expect(account.code).toBe(0)
      context = await browser.newContext({ baseURL, locale: 'zh-CN', serviceWorkers: 'block', reducedMotion: 'reduce', colorScheme: 'light' })
      const owner = await context.newPage()
      expect(await (await owner.request.post('/api/v1/auth/login', { data: { username, password } })).json()).toMatchObject({ code: 0 })
      for (const creator of [owner, admin]) {
        const created = await (await creator.request.post('/api/v1/short-link/create', { data: { targetUrl: `https://example.com/${username}/${randomBytes(4).toString('hex')}`, metadata: { title: 'Insight fixture', tags: [username] } } })).json() as { code: number; data: { shortLink: ShortLink } }
        if (created.code === 0) links.push(created.data.shortLink)
        expect(created.code).toBe(0)
      }
      await use({ owner, admin, ownerId: ownerId!, link: links[0]!, foreign: links[1]!, deleted })
    } catch (error) { errors.push(error) }
    finally {
      for (const link of links.filter((item) => !deleted.has(item.id))) {
        try { expect(await (await admin.request.post('/api/v1/admin/short-link/delete', { data: { id: link.id }, timeout: 5_000 })).json()).toMatchObject({ code: 0 }) } catch (error) { errors.push(error) }
      }
      if (ownerId) {
        try { expect(await (await admin.request.post('/api/v1/admin/user/update', { data: { id: ownerId, nickname: 'Insight fixture', status: 'disabled' }, timeout: 5_000 })).json()).toMatchObject({ code: 0 }) } catch (error) { errors.push(error) }
      }
      if (context) { try { await context.close() } catch (error) { errors.push(error) } }
    }
    if (errors.length) throw new AggregateError(errors, 'Insight scenario or independent fixture cleanup failed')
  }, { timeout: 30_000 }],
})
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

/** Checks real private reads without accepting HTTP or business errors as empty data. */
async function read<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(path)
  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toBe('no-store')
  const payload = await response.json() as { code: number; data: T }
  expect(payload.code).toBe(0)
  return payload.data
}

/** Proves a successful local public redirect while refusing to load the external destination. */
async function visit(page: Page, link: ShortLink) {
  const response = await page.request.get(link.url, { maxRedirects: 0, headers: { Referer: `https://${'long-'.repeat(8)}referrer.example.test/private?not-stored=yes`, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/144.0.0.0 Safari/537.36' } })
  expect(response.status()).toBe(302)
  expect(response.headers().location).toBe(link.targetUrl)
}

/** Saves the actual bilingual layout only after the document fits the viewport. */
async function capture(page: Page, info: TestInfo, name: string) {
  await expectNoHorizontalOverflow(page)
  if (page.viewportSize()!.width === 1280) {
    await expect.poll(() => page.locator('.console-sidebar').evaluate((element) => {
      const nav = element.querySelector('.console-sidebar__nav')!
      const utilities = element.querySelector('.console-sidebar__utilities')!
      const account = element.querySelector('.console-sidebar__account')!
      const last = nav.querySelector('section:last-child a:last-child')!
      const paintedBottom = getComputedStyle(nav).overflowY === 'visible' ? Math.max(nav.getBoundingClientRect().bottom, last.getBoundingClientRect().bottom) : nav.getBoundingClientRect().bottom
      return paintedBottom <= utilities.getBoundingClientRect().top && utilities.getBoundingClientRect().bottom <= account.getBoundingClientRect().top && account.getBoundingClientRect().bottom <= innerHeight
    })).toBe(true)
  }
  const path = info.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true, animations: 'disabled' })
  await info.attach(name, { path, contentType: 'image/png' })
}

/** Switches the real console language controls on desktop and mobile. */
async function english(page: Page, width: number) {
  if (width === 390) await page.getByRole('button', { name: '打开控制台菜单', exact: true }).click()
  await page.getByRole('button', { name: '选择语言', exact: true }).filter({ visible: true }).first().click()
  await page.getByRole('menuitemradio', { name: 'English', exact: true }).click()
  if (width === 390) await page.getByRole('button', { name: 'Close menu', exact: true }).click()
}

/** Reads the current permission version for a conflict-safe update and restoration. */
async function userGroup(admin: Page) {
  const catalog = await read<{ groups: UserGroup[] }>(admin, '/api/v1/admin/user-group/list')
  const group = catalog.groups.find((item) => item.key === 'user')
  expect(group).toBeDefined()
  return group!
}

/** Writes only the intended group capabilities with the server's current optimistic version. */
async function setPermissions(admin: Page, permissions: string[]) {
  const group = await userGroup(admin)
  expect(await (await admin.request.post('/api/v1/admin/user-group/update-permissions', { data: { groupKey: 'user', expectedUpdatedAt: group.updatedAt, permissions } })).json()).toMatchObject({ code: 0 })
}

for (const width of [1280, 390]) {
  test(`real global snapshot and immutable audit at ${width}px`, async ({ scenario }, info) => {
    const { admin, owner, ownerId, link, foreign, deleted } = scenario
    await admin.setViewportSize({ width, height: width === 1280 ? 720 : 800 })
    await visit(owner, link)
    const existing = await read<DashboardResult>(admin, '/api/v1/admin/dashboard')
    const popularVisits = Math.max(0, ...existing.topLinks.map((item) => item.visitCount)) + 1
    expect(popularVisits).toBeLessThan(1_000)
    for (let index = 0; index < popularVisits; index++) await visit(admin, foreign)
    await expect.poll(async () => (await read<VisitResult>(admin, `/api/v1/admin/short-link/visits?id=${foreign.id}`)).items.length).toBe(Math.min(popularVisits, 25))
    await expect.poll(async () => (await read<VisitResult>(owner, `/api/v1/short-link/visits?id=${link.id}`)).items.length).toBe(1)
    // Soft-deleted popular links retain historical visits but have no broken detail action.
    expect(await (await admin.request.post('/api/v1/admin/short-link/delete', { data: { id: foreign.id } })).json()).toMatchObject({ code: 0 })
    deleted.add(foreign.id)
    const snapshotResponse = admin.waitForResponse('**/api/v1/admin/dashboard?days=7')
    await admin.goto('/admin/dashboard')
    const snapshot = (await (await snapshotResponse).json() as { code: number; data: DashboardResult }).data
    await expect(admin.getByRole('heading', { name: '全站仪表盘', exact: true })).toBeVisible()
    for (const [label, value] of [['用户数', snapshot.summary.userCount], ['区间访问量', snapshot.summary.rangeVisitCount]] as const) {
      await expect(admin.getByTestId('dashboard-summary').getByText(label, { exact: true }).locator('..')).toContainText(String(value))
    }
    const deletedRow = admin.getByRole('row').filter({ hasText: foreign.url })
    await expect(deletedRow).toContainText('已删除')
    await expect(deletedRow.getByRole('link')).toHaveCount(0)
    await capture(admin, info, `dashboard-${width}-zh`)
    await english(admin, width)
    await expect(admin.getByRole('heading', { name: 'Global dashboard', exact: true })).toBeVisible()
    await capture(admin, info, `dashboard-${width}-en`)

    // A real owner page edit must commit its metadata and audit record together.
    await owner.goto('/link')
    const row = owner.getByTestId('console-link-row').filter({ hasText: link.url })
    await row.getByRole('button', { name: '更多操作', exact: true }).click()
    await owner.getByRole('menuitem', { name: '访问配置', exact: true }).click()
    const dialog = owner.getByRole('dialog')
    await dialog.getByLabel('短链标题', { exact: true }).fill('Audited owner change')
    const mutation = owner.waitForResponse('**/api/v1/short-link/update')
    await dialog.getByRole('button', { name: '保存', exact: true }).click()
    expect(await (await mutation).json()).toMatchObject({ code: 0 })
    const query = `/api/v1/admin/audit/list?actorId=${ownerId}&resourceType=short_link&action=update`
    const before = await read<AuditResult>(admin, query)
    expect(before.items).toEqual(expect.arrayContaining([expect.objectContaining({ actorId: ownerId, resourceId: link.id, action: 'update', changedFields: ['title'] })]))
    const failed = await owner.request.post('/api/v1/short-link/update', { data: { id: randomUUID(), targetUrl: 'https://example.com/failed', status: 'active' } })
    expect(await failed.json()).toMatchObject({ code: 200104 })
    expect((await read<AuditResult>(admin, query)).items).toEqual(before.items)
    await admin.goto('/admin/audit')
    await expect(admin.getByRole('heading', { name: 'Operation audit', exact: true })).toBeVisible()
    await admin.getByLabel('Actor UUID', { exact: true }).fill(ownerId)
    await admin.getByRole('combobox', { name: 'Resource type', exact: true }).press('Enter')
    await admin.getByRole('option', { name: 'Short link', exact: true }).click()
    await admin.getByRole('combobox', { name: 'Action', exact: true }).press('Enter')
    await admin.getByRole('option', { name: 'Update', exact: true }).click()
    const filtered = admin.waitForResponse((response) => { const url = new URL(response.url()); return url.pathname === '/api/v1/admin/audit/list' && url.searchParams.get('actorId') === ownerId })
    await admin.getByRole('button', { name: 'Apply filters', exact: true }).click()
    expect(await (await filtered).json()).toMatchObject({ code: 0 })
    await expect(admin.getByRole('cell', { name: link.id, exact: true })).toBeVisible()
    await expect(admin.getByRole('cell', { name: 'title', exact: true })).toBeVisible()
    await capture(admin, info, `audit-${width}-en`)
    if (width === 390) await admin.getByRole('button', { name: 'Open console menu', exact: true }).click()
    await admin.getByRole('button', { name: 'Select language', exact: true }).filter({ visible: true }).first().click()
    await admin.getByRole('menuitemradio', { name: '中文', exact: true }).click()
    if (width === 390) await admin.getByRole('button', { name: '关闭菜单', exact: true }).click()
    await expect(admin.getByRole('heading', { name: '操作审计', exact: true })).toBeVisible()
    await capture(admin, info, `audit-${width}-zh`)
    await admin.reload()
    await expect(admin.getByRole('heading', { name: '操作审计', exact: true })).toBeVisible()
  })

  test(`owner visit records, foreign denial and live revocation at ${width}px`, async ({ scenario }, info) => {
    const { admin, owner, link, foreign } = scenario
    await owner.setViewportSize({ width, height: width === 1280 ? 720 : 800 })
    await visit(owner, link)
    await expect.poll(async () => (await read<VisitResult>(owner, `/api/v1/short-link/visits?id=${link.id}`)).items.length).toBe(1)
    expect(await (await owner.request.get(`/api/v1/short-link/visits?id=${foreign.id}`)).json()).toMatchObject({ code: 200104, data: null })
    expect(await (await owner.request.get('/api/v1/admin/dashboard')).json()).toMatchObject({ code: 120001 })
    await owner.goto(`/link/${link.id}/analytics`)
    const records = owner.getByTestId('visit-records')
    await expect(records.getByRole('cell', { name: 'Chrome', exact: true })).toBeVisible()
    await expect(records.getByRole('cell', { name: 'Windows', exact: true })).toBeVisible()
    await capture(owner, info, `visits-${width}-zh`)
    await english(owner, width)
    await expect(records.getByRole('heading', { name: 'Visit records', exact: true })).toBeVisible()
    await capture(owner, info, `visits-${width}-en`)
    // Re-enter through real SPA links while holding only the new API response; the QueryClient survives.
    await owner.getByRole('link', { name: 'Back to links', exact: true }).click()
    const visitsPath = /\/api\/v1\/short-link\/visits\?/
    let releaseRead!: () => void
    const gate = new Promise<void>((resolve) => { releaseRead = resolve })
    await owner.route(visitsPath, async (route) => {
      const response = await route.fetch()
      await gate
      await route.fulfill({ response })
    })
    try {
      const started = owner.waitForRequest((request) => { const url = new URL(request.url()); return url.pathname === '/api/v1/short-link/visits' && url.searchParams.get('id') === link.id })
      await owner.getByTestId('console-link-row').filter({ hasText: link.url }).getByRole('link', { name: 'Analytics', exact: true }).click()
      await started
      await expect(records.getByRole('progressbar')).toBeVisible()
      await expect(records.getByRole('table')).toHaveCount(0)
      releaseRead()
      await expect(records.getByRole('cell', { name: 'Chrome', exact: true })).toBeVisible()
    } finally {
      releaseRead()
      await owner.unroute(visitsPath)
    }
    const group = await userGroup(admin)
    // Register the restoration path before modifying shared permissions.
    try {
      await setPermissions(admin, group.permissions.filter((permission) => permission !== 'short_link:read_visits'))
      expect(await (await owner.request.get(`/api/v1/short-link/visits?id=${link.id}`)).json()).toMatchObject({ code: 120001, data: null })
      await owner.reload()
      await expect(records.getByText('This account cannot view these records, or the resource is unavailable.', { exact: true })).toBeVisible()
      await expect(records.getByRole('table')).toHaveCount(0)
      await expect(owner.locator('a[href="/admin/dashboard"]')).toHaveCount(0)
      await expect(owner.locator('a[href="/admin/audit"]')).toHaveCount(0)
    } finally { await setPermissions(admin, group.permissions) }
    await owner.reload()
    await expect(records.getByRole('cell', { name: 'Chrome', exact: true })).toBeVisible()
  })
}
