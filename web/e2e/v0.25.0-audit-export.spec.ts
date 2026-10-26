import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { expect, test as base } from '@playwright/test'
import type { BrowserContext, Page, TestInfo } from '@playwright/test'
import type { AuditFilters, AuditResult } from '../src/entities/insights/model'
import type { ShortLink } from '../src/entities/short-link/model'
import type { UserSummary } from '../src/entities/user/api'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

interface Observation { created: { url: string; type: string; size: number }[]; revoked: string[] }
interface Scenario { manager: Page; admin: Page; owner: Page; ownerId: string; adminId: string; username: string; password: string; link: ShortLink; logs: AuditResult }
const header = 'start_date,end_date,time_zone,audit_id,occurred_at,actor_id,actor_username,resource_type,resource_id,action,changed_fields'
const createFields = ['slug', 'owner_id', 'domain_id', 'target_url', 'status', 'redirect_mode', 'intermediate_delay_seconds', 'expires_at', 'password_hash', 'max_visits', 'title', 'tags', 'deleted_at']
const expectedChanges = [
  { action: 'enable', fields: ['status'] }, { action: 'disable', fields: ['status'] },
  ...Array.from({ length: 25 }, () => ({ action: 'update', fields: ['title'] })),
  { action: 'create', fields: createFields },
]

/** Saves raw observations alongside screenshots and real browser downloads. */
async function attachJSON(info: TestInfo, name: string, value: unknown) {
  const path = info.outputPath(`${name}.json`)
  await writeFile(path, JSON.stringify(value, null, 2))
  await info.attach(name, { path, contentType: 'application/json' })
}

/** Advances only the owned disposable database sequence; every audit row still comes from business APIs. */
async function prepareBigintSequence(info: TestInfo) {
  const project: unknown = info.config.metadata.e2eComposeProjectName
  expect(info.config.metadata.e2eSkipDockerCompose).toBe(false)
  if (typeof project !== 'string' || !/^moeurl-e2e-[a-z0-9][a-z0-9_-]*$/.test(project)) throw new Error('Audit fixture requires an owned E2E Compose project')
  const run = (args: string[]) => execFileSync('docker', args, { encoding: 'utf8' }).trim()
  const containers = run(['ps', '-q', '--filter', `label=com.docker.compose.project=${project}`, '--filter', 'label=com.docker.compose.service=postgres']).split(/\s+/)
  expect(containers).toHaveLength(1)
  const container = containers[0]!
  const [owned] = JSON.parse(run(['inspect', container])) as { Config: { Labels: Record<string, string> }; State: { Running: boolean }; Mounts: { Name?: string }[] }[]
  expect(owned!.Config.Labels['com.docker.compose.project']).toBe(project)
  expect(owned!.Config.Labels['com.docker.compose.service']).toBe('postgres')
  expect(owned!.State.Running).toBe(true)
  expect(owned!.Mounts.some(mount => mount.Name === `${project}_postgres-data`)).toBe(true)
  const prefix = ['exec', container, 'psql', '-U', 'moeurl', '-d', 'moeurl', '-v', 'ON_ERROR_STOP=1', '-Atc']
  expect(run([...prefix, 'select current_database(),current_user'])).toBe('moeurl|moeurl')
  const before = run([...prefix, 'select last_value::text from audit_log_id_seq'])
  const sql = "select setval(pg_get_serial_sequence('audit_log','id'),greatest((select last_value from audit_log_id_seq),9007199254740992::bigint),true)::text"
  const after = run([...prefix, sql])
  expect(BigInt(after)).toBeGreaterThanOrEqual(9007199254740992n)
  await attachJSON(info, 'owned-bigint-sequence', { project, container, database: 'moeurl', user: 'moeurl', before, after, argv: [...prefix, sql] })
}

/** Reads persisted identifiers and microsecond timestamps independently of CSV generation. */
async function audit(page: Page, filters: AuditFilters): Promise<AuditResult> {
  const response = await page.request.get(`/api/v1/admin/audit/list?${new URLSearchParams({ days: '7', pageSize: '100', ...filters })}`)
  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toBe('no-store')
  const payload = await response.json() as { code: number; data: AuditResult }
  expect(payload.code).toBe(0)
  return payload.data
}

