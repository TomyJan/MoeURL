import { fireEvent, render, screen } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref } from 'vue'
import QRCode from 'qrcode'

import ShortLinkQrDialog from './ShortLinkQrDialog.vue'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

const url = 'https://go.example.com/abc123'
const pngWriter = QRCode.toDataURL
const svgWriter = QRCode.toString

/** Keeps each real activator's identity while replacing only popup layout. */
const menuStub = defineComponent({
  props: { modelValue: Boolean },
  emits: ['update:modelValue'],
  setup(props, { slots, emit, expose }) {
    const activator = ref<HTMLButtonElement>()
    expose({ get activatorEl() { return activator.value } })
    return () => h('div', [
      slots.activator?.({ props: {
        ref: (instance: unknown) => { activator.value = instance ? (instance as { $el: HTMLButtonElement }).$el : undefined },
        'aria-haspopup': 'menu', 'aria-expanded': String(props.modelValue),
        onClick: () => emit('update:modelValue', !props.modelValue),
      } }),
      props.modelValue ? h('div', { onClick: () => emit('update:modelValue', false) }, slots.default?.()) : null,
    ])
  },
})

/** Exercises the product component with real QR encoders and no network. */
function mountDialog() {
  return render(ShortLinkQrDialog, {
    props: { open: true, slug: 'abc123', url },
    global: { stubs: { ...componentStubs, VMenu: menuStub } },
  })
}

/** Reads the two independently prepared current artifacts. */
async function downloads() {
  const svgLink = await screen.findByRole('link', { name: 'shortLinkQr.downloadSvg' }, { timeout: 5000 })
  const pngLink = screen.getByRole('link', { name: 'shortLinkQr.download' })
  const svg = svgLink.getAttribute('href')!
  return { png: pngLink.getAttribute('href')!, svg: decodeURIComponent(svg.slice(svg.indexOf(',') + 1)) }
}

/** Uses the visible local selector and verifies focus returns to its own button. */
async function chooseQuietZone(key: 'standard' | 'wide') {
  const activator = screen.getByRole('button', { name: /^shortLinkQr.quietZone:/ })
  await fireEvent.click(activator)
  const option = screen.getByRole('menuitemradio', { name: `shortLinkQr.quietZones.${key}` })
  option.focus()
  await fireEvent.click(option)
  expect(document.activeElement).toBe(activator)
  expect(activator.textContent).toBe(`shortLinkQr.quietZone: shortLinkQr.quietZones.${key}`)
}

/** Changes the existing size selector without bypassing its focus behavior. */
async function chooseSize(width: 320 | 640 | 1024) {
  const activator = screen.getByRole('button', { name: /^shortLinkQr.exportSize:/ })
  await fireEvent.click(activator)
  const option = screen.getByRole('menuitemradio', { name: `${width} px` })
  option.focus()
  await fireEvent.click(option)
  expect(document.activeElement).toBe(activator)
}

/** Flushes released encoder work and the actual Vue watcher without sleeping. */
async function flushGeneration() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

