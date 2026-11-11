import { randomBytes } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { APIRequestContext, Locator, Page, TestInfo } from '@playwright/test'
import QRCode from 'qrcode'
import { e2eAdminPassword, e2eAdminUsername, expectNoHorizontalOverflow } from './support'

const labels = {
  en: { target: 'Enter link', create: 'Create short link', qr: 'QR code', title: 'Short-link QR code', group: 'Error correction', levels: ['M (standard)', 'Q (higher)', 'H (highest)'], colors: ['Black and white', 'Iris blue', 'Forest green'], png: 'Download PNG', svg: 'Download SVG', close: 'Close', more: 'More actions' },
  'zh-CN': { target: '输入链接', create: '创建短链', qr: '二维码', title: '短链二维码', group: '纠错等级', levels: ['M（标准）', 'Q（较高）', 'H（最高）'], colors: ['黑白', '鸢尾蓝', '森林绿'], png: '下载 PNG', svg: '下载 SVG', close: '关闭', more: '更多操作' },
} as const
const levels = ['M', 'Q', 'H'] as const
const colors = ['#000000', '#312e81', '#14532d'] as const

for (const language of ['zh-CN', 'en'] as const) for (const width of [1280, 390, 375]) {
  test(`v0.58.0 ${language} ${width}px keeps selected QR correction in PNG and SVG at all three entrypoints`, async ({ browser }, info) => {
    const text = labels[language], ids: string[] = [], failures: unknown[] = []
    const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width, height: width === 1280 ? 900 : width === 375 ? 667 : 800 }, reducedMotion: 'reduce', colorScheme: language === 'en' ? 'light' : 'dark', hasTouch: width !== 1280, serviceWorkers: 'block' })
    const page = await context.newPage()
    try {
      await post(page.request, '/auth/login', { username: e2eAdminUsername, password: e2eAdminPassword })
      await context.addInitScript(value => localStorage.setItem('moeurl.language', value), language)
      await page.goto('/')
      await page.getByLabel(text.target, { exact: true }).fill('https://example.org/qr-correction-' + randomBytes(6).toString('hex'))
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
      await expect(dialog.getByRole('group', { name: text.group, exact: true })).toBeVisible()
      await expect(dialog.getByRole('button', { name: text.levels[0], exact: true })).toHaveAttribute('aria-pressed', 'true')
      await expect(dialog.getByRole('link', { name: text.svg, exact: true })).toBeVisible()
      const requests: string[] = []
      const observe = (request: { url(): string }) => { if (new URL(request.url()).pathname.startsWith('/api/v1/')) requests.push(request.url()) }
      page.on('request', observe)
      try {
        for (let index = 0; index < levels.length; index++) {
          const choice = dialog.getByRole('button', { name: text.levels[index], exact: true })
          await choice.focus()
          await page.keyboard.press(index === 1 ? 'Space' : 'Enter')
          await expect(choice).toHaveAttribute('aria-pressed', 'true')
          const color = dialog.getByRole('button', { name: text.colors[index], exact: true })
          await color.focus()
          await page.keyboard.press('Enter')
          await expect(choice).toHaveAttribute('aria-pressed', 'true')
          await expect(color).toHaveAttribute('aria-pressed', 'true')
          await verifyDownloads(page, dialog, text, url, link.slug, levels[index]!, colors[index]!, info, `${language}-${width}-${index}`)
          await expectNoHorizontalOverflow(page)
          // Notification close buttons may expire while the dialog remains open.
          // Verify every stable QR control by name, without hiding notifications.
          for (const name of [...text.colors, ...text.levels, text.close]) {
            if (width === 375) await dialog.getByRole('button', { name, exact: true }).focus()
            await expect(dialog.getByRole('button', { name, exact: true })).toBeInViewport({ ratio: 1 })
          }
          for (const name of [text.png, text.svg]) {
            if (width === 375) await dialog.getByRole('link', { name, exact: true }).focus()
            await expect(dialog.getByRole('link', { name, exact: true })).toBeInViewport({ ratio: 1 })
          }
          // Short screens permit normal scrolling; larger viewports retain simultaneous visibility.
          if (width === 375) {
            await page.screenshot({ path: info.outputPath(`correction-${language}-${width}-${index}-actions.png`) })
            await dialog.getByText(text.title, { exact: true }).scrollIntoViewIfNeeded()
          }
          // Download focus must not scroll the title behind the card's clipped edge.
          await expect(dialog.getByText(text.title, { exact: true })).toBeInViewport({ ratio: 1 })
          await page.screenshot({ path: info.outputPath(`correction-${language}-${width}-${index}.png`) })
        }
        expect(requests).toEqual([])
      } finally { page.off('request', observe) }
      await dialog.getByRole('button', { name: text.close, exact: true }).click()
      for (const [path, levelIndex] of [['/link', 1], ['/admin/link', 2]] as const) {
        await page.goto(path)
        const row = page.getByTestId('console-link-row').filter({ hasText: link.slug })
        await row.getByRole('button', { name: text.more, exact: true }).click()
        await page.getByRole('menuitem', { name: text.qr, exact: true }).click()
        await expect(dialog.getByRole('button', { name: text.levels[0], exact: true })).toHaveAttribute('aria-pressed', 'true')
        await expect(dialog.getByRole('button', { name: text.colors[0], exact: true })).toHaveAttribute('aria-pressed', 'true')
        await dialog.getByRole('button', { name: text.levels[levelIndex], exact: true }).click()
        await verifyDownloads(page, dialog, text, url, link.slug, levels[levelIndex], colors[0], info, `${language}-${width}-${levelIndex === 1 ? 'own' : 'admin'}`)
        await dialog.getByRole('button', { name: text.close, exact: true }).click()
      }
    } catch (error) { failures.push(error) } finally {
      for (const id of ids) { try { await post(page.request, '/admin/short-link/delete', { id }) } catch (error) { failures.push(error) } }
      await context.close()
    }
    if (failures.length) throw new AggregateError(failures, 'Correction scenario or owned link cleanup failed')
  })
}

