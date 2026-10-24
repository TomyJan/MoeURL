import { randomBytes } from 'node:crypto'
import { expect, test as base } from '@playwright/test'
import type { BrowserContext, Locator, Page, TestInfo } from '@playwright/test'
import type { AdminShortLink, ShortLink } from '../src/entities/short-link/model'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

interface Account { id: string; username: string }
interface Scenario { admin: Page; original: Page; recipient: Page; anonymous: BrowserContext; users: Account[]; links: AdminShortLink[]; tag: string }
interface Audit { id: string; resourceId: string; changedFields: string[] }
const password = 'batch-ownership-fixture-password'
const accessPassword = 'batch-ownership-access-secret'

const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, page: admin }, use, info) => {
    const baseURL = info.project.use.baseURL
    if (typeof baseURL !== 'string') throw new Error('Batch ownership requires a baseURL')
    const tag = `transfer-${randomBytes(8).toString('hex')}`
    const users: Account[] = [], contexts: BrowserContext[] = [], created: ShortLink[] = []
    const errors: unknown[] = []
    try {
      expect(await (await admin.request.post('/api/v1/auth/login', { data: { username: e2eAdminUsername, password: e2eAdminPassword } })).json()).toMatchObject({ code: 0 })
      const owners: Page[] = []
      for (const [index, username] of [`${'x'.repeat(54)}-${tag}`, `${'中'.repeat(22)}-${tag}`].entries()) {
        const account = await (await admin.request.post('/api/v1/admin/user/create', { data: { username, password, nickname: `Batch owner ${index}`, groupKey: 'user', status: 'active' } })).json() as { code: number; data: { user: Account } }
        if (account.code === 0) users.push(account.data.user)
        expect(account.code).toBe(0)
        const context = await browser.newContext({ baseURL, locale: 'zh-CN', serviceWorkers: 'block', reducedMotion: 'reduce' })
        contexts.push(context)
        const owner = await context.newPage()
        expect(await (await owner.request.post('/api/v1/auth/login', { data: { username, password } })).json()).toMatchObject({ code: 0 })
        owners.push(owner)
      }
      for (let index = 0; index < 2; index++) {
        const result = await (await owners[0]!.request.post('/api/v1/short-link/create', { data: {
          targetUrl: `https://example.com/${tag}/${index}?preserve=address`,
          metadata: { title: `Batch handoff ${index}`, tags: [tag, '历史保留'] },
          redirectMode: index === 0 ? 'direct' : 'confirmation',
          expiration: { mode: 'at', expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
          maxVisits: 12,
          ...(index === 1 ? { password: { mode: 'set', value: accessPassword } } : {}),
        } })).json() as { code: number; data: { shortLink: ShortLink } }
        if (result.code === 0) created.push(result.data.shortLink)
        expect(result.code).toBe(0)
      }
      const anonymous = await browser.newContext({ baseURL, serviceWorkers: 'block' })
      contexts.push(anonymous)
      expect((await anonymous.request.get(created[0]!.url, { maxRedirects: 0 })).headers().location).toBe(created[0]!.targetUrl)
      const protectedLink = created[1]!
      expect((await anonymous.request.get(protectedLink.url, { maxRedirects: 0 })).headers().location).toBe(`/go/${protectedLink.slug}?reason=password`)
      expect(await (await anonymous.request.post(`/go/${protectedLink.slug}/unlock`, { data: { password: accessPassword } })).json()).toMatchObject({ code: 0, data: { unlocked: true } })
      expect((await anonymous.request.get(`/go/${protectedLink.slug}/continue`, { maxRedirects: 0 })).headers().location).toBe(protectedLink.targetUrl)
      for (const link of created) await expect.poll(async () => (await (await owners[0]!.request.get(`/api/v1/short-link/statistics?id=${link.id}`)).json()).data.stats.visitCount).toBe(1)
      const links = await listLinks(admin, tag)
      expect(links).toHaveLength(2)
      await use({ admin, original: owners[0]!, recipient: owners[1]!, anonymous, users, links, tag })
    } catch (error) { errors.push(error) }
    finally {
      for (const link of created) {
        try { expect(await (await admin.request.post('/api/v1/admin/short-link/delete', { data: { id: link.id }, timeout: 5_000 })).json()).toMatchObject({ code: 0 }) } catch (error) { errors.push(error) }
      }
      for (const user of users) {
        try { expect(await (await admin.request.post('/api/v1/admin/user/update', { data: { id: user.id, nickname: 'Batch transfer fixture', status: 'disabled' }, timeout: 5_000 })).json()).toMatchObject({ code: 0 }) } catch (error) { errors.push(error) }
      }
      for (const context of contexts) { try { await context.close() } catch (error) { errors.push(error) } }
    }
    if (errors.length) throw new AggregateError(errors, 'Batch ownership scenario or cleanup failed')
  }, { timeout: 40_000 }],
})

