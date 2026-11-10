import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, Locator, Page, TestInfo } from '@playwright/test'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

const labels = {
  en: { target: 'Enter link', create: 'Create short link', qr: 'QR code', title: 'Short-link QR code', presets: ['Black and white', 'Iris blue', 'Forest green'], levels: ['M (standard)', 'Q (higher)', 'H (highest)'], png: 'Download PNG', svg: 'Download SVG', close: 'Close', more: 'More actions' },
  'zh-CN': { target: '输入链接', create: '创建短链', qr: '二维码', title: '短链二维码', presets: ['黑白', '鸢尾蓝', '森林绿'], levels: ['M（标准）', 'Q（较高）', 'H（最高）'], png: '下载 PNG', svg: '下载 SVG', close: '关闭', more: '更多操作' },
} as const
const colors = ['#000000', '#312e81', '#14532d']

for (const language of ['zh-CN', 'en'] as const) for (const width of [1280, 390]) {
  test(`v0.57.0 ${language} ${width}px downloads safe SVG and preserves PNG at all three QR entrypoints`, async ({ browser }, info) => {
    const text = labels[language], ids: string[] = [], failures: unknown[] = []
    const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width, height: width === 1280 ? 900 : 800 }, reducedMotion: 'reduce', colorScheme: language === 'en' ? 'light' : 'dark', hasTouch: width === 390, serviceWorkers: 'block' })
    const page = await context.newPage()
    try {
      await post(page.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      await context.addInitScript(value => localStorage.setItem('moeurl.language', value), language)
      await page.goto('/')
      const target = 'https://example.org/qr-svg-' + randomBytes(6).toString('hex')
      await page.getByLabel(text.target, { exact: true }).fill(target)
      const created = page.waitForResponse(response => response.url().endsWith('/api/v1/short-link/create') && response.request().method() === 'POST')
      await page.getByRole('button', { name: text.create, exact: true }).click()
      const response = await created
      expect(response.status()).toBe(200)
      const payload = await response.json() as { code: number; data: { shortLink: { id: string; slug: string } } }
      expect(payload.code).toBe(0)
      const link = payload.data.shortLink
      ids.push(link.id)
      const publicUrl = (await page.getByTestId('short-link-create-result').getByRole('link').first().getAttribute('href'))!
      expect(publicUrl).toMatch(new RegExp(`^https?://[^/]+/${link.slug}$`))
      await page.getByRole('button', { name: text.qr, exact: true }).click()
      const dialog = page.getByRole('dialog', { name: text.title, exact: true })
      await expect(dialog.getByText(publicUrl, { exact: true })).toBeVisible()
      await expect(dialog.getByRole('link', { name: text.svg, exact: true })).toBeVisible()

      const apiRequests: string[] = []
      const observe = (request: { url(): string }) => { if (new URL(request.url()).pathname.startsWith('/api/v1/')) apiRequests.push(request.url()) }
      page.on('request', observe)
      try {
        for (let index = 0; index < 3; index++) {
          const preset = dialog.getByRole('button', { name: text.presets[index], exact: true })
          await preset.focus()
          await page.keyboard.press(index === 1 ? 'Space' : 'Enter')
          await expect(preset).toHaveAttribute('aria-pressed', 'true')
          await verifyDownloads(page, dialog, text, link.slug, colors[index]!, info, `${language}-${width}-${index}`)
          await expectNoHorizontalOverflow(page)
          // Check the nine QR controls without collecting expiring notification buttons.
          for (const name of [...text.presets, ...text.levels, text.close]) {
            await expect(dialog.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 })
          }
          for (const name of [text.png, text.svg]) {
            await expect(dialog.getByRole('link', { name, exact: true })).toBeInViewport({ ratio: 1 })
          }
          await expect(dialog.getByText(text.title, { exact: true })).toBeInViewport({ ratio: 1 })
          await page.screenshot({ path: info.outputPath(`svg-${language}-${width}-${index}.png`) })
        }
        expect(apiRequests).toEqual([])
      } finally { page.off('request', observe) }
      await dialog.getByRole('button', { name: text.close, exact: true }).click()

      for (const path of ['/link', '/admin/link']) {
        await page.goto(path)
        await openListQr(page, link.slug, text.more, text.qr)
        await expect(dialog.getByRole('button', { name: text.presets[0], exact: true })).toHaveAttribute('aria-pressed', 'true')
        await expect(dialog.getByText(publicUrl, { exact: true })).toBeVisible()
        await verifyDownloads(page, dialog, text, link.slug, colors[0]!, info, `${language}-${width}-${path === '/link' ? 'own' : 'admin'}`)
        await dialog.getByRole('button', { name: text.close, exact: true }).click()
      }
    } catch (error) { failures.push(error) } finally {
      for (const id of ids) { try { await post(page.request, '/admin/short-link/delete', { id }) } catch (error) { failures.push(error) } }
      await context.close()
    }
    if (failures.length) throw new AggregateError(failures, 'SVG scenario or owned link cleanup failed')
  })
}

