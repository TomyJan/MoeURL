import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test as base } from '@playwright/test'
import type { BrowserContext, Locator, Page, TestInfo } from '@playwright/test'
import type { AdminShortLink, ShortLink } from '../src/entities/short-link/model'
import type { UserGroup } from '../src/entities/user-group/api'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

interface Scenario { admin: Page; owner: Page; other: Page; anonymous: BrowserContext; links: AdminShortLink[]; tag: string; keyword: string }
const password = 'batch-tags-fixture-password'
const accessPassword = 'batch-tags-access-secret'
const longTags = Array.from({ length: 6 }, (_, index) => `${index}${'长'.repeat(31)}`)

const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, page: admin }, use, info) => {
    const baseURL = info.project.use.baseURL
    if (typeof baseURL !== 'string') throw new Error('Batch tags requires a baseURL')
    const tag = `tags-${randomBytes(8).toString('hex')}`, keyword = `batch-${tag}`
    const contexts: BrowserContext[] = [], users: string[] = [], created: ShortLink[] = [], errors: unknown[] = []
    try {
      expect(await (await admin.request.post('/api/v1/auth/login', { data: { username: e2eAdminUsername, password: e2eAdminPassword } })).json()).toMatchObject({ code: 0 })
      const owners: Page[] = []
      for (let index = 0; index < 2; index++) {
        const username = `${tag}-${index}`
        const result = await (await admin.request.post('/api/v1/admin/user/create', { data: { username, password, nickname: `Tags owner ${index}`, groupKey: 'user', status: 'active' } })).json()
        if (result.code === 0) users.push(result.data.user.id)
        expect(result.code).toBe(0)
        const context = await browser.newContext({ baseURL, locale: 'zh-CN', serviceWorkers: 'block', reducedMotion: 'reduce' })
        contexts.push(context)
        const owner = await context.newPage()
        expect(await (await owner.request.post('/api/v1/auth/login', { data: { username, password } })).json()).toMatchObject({ code: 0 })
        owners.push(owner)
      }
      for (let index = 0; index < 4; index++) {
        const result = await (await owners[index === 3 ? 1 : 0]!.request.post('/api/v1/short-link/create', { data: {
          targetUrl: `https://example.com/${keyword}/${index}/${'long-path-'.repeat(20)}?preserve=all`,
          customSlug: `${tag.replaceAll('-', '')}${index}`,
          metadata: { title: `${keyword} ${index}`, tags: [tag, ...longTags] },
          redirectMode: index === 0 ? 'direct' : index === 1 ? 'intermediate' : 'confirmation',
          intermediateDelaySeconds: 7,
          expiration: { mode: 'at', expiresAt: new Date(Date.now() + 86_400_000).toISOString() },
          maxVisits: 12,
          ...(index > 0 ? { password: { mode: 'set', value: accessPassword } } : {}),
        } })).json()
        if (result.code === 0) created.push(result.data.shortLink)
        expect(result.code).toBe(0)
      }
      const anonymous = await browser.newContext({ baseURL, serviceWorkers: 'block' })
      contexts.push(anonymous)
      for (const link of created) {
        if (link.passwordEnabled) expect(await (await anonymous.request.post(`/go/${link.slug}/unlock`, { data: { password: accessPassword } })).json()).toMatchObject({ code: 0 })
        expect((await anonymous.request.get(link.passwordEnabled ? `/go/${link.slug}/continue` : link.url, { maxRedirects: 0 })).headers().location).toBe(link.targetUrl)
        await expect.poll(async () => (await (await owners[link === created[3] ? 1 : 0]!.request.get(`/api/v1/short-link/statistics?id=${link.id}`)).json()).data.stats.visitCount).toBe(1)
      }
      const links = await list(admin, keyword)
      expect(links).toHaveLength(4)
      await use({ admin, owner: owners[0]!, other: owners[1]!, anonymous, links, tag, keyword })
    } catch (error) { errors.push(error) }
    finally {
      for (const link of created) {
        try { expect(await (await admin.request.post('/api/v1/admin/short-link/delete', { data: { id: link.id }, timeout: 5_000 })).json()).toMatchObject({ code: 0 }) } catch (error) { errors.push(error) }
      }
      for (const id of users) {
        try { expect(await (await admin.request.post('/api/v1/admin/user/update', { data: { id, nickname: 'Batch tags fixture', status: 'disabled' }, timeout: 5_000 })).json()).toMatchObject({ code: 0 }) } catch (error) { errors.push(error) }
      }
      for (const context of contexts) { try { await context.close() } catch (error) { errors.push(error) } }
    }
    if (errors.length) throw new AggregateError(errors, 'Batch tags scenario or cleanup failed')
  }, { timeout: 45_000 }],
})

