import { fireEvent, render, screen } from '@testing-library/vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

import RedirectPage from './RedirectPage.vue'
import { getPublicShortLinkPreview } from '@/entities/short-link/api'
import { componentStubs } from '@/test/component-stubs'

const state = vi.hoisted(() => ({
  assign: vi.fn(),
  params: { slug: 'abc123' } as Record<string, unknown>,
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('vue-router', () => ({
  useRoute: () => ({ params: state.params }),
}))

vi.mock('@/entities/short-link/api', () => ({
  getPublicShortLinkPreview: vi.fn(),
}))

function mountPage() {
  return render(RedirectPage, {
    global: { stubs: componentStubs },
  })
}

async function flushPreview() {
  await Promise.resolve()
  await nextTick()
}

describe('RedirectPage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    state.assign.mockReset()
    state.params = { slug: 'abc123' }
    vi.stubGlobal('location', { assign: state.assign })
    vi.mocked(getPublicShortLinkPreview).mockReset()
    vi.mocked(getPublicShortLinkPreview).mockResolvedValue({
      slug: 'abc123',
      targetHost: 'example.com',
      intermediateDelaySeconds: 5,
      expiresAt: null,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('loads the minimal preview and continues after the countdown', async () => {
    mountPage()
    expect(screen.getByRole('progressbar')).toBeTruthy()

    await flushPreview()
    expect(getPublicShortLinkPreview).toHaveBeenCalledWith('abc123')
    expect(screen.getByText('example.com')).toBeTruthy()
    expect(screen.getByText('5')).toBeTruthy()

    await vi.advanceTimersByTimeAsync(5_000)
    expect(state.assign).toHaveBeenCalledWith('/go/abc123/continue')
    expect(state.assign).toHaveBeenCalledTimes(1)
  })

  it('continues immediately once and reports synchronous navigation failures', async () => {
    state.assign.mockImplementationOnce(() => {
      throw new Error('navigation blocked')
    })
    mountPage()
    await flushPreview()

    const continueButton = screen.getByRole('button', { name: 'redirect.continue' })
    await fireEvent.click(continueButton)
    expect(screen.getByText('redirect.continueFailed')).toBeTruthy()

    await fireEvent.click(continueButton)
    await fireEvent.click(continueButton)
    expect(state.assign).toHaveBeenCalledTimes(2)
  })

  it('shows preview failures and retries the public request', async () => {
    vi.mocked(getPublicShortLinkPreview)
      .mockRejectedValueOnce(new Error('preview unavailable'))
      .mockResolvedValueOnce({
        slug: 'abc123',
        targetHost: 'example.com',
        intermediateDelaySeconds: 3,
        expiresAt: null,
      })
    mountPage()
    await flushPreview()

    expect(screen.getByText('redirect.loadFailed')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'redirect.retry' }))
    await flushPreview()

    expect(getPublicShortLinkPreview).toHaveBeenCalledTimes(2)
    expect(screen.getByText('example.com')).toBeTruthy()
  })

  it('rejects missing route slugs without calling the preview API', async () => {
    state.params = {}
    mountPage()
    await flushPreview()

    expect(getPublicShortLinkPreview).not.toHaveBeenCalled()
    expect(screen.getByText('redirect.loadFailed')).toBeTruthy()
  })

  it('clears the countdown interval when unmounted', async () => {
    const clearInterval = vi.spyOn(globalThis, 'clearInterval')
    const view = mountPage()
    await flushPreview()

    view.unmount()

    expect(clearInterval).toHaveBeenCalled()
  })
})
