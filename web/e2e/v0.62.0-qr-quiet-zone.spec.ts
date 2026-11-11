import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, Locator, Page, TestInfo } from '@playwright/test'
import QRCode from 'qrcode'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

const labels = {
  en: { target: 'Enter link', create: 'Create short link', qr: 'QR code', title: 'Short-link QR code', size: 'Export size', border: 'Border', standard: 'Standard', wide: 'Wide', levels: ['M (standard)', 'Q (higher)', 'H (highest)'], colors: ['Black and white', 'Iris blue', 'Forest green'], png: 'Download PNG', svg: 'Download SVG', close: 'Close', more: 'More actions' },
  'zh-CN': { target: '输入链接', create: '创建短链', qr: '二维码', title: '短链二维码', size: '导出尺寸', border: '留白', standard: '标准', wide: '宽', levels: ['M（标准）', 'Q（较高）', 'H（最高）'], colors: ['黑白', '鸢尾蓝', '森林绿'], png: '下载 PNG', svg: '下载 SVG', close: '关闭', more: '更多操作' },
} as const
const widths = [320, 640, 1024] as const, levels = ['M', 'Q', 'H'] as const, colors = ['#000000', '#312e81', '#14532d'] as const

// A missing border, wrong matrix/margin, or keyboard-inaccessible action must break these real checks.
for (const language of ['zh-CN', 'en'] as const) for (const width of [1280, 390, 375, 320]) {
  test(`v0.62.0 ${language} ${width}px exports both QR borders with real keyboard input at all entries`, async ({ browser }, info) => {
    const text = labels[language], failures: unknown[] = [], ids: string[] = [], pageErrors: string[] = []
    const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width, height: width === 1280 ? 900 : width === 375 ? 667 : width === 320 ? 568 : 800 }, locale: language, reducedMotion: 'reduce', colorScheme: language === 'en' ? 'light' : 'dark', serviceWorkers: 'block' })
    const page = await context.newPage()
    page.on('pageerror', error => pageErrors.push(error.message))
    try {
      await context.addInitScript(value => localStorage.setItem('moeurl.language', value), language)
      await post(page.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      await page.goto('/')
      await page.getByLabel(text.target, { exact: true }).fill('https://example.org/qr-border-' + randomBytes(6).toString('hex'))
      const pending = page.waitForResponse(response => response.url().endsWith('/api/v1/short-link/create') && response.request().method() === 'POST')
      await page.getByRole('button', { name: text.create, exact: true }).click()
      const response = await pending
      expect(response.status()).toBe(200)
      const payload = await response.json() as { code: number; data: { shortLink: { id: string; slug: string } } }
      expect(payload.code).toBe(0)
      const link = payload.data.shortLink; ids.push(link.id)
      const url = (await page.getByTestId('short-link-create-result').getByRole('link').first().getAttribute('href'))!
      expect(new URL(url).pathname).toBe('/' + link.slug)
      const dialog = page.getByRole('dialog', { name: text.title, exact: true })
      for (const [entry, path] of [['home', ''], ['own', '/link'], ['admin', '/admin/link']] as const) {
        if (path) {
          await page.goto(path)
          await page.getByTestId('console-link-row').filter({ hasText: link.slug }).getByRole('button', { name: text.more, exact: true }).click()
          await page.getByRole('menuitem', { name: text.qr, exact: true }).click()
        } else await page.getByRole('button', { name: text.qr, exact: true }).click()
        const border = dialog.getByRole('button', { name: new RegExp(`^${text.border}:`) })
        await expect(border).toHaveText(`${text.border}: ${text.standard}`)
        await expect(dialog.getByRole('button', { name: `${text.size}: 320 px`, exact: true })).toBeVisible()
        await expect(dialog.getByRole('button', { name: text.levels[0], exact: true })).toHaveAttribute('aria-pressed', 'true')
        await expect(dialog.getByRole('button', { name: text.colors[0], exact: true })).toHaveAttribute('aria-pressed', 'true')
        await expect(dialog.getByRole('link', { name: text.svg, exact: true })).toBeVisible()
        const requests: string[] = []
        const observe = (request: { url(): string }) => { if (new URL(request.url()).pathname.startsWith('/api/v1/')) requests.push(request.url()) }
        page.on('request', observe)
        try {
          for (const index of entry === 'home' ? [0, 1, 2] : entry === 'own' ? [1] : [2]) {
            const pixels = widths[index]!, level = levels[index]!, dark = colors[index]!
            await dialog.getByRole('button', { name: text.levels[index]!, exact: true }).click()
            await dialog.getByRole('button', { name: text.colors[index]!, exact: true }).click()
            const size = dialog.getByRole('button', { name: new RegExp(`^${text.size}:`) })
            await size.focus(); await page.keyboard.press('Enter')
            const sizes = page.getByRole('menu', { name: text.size, exact: true })
            await sizes.getByRole('menuitemradio', { name: `${pixels} px`, exact: true }).focus()
            await page.keyboard.press('Enter')
            await expect(sizes).toBeHidden(); await expect(size).toBeFocused()
            await page.keyboard.press('Tab'); await expect(border).toBeFocused()
            for (const margin of [4, 8] as const) {
              await border.focus(); await expect(border).toBeInViewport({ ratio: 1 }); await page.keyboard.press('Enter')
              const menu = page.getByRole('menu', { name: text.border, exact: true })
              await expect(menu).toBeVisible()
              await page.keyboard.press('ArrowDown')
              await expect.poll(() => menu.evaluate(element => element.contains(document.activeElement))).toBe(true)
              await page.keyboard.press('Home')
              if (margin === 8) await page.keyboard.press('ArrowDown')
              const option = menu.getByRole('menuitemradio', { name: margin === 4 ? text.standard : text.wide, exact: true })
              await expect(option).toBeFocused()
              await page.keyboard.press(margin === 8 ? 'Space' : 'Enter')
              await expect(menu).toBeHidden(); await expect(border).toBeFocused()
              await expect(border).toHaveText(`${text.border}: ${margin === 4 ? text.standard : text.wide}`)
              await expect(size).toHaveText(`${text.size}: ${pixels} px`)
              await expect(dialog.getByRole('button', { name: text.levels[index]!, exact: true })).toHaveAttribute('aria-pressed', 'true')
              await expect(dialog.getByRole('button', { name: text.colors[index]!, exact: true })).toHaveAttribute('aria-pressed', 'true')
              await verifyArtifacts(page, dialog, text, url, link.slug, pixels, margin, level, dark, info, `${language}-${width}-${entry}-${index}-${margin}`)
            }
          }
          expect(requests).toEqual([])
        } finally { page.off('request', observe) }
        await expectNoHorizontalOverflow(page)
        if (entry === 'home') {
          const controls = [...text.colors, ...text.levels, `${text.size}: 1024 px`, `${text.border}: ${text.wide}`, text.close]
          for (const name of controls) {
            const control = dialog.getByRole('button', { name, exact: true })
            if (width < 390) await control.focus()
            await expect(control).toBeInViewport({ ratio: 1 })
          }
          const png = dialog.getByRole('link', { name: text.png, exact: true }), svg = dialog.getByRole('link', { name: text.svg, exact: true })
          for (const link of [png, svg]) { if (width < 390) await link.focus(); await expect(link).toBeInViewport({ ratio: 1 }) }
          await border.focus(); await page.keyboard.press('Tab'); await expect(png).toBeFocused()
          await page.keyboard.press('Tab'); await expect(svg).toBeFocused()
          await page.keyboard.press('Tab'); await expect(dialog.getByRole('button', { name: text.close, exact: true })).toBeFocused()
          await page.screenshot({ path: info.outputPath(`border-${language}-${width}-actions.png`), animations: 'disabled' })
          await dialog.getByText(text.title, { exact: true }).scrollIntoViewIfNeeded()
          await expect(dialog.getByText(text.title, { exact: true })).toBeInViewport({ ratio: 1 })
          await page.screenshot({ path: info.outputPath(`border-${language}-${width}-top.png`), animations: 'disabled' })
        }
        await dialog.getByRole('button', { name: text.close, exact: true }).click()
        await expect(dialog).toBeHidden()
      }
      expect(pageErrors).toEqual([])
    } catch (error) { failures.push(error) } finally {
      for (const id of ids) { try { await post(page.request, '/admin/short-link/delete', { id }) } catch (error) { failures.push(error) } }
      try { await context.close() } catch (error) { failures.push(error) }
    }
    if (failures.length) throw new AggregateError(failures, 'QR border behavior or exact owned cleanup failed')
  })
}