test.use({ actionTimeout: 10_000, serviceWorkers: 'block' })

/** Reads only this fixture, even after its classification tag has been removed. */
async function list(admin: Page, keyword: string): Promise<AdminShortLink[]> {
  const response = await admin.request.get(`/api/v1/admin/short-link/list?q=${keyword}&pageSize=100`)
  expect(response.status()).toBe(200)
  const payload = await response.json()
  expect(payload.code).toBe(0)
  return (payload.data.items as AdminShortLink[]).sort((a, b) => a.id.localeCompare(b.id))
}

/** Checks fixture audit entries as well as record values on read-only rejection paths. */
async function audits(scenario: Scenario) {
  const payload = await (await scenario.admin.request.get('/api/v1/admin/audit/list?resourceType=short_link&action=update&pageSize=100')).json()
  expect(payload.code).toBe(0)
  return payload.data.items.filter((item: { resourceId: string }) => scenario.links.some(link => link.id === item.resourceId))
}

/** Waits for the exact applied filter response rather than relying on debounce timing. */
async function filter(page: Page, label: string, value: string, parameter: string, count: number) {
  const response = page.waitForResponse(result => { const url = new URL(result.url()); return url.pathname.endsWith('/short-link/list') && (url.searchParams.get(parameter) ?? '') === value })
  await page.getByLabel(label, { exact: true }).fill(value)
  expect(await (await response).json()).toMatchObject({ code: 0 })
  await expect(page.getByTestId('console-link-row')).toHaveCount(count)
}

/** Selects the actual refreshed list versions and opens the explicit confirmation. */
async function open(page: Page, links: AdminShortLink[]) {
  for (const link of links) await page.getByRole('checkbox', { name: `选择短链 ${link.slug}`, exact: true }).check()
  await expect(page.getByTestId('batch-tags')).toBeEnabled()
  await page.getByTestId('batch-tags').click()
  return page.getByTestId('batch-tags-dialog')
}

/** Changes the real Vuetify select and submits only after explicit approval. */
async function submit(page: Page, dialog: Locator, operation: 'add' | 'remove' | 'replace', tags: string[], admin = false) {
  await dialog.getByRole('combobox', { name: '操作', exact: true }).press('Enter')
  await page.getByRole('option', { name: { add: '添加标签', remove: '移除标签', replace: '替换全部标签' }[operation], exact: true }).click()
  await dialog.getByRole('textbox', { name: '标签，每行一个', exact: true }).fill(tags.join('\n'))
  if (operation === 'replace' && tags.length === 0) await expect(dialog.getByTestId('batch-tags-clear-warning')).toBeVisible()
  await expect(dialog.getByTestId('batch-tags-save')).toBeDisabled()
  await dialog.getByLabel('我确认对全部所选短链执行此标签操作', { exact: true }).check()
  const response = page.waitForResponse(`**/api/v1/${admin ? 'admin/' : ''}short-link/batch-tags`)
  await dialog.getByTestId('batch-tags-save').click()
  const result = await response
  expect(result.request().postDataJSON()).toMatchObject({ operation, tags })
  expect(result.headers()['cache-control']).toBe('no-store')
  expect(await result.json()).toMatchObject({ code: 0, data: { changedCount: admin ? 4 : 3, unchangedCount: 0 } })
  await expect(dialog).toHaveCount(0)
  await expect(page.getByTestId('batch-toolbar')).toContainText('已选择 0 条')
}

