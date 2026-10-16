import { randomBytes, randomUUID } from 'node:crypto'
import { expect, test as base } from '@playwright/test'
import type { APIResponse, BrowserContext, Locator, Page, Response, TestInfo } from '@playwright/test'
import type { AdminShortLink, ShortLink } from '../src/entities/short-link/model'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

type Scope = 'own' | 'admin'
type Action = 'enable' | 'disable' | 'delete'
interface Scenario { owner: Page; admin: Page; owned: ShortLink[]; foreign: ShortLink; tag: string }
const fixturePassword = 'bulk-links-fixture-password'

const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, page: admin }, use, testInfo) => {
    const baseURL = testInfo.project.use.baseURL
    if (typeof baseURL !== 'string') throw new Error('Bulk-link E2E requires a baseURL')
    const contexts: BrowserContext[] = []
    const accountIDs: string[] = []
    const links: ShortLink[] = []
    const tag = `batch-${randomBytes(8).toString('hex')}`
    const cleanupErrors: unknown[] = []
    let failed = false
    let failure: unknown
    try {
      expect(await (await admin.request.post('/api/v1/auth/login', {
        data: { username: e2eAdminUsername, password: e2eAdminPassword },
      })).json()).toMatchObject({ code: 0 })
      const owners: Page[] = []
      for (const suffix of ['owner', 'other']) {
        const username = `${tag}-${suffix}`
        const created = await admin.request.post('/api/v1/admin/user/create', {
          data: { username, password: fixturePassword, nickname: 'Bulk fixture owner', groupKey: 'user', status: 'active' },
        })
        const account = await created.json() as { code: number; data: { user: { id: string } } }
        if (account.code === 0) accountIDs.push(account.data.user.id)
        expect(account).toMatchObject({ code: 0, data: { user: { id: expect.any(String) } } })
        const context = await browser.newContext({ baseURL, locale: 'zh-CN', serviceWorkers: 'block', colorScheme: 'light', reducedMotion: 'reduce' })
        contexts.push(context)
        const owner = await context.newPage()
        expect(await (await owner.request.post('/api/v1/auth/login', {
          data: { username, password: fixturePassword },
        })).json()).toMatchObject({ code: 0 })
        expect(await (await owner.request.get('/api/v1/auth/me')).json()).toMatchObject({
          code: 0, data: { user: { id: account.data.user.id, permissions: expect.arrayContaining([
            'short_link:create', 'short_link:read_own', 'short_link:update_own', 'short_link:delete_own', 'short_link:set_metadata',
          ]) } },
        })
        owners.push(owner)
      }
      for (let index = 0; index < 3; index++) {
        const creator = owners[index === 2 ? 1 : 0]!
        const created = await creator.request.post('/api/v1/short-link/create', {
          data: {
            targetUrl: `https://example.com/${tag}/${index}?preserve=target`,
            metadata: { title: `Bulk fixture ${index}`, tags: [tag] },
          },
        })
        const payload = await created.json() as { code: number; data: { shortLink: ShortLink } }
        if (payload.code === 0) links.push(payload.data.shortLink)
        expect(payload).toMatchObject({ code: 0, data: { shortLink: { id: expect.any(String), status: 'active' } } })
      }
      await use({ owner: owners[0]!, admin, owned: links.slice(0, 2), foreign: links[2]!, tag })
    } catch (error) {
      failed = true
      failure = error
    } finally {
      // List live fixture records first: confirmed soft deletions must not be deleted twice.
      // Each cleanup step runs independently and has the fixture's separate teardown budget.
      if (links.length) {
        try {
          const remaining = await listFixtureLinks(admin, tag)
          for (const link of remaining.filter(item => links.some(created => created.id === item.id))) {
            try {
              expect(await (await admin.request.post('/api/v1/admin/short-link/delete', {
                data: { id: link.id }, timeout: 5_000,
              })).json()).toMatchObject({ code: 0 })
            } catch (error) { cleanupErrors.push(error) }
          }
        } catch (error) { cleanupErrors.push(error) }
      }
      for (const id of accountIDs) {
        try {
          expect(await (await admin.request.post('/api/v1/admin/user/update', {
            data: { id, nickname: 'Bulk fixture owner', status: 'disabled' }, timeout: 5_000,
          })).json()).toMatchObject({ code: 0, data: { user: { id, status: 'disabled' } } })
        } catch (error) { cleanupErrors.push(error) }
      }
      for (const context of contexts) {
        try { await context.close() } catch (error) { cleanupErrors.push(error) }
      }
    }
    if (failed) {
      if (cleanupErrors.length) throw new AggregateError([failure, ...cleanupErrors], 'Bulk-link scenario and cleanup failed')
      throw failure
    }
    if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'Bulk-link cleanup failed')
  }, { timeout: 30_000 }],
})