/** Decodes every actual module and exact raster size, including library rounding regressions. */
async function verifyArtifacts(page: Page, dialog: Locator, text: (typeof labels)[keyof typeof labels], url: string, slug: string, width: number, margin: 4 | 8, level: 'M' | 'Q' | 'H', dark: string, info: TestInfo, key: string) {
  const svgLink = dialog.getByRole('link', { name: text.svg, exact: true })
  const expected = QRCode.create(url, { errorCorrectionLevel: level }).modules
  const fullSize = expected.size + margin * 2
  await expect(svgLink).toHaveAttribute('href', new RegExp(`viewBox%3D%220%200%20${fullSize}%20${fullSize}%22`))
  const href = (await svgLink.getAttribute('href'))!, svg = decodeURIComponent(href.slice(href.indexOf(',') + 1))
  const png = (await dialog.getByRole('link', { name: text.png, exact: true }).getAttribute('href'))!
  const contract = await page.evaluate(async ({ href, svg, png, width, margin, dark, matrix, modules }) => {
    const xml = new DOMParser().parseFromString(svg, 'image/svg+xml'), root = xml.documentElement
    const size = modules + margin * 2
    if (root.localName !== 'svg' || xml.querySelector('parsererror,script,foreignObject,image,text') || root.getAttribute('width') !== String(width) || root.getAttribute('height') !== String(width) || root.getAttribute('viewBox') !== `0 0 ${size} ${size}`) throw new Error('SVG geometry or safety differs')
    if (xml.querySelector('path[fill]')?.getAttribute('fill')?.toLowerCase() !== '#ffffff' || xml.querySelector('path[stroke]')?.getAttribute('stroke')?.toLowerCase() !== dark) throw new Error('SVG colors differ')
    for (const source of [href, png]) {
      const image = new Image(); image.src = source; await image.decode()
      if (image.naturalWidth !== width || image.naturalHeight !== width) throw new Error('Actual image dimensions differ')
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = width
      const ctx = canvas.getContext('2d')!; ctx.drawImage(image, 0, 0)
      const data = ctx.getImageData(0, 0, width, width).data
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const offset = (Math.floor((y + 0.5) * width / size) * width + Math.floor((x + 0.5) * width / size)) * 4
        const cell = x < margin || y < margin || x >= size - margin || y >= size - margin ? 0 : matrix[(y - margin) * modules + x - margin]
        const color = cell ? dark : '#ffffff'
        if (data[offset + 3] !== 255 || [0, 1, 2].some(channel => data[offset + channel] !== parseInt(color.slice(1 + channel * 2, 3 + channel * 2), 16))) throw new Error('Wrong full URL, border or opaque module color')
      }
    }
    return { width, margin, modules, exactSize: true, opaque: true, matchesFullUrl: true }
  }, { href, svg, png, width, margin, dark, matrix: Array.from(expected.data), modules: expected.size })
  const bytes = Buffer.from(png.split(',')[1]!, 'base64')
  expect(bytes.readUInt32BE(16)).toBe(width); expect(bytes.readUInt32BE(20)).toBe(width)
  for (const [name, extension, content] of [[text.png, 'png', bytes], [text.svg, 'svg', Buffer.from(svg)]] as const) {
    const link = dialog.getByRole('link', { name, exact: true })
    await expect(link).toHaveAttribute('download', `moeurl-${slug}.${extension}`)
    const pending = page.waitForEvent('download'); await link.focus(); await expect(link).toBeInViewport({ ratio: 1 }); await page.keyboard.press('Enter')
    const download = await pending, path = info.outputPath(`border-${key}.${extension}`)
    expect(download.suggestedFilename()).toBe(`moeurl-${slug}.${extension}`)
    await download.saveAs(path); expect(await readFile(path)).toEqual(content)
  }
  const preview = dialog.getByRole('img', { name: text.title, exact: true })
  await expect(preview).toHaveAttribute('src', png); await expect(preview).toHaveAttribute('width', '320')
  const box = await preview.boundingBox(); expect(box).not.toBeNull(); expect(box!.width).toBeLessThanOrEqual(320)
  await info.attach(`border-${key}-contract`, { body: JSON.stringify({ ...contract, level, dark, url }), contentType: 'application/json' })
}

/** Uses the business envelope for login and exact owned link cleanup. */
async function post(request: APIRequestContext, path: string, data: unknown) {
  const response = await request.post('/api/v1' + path, { data }); expect(response.status()).toBe(200)
  expect((await response.json() as { code: number }).code).toBe(0)
}
