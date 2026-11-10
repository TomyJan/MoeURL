import { fireEvent, render, screen } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import QRCode from 'qrcode'
import { nextTick } from 'vue'

import ShortLinkQrDialog from './ShortLinkQrDialog.vue'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

const publicUrl = 'https://go.example.com/abc123'
const colors = [['classic', '#000000'], ['indigo', '#312E81'], ['forest', '#14532D']] as const
const pngWriter = QRCode.toDataURL
const svgWriter = QRCode.toString

/** Keeps the actual dialog and encoder; only layout components are substituted. */
function mountDialog(props: Partial<{ open: boolean; slug: string; url: string }> = {}) {
  return render(ShortLinkQrDialog, {
    props: { open: true, slug: 'abc123', url: publicUrl, ...props },
    global: { stubs: componentStubs },
  })
}

/** Reads current download bytes without injecting the downloaded XML. */
async function svgDownload() {
  const link = await screen.findByRole('link', { name: 'shortLinkQr.downloadSvg' })
  const href = link.getAttribute('href')!
  expect(href).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
  return { link, xml: decodeURIComponent(href.slice(href.indexOf(',') + 1)) }
}

/** Uses the user-visible grade control rather than manipulating component internals. */
async function choose(level: 'M' | 'Q' | 'H') {
  const button = screen.getByRole('button', { name: `shortLinkQr.correctionLevels.${level}` })
  await fireEvent.click(button)
  expect(button.getAttribute('aria-pressed')).toBe('true')
}

/** Settles only explicitly released promises and the real Vue watcher. */
async function flushGeneration() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

/** Allows deterministic timing while preserving the real PNG bytes on release. */
function pngEncoder() {
  return vi.spyOn(QRCode as unknown as { toDataURL: (text: string, options?: unknown) => Promise<string> }, 'toDataURL')
}

/** Replaces only SVG completion for state-isolation cases. */
function svgEncoder() {
  return vi.spyOn(QRCode as unknown as { toString: (text: string, options?: unknown) => Promise<string> }, 'toString')
}

