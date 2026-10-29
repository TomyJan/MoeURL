import { expect, test as base } from '@playwright/test'
import type { BrowserContext, Locator, Page } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

type Preset = 'iris' | 'ocean' | 'forest'
type Appearance = { accentPreset: Preset; updatedAt: string }
type Preferences = { language: 'en' | 'zh-CN' | null; theme: 'system' | 'light' | 'dark' | null; updatedAt: string | null }
type APIClient = Pick<Page, 'request'>
type Recovery = { client: APIClient; visitor(context: BrowserContext): void }

const test = base.extend<{ appearanceRecovery: Recovery }>({
  appearanceRecovery: async ({ request }, use) => {
    // This independent fixture survives page closure and restores through a fresh current CAS.
    const client = { request }
    await login(client)
    const original = await read(client)
    const preferences = await readPreferences(client)
    const visitors: BrowserContext[] = []
    const failures: unknown[] = []
    try {
      await use({ client, visitor: context => { visitors.push(context) } })
    } catch (error) { failures.push(error) } finally {
      try {
        await write(client, original.accentPreset)
        expect(await read(client)).toMatchObject({ accentPreset: original.accentPreset })
      } catch (error) { failures.push(error) }
      try {
        await writePreferences(client, preferences.language, preferences.theme)
        expect(await readPreferences(client)).toMatchObject({ language: preferences.language, theme: preferences.theme })
      } catch (error) { failures.push(error) }
      for (const visitor of visitors) {
        try { await visitor.close() } catch (error) { failures.push(error) }
      }
    }
    if (failures.length) throw new AggregateError(failures, 'Independent accent and account fixture restoration failed')
  },
})

const labels = {
  en: { preset: 'Accent preset', iris: 'Iris', ocean: 'Ocean', forest: 'Forest', reload: 'Reload accent', save: 'Save accent', saved: 'Site accent saved.', conflict: 'The accent changed elsewhere. Your draft is kept; reload before saving again.', generalSave: 'Save settings', theme: 'Select theme', light: 'Light', create: 'Create short link' },
  zh: { preset: '强调色预设', iris: '鸢尾紫', ocean: '海洋蓝', forest: '森林绿', reload: '重新加载强调色', save: '保存强调色', saved: '站点强调色已保存。', conflict: '强调色已被其他请求修改。草稿已保留，请重新加载后再保存。', generalSave: '保存设置', theme: '选择主题', light: '浅色', create: '创建短链' },
} as const
const palette = {
  iris: { light: { primary: '92,77,222', onPrimary: '255,255,255' }, dark: { primary: '185,173,255', onPrimary: '39,32,71' } },
  ocean: { light: { primary: '7,94,174', onPrimary: '255,255,255' }, dark: { primary: '155,202,255', onPrimary: '8,51,91' } },
  forest: { light: { primary: '35,103,68', onPrimary: '255,255,255' }, dark: { primary: '141,217,163', onPrimary: '13,57,35' } },
} as const

