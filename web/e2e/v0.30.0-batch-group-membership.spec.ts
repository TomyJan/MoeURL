import { randomBytes } from 'node:crypto'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Page, TestInfo } from '@playwright/test'
import type { UserSummary } from '../src/entities/user/api'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

const batchPath = '/api/v1/admin/user/batch-change-group'
const openName = /^(批量调整用户组|Change selected groups)$/
const cancelName = /^(取消|Cancel)$/
const saveName = /^(保存用户组调整|Save group changes)$/
const confirmName = /^(我确认这些用户组调整|I confirm the group changes)$/
const groupName = /^(目标用户组|Target group)$/
const groupTitles = { user: /^(普通用户|User)$/, admin: /^(管理员|Administrator)$/ }
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

for (const width of [1280, 390]) {
  test('v0.30.0 applies atomic selected memberships and revokes only changed sessions at ' + width + 'px', async ({ page, browser }, info) => {
    info.setTimeout(180_000)
    const suffix = randomBytes(6).toString('hex')
    const password = 'batch-membership-e2e-password'
    const language = width === 1280 ? 'en' : 'zh-CN'
    const contexts: BrowserContext[] = []
    const created: { id: string; username: string }[] = []
    let linkId = ''
    let failure: unknown
    const cleanupErrors: unknown[] = []
    const root = await browser.newContext({ baseURL: info.project.use.baseURL, serviceWorkers: 'block' })
    contexts.push(root)
    try {
      await post(root.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      for (const [kind, groupKey] of [['actor', 'admin'], ['alice', 'user'], ['bob', 'user'], ['untouched', 'user']] as const) {
        const { user } = await post<{ user: { id: string; username: string } }>(root.request, '/admin/user/create', { username: 'batch-' + kind + '-' + suffix, password, nickname: kind, groupKey, status: 'active' })
        created.push(user)
      }
      const [actor, alice, bob, untouched] = created as [{ id: string; username: string }, { id: string; username: string }, { id: string; username: string }, { id: string; username: string }]
      const members: BrowserContext[] = []
      for (const member of [alice, bob, untouched]) {
        const context = await browser.newContext({ baseURL: info.project.use.baseURL, serviceWorkers: 'block' })
        contexts.push(context); members.push(context)
        await post(context.request, '/auth/login', { username: member.username, password })
      }
      const aliceContext = members[0]!
      const untouchedContext = members[2]!
      const targetUrl = 'https://example.com/batch-preserved-' + suffix
      const { shortLink } = await post<{ shortLink: { id: string; slug: string; url: string } }>(aliceContext.request, '/short-link/create', { targetUrl })
      linkId = shortLink.id
      await post(page.request, '/auth/login', { username: actor.username, password })
      await page.addInitScript(value => localStorage.setItem('moeurl.language', value), language)
      await page.setViewportSize({ width, height: width === 1280 ? 720 : 800 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.goto('/admin/user')
      await expect(page.getByTestId('console-user-row').filter({ hasText: actor.username })).toBeVisible()
      await expect(selectAccount(page, actor.username)).toHaveCount(0)
      const before = await users(page.request)
      const protectedUser = await builtinUser(root.request)
      const rejected = await rawPost(page.request, '/admin/user/batch-change-group', { items: snapshot([before.find(item => item.id === alice.id)!, protectedUser]), groupKey: 'admin' })
      expect(rejected.code).toBe(300102)
      expect((await users(page.request)).find(item => item.id === alice.id)).toEqual(before.find(item => item.id === alice.id))
      // A focusable transparent checkbox is not a visible selection affordance.
      await expect.soft(selectAccount(page, alice.username).locator('..').locator('svg'), 'Unselected account has a visible local selection glyph').toBeVisible({ timeout: 2000 })
      await selectAccount(page, alice.username).check()
      await selectAccount(page, bob.username).check()
      await expect.soft(selectAccount(page, alice.username).locator('..').locator('svg'), 'Selected account has a visible local selection glyph').toBeVisible({ timeout: 2000 })
      await expect(page.getByRole('button', { name: /^(编辑|Edit)$/, exact: true }).first()).toBeDisabled()
      if (width === 390) {
        // The existing table scrolls within its panel, not the document.
        const groupCell = page.getByTestId('console-user-row').filter({ hasText: alice.username }).locator('td').nth(2)
        await groupCell.scrollIntoViewIfNeeded()
        // A collapsed table border may clip subpixel geometry, not the group text.
        await expect(groupCell).toBeInViewport({ ratio: 0.99 })
        await expect(groupCell).toHaveText('user')
        await page.locator('.user-table > .v-table__wrapper').evaluate(element => { element.scrollLeft = 0 })
      }
      await capture(page, info, 'batch-membership-selection-' + width)
      await page.getByRole('button', { name: openName }).click()
      let dialog = page.getByRole('dialog')
      await expect(dialog).toContainText(alice.username)
      await expect(dialog).toContainText(bob.username)
      await expect(dialog.getByRole('button', { name: saveName })).toBeDisabled()
      await dialog.getByRole('button', { name: cancelName }).click()
      await expect(selectAccount(page, alice.username)).toBeChecked()
      await page.getByRole('button', { name: openName }).click()
      dialog = page.getByRole('dialog')
      await chooseGroup(page, 'admin')
      await dialog.getByRole('checkbox', { name: confirmName }).check()
      await chooseGroup(page, 'user')
      await expect(dialog.getByRole('checkbox', { name: confirmName })).not.toBeChecked()
      await expect(dialog.getByRole('button', { name: saveName })).toBeDisabled()
      await chooseGroup(page, 'admin')
      await expect(dialog).toContainText(width === 1280 ? '2 will change; 0 will remain unchanged.' : '将调整 2 个，保持不变 0 个。')
      await dialog.getByRole('checkbox', { name: confirmName }).check()
      // Confirmation actions must not require Playwright auto-scrolling a clipped card.
      await expect.soft(dialog.getByRole('button', { name: saveName }), 'Confirmed action is fully inside the viewport').toBeInViewport({ ratio: 1, timeout: 2000 })
      // Every frozen account remains readable inside the bounded scrollable summary.
      const summary = dialog.getByRole('list').filter({ has: page.getByText(bob.username, { exact: true }) })
      for (const member of [bob, alice]) {
        const item = summary.getByRole('listitem').filter({ hasText: member.username })
        await item.scrollIntoViewIfNeeded()
        try { await expect(item).toBeInViewport({ ratio: 1 }) } catch (error) {
          // Preserve real clipping geometry before fixture cleanup, without weakening visibility.
          const geometry = await item.evaluate(element => {
            const ancestors = []
            for (let current: Element | null = element; current; current = current.parentElement) {
              const style = getComputedStyle(current)
              ancestors.push({ tag: current.tagName, className: current.className, bounds: current.getBoundingClientRect().toJSON(), clientHeight: current.clientHeight, scrollHeight: current.scrollHeight, scrollTop: current.scrollTop, display: style.display, gridTemplateRows: style.gridTemplateRows, gridAutoRows: style.gridAutoRows, minHeight: style.minHeight, maxHeight: style.maxHeight, overflowY: style.overflowY, flexShrink: style.flexShrink })
              if (current.getAttribute('role') === 'dialog') break
            }
            return { viewport: { width: innerWidth, height: innerHeight }, ancestors }
          })
          await info.attach('batch-summary-clipping-' + width, { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' })
          const path = info.outputPath('batch-summary-clipping-' + width + '.png')
          await page.screenshot({ path, fullPage: true, animations: 'disabled' })
          await info.attach('batch-summary-clipping-' + width, { path, contentType: 'image/png' })
          throw error
        }
        await expect(item).toContainText(width === 1280 ? 'User' : '普通用户')
      }
      await summary.evaluate(element => { element.scrollTop = 0 })
      await expect(dialog.getByRole('button', { name: saveName })).toBeInViewport({ ratio: 1 })
      await capture(page, info, 'batch-membership-confirmation-' + width)
      const promoted = page.waitForResponse('**' + batchPath)
      await dialog.getByRole('button', { name: saveName }).click()
      const response = await promoted
      expect(response.headers()['cache-control']).toBe('no-store')
      expect(response.request().postDataJSON()).toEqual({ items: snapshot(before.filter(item => [alice.id, bob.id].includes(item.id))), groupKey: 'admin' })
      expect(await response.json()).toMatchObject({ code: 0, data: { changedCount: 2, unchangedCount: 0 } })
      await expect(dialog).toHaveCount(0)
      await expect(selectAccount(page, alice.username)).toBeEnabled()
      await expect(selectAccount(page, alice.username)).not.toBeChecked()
      await expect(page.getByTestId('console-user-row').filter({ hasText: alice.username })).toContainText('admin')
      await capture(page, info, 'batch-membership-refreshed-' + width)
      for (const [index, member] of [alice, bob].entries()) {
        expect((await get<{ user: { group: string } }>(members[index]!.request, '/auth/me')).user.group).toBe('guest')
        expect(await post(members[index]!.request, '/auth/login', { username: member.username, password })).toMatchObject({ user: { group: 'admin' } })
        await get(members[index]!.request, '/admin/dashboard')
      }
      expect((await get<{ user: { id: string } }>(untouchedContext.request, '/auth/me')).user.id).toBe(untouched.id)
      const batchIds = [alice.id, bob.id, untouched.id]
      await selectAccount(page, alice.username).check(); await selectAccount(page, bob.username).check(); await selectAccount(page, untouched.username).check()
      await page.getByRole('button', { name: openName }).click()
      await chooseGroup(page, 'user')
      await expect(page.getByRole('dialog')).toContainText(width === 1280 ? '2 will change; 1 will remain unchanged.' : '将调整 2 个，保持不变 1 个。')
      await page.getByRole('checkbox', { name: confirmName }).check()
      await post(root.request, '/admin/user/update', { id: alice.id, nickname: 'changed after confirmation', status: 'active' })
      const conflictBefore = (await users(root.request)).filter(item => batchIds.includes(item.id))
      const conflicted = page.waitForResponse('**' + batchPath)
      await page.getByRole('dialog').getByRole('button', { name: saveName }).click()
      expect((await (await conflicted).json()).code).toBe(300105)
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(selectAccount(page, alice.username)).toBeEnabled()
      expect((await users(root.request)).filter(item => batchIds.includes(item.id))).toEqual(conflictBefore)
      expect((await get<{ user: { group: string } }>(aliceContext.request, '/auth/me')).user.group).toBe('admin')
      for (const member of [alice, bob, untouched]) await selectAccount(page, member.username).check()
      await page.getByRole('button', { name: openName }).click()
      await chooseGroup(page, 'user')
      await page.getByRole('checkbox', { name: confirmName }).check()
      const demoted = page.waitForResponse('**' + batchPath)
      await page.getByRole('dialog').getByRole('button', { name: saveName }).click()
      expect(await (await demoted).json()).toMatchObject({ code: 0, data: { changedCount: 2, unchangedCount: 1 } })
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(selectAccount(page, alice.username)).toBeEnabled()
      for (const [index, member] of [alice, bob].entries()) {
        expect((await get<{ user: { group: string } }>(members[index]!.request, '/auth/me')).user.group).toBe('guest')
        expect(await post(members[index]!.request, '/auth/login', { username: member.username, password })).toMatchObject({ user: { group: 'user' } })
        expect((await (await members[index]!.request.get('/api/v1/admin/dashboard')).json()).code).toBe(120001)
      }
      expect((await get<{ user: { id: string } }>(untouchedContext.request, '/auth/me')).user.id).toBe(untouched.id)
      const preserved = await get<{ items: { id: string; slug: string; targetUrl: string }[] }>(aliceContext.request, '/short-link/list?page=1&pageSize=100')
      expect(preserved.items.find(item => item.id === linkId)).toMatchObject({ id: linkId, slug: shortLink.slug, targetUrl })
      const publicResponse = await root.request.get(shortLink.url, { maxRedirects: 0 })
      expect(publicResponse.status()).toBe(302); expect(publicResponse.headers().location).toBe(targetUrl)
      const audits = await get<{ items: { resourceId: string; changedFields: string[]; actorId: string }[] }>(page.request, '/admin/audit/list?resourceType=user&action=update&pageSize=100')
      for (const member of [alice, bob]) {
        const changes = audits.items.filter(item => item.resourceId === member.id && item.changedFields.includes('group_id'))
        expect(changes).toHaveLength(2)
        expect(changes.every(item => item.actorId === actor.id)).toBe(true)
      }
      expect(audits.items.filter(item => item.resourceId === untouched.id && item.changedFields.includes('group_id'))).toEqual([])
    } catch (error) { failure = error } finally {
      if (linkId) { try { await post(root.request, '/admin/short-link/delete', { id: linkId }) } catch (error) { cleanupErrors.push(error) } }
      for (const member of created) { try { await post(root.request, '/admin/user/update', { id: member.id, nickname: 'Batch fixture', status: 'disabled' }) } catch (error) { cleanupErrors.push(error) } }
      for (const context of contexts) { try { await context.close() } catch (error) { cleanupErrors.push(error) } }
    }
    if (failure || cleanupErrors.length) throw new AggregateError([...(failure ? [failure] : []), ...cleanupErrors], 'Batch membership scenario or owned fixture cleanup failed')
  })
}

/** Preserves complete server versions in precisely the visible list order used by confirmation. */
function snapshot(items: UserSummary[]) { return items.map(({ id, updatedAt }) => ({ id, expectedUpdatedAt: updatedAt })) }
/** Selects one account through the accessible control rather than a positional checkbox. */
function selectAccount(page: Page, username: string) { return page.getByRole('checkbox', { name: new RegExp('^(选择账号 |Select account )' + username + '$') }) }
/** Chooses an explicit destination through the real Vuetify listbox. */
async function chooseGroup(page: Page, group: 'user' | 'admin') {
  await page.getByRole('dialog').getByRole('combobox', { name: groupName }).press('Enter')
  await page.getByRole('option', { name: groupTitles[group] }).click()
}
/** Keeps genuine business conflicts observable during setup and recovery. */
async function rawPost(request: APIRequestContext, path: string, data: unknown): Promise<{ code: number; data: unknown }> {
  const response = await request.post('/api/v1' + path, { data }); expect(response.status()).toBe(200); return response.json()
}
/** Requires real successful HTTP envelopes for fixture mutations. */
async function post<T = unknown>(request: APIRequestContext, path: string, data: unknown): Promise<T> {
  const result = await rawPost(request, path, data); expect(result.code).toBe(0); return result.data as T
}
/** Reads actual current database representations without inventing revisions. */
async function get<T>(request: APIRequestContext, path: string): Promise<T> {
  const response = await request.get('/api/v1' + path); expect(response.status()).toBe(200)
  const result = await response.json(); expect(result.code).toBe(0); return result.data as T
}
/** Reads exactly the current twenty-account UI list. */
async function users(request: APIRequestContext) { return (await get<{ items: UserSummary[] }>(request, '/admin/user/list?page=1&pageSize=20')).items }
/** Finds the original protected fixture even after earlier scenarios created more than one page. */
async function builtinUser(request: APIRequestContext): Promise<UserSummary> {
  for (let page = 1; ; page++) {
    const response = await request.get('/api/v1/admin/user/list?page=' + page + '&pageSize=100')
    expect(response.status()).toBe(200)
    const result = await response.json() as { code: number; data: { items: UserSummary[] }; meta: { total: number } }
    expect(result.code).toBe(0)
    const found = result.data.items.find(item => item.builtin)
    if (found) return found
    if (page * 100 >= result.meta.total) throw new Error('Initialized database has no builtin account')
  }
}
/** Stores a current original after proving the document has no horizontal overflow. */
async function capture(page: Page, info: TestInfo, name: string) {
  await expectNoHorizontalOverflow(page)
  const path = info.outputPath(name + '.png')
  await page.screenshot({ path, fullPage: true, animations: 'disabled' })
  await info.attach(name, { path, contentType: 'image/png' })
}
