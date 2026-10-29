import { expect, test } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

type Content = { title: string; summary: string; updatedAt: string }
const labels = {
  en: { title: 'Homepage title', summary: 'Homepage summary', save: 'Save homepage copy', reload: 'Reload homepage copy', generalSave: 'Save settings', saved: 'Homepage copy saved.', conflict: 'Homepage copy changed elsewhere. Your draft is kept; reload before saving again.', defaultTitle: 'Shorten links while keeping control', defaultSummary: 'Paste a target URL and create a managed short link under your own domain.' },
  zh: { title: '首页标题', summary: '首页简介', save: '保存首页文案', reload: '重新加载首页文案', generalSave: '保存设置', saved: '首页文案已保存。', conflict: '首页文案已被其他请求修改。草稿已保留，请重新加载后再保存。', defaultTitle: '把链接变短，把控制留在自己手里', defaultSummary: '粘贴目标链接，用自己的域名生成一条可管理的短链。' },
} as const

for (const language of ['en', 'zh'] as const) {
  test(`v0.33.0 real independent homepage editing and visitor fallback (${language})`, async ({ page, browser }, info) => {
    const text = labels[language]
    let original: Content | undefined
    let visitor: BrowserContext | undefined
    const failures: unknown[] = []
    try {
      await login(page)
      original = await read(page)
      await page.addInitScript(value => localStorage.setItem('moeurl.language', value), language)
      await page.setViewportSize({ width: language === 'en' ? 1280 : 390, height: language === 'en' ? 720 : 800 })
      await page.emulateMedia({ colorScheme: language === 'en' ? 'light' : 'dark', reducedMotion: 'reduce' })
      await page.goto('/admin/setting')
      const editor = page.getByTestId('home-content-editor')
      const title = editor.getByLabel(text.title, { exact: true })
      const summary = editor.getByLabel(text.summary, { exact: true })
      await expect(title).toBeEnabled()
      const custom = { title: '<b>{name}</b> links 🌲', summary: language === 'en' ? 'A small place for our links.' : '我们自己的短链空间。' }
      await title.fill(custom.title)
      await title.focus()
      await page.keyboard.press('Tab')
      await expect(summary).toBeFocused()
      await summary.fill(custom.summary)
      await page.keyboard.press('Tab')
      await expect(editor.getByRole('button', { name: text.reload, exact: true })).toBeFocused()
      await page.keyboard.press('Tab')
      await expect(editor.getByRole('button', { name: text.save, exact: true })).toBeFocused()
      const firstSave = page.waitForResponse(r => r.url().endsWith('/home-content/update'))
      await page.keyboard.press('Enter')
      expect((await (await firstSave).json()).code).toBe(0)
      await expect(editor.getByText(text.saved, { exact: true })).toBeVisible()
      const persisted = await read(page)
      expect(persisted).toMatchObject(custom)

      // A new local edit must not continue announcing the previous persisted draft as saved.
      const edited = language === 'en' ? title : summary
      await edited.fill('New unsaved homepage draft')
      await expect(editor.getByText(text.saved, { exact: true })).toHaveCount(0)
      await expect(edited).toHaveValue('New unsaved homepage draft')
      expect(await read(page)).toEqual(persisted)
      await editor.scrollIntoViewIfNeeded()
      await page.screenshot({ path: info.outputPath(`home-copy-${language}-unsaved.png`) })
      await editor.getByRole('button', { name: text.reload, exact: true }).click()
      await expect(title).toHaveValue(custom.title)
      await expect(summary).toHaveValue(custom.summary)

      // Real legacy complete save must leave both content and its independent revision untouched.
      const oldSave = page.waitForResponse(r => r.url().endsWith('/settings/update'))
      await page.getByRole('button', { name: text.generalSave, exact: true }).click()
      expect((await (await oldSave).json()).code).toBe(0)
      expect(await read(page)).toEqual(persisted)

      await title.fill('My unsaved conflict draft')
      const concurrent = await write(page, { ...custom, title: 'Other administrator' })
      const conflict = page.waitForResponse(r => r.url().endsWith('/home-content/update'))
      await editor.getByRole('button', { name: text.save, exact: true }).click()
      expect((await (await conflict).json()).code).toBe(900205)
      await expect(title).toHaveValue('My unsaved conflict draft')
      await expect(editor.getByText(text.conflict, { exact: true })).toBeVisible()
      expect(await read(page)).toEqual(concurrent)
      await editor.getByRole('button', { name: text.reload, exact: true }).click()
      await expect(title).toHaveValue(concurrent.title)
      await title.fill(custom.title)
      await editor.getByRole('button', { name: text.save, exact: true }).click()
      await expect(editor.getByText(text.saved, { exact: true })).toBeVisible()
      await expectNoHorizontalOverflow(page)
      await editor.scrollIntoViewIfNeeded()
      await expect(editor.getByRole('button', { name: text.save, exact: true })).toBeInViewport()
      await page.screenshot({ path: info.outputPath(`home-copy-${language}-admin.png`) })

      visitor = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: page.viewportSize()!, colorScheme: language === 'en' ? 'light' : 'dark', reducedMotion: 'reduce' })
      await visitor.addInitScript(value => localStorage.setItem('moeurl.language', value), language)
      const home = await visitor.newPage()
      await home.goto('/')
      await expect(home.locator('.home-page__copy h1')).toHaveText(custom.title)
      await expect(home.locator('.home-page__summary')).toHaveText(custom.summary)
      await expect(home.locator('.home-page__copy b')).toHaveCount(0)
      const publicResponse = await home.request.get('/api/v1/system/home-content')
      expect(publicResponse.headers()['cache-control']).toBe('no-store')
      expect((await publicResponse.json()).data).toEqual(custom)
      await expectNoHorizontalOverflow(home)
      await home.screenshot({ path: info.outputPath(`home-copy-${language}-public.png`) })
      await write(page, { title: '', summary: custom.summary })
      await home.reload()
      await expect(home.locator('.home-page__copy h1')).toHaveText(text.defaultTitle)
      await expect(home.locator('.home-page__summary')).toHaveText(custom.summary)
      await write(page, { title: custom.title, summary: '' })
      await home.reload()
      await expect(home.locator('.home-page__copy h1')).toHaveText(custom.title)
      await expect(home.locator('.home-page__summary')).toHaveText(text.defaultSummary)
    } catch (error) { failures.push(error) } finally {
      try { if (original) { await write(page, original); expect(await read(page)).toMatchObject({ title: original.title, summary: original.summary }) } } catch (error) { failures.push(error) }
      try { await visitor?.close() } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, 'Homepage copy scenario or exact fixture restoration failed')
  })
}