test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

/** Reads only this scenario's unique tag through the real administrative list. */
async function listFixtureLinks(admin: Page, tag: string): Promise<AdminShortLink[]> {
  const response = await admin.request.get(`/api/v1/admin/short-link/list?tag=${encodeURIComponent(tag)}&pageSize=100`, { timeout: 5_000 })
  expect(response.status()).toBe(200)
  const payload = await response.json() as { code: number; data: { items: AdminShortLink[] } }
  expect(payload.code).toBe(0)
  return payload.data.items
}

/** Verifies the HTTP, business and private-cache contracts for an actual batch response. */
async function expectBatchResponse(response: APIResponse | Response, code: number, count?: number) {
  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toBe('no-store')
  const payload = await response.json() as { code: number; data: { affectedCount: number } | null }
  expect(payload.code).toBe(code)
  if (count !== undefined) expect(payload.data).toEqual({ affectedCount: count })
}

/** Pins response matching to the actual scope, action and submitted ID snapshot. */
function nextBatch(page: Page, scope: Scope, action: Action, ids: string[]) {
  return page.waitForResponse(response => {
    if (new URL(response.url()).pathname !== `/api/v1/${scope === 'admin' ? 'admin/' : ''}short-link/batch`) return false
    const request = response.request()
    if (request.method() !== 'POST') return false
    const body = request.postDataJSON() as { action: string; ids: string[] }
    return body.action === action && JSON.stringify([...body.ids].sort()) === JSON.stringify([...ids].sort())
  })
}

/** Confirms the real toolbar success and dismisses the toast before subsequent clicks. */
async function dismissSuccess(page: Page, english = false) {
  const message = page.getByText(english ? 'Processed 2 links.' : '已处理 2 条短链。', { exact: true })
  await expect(message).toBeVisible()
  await page.getByRole('button', { name: english ? 'Dismiss notification' : '关闭提示', exact: true }).click()
  await expect(message).not.toBeVisible()
}

/** Requires a visible vector glyph so a clickable but visually blank checkbox cannot pass. */
async function checkboxIconPath(checkbox: Locator) {
  const icon = checkbox.locator('..').locator('svg')
  await expect(icon).toBeVisible()
  const path = icon.locator('path')
  await expect(path).toHaveAttribute('d', /\S+/)
  return path.getAttribute('d')
}

/** Exercises visible unchecked, partial and checked glyphs before selecting exactly two targets. */
async function selectTargets(page: Page, targets: ShortLink[], untouched: ShortLink | undefined, english = false) {
  const all = page.getByRole('checkbox', { name: english ? 'Select current list' : '选择当前列表', exact: true })
  const uncheckedPath = await checkboxIconPath(all)
  await page.getByRole('checkbox', { name: `${english ? 'Select short link' : '选择短链'} ${targets[0]!.slug}`, exact: true }).check()
  const partialPath = await checkboxIconPath(all)
  await all.check()
  const checkedPath = await checkboxIconPath(all)
  expect(new Set([uncheckedPath, partialPath, checkedPath]).size).toBe(3)
  if (untouched) await page.getByRole('checkbox', { name: `${english ? 'Select short link' : '选择短链'} ${untouched.slug}`, exact: true }).uncheck()
  for (const link of targets) {
    const checkbox = page.getByRole('checkbox', { name: `${english ? 'Select short link' : '选择短链'} ${link.slug}`, exact: true })
    await expect(checkbox).toBeChecked()
    expect(await checkboxIconPath(checkbox)).toBe(checkedPath)
  }
  await expect(page.getByTestId('batch-toolbar')).toContainText(english ? '2 selected' : '已选择 2 条')
}