for (const language of ['en', 'zh'] as const) {
  test('v0.34.0 real accent save, conflict and independent preferences (' + language + ')', async ({ page, browser, appearanceRecovery }, info) => {
    const text = labels[language]
    const client = appearanceRecovery.client
    await write(client, 'iris')
    const account = await writePreferences(client, language === 'en' ? 'en' : 'zh-CN', 'dark')
    await login(page)
    await page.addInitScript(value => {
      localStorage.setItem('moeurl.language', value)
      localStorage.setItem('moeurl.theme', 'system')
    }, language)
    const viewport = { width: language === 'en' ? 1280 : 390, height: language === 'en' ? 720 : 800 }
    await page.setViewportSize(viewport)
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
    await page.goto('/admin/setting')
    const editor = page.getByTestId('appearance-editor')
    const select = editor.getByRole('combobox', { name: text.preset, exact: true })
    const reload = editor.getByRole('button', { name: text.reload, exact: true })
    const save = editor.getByRole('button', { name: text.save, exact: true })
    await expect(select).toBeEnabled()
    await expect(select).toHaveValue(text.iris)
    await expectPalette(page, 'iris', 'dark', save)
    const original = await read(client)
    await choose(page, select, text.ocean)
    await expect(select).toHaveValue(text.ocean)
    expect(await read(client)).toEqual(original)
    await expectPalette(page, 'iris', 'dark', save)

    // Real keyboard selection and tab order; the focused field has a visible theme ring.
    await select.focus()
    await expect(editor.locator('.v-field--focused')).toHaveCSS('box-shadow', /^(?!none$).+/)
    await page.keyboard.press('Tab')
    await expect(reload).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(save).toBeFocused()
    await expect(save).toHaveCSS('outline-style', 'solid')
    await expect(save).toHaveCSS('outline-width', '3px')
    const firstSaved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/admin/system/appearance/update')
    await page.keyboard.press('Enter')
    const firstResponse = await firstSaved
    expect(firstResponse.request().postDataJSON()).toEqual({ accentPreset: 'ocean', expectedUpdatedAt: original.updatedAt })
    expect(firstResponse.headers()['cache-control']).toBe('no-store')
    expect((await firstResponse.json()).code).toBe(0)
    await expect(editor.getByText(text.saved, { exact: true })).toBeVisible()
    const ocean = await read(client)
    expect(ocean.accentPreset).toBe('ocean')
    expect(ocean.updatedAt).not.toBe(original.updatedAt)
    await expectPalette(page, 'ocean', 'dark', save)
    expect(await readPreferences(client)).toEqual(account)
    expect(await page.evaluate(() => localStorage.getItem('moeurl.theme'))).toBe('system')

    await choose(page, select, text.forest)
    await expect(editor.getByText(text.saved, { exact: true })).toHaveCount(0)
    await expectPalette(page, 'ocean', 'dark', save)
    await save.click()
    await expect(editor.getByText(text.saved, { exact: true })).toBeVisible()
    const forest = await read(client)
    expect(forest.accentPreset).toBe('forest')
    await expectPalette(page, 'forest', 'dark', save)

    // The actual legacy form and independent homepage no-op must not alter this resource or revision.
    const legacySaved = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/admin/system/settings/update')
    await page.getByRole('button', { name: text.generalSave, exact: true }).click()
    expect((await (await legacySaved).json()).code).toBe(0)
    expect(await read(client)).toEqual(forest)
    const home = await get<{ title: string; summary: string; updatedAt: string }>(client, '/admin/system/home-content')
    await post(client, '/admin/system/home-content/update', { title: home.title, summary: home.summary, expectedUpdatedAt: home.updatedAt })
    expect(await read(client)).toEqual(forest)

    await choose(page, select, text.ocean)
    const concurrent = await write(client, 'iris')
    const conflicted = page.waitForResponse(response => new URL(response.url()).pathname === '/api/v1/admin/system/appearance/update')
    await save.click()
    expect((await (await conflicted).json()).code).toBe(900207)
    await expect(select).toHaveValue(text.ocean)
    await expect(editor.getByText(text.conflict, { exact: true })).toBeVisible()
    expect(await read(client)).toEqual(concurrent)
    await reload.click()
    await expect(select).toHaveValue(text.iris)
    await expect(reload).toBeEnabled()
    await expect(editor.getByText(text.conflict, { exact: true })).toHaveCount(0)
    await choose(page, select, text.forest)
    await save.click()
    await expect(editor.getByText(text.saved, { exact: true })).toBeVisible()
    await expectPalette(page, 'forest', 'dark', save)
    expect(await readPreferences(client)).toEqual(account)
    expect(await page.evaluate(() => localStorage.getItem('moeurl.theme'))).toBe('system')
    await editor.scrollIntoViewIfNeeded()
    await expectNoHorizontalOverflow(page)
    await expect(select).toBeInViewport()
    await expect(save).toBeInViewport()
    const fieldBox = await select.boundingBox()
    const actionsBox = await editor.locator('.appearance__actions').boundingBox()
    expect(fieldBox).not.toBeNull()
    expect(actionsBox).not.toBeNull()
    expect(fieldBox!.y + fieldBox!.height).toBeLessThanOrEqual(actionsBox!.y)
    await page.screenshot({ path: info.outputPath('accent-' + language + '-admin.png') })

    const visitor = await browser.newContext({ baseURL: info.project.use.baseURL, viewport, colorScheme: 'light', reducedMotion: 'reduce' })
    appearanceRecovery.visitor(visitor)
    await visitor.addInitScript(value => {
      if (localStorage.getItem('moeurl.language') === null) localStorage.setItem('moeurl.language', value)
      if (localStorage.getItem('moeurl.theme') === null) localStorage.setItem('moeurl.theme', 'system')
    }, language)
    const publicPage = await visitor.newPage()
    await publicPage.goto('/')
    const create = publicPage.getByRole('button', { name: text.create, exact: true })
    await expectPalette(publicPage, 'forest', 'light', create)
    const publicResponse = await publicPage.request.get('/api/v1/system/appearance')
    expect(publicResponse.status()).toBe(200)
    expect(publicResponse.headers()['cache-control']).toBe('no-store')
    expect((await publicResponse.json()).data).toEqual({ accentPreset: 'forest' })
    await expectNoHorizontalOverflow(publicPage)
    await publicPage.screenshot({ path: info.outputPath('accent-' + language + '-public.png') })

    // System mode follows device changes; an explicit browser override survives a subsequent read/remount.
    await publicPage.emulateMedia({ colorScheme: 'dark' })
    await expectPalette(publicPage, 'forest', 'dark', create)
    expect(await publicPage.evaluate(() => localStorage.getItem('moeurl.theme'))).toBe('system')
    if (language === 'zh') await publicPage.screenshot({ path: info.outputPath('accent-zh-mobile-dark.png') })
    await publicPage.getByRole('button', { name: text.theme, exact: true }).filter({ visible: true }).first().click()
    await publicPage.getByRole('menuitemradio', { name: text.light, exact: true }).press('Enter')
    await expectPalette(publicPage, 'forest', 'light', create)
    expect(await publicPage.evaluate(() => localStorage.getItem('moeurl.theme'))).toBe('light')
    await publicPage.reload()
    await expectPalette(publicPage, 'forest', 'light', create)
    expect(await readPreferences(client)).toEqual(account)
    expect(await publicPage.evaluate(() => localStorage.getItem('moeurl.theme'))).toBe('light')
    await expectNoHorizontalOverflow(publicPage)
    // Teardown must restore through its own request fixture after this management page is gone.
    await page.close()
    expect((await read(client)).accentPreset).toBe('forest')
  })
}