test('v0.33.1 real reconnect retains current copy while pending and falls back after failure', async ({ page, browser }, info) => {
  let original: Content | undefined
  let visitor: BrowserContext | undefined
  const releases: (() => void)[] = []
  const failures: unknown[] = []
  try {
    await login(page)
    original = await read(page)
    const first = { title: 'First successful title', summary: 'First successful summary' }
    const next = { title: 'Authoritative replacement', summary: 'Updated on the server' }
    await write(page, first)
    visitor = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 720 }, reducedMotion: 'reduce' })
    await visitor.addInitScript(() => localStorage.setItem('moeurl.language', 'en'))
    const home = await visitor.newPage()
    await home.goto('/')
    const title = home.locator('.home-page__copy h1')
    const summary = home.locator('.home-page__summary')
    await expect(title).toHaveText(first.title)
    await expect(summary).toHaveText(first.summary)

    await write(page, next)
    const pending = await holdPublicRead(home)
    releases.push(pending.release)
    await reconnect(visitor, home)
    await pending.requested
    await expect(title).toHaveText(first.title)
    await expect(summary).toHaveText(first.summary)
    await expect(home.getByRole('button', { name: 'Create short link', exact: true })).toBeVisible()
    await home.screenshot({ path: info.outputPath('home-copy-background-pending.png') })
    pending.release()
    await expect(title).toHaveText(next.title)
    await expect(summary).toHaveText(next.summary)

    await home.route('**/api/v1/system/home-content', route => route.abort('failed'), { times: 1 })
    await reconnect(visitor, home)
    await expect(title).toHaveText(labels.en.defaultTitle)
    await expect(summary).toHaveText(labels.en.defaultSummary)

    const retry = await holdPublicRead(home)
    releases.push(retry.release)
    await reconnect(visitor, home)
    await retry.requested
    await expect(title).toHaveText(labels.en.defaultTitle)
    await expect(summary).toHaveText(labels.en.defaultSummary)
    retry.release()
    await expect(title).toHaveText(next.title)
    await expect(summary).toHaveText(next.summary)

    const remount = await holdPublicRead(home)
    releases.push(remount.release)
    await home.reload({ waitUntil: 'domcontentloaded' })
    await remount.requested
    await expect(title).toHaveText(labels.en.defaultTitle)
    await expect(summary).toHaveText(labels.en.defaultSummary)
    remount.release()
    await expect(title).toHaveText(next.title)
    await expect(summary).toHaveText(next.summary)
    expect(await read(page)).toMatchObject(next)
    await expectNoHorizontalOverflow(home)
  } catch (error) { failures.push(error) } finally {
    for (const release of releases) release()
    try { await visitor?.setOffline(false) } catch (error) { failures.push(error) }
    try { if (original) { await write(page, original); expect(await read(page)).toMatchObject({ title: original.title, summary: original.summary }) } } catch (error) { failures.push(error) }
    try { await visitor?.close() } catch (error) { failures.push(error) }
  }
  if (failures.length) throw new AggregateError(failures, 'Reconnect rendering or exact fixture restoration failed')
})