const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, page: manager }, use, info) => {
    const baseURL = info.project.use.baseURL
    if (typeof baseURL !== 'string') throw new Error('Audit export requires an isolated Compose baseURL')
    const contexts: BrowserContext[] = []
    const accounts: string[] = []
    const disabledAccounts: string[] = []
    let deletedLink: string | undefined
    let closedContexts = 0
    let link: ShortLink | undefined
    const errors: unknown[] = []
    try {
      expect(await (await manager.request.post('/api/v1/auth/login', { data: { username: e2eAdminUsername, password: e2eAdminPassword } })).json()).toMatchObject({ code: 0 })
      await prepareBigintSequence(info)
      const password = randomBytes(24).toString('hex')
      const username = `audit-csv-${randomBytes(8).toString('hex')}`
      const pages: Page[] = []
      for (const groupKey of ['user', 'admin']) {
        const login = `${username}-${groupKey}`
        const created = await (await manager.request.post('/api/v1/admin/user/create', { data: { username: login, password, nickname: 'Private audit fixture', groupKey, status: 'active' } })).json() as { code: number; data: { user: { id: string } } }
        if (created.code === 0) accounts.push(created.data.user.id)
        expect(created.code).toBe(0)
        const context = await browser.newContext({ baseURL, locale: 'zh-CN', serviceWorkers: 'block', colorScheme: 'light', reducedMotion: 'reduce' })
        contexts.push(context)
        const page = await context.newPage()
        expect(await (await page.request.post('/api/v1/auth/login', { data: { username: login, password } })).json()).toMatchObject({ code: 0 })
        pages.push(page)
      }
      const [owner, admin] = pages as [Page, Page]
      const created = await (await owner.request.post('/api/v1/short-link/create', { data: { targetUrl: `https://example.com/private-audit/${username}?secret=destination`, metadata: { title: 'Private audit title', tags: [username] }, password: { mode: 'set', value: password } } })).json() as { code: number; data: { shortLink: ShortLink } }
      if (created.code === 0) link = created.data.shortLink
      expect(created.code).toBe(0)
      for (let index = 0; index < 25; index++) expect(await (await owner.request.post('/api/v1/short-link/update', { data: { id: link!.id, metadata: { title: `Private revision ${index}`, tags: [username] } } })).json()).toMatchObject({ code: 0 })
      for (const status of ['disabled', 'active']) expect(await (await owner.request.post('/api/v1/short-link/update', { data: { id: link!.id, status } })).json()).toMatchObject({ code: 0 })
      const logs = await audit(admin, { actorId: accounts[0]! })
      expect(logs.items).toHaveLength(28)
      expect(logs.hasMore).toBe(false)
      expect(logs.items.map(item => ({ action: item.action, fields: item.changedFields }))).toEqual(expectedChanges)
      for (const item of logs.items) {
        expect(item).toMatchObject({ actorId: accounts[0], actorUsername: `${username}-user`, resourceType: 'short_link', resourceId: link!.id })
        expect(typeof item.id).toBe('string')
        expect(BigInt(item.id)).toBeGreaterThan(9007199254740992n)
        expect(item.occurredAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?Z$/)
      }
      expect(logs.items.some(item => /\.\d*[1-9]\d*Z$/.test(item.occurredAt))).toBe(true)
      for (let index = 1; index < logs.items.length; index++) expect(BigInt(logs.items[index - 1]!.id)).toBeGreaterThan(BigInt(logs.items[index]!.id))
      await use({ manager, admin, owner, ownerId: accounts[0]!, adminId: accounts[1]!, username, password, link: link!, logs })
    } catch (error) { errors.push(error) }
    finally {
      if (link) {
        try { expect(await (await manager.request.post('/api/v1/admin/short-link/delete', { data: { id: link.id }, timeout: 5_000 })).json()).toMatchObject({ code: 0 }); deletedLink = link.id } catch (error) { errors.push(error) }
      }
      for (const id of accounts) {
        try { expect(await (await manager.request.post('/api/v1/admin/user/update', { data: { id, nickname: 'Retired audit fixture', status: 'disabled' }, timeout: 5_000 })).json()).toMatchObject({ code: 0 }); disabledAccounts.push(id) } catch (error) { errors.push(error) }
      }
      for (const context of contexts) { try { await context.close(); closedContexts++ } catch (error) { errors.push(error) } }
      await attachJSON(info, 'fixture-cleanup', { accounts, disabledAccounts, link: link?.id, deletedLink, contexts: contexts.length, closedContexts, errors: errors.map(String) })
    }
    if (errors.length) throw new AggregateError(errors, 'Audit-export scenario or independent cleanup failed')
  }, { timeout: 45_000 }],
})
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

