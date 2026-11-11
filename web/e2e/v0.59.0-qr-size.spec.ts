import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, Locator, Page, TestInfo } from '@playwright/test'
import QRCode from 'qrcode'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

const labels = {
  en: { target: 'Enter link', create: 'Create short link', qr: 'QR code', title: 'Short-link QR code', size: 'Export size', border: 'Border: Standard', levels: ['M (standard)', 'Q (higher)', 'H (highest)'], colors: ['Black and white', 'Iris blue', 'Forest green'], png: 'Download PNG', svg: 'Download SVG', close: 'Close', more: 'More actions' },
  'zh-CN': { target: '输入链接', create: '创建短链', qr: '二维码', title: '短链二维码', size: '导出尺寸', border: '留白: 标准', levels: ['M（标准）', 'Q（较高）', 'H（最高）'], colors: ['黑白', '鸢尾蓝', '森林绿'], png: '下载 PNG', svg: '下载 SVG', close: '关闭', more: '更多操作' },
} as const
const widths = [320, 640, 1024] as const
const levels = ['M', 'Q', 'H'] as const
const colors = ['#000000', '#312e81', '#14532d'] as const

for (const language of ['zh-CN', 'en'] as const) for (const width of [1280, 390, 375]) {
  test(`v0.59.0 ${language} ${width}px exports selected QR dimensions at all three entrypoints`, async ({ browser }, info) => {
    const text = labels[language], ids: string[] = [], failures: unknown[] = []
    const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width, height: width === 1280 ? 900 : width === 375 ? 667 : 800 }, reducedMotion: 'reduce', colorScheme: language === 'en' ? 'light' : 'dark', hasTouch: width !== 1280, serviceWorkers: 'block' })
    const page = await context.newPage()
    const pageErrors: string[] = []
    page.on('pageerror', error => pageErrors.push(error.message))
    try {
      await post(page.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      await context.addInitScript(value => localStorage.setItem('moeurl.language', value), language)
      await page.goto('/')
      await page.getByLabel(text.target, { exact: true }).fill('https://example.org/qr-size-' + randomBytes(6).toString('hex'))
      const created = page.waitForResponse(response => response.url().endsWith('/api/v1/short-link/create') && response.request().method() === 'POST')
      await page.getByRole('button', { name: text.create, exact: true }).click()
      const response = await created
      expect(response.status()).toBe(200)
      const payload = await response.json() as { code: number; data: { shortLink: { id: string; slug: string } } }
      expect(payload.code).toBe(0)
      const link = payload.data.shortLink
      ids.push(link.id)
      const url = (await page.getByTestId('short-link-create-result').getByRole('link').first().getAttribute('href'))!
      expect(new URL(url).pathname).toBe('/' + link.slug)
      await page.getByRole('button', { name: text.qr, exact: true }).click()
      const dialog = page.getByRole('dialog', { name: text.title, exact: true })
      for (const [entry, path] of [['home', ''], ['own', '/link'], ['admin', '/admin/link']] as const) {
        if (path) {
          await page.goto(path)
          const row = page.getByTestId('console-link-row').filter({ hasText: link.slug })
          await row.getByRole('button', { name: text.more, exact: true }).click()
          await page.getByRole('menuitem', { name: text.qr, exact: true }).click()
        }
        await expect(dialog.getByRole('button', { name: `${text.size}: 320 px`, exact: true })).toHaveAttribute('aria-expanded', 'false')
        await expect(dialog.getByRole('button', { name: text.levels[0], exact: true })).toHaveAttribute('aria-pressed', 'true')
        await expect(dialog.getByRole('button', { name: text.colors[0], exact: true })).toHaveAttribute('aria-pressed', 'true')
        await expect(dialog.getByRole('link', { name: text.svg, exact: true })).toBeVisible()
        const requests: string[] = []
        const observe = (request: { url(): string }) => { if (new URL(request.url()).pathname.startsWith('/api/v1/')) requests.push(request.url()) }
        page.on('request', observe)
        try {
          const choices = entry === 'home' ? [0, 1, 2] : entry === 'own' ? [0, 1] : [0, 2]
          for (const index of choices) {
            const pixels = widths[index]!, level = levels[index]!, dark = colors[index]!
            await dialog.getByRole('button', { name: text.levels[index]!, exact: true }).click()
            await dialog.getByRole('button', { name: text.colors[index]!, exact: true }).click()
            const activator = dialog.getByRole('button', { name: new RegExp(`^${text.size}:`) })
            await activator.focus()
            await page.keyboard.press('Enter')
            const menu = page.getByRole('menu', { name: text.size, exact: true })
            await expect(menu).toBeVisible()
            if (entry === 'home' && index === 2) await page.screenshot({ path: info.outputPath(`size-${language}-${width}-menu.png`) })
            const option = menu.getByRole('menuitemradio', { name: `${pixels} px`, exact: true })
            await page.keyboard.press('ArrowDown')
            // A visible overlay can still be placing itself; await actual keyboard focus before sending Home.
            await expect.poll(() => menu.evaluate(element => element.contains(document.activeElement))).toBe(true)
            await page.keyboard.press('Home')
            await expect(menu.getByRole('menuitemradio').first()).toBeFocused()
            for (let step = 0; step < index; step++) await page.keyboard.press('ArrowDown')
            await expect(option).toBeFocused()
            await page.keyboard.press(index === 1 ? 'Space' : 'Enter')
            await expect(menu).toBeHidden()
            await expect(activator).toBeFocused()
            await expect(dialog.getByRole('link', { name: text.png, exact: true })).toBeVisible()
            await page.keyboard.press('Tab')
            await expect(dialog.getByRole('button', { name: text.border, exact: true })).toBeFocused()
            await page.keyboard.press('Tab')
            await expect(dialog.getByRole('link', { name: text.png, exact: true })).toBeFocused()
            await page.keyboard.press('Shift+Tab')
            await expect(dialog.getByRole('button', { name: text.border, exact: true })).toBeFocused()
            await page.keyboard.press('Shift+Tab')
            await expect(activator).toBeFocused()
            await page.keyboard.press('Enter')
            await expect(menu).toBeVisible()
            await page.keyboard.press('ArrowDown')
            await expect.poll(() => menu.evaluate(element => element.contains(document.activeElement))).toBe(true)
            await page.keyboard.press('Home')
            await expect(menu.getByRole('menuitemradio').first()).toBeFocused()
            await page.keyboard.press('Escape')
            await expect(menu).toBeHidden()
            await expect(activator).toBeFocused()
            await expect(activator).toHaveText(`${text.size}: ${pixels} px`)
            await expect(dialog.getByRole('button', { name: text.levels[index]!, exact: true })).toHaveAttribute('aria-pressed', 'true')
            await expect(dialog.getByRole('button', { name: text.colors[index]!, exact: true })).toHaveAttribute('aria-pressed', 'true')
            await verifyDimensions(page, dialog, text, url, link.slug, pixels, level, dark, info, `${language}-${width}-${entry}-${pixels}`)
            await expectNoHorizontalOverflow(page)
          }
          expect(requests).toEqual([])
        } finally { page.off('request', observe) }
        if (entry === 'home') {
          for (const name of [...text.colors, ...text.levels, `${text.size}: 1024 px`, text.close]) {
            if (width === 375) await dialog.getByRole('button', { name, exact: true }).focus()
            await expect(dialog.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 })
          }
          for (const name of [text.png, text.svg]) {
            const download = dialog.getByRole('link', { name, exact: true })
            if (width === 375) await download.focus()
            await expect(download).toBeInViewport({ ratio: 1 })
          }
          const png = dialog.getByRole('link', { name: text.png, exact: true })
          await png.focus(); await page.keyboard.press('Tab')
          await expect(dialog.getByRole('link', { name: text.svg, exact: true })).toBeFocused()
          await page.keyboard.press('Tab')
          await expect(dialog.getByRole('button', { name: text.close, exact: true })).toBeFocused()
          if (width === 375) {
            await page.screenshot({ path: info.outputPath(`size-${language}-${width}-actions.png`) })
            await dialog.getByText(text.title, { exact: true }).scrollIntoViewIfNeeded()
          }
          await expect(dialog.getByText(text.title, { exact: true })).toBeInViewport({ ratio: 1 })
          await page.screenshot({ path: info.outputPath(`size-${language}-${width}-top.png`) })
        }
        await dialog.getByRole('button', { name: text.close, exact: true }).click()
      }
      expect(pageErrors).toEqual([])
    } catch (error) { failures.push(error) } finally {
      for (const id of ids) { try { await post(page.request, '/admin/short-link/delete', { id }) } catch (error) { failures.push(error) } }
      await context.close()
    }
    if (failures.length) throw new AggregateError(failures, 'Size scenario or exact owned-link cleanup failed')
  })
}

