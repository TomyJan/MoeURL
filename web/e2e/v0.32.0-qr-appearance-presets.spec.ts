import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

const labels = {
  en: { target: 'Enter link', create: 'Create short link', qr: 'QR code', title: 'Short-link QR code', group: 'QR appearance', presets: ['Black and white', 'Iris blue', 'Forest green'], download: 'Download PNG', close: 'Close', more: 'More actions' },
  zh: { target: '输入链接', create: '创建短链', qr: '二维码', title: '短链二维码', group: '二维码外观', presets: ['黑白', '鸢尾蓝', '森林绿'], download: '下载 PNG', close: '关闭', more: '更多操作' },
} as const
const colors = ['0,0,0,255', '49,46,129,255', '20,83,45,255']

for (const language of ['en', 'zh'] as const) {
  test(`v0.32.0 local QR appearances, downloads, and three real entrypoints (${language})`, async ({ page }, info) => {
    const text = labels[language]
    const ids: string[] = []
    const errors: unknown[] = []
    try {
      await post(page, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      await page.addInitScript(value => localStorage.setItem('moeurl.language', value), language)
      await page.setViewportSize({ width: language === 'en' ? 1280 : 390, height: language === 'en' ? 720 : 800 })
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: language === 'en' ? 'light' : 'dark' })
      await page.goto('/')
      const target = 'https://example.com/qr-preset-' + randomBytes(6).toString('hex')
      await page.getByLabel(text.target, { exact: true }).fill(target)
      const created = page.waitForResponse(response => response.url().endsWith('/api/v1/short-link/create') && response.request().method() === 'POST')
      await page.getByRole('button', { name: text.create, exact: true }).click()
      const response = await created
      expect(response.status()).toBe(200)
      const result = await response.json() as { code: number; data: { shortLink: { id: string; slug: string } } }
      expect(result.code).toBe(0)
      ids.push(result.data.shortLink.id)
      const slug = result.data.shortLink.slug
      const createdUrl = await page.getByTestId('short-link-create-result').getByRole('link').first().getAttribute('href')
      expect(createdUrl).toMatch(new RegExp(`^https?://[^/]+/${slug}$`))
      await page.getByRole('button', { name: language === 'en' ? 'Dismiss notification' : '关闭提示', exact: true }).click()
      await expect(page.locator('[data-sonner-toast]')).toHaveCount(0)
      await page.getByRole('button', { name: text.qr, exact: true }).click()
      const dialog = page.getByRole('dialog', { name: text.title, exact: true })
      const group = dialog.getByRole('group', { name: text.group, exact: true })
      await expect(group.getByRole('button')).toHaveCount(3)
      await expect(dialog.getByText(createdUrl!, { exact: true })).toBeVisible()
      const apiRequests: string[] = []
      const observe = (request: { url(): string }) => { if (new URL(request.url()).pathname.startsWith('/api/v1/')) apiRequests.push(request.url()) }
      page.on('request', observe)
      try {
        for (let index = 0; index < 3; index += 1) {
          const button = group.getByRole('button', { name: text.presets[index], exact: true })
          if (index === 0) await button.focus()
          else {
            await page.keyboard.press('Tab')
            await expect(button).toBeFocused()
            await button.press(index === 1 ? 'Space' : 'Enter')
          }
          await expect(button).toHaveAttribute('aria-pressed', 'true')
          await expect(group.locator('[aria-pressed="true"]')).toHaveCount(1)
          const image = dialog.getByRole('img', { name: text.title, exact: true })
          await expect(image).toBeVisible()
          await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth)).toBe(320)
          const pixels = await readPixels(image)
          expect(pixels.width).toBe(320)
          expect(pixels.height).toBe(320)
          expect(pixels.colors.sort()).toEqual([colors[index]!, '255,255,255,255'].sort())
          // The top-left finder's outer bar spans seven modules. Its white border must span four.
          for (const border of [pixels.left, pixels.top, pixels.right, pixels.bottom]) expect(border).toBeGreaterThanOrEqual(4 * pixels.finderBar / 7 - 1)
          const preview = await image.getAttribute('src')
          await expect(dialog.getByRole('link', { name: text.download, exact: true })).toHaveAttribute('href', preview!)
          const downloaded = page.waitForEvent('download')
          await dialog.getByRole('link', { name: text.download, exact: true }).click()
          const download = await downloaded
          expect(download.suggestedFilename()).toBe(`moeurl-${slug}.png`)
          const downloadedPath = info.outputPath(`qr-${language}-${index}-download.png`)
          await download.saveAs(downloadedPath)
          expect(await readFile(downloadedPath)).toEqual(Buffer.from(preview!.split(',')[1]!, 'base64'))
          await expectNoHorizontalOverflow(page)
          await expectControlsInViewport(page, dialog)
          await page.screenshot({ path: info.outputPath(`qr-${language}-${index}-screen.png`) })
          await info.attach(`qr-${language}-${index}-pixels`, { body: JSON.stringify(pixels), contentType: 'application/json' })
          // Download clicks move focus; resume Tab navigation from the selected appearance.
          await button.focus()
        }
        expect(apiRequests).toEqual([])
      } finally { page.off('request', observe) }
      await dialog.getByRole('button', { name: text.close, exact: true }).click()
      await page.getByRole('button', { name: text.qr, exact: true }).click()
      await expect(dialog.getByRole('button', { name: text.presets[0], exact: true })).toHaveAttribute('aria-pressed', 'true')
      await dialog.getByRole('button', { name: text.close, exact: true }).click()

      const second = await post<{ shortLink: { id: string; slug: string } }>(page, '/short-link/create', { targetUrl: target + '-second' })
      ids.push(second.shortLink.id)
      for (const path of ['/link', '/admin/link']) {
        await page.goto(path)
        await openListQr(page, slug, text.more, text.qr)
        await expect(dialog.getByText(createdUrl!, { exact: true })).toBeVisible()
        await expect(dialog.getByRole('button', { name: text.presets[0], exact: true })).toHaveAttribute('aria-pressed', 'true')
        await dialog.getByRole('button', { name: text.presets[2], exact: true }).click()
        await expect(dialog.getByRole('img', { name: text.title, exact: true })).toBeVisible()
        expect((await readPixels(dialog.getByRole('img', { name: text.title, exact: true }))).colors).toContain(colors[2])
        await dialog.getByRole('button', { name: text.close, exact: true }).click()
        await openListQr(page, second.shortLink.slug, text.more, text.qr)
        await expect(dialog.getByRole('button', { name: text.presets[0], exact: true })).toHaveAttribute('aria-pressed', 'true')
        await expect(dialog.getByText(new URL('/' + second.shortLink.slug, createdUrl!).href, { exact: true })).toBeVisible()
        await expect(dialog.getByRole('link', { name: text.download, exact: true })).toHaveAttribute('download', `moeurl-${second.shortLink.slug}.png`)
        await dialog.getByRole('button', { name: text.close, exact: true }).click()
      }
    } catch (error) { errors.push(error) } finally {
      for (const id of ids) { try { await post(page, '/admin/short-link/delete', { id }) } catch (error) { errors.push(error) } }
    }
    if (errors.length) throw new AggregateError(errors, 'QR appearance scenario or owned link cleanup failed')
  })
}