/** Observes, but does not replace, native Blob creation, URL revocation or file saving. */
async function observeDownloads(page: Page) {
  await page.addInitScript(() => {
    const observation: Observation = { created: [], revoked: [] }
    Object.assign(window, { auditDownloadObservation: observation })
    const create = URL.createObjectURL.bind(URL)
    const revoke = URL.revokeObjectURL.bind(URL)
    URL.createObjectURL = object => { const url = create(object); if (object instanceof Blob) observation.created.push({ url, type: object.type, size: object.size }); return url }
    URL.revokeObjectURL = url => { observation.revoked.push(url); revoke(url) }
  })
}

/** Parses escaped quotes and commas so changed_fields stays one structured CSV cell. */
function parseCSV(content: string) {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  for (let index = 0; index < content.length; index++) {
    const character = content[index]!
    if (character === '"') {
      if (quoted && content[index + 1] === '"') { cell += '"'; index++ } else quoted = !quoted
    } else if (!quoted && character === ',') { row.push(cell); cell = '' }
    else if (!quoted && character === '\r' && content[index + 1] === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; index++ }
    else cell += character
  }
  expect(quoted).toBe(false)
  expect(row).toEqual([])
  expect(cell).toBe('')
  return rows
}

/** Downloads a real CSV, checking literal categories/counts and independently persisted ID/time cells. */
async function download(scenario: Scenario, filters: AuditFilters, indices: number[], expectedCount: number, info: TestInfo, name: string) {
  const { admin, logs, ownerId, username, link, password } = scenario
  const responsePromise = admin.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/admin/audit/export')
  const downloadPromise = admin.waitForEvent('download')
  await expect(admin.getByTestId('audit-export')).toBeEnabled()
  await admin.getByTestId('audit-export').click()
  const response = await responsePromise
  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toBe('no-store')
  expect(Object.fromEntries(new URL(response.url()).searchParams)).toEqual({ startDate: logs.range.startDate, endDate: logs.range.endDate, ...filters })
  const descriptor = await response.json() as { code: number; data: { fileName: string; contentType: string; content: string } }
  expect(descriptor.code).toBe(0)
  expect(descriptor.data.contentType).toBe('text/csv;charset=utf-8')
  const saved = await downloadPromise
  const fileName = `moeurl-audit-${logs.range.startDate}-${logs.range.endDate}.csv`
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
  const rows = parseCSV(content)
  expect(indices).toHaveLength(expectedCount)
  expect(rows).toHaveLength(expectedCount + 1)
  expect(rows).toEqual([header.split(','), ...indices.map(index => [logs.range.startDate, logs.range.endDate, 'UTC', logs.items[index]!.id, logs.items[index]!.occurredAt, ownerId, `${username}-user`, 'short_link', link.id, expectedChanges[index]!.action, JSON.stringify(expectedChanges[index]!.fields)])])
  for (const secret of [link.targetUrl, 'Private audit title', 'Private revision', 'private-audit', 'secret=destination', password, '127.0.0.1', 'access_token', 'client_secret']) expect(content).not.toContain(secret)
  const observation = await admin.evaluate(() => (window as unknown as { auditDownloadObservation: Observation }).auditDownloadObservation)
  expect(observation.created.length).toBeGreaterThan(0)
  expect(observation.revoked).toEqual(observation.created.map(item => item.url))
  expect(observation.created.at(-1)).toMatchObject({ type: 'text/csv;charset=utf-8', size: bytes.length })
  await expect(admin.locator('a[download]')).toHaveCount(0)
  await info.attach(`${name}-csv`, { path, contentType: 'text/csv' })
  await attachJSON(info, `${name}-native-cleanup`, observation)
}