describe('ShortLinkQrDialog quiet zone', () => {
  afterEach(() => { vi.restoreAllMocks() })
  // A changed default margin or altered payload must change real encoded bytes.
  it('preserves the original four-module PNG and SVG by default', async () => {
    mountDialog()
    const actual = await downloads()
    expect(actual.png).toBe(await pngWriter(url, { width: 320, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#FFFFFF' } }))
    expect(actual.svg).toBe(await svgWriter(url, { type: 'svg', width: 320, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#FFFFFF' } }))
  })

  // Missing selection or a margin applied to only one format must fail.
  it('exports an actual eight-module quiet zone in both formats after choosing wide', async () => {
    mountDialog()
    await downloads()
    await chooseQuietZone('wide')
    const actual = await downloads()
    expect(actual.png).toBe(await pngWriter(url, { width: 320, margin: 8, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#FFFFFF' } }))
    expect(actual.svg).toBe(await svgWriter(url, { type: 'svg', width: 320, margin: 8, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#FFFFFF' } }))
    expect(actual.svg).toContain(`viewBox="0 0 ${QRCode.create(url, { errorCorrectionLevel: 'M' }).modules.size + 16} ${QRCode.create(url, { errorCorrectionLevel: 'M' }).modules.size + 16}"`)
  })

  // A wrong or format-specific margin, width, color, correction, or payload changes real bytes.
  it.each(([4, 8] as const).flatMap(margin =>
    ([320, 640, 1024] as const).flatMap(width =>
      (['M', 'Q', 'H'] as const).flatMap(level =>
        ([['classic', '#000000'], ['indigo', '#312E81'], ['forest', '#14532D']] as const).map(([preset, dark]) => [margin, width, level, preset, dark] as const),
      ),
    ),
  ))('exports %i-module %ipx %s %s artifacts', async (margin, width, level, preset, dark) => {
    mountDialog()
    await chooseQuietZone(margin === 4 ? 'standard' : 'wide')
    await chooseSize(width)
    await fireEvent.click(screen.getByRole('button', { name: `shortLinkQr.correctionLevels.${level}` }))
    await fireEvent.click(screen.getByRole('button', { name: `shortLinkQr.presets.${preset}` }))
    const actual = await downloads()
    // This fixture's 49-module wide/H matrix otherwise floors 1023.9999999999999.
    // Keep the independent integer IHDR assertions below, including this regression.
    const referenceWidth = margin === 8 && width === 1024 && level === 'H' ? 1024.0000000000002 : width
    expect(actual.png).toBe(await pngWriter(url, { width: referenceWidth, margin, errorCorrectionLevel: level, color: { dark, light: '#FFFFFF' } }))
    expect(actual.svg).toBe(await svgWriter(url, { type: 'svg', width, margin, errorCorrectionLevel: level, color: { dark, light: '#FFFFFF' } }))
    const png = Buffer.from(actual.png.split(',')[1]!, 'base64')
    expect(png.readUInt32BE(16)).toBe(width)
    expect(png.readUInt32BE(20)).toBe(width)
    const document = new DOMParser().parseFromString(actual.svg, 'image/svg+xml')
    const fullSize = QRCode.create(url, { errorCorrectionLevel: level }).modules.size + margin * 2
    expect(document.documentElement.getAttribute('viewBox')).toBe(`0 0 ${fullSize} ${fullSize}`)
    expect(document.documentElement.getAttribute('width')).toBe(String(width))
    expect(document.querySelector('path[fill]')?.getAttribute('fill')).toBe('#FFFFFF')
    expect(screen.getByRole('img').getAttribute('width')).toBe('320')
  })

  // Changing one selector must preserve all three other local choices in actual output.
  it('keeps size, correction and color across border changes and vice versa', async () => {
    mountDialog()
    await chooseSize(1024)
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkQr.correctionLevels.H' }))
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkQr.presets.forest' }))
    await downloads()
    await chooseQuietZone('wide')
    expect((await downloads()).svg).toBe(await svgWriter(url, { type: 'svg', width: 1024, margin: 8, errorCorrectionLevel: 'H', color: { dark: '#14532D', light: '#FFFFFF' } }))
    await chooseSize(640)
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkQr.correctionLevels.Q' }))
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkQr.presets.indigo' }))
    expect((await downloads()).png).toBe(await pngWriter(url, { width: 640, margin: 8, errorCorrectionLevel: 'Q', color: { dark: '#312E81', light: '#FFFFFF' } }))
    await fireEvent.click(screen.getByRole('button', { name: /^shortLinkQr.quietZone:/ }))
    expect(screen.getByRole('menuitemradio', { name: 'shortLinkQr.quietZones.wide' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('menuitemradio', { name: 'shortLinkQr.quietZones.standard' }).getAttribute('aria-checked')).toBe('false')
  })

  // Another link or reopening must retire both menus and the previous border as well as old choices.
  it.each(['slug', 'url', 'reopen'] as const)('restores all defaults and closes both menus on %s', async change => {
    const view = mountDialog()
    await chooseQuietZone('wide')
    await chooseSize(640)
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkQr.correctionLevels.H' }))
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkQr.presets.forest' }))
    await downloads()
    await fireEvent.click(screen.getByRole('button', { name: /^shortLinkQr.exportSize:/ }))
    await fireEvent.click(screen.getByRole('button', { name: /^shortLinkQr.quietZone:/ }))
    expect(screen.getAllByRole('menu')).toHaveLength(2)
    let currentUrl = url
    if (change === 'slug') await view.rerender({ slug: 'next456' })
    if (change === 'url') { currentUrl = 'https://next.example.org/next456'; await view.rerender({ url: currentUrl }) }
    if (change === 'reopen') {
      await view.rerender({ open: false })
      expect(screen.queryByRole('link', { name: 'shortLinkQr.download' })).toBeNull()
      await view.rerender({ open: true })
    }
    expect(screen.queryByRole('menu')).toBeNull()
    expect((await downloads()).svg).toBe(await svgWriter(currentUrl, { type: 'svg', width: 320, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#FFFFFF' } }))
    expect(screen.getByRole('button', { name: 'shortLinkQr.quietZone: shortLinkQr.quietZones.standard' })).toBeTruthy()
  })

  // Retired menu work must not steal focus from the user's new position.
  it.each(['slug', 'url', 'close', 'unmount'] as const)('cancels queued border focus on %s', async change => {
    const view = mountDialog()
    await downloads()
    await fireEvent.click(screen.getByRole('button', { name: /^shortLinkQr.quietZone:/ }))
    const option = screen.getByRole('menuitemradio', { name: 'shortLinkQr.quietZones.wide' })
    option.focus()
    option.click()
    const pending = change === 'slug' ? view.rerender({ slug: 'next456' })
      : change === 'url' ? view.rerender({ url: 'https://next.example.org/next456' })
      : change === 'close' ? view.rerender({ open: false }) : undefined
    if (change === 'unmount') view.unmount()
    const nextPosition = document.createElement('button')
    document.body.append(nextPosition)
    try {
      nextPosition.focus()
      await pending
      await nextTick()
      expect(document.activeElement).toBe(nextPosition)
    } finally { nextPosition.remove() }
  })

  // A stale PNG must not replace new output, publish an old failure, or end current loading.
  it.each(['success', 'failure'] as const)('ignores stale PNG %s/finally after a border change', async outcome => {
    const first = createDeferred<string>(), second = createDeferred<string>()
    vi.spyOn(QRCode as unknown as { toDataURL: (text: string, options?: unknown) => Promise<string> }, 'toDataURL').mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    mountDialog()
    await screen.findByRole('progressbar')
    await chooseQuietZone('wide')
    if (outcome === 'success') first.resolve(await pngWriter(url, { width: 320, margin: 4 }))
    else first.reject(new Error('retired PNG'))
    await flushGeneration()
    expect(screen.getByRole('progressbar')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'shortLinkQr.download' })).toBeNull()
    expect(screen.queryByText('shortLinkQr.generateFailed')).toBeNull()
    second.resolve(await pngWriter(url, { width: 320, margin: 8 }))
    expect((await downloads()).svg).toBe(await svgWriter(url, { type: 'svg', width: 320, margin: 8, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#FFFFFF' } }))
  })

  // A stale SVG must not leak into a new border or disable the already current PNG.
  it.each(['success', 'failure'] as const)('ignores stale SVG %s/finally while PNG remains usable', async outcome => {
    const first = createDeferred<string>(), second = createDeferred<string>()
    vi.spyOn(QRCode as unknown as { toString: (text: string, options?: unknown) => Promise<string> }, 'toString').mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    mountDialog()
    await screen.findByText('shortLinkQr.svgGenerating')
    await chooseQuietZone('wide')
    await screen.findByRole('link', { name: 'shortLinkQr.download' }, { timeout: 5000 })
    if (outcome === 'success') first.resolve('<svg xmlns="http://www.w3.org/2000/svg"/>')
    else first.reject(new Error('retired SVG'))
    await flushGeneration()
    expect(screen.getByText('shortLinkQr.svgGenerating')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'shortLinkQr.downloadSvg' })).toBeNull()
    expect(screen.queryByText('shortLinkQr.svgGenerateFailed')).toBeNull()
    expect(screen.getByRole('link', { name: 'shortLinkQr.download' }).getAttribute('href')).toBe(await pngWriter(url, { width: 320, margin: 8, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#FFFFFF' } }))
    second.resolve(await svgWriter(url, { type: 'svg', width: 320, margin: 8, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#FFFFFF' } }))
    expect((await downloads()).svg).toContain('viewBox="0 0 45 45"')
  })

  // A current SVG failure must leave current PNG usable and permit an explicit retry.
  it('keeps PNG available when SVG fails and retries on another border choice', async () => {
    vi.spyOn(QRCode as unknown as { toString: (text: string, options?: unknown) => Promise<string> }, 'toString').mockRejectedValueOnce(new Error('SVG unavailable'))
    mountDialog()
    await screen.findByText('shortLinkQr.svgGenerateFailed')
    expect(screen.getByRole('link', { name: 'shortLinkQr.download' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'shortLinkQr.downloadSvg' })).toBeNull()
    await chooseQuietZone('wide')
    expect((await downloads()).svg).toBe(await svgWriter(url, { type: 'svg', width: 320, margin: 8, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#FFFFFF' } }))
    expect(screen.queryByText('shortLinkQr.svgGenerateFailed')).toBeNull()
  })
})