// A missing wrap rule or clipped dialog actions must fail on a real long public URL.
test('v0.32.0 long public QR URL preserves mobile layout and keyboard access', async ({ page }, info) => {
  const errors: unknown[] = []
  let domain: { id: string; host: string; displayName: string; updatedAt: string } | undefined
  let linkId: string | undefined
  try {
    await post(page, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
    const origin = 'https://' + [randomBytes(6).toString('hex'), 'a'.repeat(50), 'b'.repeat(50), 'c'.repeat(50), 'd'.repeat(50), 'example'].join('.')
    domain = (await post<{ domain: NonNullable<typeof domain> }>(page, '/admin/domain/create', { host: origin, displayName: 'QR long public origin', enabled: true, allowedGroups: ['admin'] })).domain
    const created = await post<{ shortLink: { id: string; slug: string; url: string } }>(page, '/short-link/create', { targetUrl: 'https://example.com/qr-long-origin', domainId: domain.id })
    linkId = created.shortLink.id
    const publicUrl = origin + '/' + created.shortLink.slug
    expect(created.shortLink.url).toBe(publicUrl)
    expect(new URL(publicUrl).hostname.length).toBeGreaterThan(200)
    await page.addInitScript(() => localStorage.setItem('moeurl.language', 'zh'))
    await page.setViewportSize({ width: 390, height: 800 })
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' })
    await page.goto('/link')
    await openListQr(page, created.shortLink.slug, labels.zh.more, labels.zh.qr)
    const dialog = page.getByRole('dialog', { name: labels.zh.title, exact: true })
    const url = dialog.getByText(publicUrl, { exact: true })
    await expect(url).toBeVisible()
    expect(await url.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await expectNoHorizontalOverflow(page)
    const group = dialog.getByRole('group', { name: labels.zh.group, exact: true })
    await group.getByRole('button', { name: labels.zh.presets[0], exact: true }).focus()
    await page.keyboard.press('Tab')
    const indigo = group.getByRole('button', { name: labels.zh.presets[1], exact: true })
    await expect(indigo).toBeFocused()
    await page.keyboard.press('Space')
    await expect(indigo).toHaveAttribute('aria-pressed', 'true')
    const image = dialog.getByRole('img', { name: labels.zh.title, exact: true })
    await expect(image).toBeVisible()
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth)).toBe(320)
    const pixels = await readPixels(image)
    expect(pixels.colors.sort()).toEqual([colors[1]!, '255,255,255,255'].sort())
    for (const border of [pixels.left, pixels.top, pixels.right, pixels.bottom]) expect(border).toBeGreaterThanOrEqual(4 * pixels.finderBar / 7 - 1)
    await page.keyboard.press('Tab')
    await expect(group.getByRole('button', { name: labels.zh.presets[2], exact: true })).toBeFocused()
    await page.keyboard.press('Tab')
    const download = dialog.getByRole('link', { name: labels.zh.download, exact: true })
    await expect(download).toBeFocused()
    await expect(download).toBeInViewport({ ratio: 1 })
    const downloaded = page.waitForEvent('download')
    await page.keyboard.press('Enter')
    const artifact = await downloaded
    expect(artifact.suggestedFilename()).toBe(`moeurl-${created.shortLink.slug}.png`)
    const artifactPath = info.outputPath('qr-long-url-download.png')
    await artifact.saveAs(artifactPath)
    expect(await readFile(artifactPath)).toEqual(Buffer.from((await image.getAttribute('src'))!.split(',')[1]!, 'base64'))
    await page.keyboard.press('Tab')
    const close = dialog.getByRole('button', { name: labels.zh.close, exact: true })
    await expect(close).toBeFocused()
    await expect(close).toBeInViewport({ ratio: 1 })
    await page.screenshot({ path: info.outputPath('qr-long-url-mobile-screen.png') })
    await info.attach('qr-long-url-contract', { body: JSON.stringify({ publicUrl, pixels, viewport: page.viewportSize() }), contentType: 'application/json' })
    await page.keyboard.press('Enter')
    await expect(dialog).not.toBeVisible()
  } catch (error) { errors.push(error) } finally {
    if (linkId) { try { await post(page, '/admin/short-link/delete', { id: linkId }) } catch (error) { errors.push(error) } }
    if (domain) {
      try {
        const response = await page.request.get('/api/v1/admin/domain/list')
        expect(response.status()).toBe(200)
        const payload = await response.json() as { code: number; data: { items: Array<NonNullable<typeof domain>> } }
        expect(payload.code).toBe(0)
        const current = payload.data.items.find(item => item.id === domain!.id)!
        await post(page, '/admin/domain/update', { id: current.id, host: current.host, displayName: current.displayName, enabled: false, allowedGroups: ['admin'], expectedUpdatedAt: current.updatedAt })
        // Soft-deleted links retain their immutable domain until this owned Compose DB is destroyed.
      } catch (error) { errors.push(error) }
    }
  }
  if (errors.length) throw new AggregateError(errors, 'Long public QR scenario or owned fixture cleanup failed')
})