test.use({ actionTimeout: 10_000, serviceWorkers: 'block' })

/** Reads a scenario's records, including full-precision optimistic versions. */
async function listLinks(admin: Page, tag: string): Promise<AdminShortLink[]> {
  const response = await admin.request.get(`/api/v1/admin/short-link/list?tag=${encodeURIComponent(tag)}&pageSize=100`)
  expect(response.status()).toBe(200)
  const payload = await response.json() as { code: number; data: { items: AdminShortLink[] } }
  expect(payload.code).toBe(0)
  return payload.data.items.sort((left, right) => left.id.localeCompare(right.id))
}

/** Reads the bounded audit list and keeps only the fixture's resource IDs. */
async function audits(scenario: Scenario): Promise<Audit[]> {
  const response = await scenario.admin.request.get('/api/v1/admin/audit/list?resourceType=short_link&action=update&pageSize=100')
  const payload = await response.json() as { code: number; data: { items: Audit[] } }
  expect(payload.code).toBe(0)
  return payload.data.items.filter(item => scenario.links.some(link => link.id === item.resourceId))
}

/** Opens the real filtered list and selects exactly the scenario's two links. */
async function selectLinks(scenario: Scenario) {
  const { admin, tag, links } = scenario
  await admin.goto('/admin/link')
  const response = admin.waitForResponse(result => { const url = new URL(result.url()); return url.pathname === '/api/v1/admin/short-link/list' && url.searchParams.get('tag') === tag })
  await admin.getByLabel('标签', { exact: true }).fill(tag)
  expect(await (await response).json()).toMatchObject({ code: 0 })
  await expect(admin.getByTestId('console-link-row')).toHaveCount(2)
  for (const link of links) await admin.getByRole('checkbox', { name: `选择短链 ${link.slug}`, exact: true }).check()
  await expect(admin.getByTestId('batch-toolbar')).toContainText('已选择 2 条')
}