/** Checks actual browser dimensions and modules, then compares both real downloaded files. */
async function verifyDimensions(page: Page, dialog: Locator, text: (typeof labels)[keyof typeof labels], url: string, slug: string, width: number, level: 'M' | 'Q' | 'H', dark: string, info: TestInfo, key: string) {
  const svgLink = dialog.getByRole('link', { name: text.svg, exact: true })
  await expect(svgLink).toHaveAttribute('href', new RegExp(`width%3D%22${width}%22`))
  const href = (await svgLink.getAttribute('href'))!, svg = decodeURIComponent(href.slice(href.indexOf(',') + 1))
  const png = (await dialog.getByRole('link', { name: text.png, exact: true }).getAttribute('href'))!
  expect(png).toMatch(/^data:image\/png;base64,/)
  const expected = QRCode.create(url, { errorCorrectionLevel: level }).modules
  const contract = await page.evaluate(async ({ svg, href, png, width, dark, matrix, modules }) => {
    const document = new DOMParser().parseFromString(svg, 'image/svg+xml'), root = document.documentElement
    if (root.localName !== 'svg' || document.querySelector('parsererror,script,foreignObject,image,text') || root.getAttribute('width') !== String(width) || root.getAttribute('height') !== String(width)) throw new Error('SVG dimensions or safety differ')
    if (document.querySelector('path[fill]')?.getAttribute('fill')?.toLowerCase() !== '#ffffff' || document.querySelector('path[stroke]')?.getAttribute('stroke')?.toLowerCase() !== dark) throw new Error('Wrong SVG colors')
    const size = modules + 8
    if (Number(root.getAttribute('viewBox')?.split(' ')[2]) !== size) throw new Error('Wrong module geometry')
    /** Samples the real full-size output rather than rescaling an incorrect image. */
    async function check(source: string) {
      const image = new Image(); image.src = source; await image.decode()
      if (image.naturalWidth !== width || image.naturalHeight !== width) throw new Error('Actual image dimensions differ')
      const canvas = window.document.createElement('canvas'); canvas.width = canvas.height = width
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0)
      const data = ctx.getImageData(0, 0, width, width).data
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const offset = (Math.floor((y + 0.5) * width / size) * width + Math.floor((x + 0.5) * width / size)) * 4
        if (data[offset + 3] !== 255) throw new Error('Transparent module')
        const actual = data[offset] === 255 && data[offset + 1] === 255 && data[offset + 2] === 255 ? 0 : 1
        const expected = x < 4 || y < 4 || x >= size - 4 || y >= size - 4 ? 0 : matrix[(y - 4) * modules + x - 4]
        if (actual !== expected) throw new Error('Output does not encode the full selected URL')
      }
    }
    await Promise.all([check(href), check(png)])
    return { width, naturalWidth: width, naturalHeight: width, matchesSelectedEncoding: true, opaque: true, quietZone: 4, safeXml: true }
  }, { svg, href, png, width, dark, matrix: Array.from(expected.data), modules: expected.size })
  const bytes = Buffer.from(png.split(',')[1]!, 'base64')
  expect(bytes.readUInt32BE(16)).toBe(width); expect(bytes.readUInt32BE(20)).toBe(width)
  for (const [name, extension, content] of [[text.png, 'png', bytes], [text.svg, 'svg', Buffer.from(svg)]] as const) {
    const link = dialog.getByRole('link', { name, exact: true })
    await expect(link).toHaveAttribute('download', `moeurl-${slug}.${extension}`)
    const pending = page.waitForEvent('download'); await link.focus(); await page.keyboard.press('Enter')
    const download = await pending
    expect(download.suggestedFilename()).toBe(`moeurl-${slug}.${extension}`)
    const path = info.outputPath(`size-${key}.${extension}`); await download.saveAs(path)
    expect(await readFile(path)).toEqual(content)
  }
  const preview = dialog.getByRole('img', { name: text.title, exact: true })
  await expect(preview).toHaveAttribute('src', png)
  await expect(preview).toHaveAttribute('width', '320')
  const box = await preview.boundingBox()
  expect(box).not.toBeNull(); expect(box!.width).toBeLessThanOrEqual(320)
  await info.attach(`size-${key}-contract`, { body: JSON.stringify({ ...contract, level, dark, url }), contentType: 'application/json' })
}

/** Keeps login and owned-link cleanup on the real business envelope. */
async function post(request: APIRequestContext, path: string, data: unknown) {
  const response = await request.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200)
  expect((await response.json() as { code: number }).code).toBe(0)
}