/** Delays a genuine server response until assertions inspect the observable pending state. */
async function holdPublicRead(page: Page) {
  let release!: () => void
  let observed!: () => void
  const resumed = new Promise<void>(resolve => { release = resolve })
  const requested = new Promise<void>(resolve => { observed = resolve })
  await page.route('**/api/v1/system/home-content', async route => {
    const actual = await route.fetch()
    expect(actual.status()).toBe(200)
    expect((await actual.json()).code).toBe(0)
    observed()
    await resumed
    await route.fulfill({ response: actual })
  }, { times: 1 })
  return { requested, release }
}

/** Uses the browser's real connectivity events; the observed public request proves a refetch. */
async function reconnect(context: BrowserContext, page: Page) {
  await context.setOffline(true)
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false)
  await context.setOffline(false)
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true)
}

test('v0.33.0 80 and 200 unbroken codepoints wrap on mobile and leave keyboard creation usable', async ({ page, browser }, info) => {
  let original: Content | undefined
  let visitor: BrowserContext | undefined
  let linkId: string | undefined
  const failures: unknown[] = []
  try {
    await login(page)
    original = await read(page)
    const boundary = { title: 'W'.repeat(80), summary: '界'.repeat(200) }
    await write(page, boundary)
    visitor = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 390, height: 800 } })
    await visitor.addInitScript(() => localStorage.setItem('moeurl.language', 'zh'))
    const home = await visitor.newPage()
    await home.goto('/')
    await expect(home.locator('.home-page__copy h1')).toHaveText(boundary.title)
    await expect(home.locator('.home-page__summary')).toHaveText(boundary.summary)
    for (const selector of ['.home-page__copy h1', '.home-page__summary', '.home-page__tool']) {
      await expect.poll(() => home.locator(selector).evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(0)
    }
    await expectNoHorizontalOverflow(home)
    const copyBox = await home.locator('.home-page__copy').boundingBox()
    const toolBox = await home.locator('.home-page__tool').boundingBox()
    expect(copyBox!.y + copyBox!.height).toBeLessThanOrEqual(toolBox!.y)
    await home.screenshot({ path: info.outputPath('home-copy-mobile-boundary.png'), fullPage: true })

    await page.addInitScript(() => localStorage.setItem('moeurl.language', 'en'))
    await page.setViewportSize({ width: 390, height: 800 })
    await page.goto('/')
    const target = page.getByLabel('Enter link', { exact: true })
    await expect(target).toBeEnabled()
    await target.fill('https://example.com/home-copy-keyboard')
    await target.focus()
    await page.keyboard.press('Tab')
    const create = page.getByRole('button', { name: 'Create short link', exact: true })
    await expect(create).toBeFocused()
    const created = page.waitForResponse(r => r.url().endsWith('/short-link/create'))
    await page.keyboard.press('Enter')
    const result = await (await created).json()
    expect(result.code).toBe(0)
    linkId = result.data.shortLink.id
    await expect(page.getByTestId('short-link-create-result')).toBeVisible()
    await expectNoHorizontalOverflow(page)
  } catch (error) { failures.push(error) } finally {
    try { if (linkId) await post(page, '/admin/short-link/delete', { id: linkId }) } catch (error) { failures.push(error) }
    try { if (original) { await write(page, original); expect(await read(page)).toMatchObject({ title: original.title, summary: original.summary }) } } catch (error) { failures.push(error) }
    try { await visitor?.close() } catch (error) { failures.push(error) }
  }
  if (failures.length) throw new AggregateError(failures, 'Mobile homepage boundary or owned fixture cleanup failed')
})

async function login(page: Page) { await post(page, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword }) }
async function read(page: Page): Promise<Content> {
  const response = await page.request.get('/api/v1/admin/system/home-content')
  expect(response.status()).toBe(200)
  const result = await response.json()
  expect(result.code).toBe(0)
  return result.data as Content
}
async function write(page: Page, content: Pick<Content, 'title' | 'summary'>): Promise<Content> {
  const current = await read(page)
  return post<Content>(page, '/admin/system/home-content/update', { title: content.title, summary: content.summary, expectedUpdatedAt: current.updatedAt })
}
async function post<T = unknown>(page: Page, path: string, data: unknown): Promise<T> {
  const response = await page.request.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200)
  const result = await response.json()
  expect(result.code).toBe(0)
  return result.data as T
}