/** Compares persisted configuration and metadata, allowing only the requested status change. */
async function expectPersisted(scenario: Scenario, targets: ShortLink[], status: ShortLink['status']) {
  const persisted = await listFixtureLinks(scenario.admin, scenario.tag)
  expect(persisted).toHaveLength(3)
  for (const original of [...scenario.owned, scenario.foreign]) {
    expect(persisted.find(link => link.id === original.id)).toMatchObject({
      ...original, status: targets.some(link => link.id === original.id) ? status : original.status,
    })
  }
}

/** Checks the real public entry without following its target or internal status redirect. */
async function expectPublicState(page: Page, targets: ShortLink[], state: 'active' | 'disabled' | 'deleted') {
  for (const link of targets) {
    const response = await page.request.get(link.url, { maxRedirects: 0 })
    if (state === 'deleted') {
      expect(response.status()).toBe(404)
      expect(response.headers().location).toBeUndefined()
    } else {
      expect(response.status()).toBe(302)
      expect(response.headers().location).toBe(state === 'active' ? link.targetUrl : `/go/${link.slug}?reason=disabled`)
    }
  }
}

/** Saves a full-page screenshot only after the actual document fits its viewport. */
async function captureLayout(page: Page, testInfo: TestInfo, name: string) {
  await expectNoHorizontalOverflow(page)
  await expect(page.getByTestId('batch-toolbar')).toBeVisible()
  const path = testInfo.outputPath(`${name}.png`)
  await page.screenshot({ path, fullPage: true, animations: 'disabled' })
  await testInfo.attach(name, { path, contentType: 'image/png' })
}