/** Checks the real business envelope during fixture setup and owned cleanup. */
async function post<T = unknown>(page: Page, path: string, data: unknown): Promise<T> {
  const response = await page.request.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200)
  const payload = await response.json() as { code: number; data: T }
  expect(payload.code).toBe(0)
  return payload.data
}

/** Opens the shared dialog through an actual list row's public QR action. */
async function openListQr(page: Page, slug: string, more: string, qr: string) {
  const row = page.getByTestId('console-link-row').filter({ hasText: slug })
  await row.getByRole('button', { name: more, exact: true }).click()
  await page.getByRole('menuitem', { name: qr, exact: true }).click()
}

/** Reads actual decoded PNG pixels, including opacity and the finder's white border. */
async function readPixels(image: Locator) {
  return image.evaluate((element: HTMLImageElement) => {
    const canvas = document.createElement('canvas')
    canvas.width = element.naturalWidth
    canvas.height = element.naturalHeight
    const context = canvas.getContext('2d')!
    context.drawImage(element, 0, 0)
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
    const colors = new Set<string>()
    let left = canvas.width, top = canvas.height, maxX = 0, maxY = 0
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        const offset = (y * canvas.width + x) * 4
        const pixel = Array.from(data.slice(offset, offset + 4)).join(',')
        colors.add(pixel)
        if (pixel !== '255,255,255,255') { left = Math.min(left, x); top = Math.min(top, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y) }
      }
    }
    let end = left
    while (end < canvas.width && data[(top * canvas.width + end) * 4] !== 255) end += 1
    return { width: canvas.width, height: canvas.height, colors: [...colors], left, top, right: canvas.width - maxX - 1, bottom: canvas.height - maxY - 1, finderBar: end - left }
  })
}

/** Verifies all dialog actions are visible in the current real viewport. */
async function expectControlsInViewport(page: Page, dialog: Locator) {
  const viewport = page.viewportSize()!
  for (const control of await dialog.locator('button,a').all()) {
    const box = await control.boundingBox()
    expect(box).not.toBeNull()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
  }
}
