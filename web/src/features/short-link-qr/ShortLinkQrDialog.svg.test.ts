import { fireEvent, render, screen } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import QRCode from 'qrcode'
import { nextTick } from 'vue'

import ShortLinkQrDialog from './ShortLinkQrDialog.vue'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

/** Mounts the actual dialog; only Vuetify layout is replaced. */
function mountDialog(props: Partial<{ open: boolean; slug: string; url: string }> = {}) {
  return render(ShortLinkQrDialog, {
    props: { open: true, slug: 'abc123', url: 'https://go.example.com/abc123', ...props },
    global: { stubs: componentStubs },
  })
}

/** Parses the real downloaded document, rather than an injected DOM preview. */
function downloadedSvg(link: HTMLElement) {
  const href = link.getAttribute('href')!
  expect(href).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
  return new DOMParser().parseFromString(decodeURIComponent(href.slice(href.indexOf(',') + 1)), 'image/svg+xml')
}

/** Controls only the local SVG encoder's completion; PNG stays real. */
function svgEncoder() {
  return vi.spyOn(QRCode as unknown as { toString: (text: string, options?: unknown) => Promise<string> }, 'toString')
}

/** Flushes a settled encoder through the real Vue watcher. */
async function flushGeneration() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

const currentSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320"><path d="M4 4h1v1H4z"/></svg>'

