import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test as base } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Page, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

interface User { id: string; username: string }
interface Link { id: string; slug: string; targetUrl: string; redirectMode: string; url: string }
interface Scenario { page: Page; manager: APIRequestContext; account: User }
const password = 'csv-import-disposable-account'
const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, page: manager }, use, info) => {
    let account: User | undefined, context: BrowserContext | undefined, page: Page | undefined
    const failures: unknown[] = []
    try {
      const baseURL = info.project.use.baseURL
      if (typeof baseURL !== 'string') throw new Error('Requires disposable Compose baseURL')
      await post(manager.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      const username = 'csv-' + randomBytes(7).toString('hex')
      const response = await manager.request.post('/api/v1/admin/user/create', { data: { username, password, nickname: 'CSV import fixture', groupKey: 'admin', status: 'active' } })
      const payload = await response.json() as { code: number; data: { user: User } }
      if (payload.code === 0 && payload.data.user.id) account = payload.data.user
      expect(response.status()).toBe(200); expect(payload.code).toBe(0)
      if (!account) throw new Error('Disposable account not created')
      const width = info.title.includes('1280px') ? 1280 : 390
      const language = info.title.includes(' en ') ? 'en' : 'zh-CN'
      const theme = language === 'en' ? 'dark' : 'light'
      context = await browser.newContext({ baseURL, viewport: { width, height: width === 1280 ? 720 : 800 }, locale: language, hasTouch: width === 390, serviceWorkers: 'block', colorScheme: theme, reducedMotion: 'reduce' })
      await context.addInitScript(({ language, theme }) => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', theme) }, { language, theme })
      page = await context.newPage()
      await post(page.request, '/auth/login', { username, password })
      await attach(info, 'runtime', { browser: browser.version(), driverNode: process.version, width, language, theme, userId: account.id, disposableDatabase: true })
      await use({ page, manager: manager.request, account })
    } catch (error) { failures.push(error) } finally {
      // Discover this fresh account's links even if an assertion failed after the actual commit.
      if (page) {
        try { for (const link of await links(page.request)) await post(manager.request, '/admin/short-link/delete', { id: link.id }) } catch (error) { failures.push(error) }
      }
      if (account) { try { await post(manager.request, '/admin/user/update', { id: account.id, nickname: 'CSV import fixture', status: 'disabled' }) } catch (error) { failures.push(error) } }
      if (context) { try { await context.close() } catch (error) { failures.push(error) } }
    }
    if (failures.length) throw new AggregateError(failures, 'CSV import scenario or exact owned cleanup failed')
  }, { timeout: 60_000 }],
})
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const language of ['zh-CN', 'en'] as const) for (const width of [1280, 390]) {
  test('v0.40.0 ' + language + ' ' + width + 'px imports a local file only after explicit ordered preview and confirmation', async ({ scenario }, info) => {
    const { page } = scenario
    const nonce = randomBytes(7).toString('hex')
    const targets = ['https://example.com/csv/' + nonce + '?value=a,b', 'https://example.org/csv/' + nonce + '%2Fkeep']
    const writes: unknown[] = []
    page.on('request', request => { if (new URL(request.url()).pathname === '/api/v1/short-link/batch-create') writes.push(request.postDataJSON()) })
    expect(await links(page.request)).toEqual([])
    const domainResponse = await page.request.get('/api/v1/domain/available')
    const domains = await domainResponse.json() as { code: number; data: { items: { host: string; isDefault: boolean }[] } }
    expect(domains.code).toBe(0)
    const global = domains.data.items.find(domain => domain.isDefault)
    expect(global).toBeTruthy()
    await page.goto('/link')
    const open = page.getByTestId('bulk-create-open')
    await open.focus(); await open.press('Enter')
    const dialog = page.getByRole('dialog')
    const file = dialog.getByLabel(language === 'en' ? 'Read URLs from CSV' : '从 CSV 读入网址', { exact: true })
    await expect(file).toBeVisible()
    await expect(file).toHaveAttribute('accept', '.csv,text/csv')
    await expect(dialog).toContainText('target_url')
    const draft = dialog.getByRole('textbox')
    await draft.fill('https://example.net/keep-' + nonce)
    // A real browser File containing an old multi-column shape must preserve the entire prior draft.
    await file.setInputFiles({ name: 'targets.csv', mimeType: 'text/csv', buffer: Buffer.from('target_url,slug\r\n' + targets[0] + ',old\r\n') })
    await expect(page.getByTestId('bulk-create-error')).toContainText(language === 'en' ? 'single target_url column' : '单列 CSV')
    await expect(draft).toHaveValue('https://example.net/keep-' + nonce)
    expect(writes).toHaveLength(0); expect(await links(page.request)).toEqual([])
    // Selecting a corrected file with the same name must still dispatch a new read.
    const csv = '\uFEFFtarget_url\r\n"' + targets[0] + '"\r\n' + targets[1] + '\r\n'
    await file.setInputFiles({ name: 'targets.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
    await expect(draft).toHaveValue(targets.join('\n'))
    await expect(page.getByTestId('bulk-create-error')).toBeHidden()
    await expect(file).toHaveValue('')
    expect(writes).toHaveLength(0); expect(await links(page.request)).toEqual([])
    const geometry = await file.boundingBox()
    expect(geometry).not.toBeNull()
    expect(geometry!.height).toBeGreaterThanOrEqual(44)
    expect(geometry!.x).toBeGreaterThanOrEqual(0)
    expect(geometry!.x + geometry!.width).toBeLessThanOrEqual(width)
    await capture(info, 'csv-draft-' + language + '-' + width, page)
    const preview = page.getByTestId('bulk-create-preview')
    await preview.focus(); await preview.press('Enter')
    await expect(page.getByTestId('bulk-create-preview-list').locator('li')).toHaveText(targets)
    await expect(file).toBeHidden()
    expect(writes).toHaveLength(0)
    const requestId = await page.getByTestId('bulk-create-request-id').innerText()
    await capture(info, 'csv-preview-' + language + '-' + width, page)
    const waiting = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/short-link/batch-create')
    const submit = page.getByTestId('bulk-create-submit')
    await submit.focus(); await submit.press('Enter')
    expect(await (await waiting).json()).toMatchObject({ code: 0, data: { requestId, createdCount: 2 } })
    await expect(dialog).toBeHidden()
    expect(writes).toEqual([{ requestId, targetUrls: targets }])
    const created = await links(page.request)
    expect(created).toHaveLength(2)
    expect(created.map(link => link.targetUrl).sort()).toEqual([...targets].sort())
    const host = new URL(global!.host.includes('://') ? global!.host : 'https://' + global!.host).host
    for (const link of created) {
      expect(link.redirectMode).toBe('direct'); expect(new URL(link.url).host).toBe(host)
      await expect(page.getByTestId('console-link-row').filter({ hasText: link.slug })).toBeVisible()
    }
    await attach(info, 'import-proof', { requestId, targets, writes, createdIds: created.map(link => link.id), fileGeometry: geometry, rejectedMultiColumnWithoutWrite: true })
  })
}

for (const unknown of [false, true]) {
  test('v0.40.0 zh-CN 1280px rejects a stale CSV after another tab changes account: ' + (unknown ? 'unknown retry' : 'initial submit'), async ({ scenario }, info) => {
    const { page, manager, account } = scenario
    const otherPage = await page.context().newPage(), failures: unknown[] = []
    let other: User | undefined
    try {
      const username = 'csv-other-' + randomBytes(6).toString('hex')
      const created = await manager.post('/api/v1/admin/user/create', { data: { username, password, nickname: 'CSV other account', groupKey: 'admin', status: 'active' } })
      const body = await created.json() as { code: number; data: { user: User } }
      if (body.code === 0) other = body.data.user
      expect(created.status()).toBe(200); expect(body.code).toBe(0)
      if (!other) throw new Error('Second disposable account not created')
      const target = 'https://example.com/stale-csv-' + randomBytes(7).toString('hex')
      await page.goto('/link')
      await page.getByTestId('bulk-create-open').click()
      await page.getByLabel('从 CSV 读入网址', { exact: true }).setInputFiles({ name: 'targets.csv', mimeType: 'text/csv', buffer: Buffer.from('target_url\n' + target) })
      await expect(page.getByRole('dialog').getByRole('textbox')).toHaveValue(target)
      await page.getByTestId('bulk-create-preview').click()
      const requestId = await page.getByTestId('bulk-create-request-id').innerText()
      const attempts: { body: unknown; expected: string | undefined }[] = []
      page.on('request', request => {
        if (new URL(request.url()).pathname === '/api/v1/short-link/batch-create') attempts.push({ body: request.postDataJSON(), expected: request.headers()['x-moeurl-expected-user-id'] })
      })
      if (unknown) {
        // Commit under A, then lose only the acknowledgement at the browser boundary.
        await page.route('**/api/v1/short-link/batch-create', async route => {
          const result = await route.fetch()
          expect(await result.json()).toMatchObject({ code: 0, data: { requestId, createdCount: 1 } })
          await route.abort('failed')
        }, { times: 1 })
        await page.getByTestId('bulk-create-submit').click()
        await expect(page.getByTestId('bulk-create-error')).toContainText('结果未确认')
        expect(await links(page.request)).toHaveLength(1)
      }
      // Both pages share this context's Cookie. The old page never reloads its cached A identity.
      await post(otherPage.request, '/auth/login', { username, password })
      await otherPage.goto('/link')
      expect(await links(otherPage.request)).toEqual([])
      await expect(page.getByTestId('bulk-create-preview-list')).toContainText(target)
      const rejected = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/short-link/batch-create')
      await page.getByTestId('bulk-create-submit').click()
      expect(await (await rejected).json()).toMatchObject({ code: 120001 })
      await expect(page.getByRole('dialog')).toBeHidden()
      expect(await links(otherPage.request)).toEqual([])
      expect(attempts).toHaveLength(unknown ? 2 : 1)
      for (const attempt of attempts) expect(attempt).toEqual({ body: { requestId, targetUrls: [target] }, expected: account.id })
      await post(page.request, '/auth/login', { username: account.username, password })
      const original = await links(page.request)
      expect(original).toHaveLength(unknown ? 1 : 0)
      await attach(info, 'cross-tab-owner-proof', { expected: account.id, other: other.id, unknown, requestId, attempts, otherLinks: 0, originalLinks: original.length })
    } catch (error) { failures.push(error) } finally {
      if (other) {
        try {
          await post(otherPage.request, '/auth/login', { username: other.username, password })
          for (const link of await links(otherPage.request)) await post(manager, '/admin/short-link/delete', { id: link.id })
          await post(manager, '/admin/user/update', { id: other.id, nickname: 'CSV other account', status: 'disabled' })
        } catch (error) { failures.push(error) }
      }
      try { await post(page.request, '/auth/login', { username: account.username, password }) } catch (error) { failures.push(error) }
      try { await otherPage.close() } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, 'Cross-tab ownership assertion or exact fixture cleanup failed')
  })
}

/** Verifies the current fresh scenario account's persisted list. */
async function links(api: APIRequestContext): Promise<Link[]> {
  const response = await api.get('/api/v1/short-link/list?page=1&pageSize=100')
  expect(response.status()).toBe(200)
  const payload = await response.json() as { code: number; data: { items: Link[] } }
  expect(payload.code).toBe(0)
  return payload.data.items
}
/** Validates business success in the disposable database. */
async function post(api: APIRequestContext, path: string, data: unknown) {
  const response = await api.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200); expect(await response.json()).toMatchObject({ code: 0 })
}
/** Captures the actual viewport without hiding product guidance or notifications. */
async function capture(info: TestInfo, name: string, page: Page) {
  await expectNoHorizontalOverflow(page)
  const dialog = page.getByRole('dialog')
  await expect.poll(() => dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0)
  const path = info.outputPath(name + '.png')
  await page.screenshot({ path, animations: 'disabled' }); await info.attach(name, { path, contentType: 'image/png' })
}
/** Preserves actual runtime and protocol observations. */
async function attach(info: TestInfo, name: string, value: unknown) {
  const path = info.outputPath(name + '.json')
  await writeFile(path, JSON.stringify(value, null, 2)); await info.attach(name, { path, contentType: 'application/json' })
}
