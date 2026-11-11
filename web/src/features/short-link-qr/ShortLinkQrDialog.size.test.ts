import { fireEvent, render, screen } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import QRCode from 'qrcode'
import { defineComponent, h, nextTick, ref } from 'vue'

import ShortLinkQrDialog from './ShortLinkQrDialog.vue'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))

const url = 'https://go.example.com/abc123'
const pngWriter = QRCode.toDataURL
const svgWriter = QRCode.toString

/** Mirrors Vuetify's activator ref and its publicly forwarded activatorEl. */
const sizeMenuStub = defineComponent({
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

/** Exercises the real component and encoder while substituting only layout. */
function mountDialog() {
  return render(ShortLinkQrDialog, {
    props: { open: true, slug: 'abc123', url },
    global: { stubs: { ...componentStubs, VMenu: sizeMenuStub } },
  })
}

/** Selects through the visible menu rather than changing internal state. */
async function chooseSize(width: 320 | 640 | 1024) {
  const activator = screen.getByRole('button', { name: /^shortLinkQr.exportSize:/ })
  await fireEvent.click(activator)
  const option = screen.getByRole('menuitemradio', { name: `${width} px` })
  option.focus()
  await fireEvent.click(option)
  expect(document.activeElement).toBe(activator)
  expect(screen.getByRole('button', { name: `shortLinkQr.exportSize: ${width} px` })).toBeTruthy()
}

/** Reads both separate current download artifacts without inserting SVG into DOM. */
async function downloads() {
  const svgLink = await screen.findByRole('link', { name: 'shortLinkQr.downloadSvg' }, { timeout: 5000 })
  const pngLink = screen.getByRole('link', { name: 'shortLinkQr.download' })
  const svgHref = svgLink.getAttribute('href')!
  const pngHref = pngLink.getAttribute('href')!
  expect(svgHref).toMatch(/^data:image\/svg\+xml;charset=utf-8,/)
  expect(pngHref).toMatch(/^data:image\/png;base64,/)
  return { svgLink, pngLink, svg: decodeURIComponent(svgHref.slice(svgHref.indexOf(',') + 1)), png: pngHref }
}

/** Flushes only released encoder completions and the actual Vue watcher. */
async function flushGeneration() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

describe('ShortLinkQrDialog export sizes', () => {
  afterEach(() => { vi.restoreAllMocks() })

  // A queued focus from a retired dialog must not steal the user's new position.
  it.each(['slug', 'url', 'close', 'unmount'] as const)('cancels queued size focus on %s', async change => {
    const view = mountDialog()
    await downloads()
    await fireEvent.click(screen.getByRole('button', { name: /^shortLinkQr.exportSize:/ }))
    const option = screen.getByRole('menuitemradio', { name: '640 px' })
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

  // A changed default, missing selector, or enlarged screen preview must fail.
  it('keeps actual 320 downloads and a fixed responsive preview by default', async () => {
    mountDialog()
    const actual = await downloads()
    expect(actual.png).toBe(await pngWriter(url, { width: 320, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#FFFFFF' } }))
    expect(actual.svg).toBe(await svgWriter(url, { type: 'svg', width: 320, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#FFFFFF' } }))
    expect(screen.getByRole('button', { name: 'shortLinkQr.exportSize: 320 px' }).getAttribute('aria-haspopup')).toBe('menu')
    expect(screen.getByRole('img').getAttribute('width')).toBe('320')
    expect(actual.pngLink.getAttribute('download')).toBe('moeurl-abc123.png')
    expect(actual.svgLink.getAttribute('download')).toBe('moeurl-abc123.svg')
  })

  // A stale width, color, correction, URL, background or quiet zone changes actual bytes.
  it.each(([320, 640, 1024] as const).flatMap(width =>
    (['M', 'Q', 'H'] as const).flatMap(level =>
      ([['classic', '#000000'], ['indigo', '#312E81'], ['forest', '#14532D']] as const).map(([preset, dark]) => [width, level, preset, dark] as const),
    ),
  ))('exports exact %i %s %s PNG and SVG', async (width, level, preset, dark) => {
    mountDialog()
    await chooseSize(width)
    await fireEvent.click(screen.getByRole('button', { name: `shortLinkQr.correctionLevels.${level}` }))
    await fireEvent.click(screen.getByRole('button', { name: `shortLinkQr.presets.${preset}` }))
    const actual = await downloads()
    expect(actual.png).toBe(await pngWriter(url, { width, margin: 4, errorCorrectionLevel: level, color: { dark, light: '#FFFFFF' } }))
    expect(actual.svg).toBe(await svgWriter(url, { type: 'svg', width, margin: 4, errorCorrectionLevel: level, color: { dark, light: '#FFFFFF' } }))
    const bytes = Buffer.from(actual.png.split(',')[1]!, 'base64')
    expect(bytes.subarray(1, 4).toString('ascii')).toBe('PNG')
    expect(bytes.readUInt32BE(16)).toBe(width)
    expect(bytes.readUInt32BE(20)).toBe(width)
    const document = new DOMParser().parseFromString(actual.svg, 'image/svg+xml')
    expect(document.querySelector('parsererror, script, foreignObject')).toBeNull()
    expect(document.documentElement.getAttribute('width')).toBe(String(width))
    expect(document.documentElement.getAttribute('height')).toBe(String(width))
    expect(screen.getByRole('img').getAttribute('width')).toBe('320')
    expect(screen.getByRole('button', { name: `shortLinkQr.exportSize: ${width} px` })).toBeTruthy()
  })

  // Resetting another selector while changing size silently changes the downloaded artifact.
  it('preserves current color and correction when changing size', async () => {
    mountDialog()
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkQr.presets.forest' }))
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkQr.correctionLevels.H' }))
    await downloads()
    await chooseSize(1024)
    const actual = await downloads()
    expect(actual.svg).toBe(await svgWriter(url, { type: 'svg', width: 1024, margin: 4, errorCorrectionLevel: 'H', color: { dark: '#14532D', light: '#FFFFFF' } }))
    expect(screen.getByRole('button', { name: 'shortLinkQr.presets.forest' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'shortLinkQr.correctionLevels.H' }).getAttribute('aria-pressed')).toBe('true')
  })

  // A new link or reopened dialog must not inherit the old size or an open menu.
  it.each(['slug', 'url', 'reopen'] as const)('restores classic/M/320 and closes the menu on %s identity change', async change => {
    const view = mountDialog()
    await chooseSize(1024)
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkQr.presets.forest' }))
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkQr.correctionLevels.H' }))
    await downloads()
    await fireEvent.click(screen.getByRole('button', { name: /^shortLinkQr.exportSize:/ }))
    expect(screen.getByRole('menuitemradio', { name: '1024 px' }).getAttribute('aria-checked')).toBe('true')
    let currentUrl = url
    if (change === 'slug') await view.rerender({ slug: 'next456' })
    if (change === 'url') { currentUrl = 'https://second.example.org/next456'; await view.rerender({ url: currentUrl }) }
    if (change === 'reopen') {
      await view.rerender({ open: false })
      expect(screen.queryByRole('link', { name: 'shortLinkQr.download' })).toBeNull()
      await view.rerender({ open: true })
    }
    expect(screen.queryByRole('menuitemradio')).toBeNull()
    const actual = await downloads()
    expect(actual.svg).toBe(await svgWriter(currentUrl, { type: 'svg', width: 320, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#FFFFFF' } }))
    expect(screen.getByRole('button', { name: 'shortLinkQr.exportSize: 320 px' })).toBeTruthy()
    expect(actual.svgLink.getAttribute('download')).toBe(change === 'slug' ? 'moeurl-next456.svg' : 'moeurl-abc123.svg')
  })

  // Missing PNG generation guards would expose an old image/error or end new loading.
  it.each(['success', 'failure'] as const)('ignores stale PNG %s/finally after a size change', async outcome => {
    const first = createDeferred<string>(), second = createDeferred<string>()
    vi.spyOn(QRCode as unknown as { toDataURL: (text: string, options?: unknown) => Promise<string> }, 'toDataURL').mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    mountDialog()
    await screen.findByRole('progressbar')
    await chooseSize(640)
    if (outcome === 'success') first.resolve(await pngWriter(url, { width: 320 }))
    else first.reject(new Error('retired PNG'))
    await flushGeneration()
    expect(screen.getByRole('progressbar')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'shortLinkQr.download' })).toBeNull()
    expect(screen.queryByText('shortLinkQr.generateFailed')).toBeNull()
    second.resolve(await pngWriter(url, { width: 640 }))
    expect((await downloads()).svg).toBe(await svgWriter(url, { type: 'svg', width: 640, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#FFFFFF' } }))
  })

  // Missing SVG generation guards would publish old XML/error or end the new SVG wait.
  it.each(['success', 'failure'] as const)('keeps PNG usable and ignores stale SVG %s/finally after resizing', async outcome => {
    const first = createDeferred<string>(), second = createDeferred<string>()
    vi.spyOn(QRCode as unknown as { toString: (text: string, options?: unknown) => Promise<string> }, 'toString').mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    mountDialog()
    await screen.findByText('shortLinkQr.svgGenerating')
    await chooseSize(1024)
    await screen.findByRole('link', { name: 'shortLinkQr.download' }, { timeout: 5000 })
    if (outcome === 'success') first.resolve('<svg xmlns="http://www.w3.org/2000/svg" width="320"/>')
    else first.reject(new Error('retired SVG'))
    await flushGeneration()
    expect(screen.getByText('shortLinkQr.svgGenerating')).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'shortLinkQr.downloadSvg' })).toBeNull()
    expect(screen.queryByText('shortLinkQr.svgGenerateFailed')).toBeNull()
    expect(screen.getByRole('link', { name: 'shortLinkQr.download' }).getAttribute('href')).toBe(await pngWriter(url, { width: 1024, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#FFFFFF' } }))
    second.resolve(await svgWriter(url, { type: 'svg', width: 1024, margin: 4, errorCorrectionLevel: 'M', color: { dark: '#000000', light: '#FFFFFF' } }))
    expect((await downloads()).svg).toContain('width="1024"')
  })
})