describe('ShortLinkQrDialog SVG download', () => {
  afterEach(() => { vi.restoreAllMocks() })

  // Missing SVG generation/download, a stale color, or transparent background must fail.
  it('downloads a real, separate SVG for every appearance while retaining PNG', async () => {
    const view = mountDialog()
    const documents = new Set<string>()
    for (const [preset, dark] of [['classic', '#000000'], ['indigo', '#312e81'], ['forest', '#14532d']]) {
      await fireEvent.click(screen.getByRole('button', { name: `shortLinkQr.presets.${preset}` }))
      const link = await screen.findByRole('link', { name: 'shortLinkQr.downloadSvg' })
      expect(link.getAttribute('download')).toBe('moeurl-abc123.svg')
      const svg = downloadedSvg(link)
      expect(svg.querySelector('parsererror')).toBeNull()
      expect(svg.documentElement.localName).toBe('svg')
      expect(svg.documentElement.getAttribute('width')).toBe('320')
      expect(svg.documentElement.getAttribute('height')).toBe('320')
      expect(svg.documentElement.getAttribute('viewBox')).toBe('0 0 37 37')
      expect(svg.querySelector('path[fill]')?.getAttribute('fill')?.toLowerCase()).toBe('#ffffff')
      expect(svg.querySelector('path[stroke]')?.getAttribute('stroke')?.toLowerCase()).toBe(dark)
      expect(svg.querySelector('path[stroke]')?.getAttribute('d')).toMatch(/^M4 4\.5/)
      expect(svg.querySelector('script, foreignObject, image, text')).toBeNull()
      expect(view.container.querySelector('svg')).toBeNull()
      documents.add(link.getAttribute('href')!)
      expect(screen.getByRole('link', { name: 'shortLinkQr.download' }).getAttribute('href')).toMatch(/^data:image\/png/)
      expect(screen.getByRole('img', { name: 'shortLinkQr.imageAlt' })).toBeTruthy()
    }
    expect(documents.size).toBe(3)
  })

  // Awaiting SVG in the PNG pipeline would hide an otherwise usable PNG.
  it('keeps PNG usable while the SVG encoder is still pending', async () => {
    const pending = createDeferred<string>()
    svgEncoder().mockReturnValueOnce(pending.promise)
    mountDialog()
    expect(await screen.findByRole('img', { name: 'shortLinkQr.imageAlt' })).toBeTruthy()
    expect(screen.getByRole('link', { name: 'shortLinkQr.download' })).toBeTruthy()
    expect(await screen.findByText('shortLinkQr.svgGenerating')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'shortLinkQr.downloadSvg' })).toBeNull()
    pending.resolve(currentSvg)
    expect(await screen.findByRole('link', { name: 'shortLinkQr.downloadSvg' })).toBeTruthy()
    expect(screen.queryByText('shortLinkQr.svgGenerating')).toBeNull()
  })

  // An SVG failure must not clear PNG or be confused with a PNG failure.
  it('retains PNG and an independent SVG error until a new appearance recovers', async () => {
    svgEncoder().mockRejectedValueOnce(new Error('SVG unavailable'))
    mountDialog()
    expect(await screen.findByText('shortLinkQr.svgGenerateFailed')).toBeTruthy()
    const png = screen.getByRole('link', { name: 'shortLinkQr.download' }).getAttribute('href')
    expect(png).toMatch(/^data:image\/png/)
    expect(screen.queryByText('shortLinkQr.generateFailed')).toBeNull()
    await flushGeneration()
    expect(screen.getByText('shortLinkQr.svgGenerateFailed')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkQr.presets.indigo' }))
    expect(await screen.findByRole('link', { name: 'shortLinkQr.downloadSvg' })).toBeTruthy()
    expect(screen.queryByText('shortLinkQr.svgGenerateFailed')).toBeNull()
    expect(screen.getByRole('link', { name: 'shortLinkQr.download' }).getAttribute('href')).not.toBe(png)
  })

  // A stale success/catch/finally must not publish a link/error or stop current loading.
  it.each(['success', 'failure'])('ignores stale SVG %s and finally while the next preset loads', async (outcome) => {
    const first = createDeferred<string>()
    const second = createDeferred<string>()
    svgEncoder().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    mountDialog()
    await screen.findByText('shortLinkQr.svgGenerating')
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkQr.presets.forest' }))
    await screen.findByRole('img', { name: 'shortLinkQr.imageAlt' })
    await screen.findByText('shortLinkQr.svgGenerating')
    if (outcome === 'success') first.resolve('<svg xmlns="http://www.w3.org/2000/svg" id="stale"/>')
    else first.reject(new Error('stale failure'))
    await flushGeneration()
    expect(screen.getByText('shortLinkQr.svgGenerating')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'shortLinkQr.downloadSvg' })).toBeNull()
    expect(screen.queryByText('shortLinkQr.svgGenerateFailed')).toBeNull()
    second.resolve(currentSvg)
    const link = await screen.findByRole('link', { name: 'shortLinkQr.downloadSvg' })
    expect(downloadedSvg(link).documentElement.getAttribute('id')).toBeNull()
  })

  // Changing identity must remove old SVG immediately and restore classic appearance.
  it.each(['slug', 'url', 'reopen', 'empty'])('clears an old SVG on identity change: %s', async (identity) => {
    const view = mountDialog()
    await screen.findByRole('link', { name: 'shortLinkQr.downloadSvg' })
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkQr.presets.indigo' }))
    const prior = (await screen.findByRole('link', { name: 'shortLinkQr.downloadSvg' })).getAttribute('href')
    const pending = createDeferred<string>()
    svgEncoder().mockReturnValueOnce(pending.promise)
    if (identity === 'slug') await view.rerender({ slug: 'newslug' })
    else if (identity === 'url') await view.rerender({ url: 'https://other.example.com/abc123' })
    else if (identity === 'empty') await view.rerender({ url: '' })
    else {
      await view.rerender({ open: false })
      expect(screen.queryByRole('link', { name: 'shortLinkQr.downloadSvg' })).toBeNull()
      await view.rerender({ open: true })
    }
    expect(screen.queryByRole('link', { name: 'shortLinkQr.downloadSvg' })).toBeNull()
    if (identity === 'empty') {
      expect(screen.queryByText('shortLinkQr.svgGenerating')).toBeNull()
      return
    }
    await screen.findByText('shortLinkQr.svgGenerating')
    pending.resolve(currentSvg)
    const link = await screen.findByRole('link', { name: 'shortLinkQr.downloadSvg' })
    expect(link.getAttribute('href')).not.toBe(prior)
    expect(link.getAttribute('download')).toBe(identity === 'slug' ? 'moeurl-newslug.svg' : 'moeurl-abc123.svg')
    expect(screen.getByRole('button', { name: 'shortLinkQr.presets.classic' }).getAttribute('aria-pressed')).toBe('true')
  })

  // A closed/unmounted dialog must not offer a completed stale download on reopen.
  it.each(['close', 'unmount'])('discards a pending SVG on %s', async (action) => {
    const pending = createDeferred<string>()
    svgEncoder().mockReturnValueOnce(pending.promise)
    const view = mountDialog()
    await screen.findByText('shortLinkQr.svgGenerating')
    if (action === 'close') await view.rerender({ open: false })
    else view.unmount()
    pending.reject(new Error('completion after disposal'))
    await flushGeneration()
    expect(screen.queryByRole('link', { name: 'shortLinkQr.downloadSvg' })).toBeNull()
    expect(screen.queryByText('shortLinkQr.svgGenerateFailed')).toBeNull()
    if (action === 'close') await view.rerender({ open: true })
    else mountDialog({ slug: 'newslug', url: 'https://go.example.com/newslug' })
    expect(await screen.findByRole('link', { name: 'shortLinkQr.downloadSvg' })).toBeTruthy()
    expect(screen.queryByText('shortLinkQr.svgGenerateFailed')).toBeNull()
  })

  // Passing only a slug, truncating a URL, or injecting URL text as XML must fail.
  it('encodes the complete long URL as SVG data without inserting its markup into the page', async () => {
    const encoder = svgEncoder()
    const url = `https://go.example.com/abc123?note=${'long-'.repeat(40)}</svg><script>alert(1)</script>`
    const view = mountDialog({ url })
    const link = await screen.findByRole('link', { name: 'shortLinkQr.downloadSvg' })
    expect(encoder).toHaveBeenCalledWith(url, {
      type: 'svg', width: 320, margin: 4, errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#FFFFFF' },
    })
    const svg = downloadedSvg(link)
    expect(svg.querySelector('parsererror, script, foreignObject, image, text')).toBeNull()
    expect(view.container.querySelector('svg, script')).toBeNull()
    expect(screen.getByText(url)).toBeTruthy()
  })
})