/** Verifies actual downloaded SVG bytes, safe XML, module parity and original PNG. */
async function verifyDownloads(page: Page, dialog: Locator, text: (typeof labels)[keyof typeof labels], slug: string, dark: string, info: TestInfo, key: string) {
  const svgLink = dialog.getByRole('link', { name: text.svg, exact: true })
  await expect(svgLink).toBeVisible()
  await expect(svgLink).toHaveAttribute('download', `moeurl-${slug}.svg`)
  const href = (await svgLink.getAttribute('href'))!
  expect(href).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
  const svg = decodeURIComponent(href.slice(href.indexOf(',') + 1))
  const png = (await dialog.getByRole('link', { name: text.png, exact: true }).getAttribute('href'))!
  expect(png).toMatch(/^data:image\/png;base64,/)
  const contract = await page.evaluate(async ({ svg, href, png, dark }) => {
    const document = new DOMParser().parseFromString(svg, 'image/svg+xml')
    const root = document.documentElement
    if (root.localName !== 'svg' || document.querySelector('parsererror,script,foreignObject,image,text') || root.getAttribute('width') !== '320' || root.getAttribute('height') !== '320') throw new Error('Unsafe or malformed SVG')
    if (document.querySelector('path[fill]')?.getAttribute('fill')?.toLowerCase() !== '#ffffff' || document.querySelector('path[stroke]')?.getAttribute('stroke')?.toLowerCase() !== dark) throw new Error('Wrong SVG colors')
    const size = Number(root.getAttribute('viewBox')?.split(' ')[2])
    if (!Number.isInteger(size) || size < 29) throw new Error('Wrong SVG module geometry')
    /** Samples each module centre after the browser decodes the actual image. */
    async function modules(url: string) {
      const image = new Image()
      image.src = url
      await image.decode()
      const canvas = window.document.createElement('canvas')
      canvas.width = canvas.height = 320
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(image, 0, 0, 320, 320)
      const data = ctx.getImageData(0, 0, 320, 320).data
      return Array.from({ length: size * size }, (_, n) => {
        const x = Math.floor((n % size + 0.5) * 320 / size)
        const y = Math.floor((Math.floor(n / size) + 0.5) * 320 / size)
        const offset = (y * 320 + x) * 4
        if (data[offset + 3] !== 255) throw new Error('Transparent module')
        return data[offset] === 255 && data[offset + 1] === 255 && data[offset + 2] === 255 ? '0' : '1'
      })
    }
    const [svgModules, pngModules] = await Promise.all([modules(href), modules(png)])
    if (svgModules.join('') !== pngModules.join('')) throw new Error('SVG differs from current PNG')
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if ((x < 4 || y < 4 || x >= size - 4 || y >= size - 4) && svgModules[y * size + x] !== '0') throw new Error('Missing four-module quiet zone')
    }
    return { size, dark, opaque: true, sameModules: true, quietZone: 4, safeXml: true }
  }, { svg, href, png, dark })
  const downloaded = page.waitForEvent('download')
  await svgLink.focus()
  await page.keyboard.press('Enter')
  const download = await downloaded
  expect(download.suggestedFilename()).toBe(`moeurl-${slug}.svg`)
  const path = info.outputPath(`qr-${key}.svg`)
  await download.saveAs(path)
  expect(await readFile(path, 'utf8')).toBe(svg)
  await expect(dialog.getByRole('img', { name: text.title, exact: true })).toHaveAttribute('src', png)
  await info.attach(`qr-${key}-contract`, { body: JSON.stringify(contract), contentType: 'application/json' })
}

/** Uses the real business envelope for login and exact owned-link cleanup. */
async function post(request: APIRequestContext, path: string, data: unknown) {
  const response = await request.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200)
  const payload = await response.json() as { code: number }
  expect(payload.code).toBe(0)
}

/** Opens the current row's real public QR action. */
async function openListQr(page: Page, slug: string, more: string, qr: string) {
  const row = page.getByTestId('console-link-row').filter({ hasText: slug })
  await row.getByRole('button', { name: more, exact: true }).click()
  await page.getByRole('menuitem', { name: qr, exact: true }).click()
}