/** Saves visible dialog layouts after checking both document and card overflow. */
async function capture(admin: Page, dialog: Locator, info: TestInfo, name: string) {
  await expectNoHorizontalOverflow(admin)
  await expect.poll(() => dialog.locator('.batch-transfer-body').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  const path = info.outputPath(`${name}.png`)
  await admin.screenshot({ path, fullPage: true, animations: 'disabled' })
  await info.attach(name, { path, contentType: 'image/png' })
}

for (const width of [1280, 390]) {
  // Removing atomic owner updates, keeping old access, or resetting any configuration must fail this real flow.
  test(`batch ownership preserves both links and anonymous grants at ${width}px`, async ({ scenario }, info) => {
    const { admin, original, recipient, anonymous, users, links } = scenario
    await admin.setViewportSize({ width, height: width === 1280 ? 900 : 844 })
    await selectLinks(scenario)
    await admin.getByTestId('batch-transfer').click()
    const dialog = admin.getByRole('dialog')
    await expect(dialog).toContainText('2')
    for (const link of links) { await expect(dialog).toContainText(link.url); await expect(dialog).toContainText(link.owner.username) }
    await expect(dialog.getByRole('button', { name: '确认转移', exact: true })).toBeDisabled()
    await dialog.getByRole('textbox', { name: '接收账号的准确用户名', exact: true }).fill(users[1]!.username)
    await expect(dialog.getByRole('button', { name: '确认转移', exact: true })).toBeDisabled()
    await dialog.getByRole('checkbox', { name: '我已核对接收账号，并确认移交管理权及历史统计', exact: true }).check()
    await capture(admin, dialog, info, `batch-transfer-${width}-zh`)
    const transferred = admin.waitForResponse('**/api/v1/admin/short-link/batch-transfer')
    await dialog.getByRole('button', { name: '确认转移', exact: true }).click()
    const response = await transferred
    expect(response.request().postDataJSON()).toEqual({ items: expect.arrayContaining(links.map(link => ({ id: link.id, expectedUpdatedAt: link.updatedAt }))), newOwnerUsername: users[1]!.username })
    expect(response.headers()['cache-control']).toBe('no-store')
    expect(await response.json()).toMatchObject({ code: 0, data: { transferredCount: 2, unchangedCount: 0 } })
    await expect(dialog).toHaveCount(0)
    await expect(admin.getByTestId('batch-toolbar')).toContainText('已选择 0 条')
    const after = await listLinks(admin, scenario.tag)
    for (const link of links) {
      const current = after.find(item => item.id === link.id)!
      expect(current).toEqual({ ...link, owner: { id: users[1]!.id, username: users[1]!.username, nickname: 'Batch owner 1' }, updatedAt: expect.any(String) })
      expect(current.updatedAt).not.toBe(link.updatedAt)
      expect(await (await original.request.get(`/api/v1/short-link/statistics?id=${link.id}`)).json()).toMatchObject({ code: 200104 })
      for (const action of ['update', 'delete']) expect(await (await original.request.post(`/api/v1/short-link/${action}`, { data: { id: link.id, ...(action === 'update' ? { status: 'disabled' } : {}) } })).json()).toMatchObject({ code: 200104 })
      expect(await (await recipient.request.get(`/api/v1/short-link/statistics?id=${link.id}`)).json()).toMatchObject({ code: 0, data: { stats: { visitCount: 1 } } })
    }
    expect(await (await original.request.get('/api/v1/short-link/list')).json()).toMatchObject({ code: 0, data: { items: [] } })
    expect((await (await recipient.request.get('/api/v1/short-link/list')).json()).data.items.map((link: ShortLink) => link.id).sort()).toEqual(links.map(link => link.id).sort())
    const audit = await audits(scenario)
    expect(audit).toHaveLength(2)
    for (const link of links) expect(audit).toContainEqual(expect.objectContaining({ resourceId: link.id, changedFields: ['owner_id'] }))
    for (const link of links) {
      if (link.passwordEnabled) {
        expect(await (await anonymous.request.get(`/go/${link.slug}/preview`)).json()).toMatchObject({ code: 0, data: { redirectMode: 'confirmation' } })
        expect((await anonymous.request.get(`/go/${link.slug}/continue`, { maxRedirects: 0 })).headers().location).toBe(link.targetUrl)
      } else expect((await anonymous.request.get(link.url, { maxRedirects: 0 })).headers().location).toBe(link.targetUrl)
      await expect.poll(async () => (await (await recipient.request.get(`/api/v1/short-link/statistics?id=${link.id}`)).json()).data.stats.visitCount).toBe(2)
      expect(await (await recipient.request.post('/api/v1/short-link/update', { data: { id: link.id, metadata: { title: `Recipient manages ${link.slug}`, tags: [scenario.tag] } } })).json()).toMatchObject({ code: 0 })
    }
    if (width === 390) await admin.getByRole('button', { name: '打开控制台菜单', exact: true }).click()
    await admin.getByRole('button', { name: '选择语言', exact: true }).filter({ visible: true }).first().click()
    await admin.getByRole('menuitemradio', { name: 'English', exact: true }).click()
    if (width === 390) await admin.getByRole('button', { name: 'Close menu', exact: true }).click()
    await admin.reload()
    for (const link of links) await admin.getByRole('checkbox', { name: `Select short link ${link.slug}`, exact: true }).check()
    await admin.getByTestId('batch-transfer').click()
    await expect(dialog).toContainText(`Current owner: ${users[1]!.username}`)
    await dialog.getByRole('textbox', { name: 'Exact recipient username', exact: true }).fill(users[0]!.username)
    await dialog.getByRole('checkbox', { name: 'I verified the recipient and approve transferring management and historical statistics', exact: true }).check()
    await capture(admin, dialog, info, `batch-transfer-${width}-en`)
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(dialog).toHaveCount(0)
  })
}

// Writing unchanged owners or committing before all version checks must fail these API assertions.
test('same-owner counts are read-only and one stale version rolls back the whole batch', async ({ scenario }) => {
  const { admin, users, links, tag } = scenario
  const body = { items: links.map(link => ({ id: link.id, expectedUpdatedAt: link.updatedAt })), newOwnerUsername: users[0]!.username }
  const beforeAudit = await audits(scenario)
  const unchanged = await admin.request.post('/api/v1/admin/short-link/batch-transfer', { data: body })
  expect(unchanged.status()).toBe(200)
  expect(unchanged.headers()['cache-control']).toBe('no-store')
  expect(await unchanged.json()).toMatchObject({ code: 0, data: { transferredCount: 0, unchangedCount: 2 } })
  expect(await listLinks(admin, tag)).toEqual(links)
  expect(await audits(scenario)).toEqual(beforeAudit)
  expect(await (await admin.request.post('/api/v1/admin/short-link/update', { data: { id: links[1]!.id, metadata: { title: 'Concurrent title edit', tags: [tag] } } })).json()).toMatchObject({ code: 0 })
  const concurrent = await listLinks(admin, tag), auditBeforeConflict = await audits(scenario)
  expect(concurrent[1]!.updatedAt).not.toBe(links[1]!.updatedAt)
  const conflict = await admin.request.post('/api/v1/admin/short-link/batch-transfer', { data: { ...body, newOwnerUsername: users[1]!.username } })
  expect(conflict.status()).toBe(200)
  expect(conflict.headers()['cache-control']).toBe('no-store')
  expect(await conflict.json()).toMatchObject({ code: 200116 })
  expect(await listLinks(admin, tag)).toEqual(concurrent)
  expect(await audits(scenario)).toEqual(auditBeforeConflict)
})