/** Captures a bounded, actually scrollable summary with no horizontal overflow. */
async function capture(page: Page, dialog: Locator, info: TestInfo, name: string) {
  await expectNoHorizontalOverflow(page)
  const summary = dialog.locator('.batch-tags-summary')
  await expect.poll(() => summary.evaluate(element => element.scrollHeight - element.clientHeight)).toBeGreaterThan(0)
  await expect.poll(() => dialog.evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  const summaryBox = await summary.boundingBox()
  expect(summaryBox).not.toBeNull()
  if (summaryBox) {
    await page.mouse.move(summaryBox.x + summaryBox.width / 2, summaryBox.y + Math.min(summaryBox.height / 2, 60))
    await page.mouse.wheel(0, 1_500)
  }
  await expect.poll(() => summary.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  const path = info.outputPath(`${name}.png`)
  await page.screenshot({ path, animations: 'disabled' })
  await info.attach(name, { path, contentType: 'image/png' })
  const geometry = () => dialog.evaluate(element => {
    const targets = [element, ...element.querySelectorAll('.batch-tags-body, .batch-tags-summary, .v-switch, .v-card-actions, [data-testid="batch-tags-save"]')]
    let ancestor = element.parentElement
    while (ancestor) { targets.push(ancestor); ancestor = ancestor.parentElement }
    return targets.map(target => {
      const style = getComputedStyle(target), rect = target.getBoundingClientRect()
      return { className: target.className, testid: target.getAttribute('data-testid'), overflowY: style.overflowY, clientHeight: target.clientHeight, scrollHeight: target.scrollHeight, scrollTop: target.scrollTop, x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    })
  })
  const before = await geometry()
  const box = await dialog.boundingBox()
  expect(box).not.toBeNull()
  if (box) {
    // Wheel over the body outside the nested summary: no programmatic scrollIntoView.
    await page.mouse.move(box.x + box.width - 12, Math.min(page.viewportSize()!.height - 100, box.y + box.height / 2))
    await page.mouse.wheel(0, 1_500)
  }
  await expect.poll(async () => {
    const card = await dialog.boundingBox()
    const controls = await Promise.all([
      dialog.getByTestId('batch-tags-save').boundingBox(),
      dialog.getByTestId('batch-tags-cancel').boundingBox(),
      dialog.getByTestId('batch-tags-confirm').boundingBox(),
    ])
    return card !== null && controls.every(control => control !== null && control.y >= Math.max(0, card.y) && control.y + control.height <= Math.min(page.viewportSize()!.height, card.y + card.height))
  }).toBe(true)
  const geometryPath = info.outputPath(`${name}-physical-scroll-geometry.json`)
  await writeFile(geometryPath, JSON.stringify({ before, after: await geometry() }, null, 2))
  await info.attach(`${name}-physical-scroll-geometry`, { path: geometryPath, contentType: 'application/json' })
  await page.screenshot({ path: info.outputPath(`${name}-after-wheel.png`), animations: 'disabled' })
}

for (const width of [1280, 390]) {
  test(`personal and cross-owner admin tags preserve access and filters at ${width}px`, async ({ scenario }, info) => {
    const { owner, admin, links, tag, keyword, anonymous } = scenario
    const own = links.filter(link => link.owner.username.endsWith('-0'))
    await owner.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    await owner.goto('/link')
    await filter(owner, '标签', tag, 'tag', 3)
    let dialog = await open(owner, own)
    for (const link of own) await expect(dialog).toContainText(link.url)
    await capture(owner, dialog, info, `batch-tags-own-${width}`)
    await dialog.getByTestId('batch-tags-cancel').click()
    await expect(dialog).toHaveCount(0)
    await expect(owner.getByTestId('batch-toolbar')).toContainText('已选择 3 条')
    await owner.getByTestId('batch-tags').click()
    dialog = owner.getByTestId('batch-tags-dialog')
    await submit(owner, dialog, 'add', ['追加 空格', '逗号,保留'])
    for (const current of await list(admin, keyword)) {
      const before = links.find(link => link.id === current.id)!
      expect(current).toEqual({ ...before, ...(own.some(link => link.id === current.id) ? { tags: [...before.tags, '追加 空格', '逗号,保留'], updatedAt: expect.any(String) } : {}) })
    }
    dialog = await open(owner, own)
    await submit(owner, dialog, 'remove', ['追加 空格'])
    for (const current of await list(admin, keyword)) if (own.some(link => link.id === current.id)) expect(current.tags).toEqual([tag, ...longTags, '逗号,保留'])
    dialog = await open(owner, own)
    await submit(owner, dialog, 'replace', ['最终 分类'])
    await expect(owner.getByTestId('console-link-row')).toHaveCount(0)
    for (const current of await list(admin, keyword)) if (own.some(link => link.id === current.id)) expect(current.tags).toEqual(['最终 分类'])
    await filter(owner, '标签', '', 'tag', 3)
    dialog = await open(owner, own)
    await submit(owner, dialog, 'replace', [])
    const cleared = await list(admin, keyword)
    for (const link of own) expect(cleared.find(current => current.id === link.id)!.tags).toEqual([])
    await admin.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    await admin.goto('/admin/link')
    await filter(admin, '关键词搜索', keyword, 'q', 4)
    dialog = await open(admin, cleared)
    await submit(admin, dialog, 'add', ['后台 跨账号'], true)
    let previous = cleared
    const readBack = async (tagsFor: (original: AdminShortLink) => string[]) => {
      const currentLinks = await list(admin, keyword)
      expect(currentLinks).toHaveLength(4)
      for (const current of currentLinks) {
        const original = links.find(link => link.id === current.id)!
        expect(current).toEqual({ ...original, tags: tagsFor(original), updatedAt: expect.any(String) })
        expect(current.updatedAt).not.toBe(previous.find(link => link.id === current.id)!.updatedAt)
      }
      previous = currentLinks
      return currentLinks
    }
    let after = await readBack(original => own.some(link => link.id === original.id) ? ['后台 跨账号'] : [...original.tags, '后台 跨账号'])
    dialog = await open(admin, after)
    await submit(admin, dialog, 'remove', ['后台 跨账号'], true)
    after = await readBack(original => own.some(link => link.id === original.id) ? [] : original.tags)
    dialog = await open(admin, after)
    await submit(admin, dialog, 'replace', ['后台 替换', '顺序,保留'], true)
    after = await readBack(() => ['后台 替换', '顺序,保留'])
    dialog = await open(admin, after)
    // The shared submit helper asserts the visible clear warning before explicit approval.
    await submit(admin, dialog, 'replace', [], true)
    after = await readBack(() => [])
    for (const current of after) {
      if (current.passwordEnabled) expect(await (await anonymous.request.get(`/go/${current.slug}/preview`)).json()).toMatchObject({ code: 0, data: { redirectMode: current.redirectMode } })
      expect((await anonymous.request.get(current.passwordEnabled ? `/go/${current.slug}/continue` : current.url, { maxRedirects: 0 })).headers().location).toBe(current.targetUrl)
      const actor = own.some(link => link.id === current.id) ? owner : scenario.other
      await expect.poll(async () => (await (await actor.request.get(`/api/v1/short-link/statistics?id=${current.id}`)).json()).data.stats.visitCount).toBe(2)
    }
  })
}

for (const scope of ['own', 'admin'] as const) {
  test(`retires ${scope} confirmation after permissions are revoked in another window`, async ({ scenario }) => {
    const { admin, owner, links, tag, keyword } = scenario
    const page = scope === 'own' ? owner : admin
    const groupKey = scope === 'own' ? 'user' : 'admin'
    /** Reads the live concurrency version without caching a group restoration token. */
    const readGroup = async () => {
      const response = await admin.request.get('/api/v1/admin/user-group/list')
      expect(response.status()).toBe(200)
      const result = await response.json() as { code: number; data: { groups: UserGroup[] } }
      expect(result.code).toBe(0)
      const group = result.data.groups.find(value => value.key === groupKey)
      if (!group) throw new Error('Fixture group missing')
      return group
    }
    const original = await readGroup()
    expect(original.permissions).toContain('short_link:set_metadata')
    /** Restores the shared fixture group on every path using its latest version. */
    const restoreGroup = async () => {
      const current = await readGroup()
      if (JSON.stringify(current.permissions) !== JSON.stringify(original.permissions)) {
        expect(await (await admin.request.post('/api/v1/admin/user-group/update-permissions', { data: { groupKey, expectedUpdatedAt: current.updatedAt, permissions: original.permissions } })).json()).toMatchObject({ code: 0 })
      }
    }
    const errors: unknown[] = []
    try {
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(scope === 'own' ? '/link' : '/admin/link')
      await filter(page, scope === 'own' ? '标签' : '关键词搜索', scope === 'own' ? tag : keyword, scope === 'own' ? 'tag' : 'q', scope === 'own' ? 3 : 4)
      const selected = scope === 'own' ? links.filter(link => link.owner.username.endsWith('-0')) : links
      const dialog = await open(page, selected)
      await dialog.getByLabel('标签，每行一个').fill('禁止复用旧确认')
      await dialog.getByLabel('我确认对全部所选短链执行此标签操作').check()
      const beforeAudit = await audits(scenario)
      expect(await (await admin.request.post('/api/v1/admin/user-group/update-permissions', { data: { groupKey, expectedUpdatedAt: original.updatedAt, permissions: original.permissions.filter(value => value !== 'short_link:set_metadata') } })).json()).toMatchObject({ code: 0 })
      const denied = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/short-link/batch-tags'))
      const authority = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/auth/me')
      await dialog.getByTestId('batch-tags-save').click()
      expect(await (await denied).json()).toMatchObject({ code: 120001 })
      await expect(page.getByTestId('batch-tags-dialog')).toHaveCount(0)
      await expect(page.getByText('权限或登录状态已变化，本次确认已取消。请重新登录或确认权限后再操作。', { exact: true })).toBeVisible()
      const refreshed = await (await authority).json()
      expect(refreshed.code).toBe(0)
      expect(refreshed.data.user.permissions).not.toContain('short_link:set_metadata')
      await expect(page.getByTestId('batch-tags')).toHaveCount(0)
      expect(await list(admin, keyword)).toEqual(links)
      expect(await audits(scenario)).toEqual(beforeAudit)
      await restoreGroup()
      await expect(page.getByTestId('batch-tags-dialog')).toHaveCount(0)
      await page.reload()
      await filter(page, scope === 'own' ? '标签' : '关键词搜索', scope === 'own' ? tag : keyword, scope === 'own' ? 'tag' : 'q', scope === 'own' ? 3 : 4)
      const fresh = await open(page, selected)
      await expect(fresh.getByLabel('标签，每行一个')).toHaveValue('')
      await expect(fresh.getByLabel('我确认对全部所选短链执行此标签操作')).not.toBeChecked()
      await expect(fresh.getByTestId('batch-tags-save')).toBeDisabled()
      await fresh.getByTestId('batch-tags-cancel').click()
    } catch (error) { errors.push(error) }
    finally { try { await restoreGroup() } catch (error) { errors.push(error) } }
    if (errors.length) throw new AggregateError(errors, 'Server denial scenario or permission cleanup failed')
  })
}

test('foreign ownership, stale versions and result overflow reject the whole batch without writes', async ({ scenario }) => {
  const { admin, owner, other, links, keyword } = scenario
  const items = links.map(link => ({ id: link.id, expectedUpdatedAt: link.updatedAt }))
  const beforeAudit = await audits(scenario)
  const unchanged = await admin.request.post('/api/v1/admin/short-link/batch-tags', { data: { items, operation: 'add', tags: [scenario.tag] } })
  expect(await unchanged.json()).toMatchObject({ code: 0, data: { changedCount: 0, unchangedCount: 4 } })
  expect(await list(admin, keyword)).toEqual(links)
  expect(await audits(scenario)).toEqual(beforeAudit)
  for (const actor of [owner, other]) {
    const response = await actor.request.post('/api/v1/short-link/batch-tags', { data: { items, operation: 'add', tags: ['forbidden'] } })
    expect(response.status()).toBe(200)
    expect(response.headers()['cache-control']).toBe('no-store')
    expect(await response.json()).toMatchObject({ code: 200104 })
    expect(await list(admin, keyword)).toEqual(links)
    expect(await audits(scenario)).toEqual(beforeAudit)
  }
  const response = await admin.request.post('/api/v1/admin/short-link/batch-tags', { data: { items, operation: 'add', tags: ['one', 'two', 'three', 'four'] } })
  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toBe('no-store')
  expect(await response.json()).toMatchObject({ code: 200119 })
  expect(await list(admin, keyword)).toEqual(links)
  expect(await audits(scenario)).toEqual(beforeAudit)
  expect(await (await admin.request.post('/api/v1/admin/short-link/update', { data: { id: links[1]!.id, metadata: { title: 'Concurrent title', tags: links[1]!.tags } } })).json()).toMatchObject({ code: 0 })
  const concurrent = await list(admin, keyword)
  const concurrentAudit = await audits(scenario)
  // The searchable target URL keeps the edited title's record inside the fixture query.
  expect(concurrent).toHaveLength(4)
  const conflict = await admin.request.post('/api/v1/admin/short-link/batch-tags', { data: { items, operation: 'remove', tags: [links[0]!.tags[0]!] } })
  expect(conflict.status()).toBe(200)
  expect(conflict.headers()['cache-control']).toBe('no-store')
  expect(await conflict.json()).toMatchObject({ code: 200116 })
  expect(await list(admin, keyword)).toEqual(concurrent)
  expect(await audits(scenario)).toEqual(concurrentAudit)
})