/** Compares both actual browser images with the chosen full-URL encoding, then downloads both files. */
async function verifyDownloads(page: Page, dialog: Locator, text: (typeof labels)[keyof typeof labels], url: string, slug: string, level: 'M' | 'Q' | 'H', dark: string, info: TestInfo, key: string) {
  const svgLink = dialog.getByRole('link', { name: text.svg, exact: true })
  await expect(svgLink).toBeVisible()
  const href = (await svgLink.getAttribute('href'))!
  expect(href).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
  const svg = decodeURIComponent(href.slice(href.indexOf(',') + 1))
  const png = (await dialog.getByRole('link', { name: text.png, exact: true }).getAttribute('href'))!
  expect(png).toMatch(/^data:image\/png;base64,/)
  const expected = QRCode.create(url, { errorCorrectionLevel: level }).modules
  const matrix = Array.from(expected.data)
  const contract = await page.evaluate(async ({ svg, href, png, dark, matrix, modules }) => {
    const document = new DOMParser().parseFromString(svg, 'image/svg+xml')
    const root = document.documentElement
    if (root.localName !== 'svg' || document.querySelector('parsererror,script,foreignObject,image,text') || root.getAttribute('width') !== '320' || root.getAttribute('height') !== '320') throw new Error('Unsafe or malformed SVG')
    if (document.querySelector('path[fill]')?.getAttribute('fill')?.toLowerCase() !== '#ffffff' || document.querySelector('path[stroke]')?.getAttribute('stroke')?.toLowerCase() !== dark) throw new Error('Wrong SVG colors')
    const size = modules + 8
    if (Number(root.getAttribute('viewBox')?.split(' ')[2]) !== size) throw new Error('Wrong module geometry')
    /** Samples actual downloaded image modules independently of the production component. */
    async function check(source: string) {
      const image = new Image()
      image.src = source
      await image.decode()
      const canvas = window.document.createElement('canvas')
      canvas.width = canvas.height = 320
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(image, 0, 0, 320, 320)
      const data = ctx.getImageData(0, 0, 320, 320).data
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const offset = (Math.floor((y + 0.5) * 320 / size) * 320 + Math.floor((x + 0.5) * 320 / size)) * 4
        if (data[offset + 3] !== 255) throw new Error('Transparent module')
        const actual = data[offset] === 255 && data[offset + 1] === 255 && data[offset + 2] === 255 ? 0 : 1
        const expected = x < 4 || y < 4 || x >= size - 4 || y >= size - 4 ? 0 : matrix[(y - 4) * modules + x - 4]
        if (actual !== expected) throw new Error('Downloaded image differs from selected full-URL encoding')
      }
    }
    await Promise.all([check(href), check(png)])
    return { size, dark, opaque: true, matchesSelectedEncoding: true, quietZone: 4, safeXml: true }
  }, { svg, href, png, dark, matrix, modules: expected.size })
  for (const [name, extension, bytes] of [[text.svg, 'svg', Buffer.from(svg)], [text.png, 'png', Buffer.from(png.split(',')[1]!, 'base64')]] as const) {
    const link = dialog.getByRole('link', { name, exact: true })
    await expect(link).toHaveAttribute('download', `moeurl-${slug}.${extension}`)
    const pending = page.waitForEvent('download')
    await link.focus()
    await page.keyboard.press('Enter')
    const download = await pending
    expect(download.suggestedFilename()).toBe(`moeurl-${slug}.${extension}`)
    const path = info.outputPath(`qr-${key}.${extension}`)
    await download.saveAs(path)
    expect(await readFile(path)).toEqual(bytes)
  }
  await expect(dialog.getByRole('img', { name: text.title, exact: true })).toHaveAttribute('src', png)
  await info.attach(`qr-${key}-contract`, { body: JSON.stringify({ ...contract, level, url }), contentType: 'application/json' })
}

/** Uses the real business envelope for login and exact owned-link cleanup. */
async function post(request: APIRequestContext, path: string, data: unknown) {
  const response = await request.post('/api/v1' + path, { data })
  expect(response.status()).toBe(200)
  expect((await response.json() as { code: number }).code).toBe(0)
}