/** Selects an actual Vuetify option by keyboard, not DOM mutation or a synthetic API result. */
async function choose(page: Page, select: Locator, option: string) {
  const current = await select.inputValue()
  await select.press('Enter')
  const target = page.getByRole('option', { name: option, exact: true })
  await expect(target).toBeVisible()
  // Vuetify focuses the current choice after its opening transition; wait before moving focus.
  await expect(page.getByRole('option', { name: current, exact: true })).toBeFocused()
  await target.press('Enter')
  await expect(select).toHaveValue(option)
  await expect(target).toBeHidden()
}

/** Checks the active theme tokens and the rendered primary button's foreground/background. */
async function expectPalette(page: Page, preset: Preset, mode: 'light' | 'dark', button: Locator) {
  const value = palette[preset][mode]
  const app = page.locator('.v-application')
  await expect(app).toHaveClass(new RegExp('v-theme--moeurl' + (mode === 'dark' ? 'Dark' : 'Light')))
  await expect.poll(() => app.evaluate(element => getComputedStyle(element).getPropertyValue('--v-theme-primary').replace(/\s/g, ''))).toBe(value.primary)
  await expect.poll(() => app.evaluate(element => getComputedStyle(element).getPropertyValue('--v-theme-on-primary').replace(/\s/g, ''))).toBe(value.onPrimary)
  await expect(button).toHaveCSS('background-color', 'rgb(' + value.primary.split(',').join(', ') + ')')
  await expect(button).toHaveCSS('color', 'rgb(' + value.onPrimary.split(',').join(', ') + ')')
}
async function login(client: APIClient) { await post(client, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword }) }
async function read(client: APIClient) { return get<Appearance>(client, '/admin/system/appearance') }
async function write(client: APIClient, accentPreset: Preset) {
  const current = await read(client)
  return post<Appearance>(client, '/admin/system/appearance/update', { accentPreset, expectedUpdatedAt: current.updatedAt })
}
async function readPreferences(client: APIClient) { return (await get<{ preferences: Preferences }>(client, '/user/preferences')).preferences }
async function writePreferences(client: APIClient, language: Preferences['language'], theme: Preferences['theme']) {
  const current = await readPreferences(client)
  return (await post<{ preferences: Preferences }>(client, '/user/preferences/update', { language, theme, expectedUpdatedAt: current.updatedAt })).preferences
}
async function get<T>(client: APIClient, path: string): Promise<T> {
  const response = await client.request.get('/api/v1' + path)
  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toBe('no-store')
  const payload = await response.json()
  expect(payload.code).toBe(0)
  return payload.data as T
}
async function post<T = unknown>(client: APIClient, path: string, data: unknown): Promise<T> {
  const response = await client.request.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200)
  const payload = await response.json()
  expect(payload.code).toBe(0)
  return payload.data as T
}
