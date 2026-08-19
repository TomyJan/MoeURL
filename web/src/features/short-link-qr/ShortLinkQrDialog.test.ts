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
      margin: 2,
      errorCorrectionLevel: 'M',
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