/** Changes language through the desktop or mobile console's real language controls. */
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
    test(`${scope} atomically manages real selected links at ${width}px`, async ({ scenario }, testInfo) => {
      const { owner, admin, owned, foreign, tag } = scenario
      const page = scope === 'own' ? owner : admin
      const targets = scope === 'own' ? owned : [owned[0]!, foreign]
      const untouched = scope === 'own' ? undefined : owned[1]!
      const ids = targets.map(link => link.id)
      const endpoint = `/api/v1/${scope === 'admin' ? 'admin/' : ''}short-link`
      await page.setViewportSize({ width, height: width === 1280 ? 720 : 800 })

      // A mixed ownership delete must leave both the owned and foreign record intact.
      await expectBatchResponse(await owner.request.post('/api/v1/short-link/batch', {
        data: { ids: [owned[0]!.id, foreign.id], action: 'delete' },
      }), 200104)
      await expectPersisted(scenario, [], 'active')
      // Missing records invalidate the complete batch in both supported scopes.
      await expectBatchResponse(await page.request.post(`${endpoint}/batch`, {
        data: { ids: [targets[0]!.id, randomUUID()], action: 'disable' },
      }), 200104)
      await expectPersisted(scenario, [], 'active')
      await expectPublicState(owner, targets, 'active')

      await page.goto(scope === 'admin' ? '/admin/link' : '/link')
      const filtered = page.waitForResponse(response => {
        const url = new URL(response.url())
        return url.pathname === `${endpoint}/list` && url.searchParams.get('tag') === tag
      })
      await page.getByLabel('标签', { exact: true }).fill(tag)
      expect(await (await filtered).json()).toMatchObject({ code: 0 })
      await expect(page.getByTestId('console-link-row')).toHaveCount(scope === 'admin' ? 3 : 2)
      await expect(page.getByTestId('batch-enable')).toHaveText('批量启用')
      await expect(page.getByTestId('batch-disable')).toHaveText('批量停用')
      await expect(page.getByTestId('batch-delete')).toHaveText('批量删除')
      await expect(page.getByTestId('batch-disable')).toBeDisabled()
      await selectTargets(page, targets, untouched)
      await captureLayout(page, testInfo, `batch-${scope}-${width}px-zh-selected`)

      const disabled = nextBatch(page, scope, 'disable', ids)
      await page.getByTestId('batch-disable').click()
      await expectBatchResponse(await disabled, 0, 2)
      await dismissSuccess(page)
      await expect(page.getByTestId('batch-toolbar')).toContainText('已选择 0 条')
      await expectPersisted(scenario, targets, 'disabled')
      await expectPublicState(owner, targets, 'disabled')

      await selectTargets(page, targets, untouched)
      const enabled = nextBatch(page, scope, 'enable', ids)
      await page.getByTestId('batch-enable').click()
      await expectBatchResponse(await enabled, 0, 2)
      await dismissSuccess(page)
      await expectPersisted(scenario, targets, 'active')
      await expectPublicState(owner, targets, 'active')

      await selectTargets(page, targets, untouched)
      await page.getByTestId('batch-delete').click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toContainText('即将删除 2 条短链')
      await expect(dialog).toContainText('此操作无法撤销。')
      await expect(page.getByTestId('batch-confirm-delete')).toHaveText('确认删除')
      await captureLayout(page, testInfo, `batch-${scope}-${width}px-zh-confirm`)
      const cancelledRequests: string[] = []
      const recordBatch = (request: import('@playwright/test').Request) => {
        if (new URL(request.url()).pathname === `${endpoint}/batch` && request.method() === 'POST') cancelledRequests.push(request.postData() ?? '')
      }
      page.on('request', recordBatch)
      await page.getByTestId('batch-cancel-delete').click()
      await expect(dialog).not.toBeVisible()
      await expectPersisted(scenario, targets, 'active')
      page.off('request', recordBatch)
      expect(cancelledRequests).toEqual([])
      await expect(page.getByTestId('batch-toolbar')).toContainText('已选择 2 条')

      await switchToEnglish(page, width)
      await expect(page.getByTestId('batch-toolbar')).toContainText('2 selected')
      await expect(page.getByTestId('batch-toolbar')).toContainText('Current list only, up to 100 links')
      await expect(page.getByTestId('batch-enable')).toHaveText('Enable selected')
      await expect(page.getByTestId('batch-disable')).toHaveText('Disable selected')
      await expect(page.getByTestId('batch-delete')).toHaveText('Delete selected')
      for (const link of targets) await expect(page.getByRole('checkbox', { name: `Select short link ${link.slug}`, exact: true })).toBeChecked()
      await captureLayout(page, testInfo, `batch-${scope}-${width}px-en-selected`)
      if (width === 390) {
        await page.setViewportSize({ width: 320, height: 800 })
        await captureLayout(page, testInfo, `batch-${scope}-320px-en-selected`)
        await page.setViewportSize({ width, height: 800 })
      }
      await page.getByTestId('batch-delete').click()
      await expect(dialog).toContainText('Delete 2 links?')
      await expect(dialog).toContainText('This action cannot be undone.')
      await expect(page.getByTestId('batch-confirm-delete')).toHaveText('Confirm delete')
      await captureLayout(page, testInfo, `batch-${scope}-${width}px-en-confirm`)
      const deleted = nextBatch(page, scope, 'delete', ids)
      await page.getByTestId('batch-confirm-delete').click()
      await expectBatchResponse(await deleted, 0, 2)
      await dismissSuccess(page, true)
      await expect(dialog).not.toBeVisible()
      await expect(page.getByTestId('batch-toolbar')).toContainText('0 selected')
      for (const link of targets) await expect(page.getByRole('checkbox', { name: `Select short link ${link.slug}`, exact: true })).toHaveCount(0)
      const remaining = await listFixtureLinks(admin, tag)
      expect(remaining.map(link => link.id)).toEqual([scope === 'own' ? foreign.id : owned[1]!.id])
      expect(remaining[0]).toMatchObject({ ...(scope === 'own' ? foreign : owned[1]!) })
      await expectPublicState(owner, targets, 'deleted')
      await captureLayout(page, testInfo, `batch-${scope}-${width}px-en-deleted`)
    })
  }
}
