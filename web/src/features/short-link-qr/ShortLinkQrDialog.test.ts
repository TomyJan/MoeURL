import { fireEvent, render, screen } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import QRCode from 'qrcode'
import { nextTick } from 'vue'

import ShortLinkQrDialog from './ShortLinkQrDialog.vue'
import { componentStubs } from '@/test/component-stubs'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

/** Mounts the QR dialog with a representative short-link fixture. */
function mountDialog(
  props: Partial<{ open: boolean; slug: string; url: string }> = {},
  stubs = componentStubs,
) {
  return render(ShortLinkQrDialog, {
    props: {
      open: true,
      slug: 'abc123',
      url: 'https://go.example.com/abc123',
      ...props,
    },
    global: { stubs },
  })
}

/** Installs a deterministic QR encoder spy for rendering assertions. */
function spyOnToDataURL() {
  return vi.spyOn(
    QRCode as unknown as { toDataURL: (text: string, options?: unknown) => Promise<string> },
    'toDataURL',
  )
}

/** Flushes the delayed QR generation used by stale-result tests. */
async function flushStaleGeneration() {
  await Promise.resolve()
  await Promise.resolve()
  await nextTick()
}

describe('ShortLinkQrDialog', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('encodes the complete public URL into a usable PNG and exposes a download', async () => {
    const toDataURL = spyOnToDataURL()
    const view = mountDialog()

    expect(view.container.querySelector('.short-link-qr-dialog__preview')?.getAttribute('aria-live')).toBe('polite')

    const image = await screen.findByRole('img', { name: 'shortLinkQr.imageAlt' }) as HTMLImageElement
    expect(toDataURL).toHaveBeenCalledWith('https://go.example.com/abc123', expect.objectContaining({
      width: 320,
      margin: 4,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#FFFFFF' },
    }))
    expect(image.src).toMatch(/^data:image\/png/)

    const download = screen.getByRole('link', { name: 'shortLinkQr.download' })
    expect(download.getAttribute('href')).toMatch(/^data:image\/png/)
    expect(download.getAttribute('download')).toBe('moeurl-abc123.png')

    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkQr.close' }))
    expect(view.emitted()['update:open']).toEqual([[false]])
  })

  it('does not generate while closed and regenerates when opened', async () => {
    const toDataURL = spyOnToDataURL()
    const view = mountDialog({ open: false })
    expect(toDataURL).not.toHaveBeenCalled()

    await view.rerender({ open: true })
    expect(await screen.findByRole('img', { name: 'shortLinkQr.imageAlt' })).toBeTruthy()
    expect(toDataURL).toHaveBeenCalledTimes(1)
  })

  it('selects each named appearance and downloads the matching real PNG', async () => {
    const toDataURL = spyOnToDataURL()
    mountDialog()
    expect(screen.getByRole('dialog', { name: 'shortLinkQr.title' })).toBeTruthy()
    const group = screen.getByRole('group', { name: 'shortLinkQr.appearance' })
    expect(group.querySelectorAll('button')).toHaveLength(3)
    const outputs = new Set<string>()
    for (const [name, dark] of [
      ['classic', '#000000'], ['indigo', '#312E81'], ['forest', '#14532D'],
    ]) {
      const button = screen.getByRole('button', { name: `shortLinkQr.presets.${name}` })
      expect(button.getAttribute('type')).toBe('button')
      await fireEvent.click(button)
      const image = await screen.findByRole('img', { name: 'shortLinkQr.imageAlt' })
      const png = image.getAttribute('src')!
      expect(png).toMatch(/^data:image\/png;base64,/)
      expect(button.getAttribute('aria-pressed')).toBe('true')
      expect(group.querySelectorAll('[aria-pressed="true"]')).toHaveLength(1)
      expect(toDataURL).toHaveBeenLastCalledWith('https://go.example.com/abc123', {
        width: 320, margin: 4, errorCorrectionLevel: 'M',
        color: { dark, light: '#FFFFFF' },
      })
      expect(screen.getByRole('link', { name: 'shortLinkQr.download' }).getAttribute('href')).toBe(png)
      outputs.add(png)
    }
    expect(outputs.size).toBe(3)
  })

  it.each(['reopen', 'slug', 'url'])('resets appearance when identity changes: %s', async (identity) => {
    const view = mountDialog()
    await screen.findByRole('img', { name: 'shortLinkQr.imageAlt' })
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkQr.presets.forest' }))
    await screen.findByRole('img', { name: 'shortLinkQr.imageAlt' })
    if (identity === 'reopen') {
      await view.rerender({ open: false })
      expect(screen.queryByRole('link', { name: 'shortLinkQr.download' })).toBeNull()
      await view.rerender({ open: true })
    } else if (identity === 'slug') {
      await view.rerender({ slug: 'newslug' })
    } else {
      await view.rerender({ url: 'https://other.example.com/abc123' })
    }
    await screen.findByRole('img', { name: 'shortLinkQr.imageAlt' })
    expect(screen.getByRole('button', { name: 'shortLinkQr.presets.classic' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'shortLinkQr.presets.forest' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('link', { name: 'shortLinkQr.download' }).getAttribute('download')).toBe(
      identity === 'slug' ? 'moeurl-newslug.png' : 'moeurl-abc123.png',
    )
  })

  it('does not expose an old download while a new appearance is pending', async () => {
    const encoder = spyOnToDataURL()
    mountDialog()
    await screen.findByRole('img', { name: 'shortLinkQr.imageAlt' })
    let finish: ((png: string) => void) | undefined
    encoder.mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve }))
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkQr.presets.indigo' }))
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    expect(screen.queryByRole('img', { name: 'shortLinkQr.imageAlt' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'shortLinkQr.download' })).toBeNull()
    expect(screen.getByRole('progressbar')).toBeTruthy()
    finish!('data:image/png;base64,current')
    expect((await screen.findByRole('img', { name: 'shortLinkQr.imageAlt' })).getAttribute('src')).toBe('data:image/png;base64,current')
  })

  it('recovers from a current appearance failure without offering the old download', async () => {
    const encoder = spyOnToDataURL()
    mountDialog()
    await screen.findByRole('img', { name: 'shortLinkQr.imageAlt' })
    encoder.mockRejectedValueOnce(new Error('encoding unavailable'))
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkQr.presets.indigo' }))
    await screen.findByText('shortLinkQr.generateFailed')
    expect(screen.queryByRole('link', { name: 'shortLinkQr.download' })).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkQr.presets.forest' }))
    expect(await screen.findByRole('img', { name: 'shortLinkQr.imageAlt' })).toBeTruthy()
    expect(screen.queryByText('shortLinkQr.generateFailed')).toBeNull()
    expect(screen.getByRole('link', { name: 'shortLinkQr.download' })).toBeTruthy()
  })

  it.each(['success', 'failure'])('keeps the current appearance loading after a stale %s and finally', async (outcome) => {
    let firstResolve: ((png: string) => void) | undefined
    let firstReject: ((reason: Error) => void) | undefined
    let secondResolve: ((png: string) => void) | undefined
    spyOnToDataURL()
      .mockImplementationOnce(() => new Promise<string>((resolve, reject) => { firstResolve = resolve; firstReject = reject }))
      .mockImplementationOnce(() => new Promise<string>((resolve) => { secondResolve = resolve }))
    mountDialog()
    await vi.waitFor(() => expect(firstResolve).toBeTypeOf('function'))
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkQr.presets.indigo' }))
    await vi.waitFor(() => expect(secondResolve).toBeTypeOf('function'))
    if (outcome === 'success') firstResolve!('data:image/png;base64,stale')
    else firstReject!(new Error('stale failure'))
    await flushStaleGeneration()
    expect(screen.getByRole('progressbar')).toBeTruthy()
    expect(screen.queryByRole('img', { name: 'shortLinkQr.imageAlt' })).toBeNull()
    expect(screen.queryByText('shortLinkQr.generateFailed')).toBeNull()
    secondResolve!('data:image/png;base64,current')
    expect((await screen.findByRole('img', { name: 'shortLinkQr.imageAlt' })).getAttribute('src')).toBe('data:image/png;base64,current')
  })

  it('ignores an encoding completed while closed and regenerates black and white on reopen', async () => {
    let finish: ((png: string) => void) | undefined
    spyOnToDataURL().mockImplementationOnce(() => new Promise<string>((resolve) => { finish = resolve }))
    const view = mountDialog()
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
    await view.rerender({ open: false })
    finish!('data:image/png;base64,closed')
    await flushStaleGeneration()
    await view.rerender({ open: true })
    const image = await screen.findByRole('img', { name: 'shortLinkQr.imageAlt' })
    expect(image.getAttribute('src')).toMatch(/^data:image\/png;base64,/)
    expect(image.getAttribute('src')).not.toContain(',closed')
    expect(screen.getByRole('button', { name: 'shortLinkQr.presets.classic' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('encodes a long complete public URL without truncating its payload', async () => {
    const encoder = spyOnToDataURL()
    const url = `https://${'long-public-host-'.repeat(8)}example.com/abc123`
    mountDialog({ url })
    expect(await screen.findByRole('img', { name: 'shortLinkQr.imageAlt' })).toBeTruthy()
    expect(encoder).toHaveBeenCalledWith(url, expect.objectContaining({ margin: 4 }))
    expect(screen.getByText(url)).toBeTruthy()
  })

  it('shows an explicit generation error instead of a blank image', async () => {
    spyOnToDataURL().mockRejectedValueOnce(new Error('encode failed'))
    mountDialog()

    expect(await screen.findByText('shortLinkQr.generateFailed')).toBeTruthy()
    expect(screen.queryByRole('img', { name: 'shortLinkQr.imageAlt' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'shortLinkQr.download' })).toBeNull()
  })

  it('clears a previous image when the URL becomes empty', async () => {
    const view = mountDialog()
    expect(await screen.findByRole('img', { name: 'shortLinkQr.imageAlt' })).toBeTruthy()

    await view.rerender({ url: '' })

    expect(screen.queryByRole('img', { name: 'shortLinkQr.imageAlt' })).toBeNull()
  })

  it('ignores an older generation result after the public URL changes', async () => {
    let resolveFirst: ((value: string) => void) | undefined
    spyOnToDataURL()
      .mockImplementationOnce(() => new Promise<string>((resolve) => {
        resolveFirst = resolve
      }))
      .mockResolvedValueOnce('data:image/png;base64,new')
    const view = mountDialog()

    await view.rerender({ slug: 'def456', url: 'https://go.example.com/def456' })
    const image = await screen.findByRole('img', { name: 'shortLinkQr.imageAlt' }) as HTMLImageElement
    expect(image.src).toContain('data:image/png;base64,new')

    resolveFirst?.('data:image/png;base64,old')
    await flushStaleGeneration()
    expect(image.src).toContain('data:image/png;base64,new')
  })

  it('ignores an older generation failure after the public URL changes', async () => {
    let rejectFirst: ((reason: Error) => void) | undefined
    spyOnToDataURL()
      .mockImplementationOnce(() => new Promise<string>((_resolve, reject) => {
        rejectFirst = reject
      }))
      .mockResolvedValueOnce('data:image/png;base64,new')
    const view = mountDialog()

    await view.rerender({ slug: 'def456', url: 'https://go.example.com/def456' })
    const image = await screen.findByRole('img', { name: 'shortLinkQr.imageAlt' }) as HTMLImageElement

    rejectFirst?.(new Error('old generation failed'))
    await flushStaleGeneration()
    expect(image.src).toContain('data:image/png;base64,new')
    expect(screen.queryByText('shortLinkQr.generateFailed')).toBeNull()
  })

  it('forwards dialog model updates to the parent', async () => {
    const view = mountDialog(
      {},
      {
        ...componentStubs,
        VDialog: {
          props: ['modelValue'],
          emits: ['update:modelValue'],
          template: '<div role="dialog"><button aria-label="qr-dialog-model-update" @click="$emit(\'update:modelValue\', true)" /><slot /></div>',
        },
      },
    )

    await fireEvent.click(screen.getByLabelText('qr-dialog-model-update'))
    expect(view.emitted()['update:open']).toEqual([[true]])
  })
})