/** Waits for the exact applied filter/page to avoid accepting an earlier successful list. */
function nextAudit(page: Page, filters: AuditFilters, cursor = false) {
  return page.waitForResponse(response => {
    const url = new URL(response.url())
    return url.pathname === '/api/v1/admin/audit/list' && ['actorId', 'resourceType', 'action'].every(key => url.searchParams.get(key) === (filters[key as keyof AuditFilters] || null)) && url.searchParams.has('cursor') === cursor
  })
}

/** Preserves responsive action geometry and exact footer source attribution with the screenshot. */
async function capture(page: Page, info: TestInfo, name: string) {
  await expectNoHorizontalOverflow(page)
  const geometry = await page.getByTestId('admin-audit').evaluate(element => {
    const panel = element.getBoundingClientRect(), button = element.querySelector('[data-testid="audit-export"]')!.getBoundingClientRect()
    return { browser: navigator.userAgent, viewport: innerWidth, document: document.documentElement.scrollWidth, panel: { left: panel.left, right: panel.right }, button: { left: button.left, right: button.right }, footer: [...document.querySelectorAll('a')].filter(a => a.href.includes('github.com/TomyJan/MoeURL/commit/')).map(a => ({ label: a.textContent, url: a.href })) }
  })
  expect(geometry.button.left).toBeGreaterThanOrEqual(geometry.panel.left)
  expect(geometry.button.right).toBeLessThanOrEqual(geometry.panel.right + 1)
  expect(geometry.button.right).toBeLessThanOrEqual(geometry.viewport)
  const path = info.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true, animations: 'disabled' })
  await info.attach(name, { path, contentType: 'image/png' })
  await attachJSON(info, `${name}-geometry`, geometry)
}

for (const width of [1280, 390]) {
  test(`real audit CSV preserves complete second-page results and combined filters at ${width}px`, async ({ scenario }, info) => {
    const { admin, owner, ownerId } = scenario
    const filters = { actorId: ownerId }
    await observeDownloads(admin)
    await admin.setViewportSize({ width, height: width === 390 ? 800 : 900 })
    await admin.goto('/admin/audit')
    await admin.getByLabel('操作者 UUID', { exact: true }).fill(ownerId)
    await expect(admin.getByTestId('audit-export')).toBeDisabled()
    let applied = nextAudit(admin, filters)
    await admin.getByRole('button', { name: '应用筛选', exact: true }).click()
    expect(await (await applied).json()).toMatchObject({ code: 0 })
    await expect(admin.getByRole('row')).toHaveCount(26)
    await expect(admin.getByText('导出完整筛选结果，最多 1000 条、8 MiB。', { exact: true })).toBeVisible()
    applied = nextAudit(admin, filters, true)
    await admin.getByRole('button', { name: '下一页', exact: true }).click()
    expect(await (await applied).json()).toMatchObject({ code: 0 })
    await expect(admin.getByRole('row')).toHaveCount(4)
    await download(scenario, filters, Array.from({ length: 28 }, (_, index) => index), 28, info, 'complete-from-second-page')
    await capture(admin, info, `audit-${width}-zh`)

    await admin.getByRole('combobox', { name: '资源类型', exact: true }).press('Enter')
    await admin.getByRole('option', { name: '短链', exact: true }).click()
    await expect(admin.getByTestId('audit-export')).toBeDisabled()
    applied = nextAudit(admin, { ...filters, resourceType: 'short_link' })
    await admin.getByRole('button', { name: '应用筛选', exact: true }).click()
    expect(await (await applied).json()).toMatchObject({ code: 0 })
    await expect(admin.getByTestId('audit-export')).toBeEnabled()
    await admin.getByRole('combobox', { name: '动作', exact: true }).press('Enter')
    await admin.getByRole('option', { name: '修改', exact: true }).click()
    await expect(admin.getByTestId('audit-export')).toBeDisabled()
    const combined = { ...filters, resourceType: 'short_link', action: 'update' }
    applied = nextAudit(admin, combined)
    await admin.getByRole('button', { name: '应用筛选', exact: true }).click()
    expect(await (await applied).json()).toMatchObject({ code: 0 })
    await expect(admin.getByRole('row')).toHaveCount(26)
    await download(scenario, combined, Array.from({ length: 25 }, (_, index) => index + 2), 25, info, 'combined-filter')
    if (width === 390) await admin.getByRole('button', { name: '打开控制台菜单', exact: true }).click()
    await admin.getByRole('button', { name: '选择语言', exact: true }).filter({ visible: true }).first().click()
    await admin.getByRole('menuitemradio', { name: 'English', exact: true }).click()
    if (width === 390) await admin.getByRole('button', { name: 'Close menu', exact: true }).click()
    await expect(admin.getByTestId('audit-export')).toHaveText('Export audit records CSV')
    await capture(admin, info, `audit-${width}-en`)
    expect(await (await owner.request.get('/api/v1/admin/audit/export')).json()).toMatchObject({ code: 120001, data: null })
    await owner.goto('/link')
    await expect(owner.getByRole('heading', { name: '我的短链', exact: true })).toBeVisible()
    await expect(owner.getByTestId('audit-export')).toHaveCount(0)
    await expect(owner.locator('a[href="/admin/audit"]')).toHaveCount(0)
  })
}

