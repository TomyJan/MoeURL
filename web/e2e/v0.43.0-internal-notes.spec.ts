import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { expect, test as base } from '@playwright/test'
import type { APIRequestContext, BrowserContext, Page, TestInfo } from '@playwright/test'
import type { ShortLink } from '../src/entities/short-link/model'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

interface Group { key: string; permissions: string[]; updatedAt: string }
interface Scenario { admin: Page; owner: Page; recipient: Page; guest: Page; link: ShortLink; recipientName: string; group: Group }
const password = 'internal-note-owned-fixture'
const test = base.extend<{ scenario: Scenario }>({
  scenario: [async ({ browser, page: manager }, use, info) => {
    const contexts: BrowserContext[] = [], users: string[] = [], failures: unknown[] = []
    let link: ShortLink | undefined, original: Group | undefined
    try {
      const baseURL = info.project.use.baseURL
      if (typeof baseURL !== 'string') throw new Error('Requires disposable Compose baseURL')
      await post(manager.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      original = await group(manager.request)
      const keyword = 'note43-' + randomBytes(6).toString('hex')
      const language = info.title.includes(' en ') ? 'en' : 'zh-CN', width = info.title.includes('1280px') ? 1280 : 390
      const theme = language === 'en' ? 'dark' : 'light'
      const makePage = async () => {
        const context = await browser.newContext({ baseURL, viewport: { width, height: width === 1280 ? 900 : 844 }, locale: language, hasTouch: width === 390, serviceWorkers: 'block', colorScheme: theme, reducedMotion: 'reduce' })
        contexts.push(context)
        await context.addInitScript(({ language, theme }) => { localStorage.setItem('moeurl.language', language); localStorage.setItem('moeurl.theme', theme) }, { language, theme })
        return context.newPage()
      }
      const pages: Page[] = []
      for (let index = 0; index < 2; index++) {
        const username = keyword + '-' + index
        const created = await post(manager.request, '/admin/user/create', { username, password, nickname: 'Internal note fixture', groupKey: 'user', status: 'active' })
        users.push(created.data.user.id)
        const page = await makePage(); pages.push(page)
        await post(page.request, '/auth/login', { username, password })
      }
      const owner = pages[0]!, recipient = pages[1]!, admin = await makePage(), guest = await makePage()
      await post(admin.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      link = (await post(owner.request, '/short-link/create', { targetUrl: 'https://example.com/' + keyword, metadata: { title: keyword, tags: [] } })).data.shortLink
      await attach(info, 'runtime', { browser: browser.version(), driverNode: process.version, width, language, theme, users, linkId: link!.id, disposableDatabase: true })
      await use({ admin, owner, recipient, guest, link: link!, recipientName: keyword + '-1', group: original })
    } catch (error) { failures.push(error) } finally {
      // Restore shared permissions by their live version, even if a request's response was lost.
      if (original) {
        try {
          const current = await group(manager.request)
          if (JSON.stringify(current.permissions) !== JSON.stringify(original.permissions)) await permissions(manager.request, original.permissions)
          expect((await group(manager.request)).permissions).toEqual(original.permissions)
        } catch (error) { failures.push(error) }
      }
      if (link) { try { await post(manager.request, '/admin/short-link/delete', { id: link.id }) } catch (error) { failures.push(error) } }
      for (const id of users) {
        try { await post(manager.request, '/admin/user/update', { id, nickname: 'Internal note fixture', status: 'disabled' }) } catch (error) { failures.push(error) }
      }
      for (const context of contexts) { try { await context.close() } catch (error) { failures.push(error) } }
    }
    if (failures.length) throw new AggregateError(failures, 'Internal note scenario or exact owned cleanup failed')
  }, { timeout: 90_000 }],
})
test.use({ serviceWorkers: 'block', actionTimeout: 10_000 })

// Removing CAS, permission checks, owner checks or the private DTO boundary must break these real Session scenarios.
for (const language of ['zh-CN', 'en'] as const) for (const width of [1280, 390]) {
  test('v0.43.0 ' + language + ' ' + width + 'px saves private notes, preserves conflicts and transfers access safely', async ({ scenario }, info) => {
    const { owner, admin, recipient, guest, link, recipientName } = scenario
    const en = language === 'en'
    const labels = {
      text: en ? 'Note text' : '备注内容', save: en ? 'Save note' : '保存备注', close: en ? 'Close' : '关闭',
      reload: en ? 'Reload (replace draft)' : '重新加载（替换草稿）', clear: en ? 'Clear draft' : '清空草稿',
    }
    const dialog = owner.getByTestId('note-dialog'), field = dialog.getByRole('textbox', { name: labels.text, exact: true })
    const long = '<b>literal</b>\n\t' + '长🙂'.repeat(492)
    expect([...long]).toHaveLength(1000)
    await owner.goto('/link'); await open(owner, link.slug, en)
    await expect(field).toHaveValue('')
    await expect(dialog).toContainText(en ? 'Notes move with the link' : '备注会随短链转移')
    await field.fill(long + 'x'); await expect(dialog.getByRole('button', { name: labels.save, exact: true })).toBeDisabled()
    await field.fill(long); await expect(dialog.getByRole('status')).toContainText('1000 / 1000')
    await capture(info, owner, 'note-long-' + language + '-' + width)
    const saved = owner.waitForResponse('**/api/v1/short-link/note/update')
    await dialog.getByRole('button', { name: labels.save, exact: true }).focus()
    await owner.keyboard.press('Enter')
    const savedResponse = await saved
    expect(savedResponse.request().headers()['x-moeurl-expected-user-id']).toBe((await get(owner.request, '/auth/me')).data.user.id)
    expect(await savedResponse.json()).toMatchObject({ code: 0, data: { note: long } })
    await expect(dialog.getByRole('button', { name: labels.save, exact: true })).toBeDisabled()
    expect((await get(admin.request, '/admin/short-link/note?id=' + link.id)).data.note).toBe(long)
    const listed = await get(owner.request, '/short-link/list')
    expect(JSON.stringify(listed)).not.toContain('literal')
    expect(listed.data.items.find((item: ShortLink) => item.id === link.id)).not.toHaveProperty('note')
    const publicResponse = await guest.request.get(link.url, { maxRedirects: 0 })
    expect(publicResponse.status()).toBe(302); expect(publicResponse.headers().location).toBe(link.targetUrl)
    expect(await publicResponse.text()).not.toContain('literal')
    expect((await (await guest.request.get('/api/v1/short-link/note?id=' + link.id)).json()).code).toBe(120001)
    expect((await (await recipient.request.get('/api/v1/short-link/note?id=' + link.id)).json()).code).toBe(200104)

    await field.fill('My preserved draft')
    const prior = (await get(admin.request, '/admin/short-link/note?id=' + link.id)).data
    await post(admin.request, '/admin/short-link/note/update', { id: link.id, note: 'Changed by administrator', expectedUpdatedAt: prior.updatedAt })
    const conflict = owner.waitForResponse('**/api/v1/short-link/note/update')
    await dialog.getByRole('button', { name: labels.save, exact: true }).click()
    expect(await (await conflict).json()).toMatchObject({ code: 200116 })
    await expect(field).toHaveValue('My preserved draft')
    await expect(dialog.getByRole('button', { name: labels.save, exact: true })).toBeDisabled()
    await capture(info, owner, 'note-conflict-' + language + '-' + width)
    await dialog.getByRole('button', { name: labels.reload, exact: true }).click()
    await expect(field).toHaveValue('Changed by administrator')
    await dialog.getByRole('button', { name: labels.clear, exact: true }).click()
    await expect(field).toHaveValue('')
    expect((await get(owner.request, '/short-link/note?id=' + link.id)).data.note).toBe('Changed by administrator')
    const cleared = owner.waitForResponse('**/api/v1/short-link/note/update')
    await dialog.getByRole('button', { name: labels.save, exact: true }).click()
    expect(await (await cleared).json()).toMatchObject({ code: 0, data: { note: '' } })
    await dialog.getByRole('button', { name: labels.close, exact: true }).focus(); await owner.keyboard.press('Enter')
    await expect(dialog).toHaveCount(0)

    await admin.goto('/admin/link'); await open(admin, link.slug, en)
    const adminDialog = admin.getByTestId('note-dialog')
    await adminDialog.getByRole('textbox', { name: labels.text, exact: true }).fill('Private handoff 🙂\nSecond line')
    const adminSaved = admin.waitForResponse('**/api/v1/admin/short-link/note/update')
    await adminDialog.getByRole('button', { name: labels.save, exact: true }).click()
    expect(await (await adminSaved).json()).toMatchObject({ code: 0 })
    await expect(adminDialog.getByRole('button', { name: labels.save, exact: true })).toBeDisabled()
    await capture(info, admin, 'note-admin-' + language + '-' + width)
    await adminDialog.getByRole('button', { name: labels.close, exact: true }).click()
    const row = admin.getByTestId('console-link-row').filter({ hasText: link.slug })
    await row.getByRole('button', { name: en ? 'More actions' : '更多操作', exact: true }).click()
    await admin.getByRole('menuitem', { name: en ? 'Transfer ownership' : '转移归属', exact: true }).click()
    const transfer = admin.getByRole('dialog')
    await transfer.getByRole('textbox', { name: en ? 'Exact recipient username' : '接收账号的准确用户名', exact: true }).fill(recipientName)
    await transfer.getByRole('checkbox').check()
    const transferred = admin.waitForResponse('**/api/v1/admin/short-link/transfer')
    await transfer.getByRole('button', { name: en ? 'Confirm transfer' : '确认转移', exact: true }).click()
    expect(await (await transferred).json()).toMatchObject({ code: 0 })
    await expect(transfer).toHaveCount(0)
    expect((await (await owner.request.get('/api/v1/short-link/note?id=' + link.id)).json()).code).toBe(200104)
    expect((await get(recipient.request, '/short-link/note?id=' + link.id)).data.note).toBe('Private handoff 🙂\nSecond line')
    await permissions(admin.request, scenario.group.permissions.filter(permission => permission !== 'short_link:set_metadata'))
    await recipient.goto('/link'); await open(recipient, link.slug, en)
    const readonly = recipient.getByTestId('note-dialog'), readonlyField = readonly.getByRole('textbox', { name: labels.text, exact: true })
    await expect(readonlyField).toHaveValue('Private handoff 🙂\nSecond line')
    await expect(readonlyField).toHaveAttribute('readonly', '')
    await expect(readonly.getByRole('button', { name: labels.save, exact: true })).toHaveCount(0)
    const current = (await get(recipient.request, '/short-link/note?id=' + link.id)).data
    expect((await (await recipient.request.post('/api/v1/short-link/note/update', { data: { id: link.id, note: 'Denied', expectedUpdatedAt: current.updatedAt } })).json()).code).toBe(120001)
    await capture(info, recipient, 'note-readonly-' + language + '-' + width)
    await attach(info, 'protocol-proof', { language, width, scalarBoundary: 1000, conflictPreservedDraft: true, explicitReload: true, clearRequiresSave: true, actualTransfer: true, oldOwnerDenied: true, recipientReadsPreservedNote: true, readonlyWriteDenied: true, publicRedirectExcludedNote: true })
  })
}

/** Opens the real current row menu by keyboard, without bypassing parent interaction guards. */
async function open(page: Page, slug: string, en: boolean) {
  const row = page.getByTestId('console-link-row').filter({ hasText: slug })
  const more = row.getByRole('button', { name: en ? 'More actions' : '更多操作', exact: true })
  await more.focus(); await more.press('Enter')
  const action = page.getByRole('menuitem', { name: en ? 'Note' : '备注', exact: true })
  await action.focus(); await action.press('Enter')
  await expect(page.getByTestId('note-dialog').getByRole('textbox')).toBeEnabled()
}
/** Reads the current shared fixture group's full permissions and CAS version. */
async function group(api: APIRequestContext): Promise<Group> {
  const result = await get(api, '/admin/user-group/list')
  const value = (result.data.groups as Group[]).find(group => group.key === 'user')
  if (!value) throw new Error('User group missing')
  return value
}
/** Replaces only disposable database permissions and always uses the current version. */
async function permissions(api: APIRequestContext, values: string[]) { await post(api, '/admin/user-group/update-permissions', { groupKey: 'user', permissions: values, expectedUpdatedAt: (await group(api)).updatedAt }) }
/** Verifies real transport and business success, without printing private response text. */
async function get(api: APIRequestContext, path: string) { const response = await api.get('/api/v1' + path); expect(response.status()).toBe(200); const payload = await response.json(); expect(payload.code).toBe(0); return payload }
/** Verifies a single real write; transport failures are never replayed. */
async function post(api: APIRequestContext, path: string, data: unknown) { const response = await api.post('/api/v1' + path, { data }); expect(response.status()).toBe(200); const payload = await response.json(); expect(payload.code).toBe(0); return payload }
/** Measures actual visible controls and captures original notifications and text without hiding anything. */
async function capture(info: TestInfo, page: Page, name: string) {
  const dialog = page.getByTestId('note-dialog')
  await expectNoHorizontalOverflow(page)
  const geometry = () => dialog.evaluate(element => {
    const selectors = ['.note-body .v-textarea', '.note-counter', ...Array.from(element.querySelectorAll('.note-actions button')).map((_, index) => `.note-actions button:nth-child(${index + 1})`)]
    const body = element.querySelector('.note-body')!, clip = body.getBoundingClientRect(), clippingOverflow = getComputedStyle(body).overflowY
    const rawBoxes = selectors.map(selector => { const rect = element.querySelector(selector)!.getBoundingClientRect(); return { selector, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom } })
    // A scroll child's full DOM rectangle includes offscreen content that the browser actually clips.
    const boxes = rawBoxes.map(box => box.selector.startsWith('.note-actions') || !['auto', 'scroll', 'hidden', 'clip'].includes(clippingOverflow) ? box
      : { ...box, left: Math.max(box.left, clip.left), right: Math.min(box.right, clip.right), top: Math.max(box.top, clip.top), bottom: Math.min(box.bottom, clip.bottom) })
    const visible = boxes.filter(box => box.right > box.left && box.bottom > box.top)
    const overlaps = visible.flatMap((a, index) => visible.slice(index + 1).filter(b => a.right > b.left + 1 && b.right > a.left + 1 && a.bottom > b.top + 1 && b.bottom > a.top + 1).map(b => [a.selector, b.selector]))
    const buttonsUnobstructed = Array.from(element.querySelectorAll('.note-actions button')).every(button => {
      if (button.matches(':disabled')) return true
      const rect = button.getBoundingClientRect(), hit = document.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2)
      return hit !== null && button.contains(hit)
    })
    return { boxes, rawBoxes, clippingOverflow, buttonsUnobstructed, overlaps, viewport: { width: innerWidth, height: innerHeight }, overflow: element.scrollWidth - element.clientWidth }
  })
  await expect.poll(async () => (await geometry()).overlaps).toEqual([])
  await expect.poll(async () => (await geometry()).overflow).toBeLessThanOrEqual(1)
  for (const button of await dialog.locator('.note-actions button').all()) await expect(button).toBeInViewport()
  await expect.poll(async () => (await geometry()).buttonsUnobstructed).toBe(true)
  await attach(info, name + '-geometry', await geometry())
  const path = info.outputPath(name + '.png'); await page.screenshot({ path, animations: 'disabled' }); await info.attach(name, { path, contentType: 'image/png' })
}
/** Stores actual runtime and geometry next to original images. */
async function attach(info: TestInfo, name: string, value: unknown) { const path = info.outputPath(name + '.json'); await writeFile(path, JSON.stringify(value, null, 2)); await info.attach(name, { path, contentType: 'application/json' }) }