describe('ShortLinkQrDialog correction levels', () => {
  afterEach(() => { vi.restoreAllMocks() })

  // Changing the legacy default must change its actual downloaded bytes.
  it('keeps the original M downloads as the default', async () => {
    mountDialog()
    const actual = await svgDownload()
    expect(actual.xml).toBe(await svgWriter(publicUrl, {
      type: 'svg', width: 320, margin: 4, errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#FFFFFF' },
    }))
    expect(screen.getByRole('link', { name: 'shortLinkQr.download' }).getAttribute('href')).toBe(await pngWriter(publicUrl, {
      width: 320, margin: 4, errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#FFFFFF' },
    }))
    expect(screen.getByRole('button', { name: 'shortLinkQr.correctionLevels.M' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('group', { name: 'shortLinkQr.correction' })).toBeTruthy()
  })

  // Keeping either encoder at M, losing the current color, or changing the payload must fail.
  it.each(['M', 'Q', 'H'] as const)('downloads actual %s PNG and SVG for all three colors', async level => {
    const view = mountDialog()
    await choose(level)
    for (const [preset, dark] of colors) {
      await fireEvent.click(screen.getByRole('button', { name: `shortLinkQr.presets.${preset}` }))
      const actual = await svgDownload()
      expect(actual.xml).toBe(await svgWriter(publicUrl, {
        type: 'svg', width: 320, margin: 4, errorCorrectionLevel: level,
        color: { dark, light: '#FFFFFF' },
      }))
      const png = screen.getByRole('link', { name: 'shortLinkQr.download' })
      expect(png.getAttribute('href')).toBe(await pngWriter(publicUrl, {
        width: 320, margin: 4, errorCorrectionLevel: level,
        color: { dark, light: '#FFFFFF' },
      }))
      expect(png.getAttribute('download')).toBe('moeurl-abc123.png')
      expect(actual.link.getAttribute('download')).toBe('moeurl-abc123.svg')
      const svg = new DOMParser().parseFromString(actual.xml, 'image/svg+xml')
      expect(svg.querySelector('parsererror, script, foreignObject')).toBeNull()
      expect(svg.documentElement.getAttribute('width')).toBe('320')
      expect(svg.querySelector('path[fill]')?.getAttribute('fill')?.toLowerCase()).toBe('#ffffff')
      expect(svg.querySelector('path[stroke]')?.getAttribute('stroke')?.toLowerCase()).toBe(dark.toLowerCase())
      expect(view.container.querySelector('svg')).toBeNull()
      expect(screen.getByRole('button', { name: `shortLinkQr.correctionLevels.${level}` }).getAttribute('aria-pressed')).toBe('true')
    }
  })

  // Resetting the other selector would silently download a different choice.
  it('preserves color when changing correction and correction when changing color', async () => {
    mountDialog()
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkQr.presets.forest' }))
    await svgDownload()
    await choose('H')
    await svgDownload()
    expect(screen.getByRole('button', { name: 'shortLinkQr.presets.forest' }).getAttribute('aria-pressed')).toBe('true')
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkQr.presets.indigo' }))
    const actual = await svgDownload()
    expect(screen.getByRole('button', { name: 'shortLinkQr.correctionLevels.H' }).getAttribute('aria-pressed')).toBe('true')
    expect(actual.xml).toBe(await svgWriter(publicUrl, {
      type: 'svg', width: 320, margin: 4, errorCorrectionLevel: 'H',
      color: { dark: '#312E81', light: '#FFFFFF' },
    }))
  })

  // A new link or reopened dialog must not inherit a prior link's local selections.
  it.each(['slug', 'url', 'reopen'] as const)('restores classic/M on %s identity change', async change => {
    const view = mountDialog()
    await choose('H')
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkQr.presets.forest' }))
    const old = (await svgDownload()).xml
    let url = publicUrl
    if (change === 'slug') await view.rerender({ slug: 'next456' })
    if (change === 'url') { url = 'https://second.example.org/abc123'; await view.rerender({ url }) }
    if (change === 'reopen') {
      await view.rerender({ open: false })
      expect(screen.queryByRole('link', { name: 'shortLinkQr.downloadSvg' })).toBeNull()
      await view.rerender({ open: true })
    }
    const actual = await svgDownload()
    expect(actual.xml).not.toBe(old)
    expect(actual.xml).toBe(await svgWriter(url, {
      type: 'svg', width: 320, margin: 4, errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#FFFFFF' },
    }))
    expect(screen.getByRole('button', { name: 'shortLinkQr.correctionLevels.M' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'shortLinkQr.presets.classic' }).getAttribute('aria-pressed')).toBe('true')
    expect(actual.link.getAttribute('download')).toBe(change === 'slug' ? 'moeurl-next456.svg' : 'moeurl-abc123.svg')
  })

  // Removing PNG's generation check would publish a stale link/error or end new loading.
  it.each(['success', 'failure'] as const)('ignores stale PNG %s/finally after changing grade', async outcome => {
    const first = createDeferred<string>(), second = createDeferred<string>()
    pngEncoder().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    mountDialog()
    await screen.findByRole('progressbar')
    await choose('H')
    await screen.findByRole('progressbar')
    if (outcome === 'success') first.resolve(await pngWriter(publicUrl))
    else first.reject(new Error('retired PNG'))
    await flushGeneration()
    expect(screen.getByRole('progressbar')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'shortLinkQr.download' })).toBeNull()
    expect(screen.queryByText('shortLinkQr.generateFailed')).toBeNull()
    second.resolve(await pngWriter(publicUrl, { errorCorrectionLevel: 'H' }))
    expect((await svgDownload()).xml).toBe(await svgWriter(publicUrl, {
      type: 'svg', width: 320, margin: 4, errorCorrectionLevel: 'H',
      color: { dark: '#000000', light: '#FFFFFF' },
    }))
  })

  // Removing SVG's generation check would publish stale XML/errors or end new loading.
  it.each(['success', 'failure'] as const)('ignores stale SVG %s/finally after changing grade', async outcome => {
    const first = createDeferred<string>(), second = createDeferred<string>()
    svgEncoder().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    mountDialog()
    await screen.findByText('shortLinkQr.svgGenerating')
    await choose('H')
    await screen.findByText('shortLinkQr.svgGenerating')
    if (outcome === 'success') first.resolve('<svg xmlns="http://www.w3.org/2000/svg" id="retired"/>')
    else first.reject(new Error('retired SVG'))
    await flushGeneration()
    expect(screen.getByText('shortLinkQr.svgGenerating')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'shortLinkQr.downloadSvg' })).toBeNull()
    expect(screen.queryByText('shortLinkQr.svgGenerateFailed')).toBeNull()
    second.resolve(await svgWriter(publicUrl, { type: 'svg', errorCorrectionLevel: 'H' }))
    expect((await svgDownload()).xml).not.toContain('retired')
  })

  // Awaiting the H SVG would incorrectly hide a usable H PNG.
  it('keeps current PNG usable during independent high-grade SVG preparation', async () => {
    const pending = createDeferred<string>()
    svgEncoder().mockImplementationOnce((text, options) => svgWriter(text, options as QRCode.QRCodeToStringOptions)).mockReturnValueOnce(pending.promise)
    mountDialog()
    await svgDownload()
    await choose('H')
    await screen.findByText('shortLinkQr.svgGenerating')
    expect(screen.getByRole('link', { name: 'shortLinkQr.download' }).getAttribute('href')).toBe(await pngWriter(publicUrl, {
      width: 320, margin: 4, errorCorrectionLevel: 'H', color: { dark: '#000000', light: '#FFFFFF' },
    }))
    expect(screen.queryByRole('link', { name: 'shortLinkQr.downloadSvg' })).toBeNull()
    pending.resolve(await svgWriter(publicUrl, { type: 'svg', errorCorrectionLevel: 'H' }))
    await svgDownload()
  })

  // An SVG-only failure must not clear PNG, and an explicit different grade can retry.
  it('retains high-grade PNG after SVG failure and recovers on explicit grade selection', async () => {
    svgEncoder().mockImplementationOnce((text, options) => svgWriter(text, options as QRCode.QRCodeToStringOptions)).mockRejectedValueOnce(new Error('SVG unavailable'))
    mountDialog()
    await svgDownload()
    await choose('H')
    await screen.findByText('shortLinkQr.svgGenerateFailed')
    expect(screen.getByRole('link', { name: 'shortLinkQr.download' }).getAttribute('href')).toMatch(/^data:image\/png/)
    expect(screen.queryByText('shortLinkQr.generateFailed')).toBeNull()
    await choose('Q')
    await svgDownload()
    expect(screen.queryByText('shortLinkQr.svgGenerateFailed')).toBeNull()
  })

  // Truncating the payload or silently falling back to M would make H appear successful.
  it('shows real high-grade capacity failure without truncation and recovers only on explicit M', async () => {
    const url = 'https://go.example.com/' + 'a'.repeat(1600)
    mountDialog({ url })
    await svgDownload()
    await choose('H')
    expect(await screen.findByText('shortLinkQr.generateFailed')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'shortLinkQr.download' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'shortLinkQr.downloadSvg' })).toBeNull()
    expect(screen.getByRole('button', { name: 'shortLinkQr.correctionLevels.H' }).getAttribute('aria-pressed')).toBe('true')
    await choose('M')
    expect((await svgDownload()).xml).toBe(await svgWriter(url, {
      type: 'svg', width: 320, margin: 4, errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#FFFFFF' },
    }))
    expect(screen.queryByText('shortLinkQr.generateFailed')).toBeNull()
  })
})