test('empty audit combination downloads only BOM and the legal header', async ({ scenario }, info) => {
  const { admin, ownerId } = scenario
  await observeDownloads(admin)
  await admin.goto('/admin/audit')
  await admin.getByLabel('操作者 UUID', { exact: true }).fill(ownerId)
  await admin.getByRole('combobox', { name: '资源类型', exact: true }).press('Enter')
  await admin.getByRole('option', { name: '用户', exact: true }).click()
  const filters = { actorId: ownerId, resourceType: 'user' }
  const applied = nextAudit(admin, filters)
  await admin.getByRole('button', { name: '应用筛选', exact: true }).click()
  expect(await (await applied).json()).toMatchObject({ code: 0, data: { items: [] } })
  await expect(admin.getByText('已应用范围与筛选下暂无审计记录。', { exact: true })).toBeVisible()
  await download(scenario, filters, [], 0, info, 'empty')
})

test('another administrator demotes a loaded audit account and stale export cannot download', async ({ scenario }, info) => {
  const { manager, admin, adminId } = scenario
  await observeDownloads(admin)
  const downloads: string[] = []
  admin.on('download', file => { downloads.push(file.suggestedFilename()) })
  await admin.goto('/admin/audit')
  await expect(admin.getByTestId('audit-export')).toBeEnabled()
  let account: UserSummary | undefined
  for (let page = 1; !account; page++) {
    const payload = await (await manager.request.get(`/api/v1/admin/user/list?page=${page}&pageSize=100`)).json() as { code: number; data: { items: UserSummary[] }; meta: { total: number } }
    expect(payload.code).toBe(0)
    account = payload.data.items.find(item => item.id === adminId)
    if (page * 100 >= payload.meta.total) break
  }
  expect(account).toBeDefined()
  expect(await (await manager.request.post('/api/v1/admin/user/change-group', { data: { id: adminId, groupKey: 'user', expectedUpdatedAt: account!.updatedAt } })).json()).toMatchObject({ code: 0, data: { user: { group: 'user' } } })
  const rejected = admin.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/admin/audit/export')
  const refreshed = admin.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/me')
  await admin.getByTestId('audit-export').click()
  const response = await rejected
  expect(response.status()).toBe(200)
  expect(await response.json()).toMatchObject({ code: 120001, data: null })
  expect(await (await refreshed).json()).toMatchObject({ code: 0, data: { user: { group: 'guest' } } })
  await expect(admin).toHaveURL(/\/login(?:\?|$)/)
  await expect(admin.getByTestId('audit-export')).toHaveCount(0)
  expect(downloads).toEqual([])
  const observation = await admin.evaluate(() => (window as unknown as { auditDownloadObservation: Observation }).auditDownloadObservation)
  expect(observation).toEqual({ created: [], revoked: [] })
  await attachJSON(info, 'loaded-page-revocation', { account: adminId, changedByAnotherAdmin: true, sessionsRevoked: true, code: 120001, downloads, observation, url: admin.url() })
})
