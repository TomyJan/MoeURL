import { fireEvent, render, screen } from '@testing-library/vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'

import RedirectPage from './RedirectPage.vue'
import { getPublicShortLinkPreview, unlockShortLink } from '@/entities/short-link/api'
import { ApiClientError } from '@/shared/api/client'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'

const state = vi.hoisted(() => ({
  assign: vi.fn(),
  route: undefined as undefined | {
    params: Record<string, unknown>
    query: Record<string, unknown>
  },
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))

vi.mock('vue-router', () => ({
  useRoute: () => state.route,
}))

vi.mock('@/entities/short-link/api', () => ({
  getPublicShortLinkPreview: vi.fn(),
  unlockShortLink: vi.fn(),
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
    state.route = reactive({ params: { slug: 'abc123' }, query: {} })
    vi.stubGlobal('location', { assign: state.assign })
    vi.mocked(getPublicShortLinkPreview).mockReset()
    vi.mocked(unlockShortLink).mockReset()
    vi.mocked(getPublicShortLinkPreview).mockResolvedValue({
      slug: 'abc123',
      targetHost: 'example.com',
      intermediateDelaySeconds: 5,
      expiresAt: null,
      requiresPassword: false,
    })
    vi.mocked(unlockShortLink).mockResolvedValue({ unlocked: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('loads the minimal preview and continues after the countdown', async () => {
    const { container } = mountPage()
    expect(screen.getByRole('progressbar')).toBeTruthy()
    expect(container.querySelector('.redirect-page__content')?.getAttribute('aria-live')).toBeNull()

    await flushPreview()
    expect(getPublicShortLinkPreview).toHaveBeenCalledWith('abc123')
    expect(screen.getByText('example.com')).toBeTruthy()
    expect(screen.getByText('5')).toBeTruthy()
    expect(container.querySelector('.redirect-page__countdown')?.getAttribute('aria-live')).toBe('off')

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
        requiresPassword: false,
      })
    const { container } = mountPage()
    await flushPreview()

    expect(screen.getByText('redirect.loadFailed')).toBeTruthy()
    expect(container.querySelector('.redirect-page__state')?.getAttribute('aria-live')).toBe('polite')
    await fireEvent.click(screen.getByRole('button', { name: 'redirect.retry' }))
    await flushPreview()

    expect(getPublicShortLinkPreview).toHaveBeenCalledTimes(2)
    expect(screen.getByText('example.com')).toBeTruthy()
  })

  it.each([
    [200104, 'redirect.unavailable'],
    [200105, 'redirect.disabled'],
    [200109, 'redirect.expired'],
    [200110, 'redirect.notIntermediate'],
  ])('shows a non-retryable state for public business error %i', async (code, messageKey) => {
    vi.mocked(getPublicShortLinkPreview).mockRejectedValueOnce(new ApiClientError(code, 'unavailable'))
    mountPage()
    await flushPreview()

    expect(screen.getByText(messageKey)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'redirect.retry' })).toBeNull()
  })

  it.each([
    ['disabled', 'redirect.disabled'],
    ['expired', 'redirect.expired'],
    ['not-intermediate', 'redirect.notIntermediate'],
  ])('renders the localized public status for redirect reason %s', async (reason, messageKey) => {
    state.route!.query = { reason }
    mountPage()
    await flushPreview()

    expect(getPublicShortLinkPreview).not.toHaveBeenCalled()
    expect(screen.getByText(messageKey)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'redirect.retry' })).toBeNull()
  })

  it('shows a password form for protected previews', async () => {
    state.route!.query = { reason: 'password' }
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      intermediateDelaySeconds: 5,
      expiresAt: null,
      requiresPassword: true,
    })
    mountPage()
    await flushPreview()

    expect(screen.getByLabelText('redirect.password')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'redirect.unlock' })).toBeTruthy()
    expect(screen.queryByText('5')).toBeNull()
  })

  it('shows an invalid-password error without navigating', async () => {
    state.route!.query = { reason: 'password' }
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      intermediateDelaySeconds: 5,
      expiresAt: null,
      requiresPassword: true,
    })
    vi.mocked(unlockShortLink).mockRejectedValueOnce(new ApiClientError(200112, 'Invalid password'))
    mountPage()
    await flushPreview()

    await fireEvent.update(screen.getByLabelText('redirect.password'), 'wrongpass')
    await fireEvent.click(screen.getByRole('button', { name: 'redirect.unlock' }))

    expect(screen.getByText('redirect.invalidPassword')).toBeTruthy()
    expect(state.assign).not.toHaveBeenCalled()
  })

  it.each([
    [{ reason: 'rate-limited' }, undefined],
    [{ reason: 'rate-limited', retryAt: 'not-a-date' }, undefined],
    [{ reason: 'password' }, new ApiClientError(200113, 'Too many attempts')],
  ])('shows the password rate-limit state for query or unlock errors', async (query, unlockError) => {
    state.route!.query = query
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      intermediateDelaySeconds: 5,
      expiresAt: null,
      requiresPassword: true,
    })
    if (unlockError) {
      vi.mocked(unlockShortLink).mockRejectedValueOnce(unlockError)
    }
    mountPage()
    await flushPreview()

    if (unlockError) {
      await fireEvent.update(screen.getByLabelText('redirect.password'), 'wrongpass')
      await fireEvent.click(screen.getByRole('button', { name: 'redirect.unlock' }))
    }
    expect(screen.getByText('redirect.rateLimitedWithoutDeadline')).toBeTruthy()
    expect(state.assign).not.toHaveBeenCalled()
  })

  it('requires a non-empty password before sending an unlock request', async () => {
    state.route!.query = { reason: 'password' }
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      intermediateDelaySeconds: 5,
      expiresAt: null,
      requiresPassword: true,
    })
    mountPage()
    await flushPreview()

    await fireEvent.click(screen.getByRole('button', { name: 'redirect.unlock' }))

    expect(screen.getByText('redirect.passwordRequired')).toBeTruthy()
    expect(unlockShortLink).not.toHaveBeenCalled()
  })

  it('lets the backend re-evaluate a rate-limited unlock request', async () => {
    state.route!.query = { reason: 'rate-limited' }
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      intermediateDelaySeconds: null,
      expiresAt: null,
      requiresPassword: true,
    })
    mountPage()
    await flushPreview()

    await fireEvent.update(screen.getByLabelText('redirect.password'), 'correct horse')
    await fireEvent.click(screen.getByRole('button', { name: 'redirect.unlock' }))

    expect(unlockShortLink).toHaveBeenCalledWith({ slug: 'abc123', password: 'correct horse' })
    expect(screen.queryByText('redirect.rateLimitedWithoutDeadline')).toBeNull()
    await vi.waitFor(() => {
      expect(state.assign).toHaveBeenCalledWith('/go/abc123/continue')
    })
  })

  it('counts down the backend retry deadline before allowing another unlock', async () => {
    state.route!.query = { reason: 'password' }
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      intermediateDelaySeconds: null,
      expiresAt: null,
      requiresPassword: true,
    })
    vi.mocked(unlockShortLink)
      .mockRejectedValueOnce(new ApiClientError(200113, 'Too many attempts', {
        retryAt: new Date(Date.now() + 3_000).toISOString(),
      }))
      .mockResolvedValueOnce({ unlocked: true })
    mountPage()
    await flushPreview()

    const passwordInput = screen.getByLabelText('redirect.password')
    const unlockButton = screen.getByRole('button', { name: 'redirect.unlock' }) as HTMLButtonElement
    await fireEvent.update(passwordInput, 'wrongpass')
    await fireEvent.click(unlockButton)

    expect(unlockButton.disabled).toBe(true)
    await vi.advanceTimersByTimeAsync(2_000)
    expect(unlockButton.disabled).toBe(true)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(unlockButton.disabled).toBe(false)

    await fireEvent.update(passwordInput, 'correct horse')
    await fireEvent.click(unlockButton)
    await vi.waitFor(() => expect(state.assign).toHaveBeenCalledWith('/go/abc123/continue'))
  })

  it('does not create a rate-limit timer for an expired retry deadline', async () => {
    state.route!.query = {
      reason: 'rate-limited',
      retryAt: new Date(Date.now() - 1_000).toISOString(),
    }
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      intermediateDelaySeconds: null,
      expiresAt: null,
      requiresPassword: true,
    })
    mountPage()
    await flushPreview()

    expect(screen.queryByText('redirect.rateLimitedWithoutDeadline')).toBeNull()
    const unlockButton = screen.getByRole('button', { name: 'redirect.unlock' }) as HTMLButtonElement
    expect(unlockButton.disabled).toBe(false)
  })

  it.each([
    [new ApiClientError(200111, 'Password required'), 'redirect.passwordRequired'],
    [new Error('network failure'), 'redirect.unlockFailed'],
  ])('maps unlock errors to safe messages', async (error, messageKey) => {
    state.route!.query = { reason: 'password' }
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      intermediateDelaySeconds: 5,
      expiresAt: null,
      requiresPassword: true,
    })
    vi.mocked(unlockShortLink).mockRejectedValueOnce(error)
    mountPage()
    await flushPreview()

    await fireEvent.update(screen.getByLabelText('redirect.password'), 'wrongpass')
    await fireEvent.click(screen.getByRole('button', { name: 'redirect.unlock' }))

    expect(screen.getByText(messageKey)).toBeTruthy()
  })

  it('continues directly after unlocking a protected direct link', async () => {
    state.route!.query = { reason: 'password' }
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      intermediateDelaySeconds: null,
      expiresAt: null,
      requiresPassword: true,
    })
    mountPage()
    await flushPreview()

    await fireEvent.update(screen.getByLabelText('redirect.password'), 'correct horse')
    await fireEvent.click(screen.getByRole('button', { name: 'redirect.unlock' }))

    expect(unlockShortLink).toHaveBeenCalledWith({ slug: 'abc123', password: 'correct horse' })
    expect(state.assign).toHaveBeenCalledWith('/go/abc123/continue')
  })

  it('reads the password from form data and resets the form after unlocking', async () => {
    state.route!.query = { reason: 'password' }
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      intermediateDelaySeconds: null,
      expiresAt: null,
      requiresPassword: true,
    })
    mountPage()
    await flushPreview()

    const passwordInput = screen.getByLabelText('redirect.password') as HTMLInputElement
    passwordInput.value = 'correct horse'
    const form = passwordInput.closest('form')
    expect(form).not.toBeNull()
    await fireEvent.submit(form!)

    expect(unlockShortLink).toHaveBeenCalledWith({ slug: 'abc123', password: 'correct horse' })
    expect(passwordInput.value).toBe('')
  })

  it('falls back to the route slug when an unlock preview omits its slug', async () => {
    state.route!.query = { reason: 'password' }
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      targetHost: 'example.com',
      intermediateDelaySeconds: null,
      expiresAt: null,
      requiresPassword: true,
    } as never)
    mountPage()
    await flushPreview()

    await fireEvent.update(screen.getByLabelText('redirect.password'), 'correct horse')
    await fireEvent.click(screen.getByRole('button', { name: 'redirect.unlock' }))

    expect(unlockShortLink).toHaveBeenCalledWith({ slug: 'abc123', password: 'correct horse' })
    expect(state.assign).toHaveBeenCalledWith('/go/abc123/continue')
  })

  it('uses the canonical preview slug for protected access', async () => {
    state.route!.params = { slug: 'AbC123' }
    state.route!.query = { reason: 'password' }
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      intermediateDelaySeconds: null,
      expiresAt: null,
      requiresPassword: true,
    })
    mountPage()
    await flushPreview()

    await fireEvent.update(screen.getByLabelText('redirect.password'), 'correct horse')
    await fireEvent.click(screen.getByRole('button', { name: 'redirect.unlock' }))

    expect(unlockShortLink).toHaveBeenCalledWith({ slug: 'abc123', password: 'correct horse' })
    expect(state.assign).toHaveBeenCalledWith('/go/abc123/continue')
  })

  it('ignores duplicate unlock submissions while the first request is pending', async () => {
    state.route!.query = { reason: 'password' }
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      intermediateDelaySeconds: null,
      expiresAt: null,
      requiresPassword: true,
    })
    const unlock = createDeferred<{ unlocked: true }>()
    vi.mocked(unlockShortLink).mockReturnValueOnce(unlock.promise)
    mountPage()
    await flushPreview()
    await fireEvent.update(screen.getByLabelText('redirect.password'), 'correct horse')

    const button = screen.getByRole('button', { name: 'redirect.unlock' })
    const first = fireEvent.click(button)
    const second = fireEvent.click(button)
    await Promise.all([first, second])

    expect(unlockShortLink).toHaveBeenCalledTimes(1)
    unlock.resolve({ unlocked: true })
    await flushPreview()
  })

  it.each(['success', 'failure'])('ignores a stale %s unlock after navigating to another slug', async (outcome) => {
    state.route!.query = { reason: 'password' }
    vi.mocked(getPublicShortLinkPreview)
      .mockResolvedValueOnce({
        slug: 'abc123',
        targetHost: 'example.com',
        intermediateDelaySeconds: null,
        expiresAt: null,
        requiresPassword: true,
      })
      .mockResolvedValueOnce({
        slug: 'def456',
        targetHost: 'other.example.com',
        intermediateDelaySeconds: null,
        expiresAt: null,
        requiresPassword: true,
      })
    const unlock = createDeferred<{ unlocked: true }>()
    vi.mocked(unlockShortLink).mockReturnValueOnce(unlock.promise)
    mountPage()
    await flushPreview()
    await fireEvent.update(screen.getByLabelText('redirect.password'), 'correct horse')
    await fireEvent.click(screen.getByRole('button', { name: 'redirect.unlock' }))

    state.route!.params.slug = 'def456'
    await flushPreview()
    expect(screen.getByText('other.example.com')).toBeTruthy()

    if (outcome === 'success') {
      unlock.resolve({ unlocked: true })
    } else {
      unlock.reject(new Error('stale unlock failure'))
    }
    await flushPreview()

    expect(screen.getByText('other.example.com')).toBeTruthy()
    expect(screen.queryByText('redirect.unlockFailed')).toBeNull()
    expect(state.assign).not.toHaveBeenCalled()
  })

  it('starts the intermediate countdown after unlocking', async () => {
    state.route!.query = { reason: 'password' }
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      intermediateDelaySeconds: 3,
      expiresAt: null,
      requiresPassword: true,
    })
    mountPage()
    await flushPreview()

    await fireEvent.update(screen.getByLabelText('redirect.password'), 'correct horse')
    await fireEvent.click(screen.getByRole('button', { name: 'redirect.unlock' }))
    expect(screen.getByText('3')).toBeTruthy()

    await vi.advanceTimersByTimeAsync(3_000)
    expect(state.assign).toHaveBeenCalledWith('/go/abc123/continue')
  })

  it('falls back to the route slug when an intermediate preview omits its slug', async () => {
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      targetHost: 'example.com',
      intermediateDelaySeconds: 3,
      expiresAt: null,
      requiresPassword: false,
    } as never)
    mountPage()
    await flushPreview()

    await vi.advanceTimersByTimeAsync(3_000)
    expect(state.assign).toHaveBeenCalledWith('/go/abc123/continue')
  })

  it('rejects missing route slugs without calling the preview API', async () => {
    state.route!.params = {}
    mountPage()
    await flushPreview()

    expect(getPublicShortLinkPreview).not.toHaveBeenCalled()
    expect(screen.getByText('redirect.unavailable')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'redirect.retry' })).toBeNull()
  })

  it('clears the countdown interval when unmounted', async () => {
    const clearInterval = vi.spyOn(globalThis, 'clearInterval')
    const view = mountPage()
    await flushPreview()

    view.unmount()

    expect(clearInterval).toHaveBeenCalled()
  })

  it('does not start a countdown when a pending preview resolves after unmount', async () => {
    const preview = createDeferred<{
      slug: string
      targetHost: string
      intermediateDelaySeconds: number
      expiresAt: null
      requiresPassword: false
    }>()
    const setInterval = vi.spyOn(globalThis, 'setInterval')
    vi.mocked(getPublicShortLinkPreview).mockReturnValueOnce(preview.promise)
    const view = mountPage()

    view.unmount()
    preview.resolve({
      slug: 'abc123',
      targetHost: 'example.com',
      intermediateDelaySeconds: 5,
      expiresAt: null,
      requiresPassword: false,
    })
    await flushPreview()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(setInterval).not.toHaveBeenCalled()
    expect(state.assign).not.toHaveBeenCalled()
  })

  it('ignores a successful unlock that resolves after unmount', async () => {
    state.route!.query = { reason: 'password' }
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      intermediateDelaySeconds: null,
      expiresAt: null,
      requiresPassword: true,
    })
    const unlock = createDeferred<{ unlocked: true }>()
    vi.mocked(unlockShortLink).mockReturnValueOnce(unlock.promise)
    const view = mountPage()
    await flushPreview()
    await fireEvent.update(screen.getByLabelText('redirect.password'), 'correct horse')
    await fireEvent.click(screen.getByRole('button', { name: 'redirect.unlock' }))

    view.unmount()
    unlock.resolve({ unlocked: true })
    await flushPreview()

    expect(state.assign).not.toHaveBeenCalled()
  })

  it('ignores a failed unlock that rejects after unmount', async () => {
    state.route!.query = { reason: 'password' }
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      intermediateDelaySeconds: 5,
      expiresAt: null,
      requiresPassword: true,
    })
    const unlock = createDeferred<{ unlocked: true }>()
    vi.mocked(unlockShortLink).mockReturnValueOnce(unlock.promise)
    const view = mountPage()
    await flushPreview()
    await fireEvent.update(screen.getByLabelText('redirect.password'), 'correct horse')
    await fireEvent.click(screen.getByRole('button', { name: 'redirect.unlock' }))

    view.unmount()
    unlock.reject(new Error('network failure'))
    await flushPreview()

    expect(state.assign).not.toHaveBeenCalled()
  })
})
