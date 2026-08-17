import { fireEvent, render, screen } from '@testing-library/vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive, ref, type Ref } from 'vue'

import RedirectPage from './RedirectPage.vue'
import { getPublicShortLinkPreview, unlockShortLink } from '@/entities/short-link/api'
import { ApiClientError } from '@/shared/api/client'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'

const state = vi.hoisted(() => ({
  assign: vi.fn(),
  locale: undefined as unknown as Ref<string>,
  route: undefined as undefined | {
    params: Record<string, unknown>
    query: Record<string, unknown>
  },
}))

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ locale: state.locale, t: (key: string) => key }),
}))

vi.mock('vue-router', () => ({
  useRoute: () => state.route,
}))

vi.mock('@/entities/short-link/api', () => ({
  getPublicShortLinkPreview: vi.fn(),
  unlockShortLink: vi.fn(),
}))

/** Mounts the public redirect page with shared component stubs. */
function mountPage() {
  return render(RedirectPage, {
    global: { stubs: componentStubs },
  })
}

/** Configures the next preview request to require password authorization. */
function mockUnauthorizedPreview() {
  vi.mocked(getPublicShortLinkPreview).mockRejectedValueOnce(new ApiClientError(200111, 'Password required'))
}

/** Flushes the preview promise and its reactive DOM update. */
async function flushPreview() {
  await Promise.resolve()
  await nextTick()
}

describe('RedirectPage', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    state.assign.mockReset()
    state.locale = ref('zh-CN')
    state.route = reactive({ params: { slug: 'abc123' }, query: {} })
    vi.stubGlobal('location', { assign: state.assign })
    vi.mocked(getPublicShortLinkPreview).mockReset()
    vi.mocked(unlockShortLink).mockReset()
    vi.mocked(getPublicShortLinkPreview).mockResolvedValue({
      slug: 'abc123',
      targetHost: 'example.com',
      redirectMode: 'intermediate',
      intermediateDelaySeconds: 5,
      expiresAt: null,
    })
    vi.mocked(unlockShortLink).mockResolvedValue({ unlocked: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
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
        redirectMode: 'intermediate',
        intermediateDelaySeconds: 3,
        expiresAt: null,
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
    [200110, 'redirect.notInteractive'],
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
    ['not-interactive', 'redirect.notInteractive'],
  ])('renders the localized public status for redirect reason %s', async (reason, messageKey) => {
    state.route!.query = { reason }
    mountPage()
    await flushPreview()

    expect(getPublicShortLinkPreview).not.toHaveBeenCalled()
    expect(screen.getByText(messageKey)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'redirect.retry' })).toBeNull()
  })

  it.each(['password', 'rate-limited'])('continues after an authorized preview despite reason %s', async (reason) => {
    state.route!.query = { reason }
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      redirectMode: 'direct',
      intermediateDelaySeconds: null,
      expiresAt: null,
    })
    mountPage()
    await flushPreview()

    expect(screen.queryByLabelText('redirect.password')).toBeNull()
    expect(state.assign).toHaveBeenCalledWith('/go/abc123/continue')
  })

  it('keeps the password form when the protected preview requires authorization', async () => {
    state.route!.query = { reason: 'password' }
    vi.mocked(getPublicShortLinkPreview)
      .mockRejectedValueOnce(new ApiClientError(200111, 'Password required'))
      .mockResolvedValueOnce({
        slug: 'abc123',
        targetHost: 'example.com',
        redirectMode: 'direct',
        intermediateDelaySeconds: null,
        expiresAt: null,
      })
    mountPage()
    await flushPreview()

    expect(screen.getByLabelText('redirect.password')).toBeTruthy()
    await fireEvent.update(screen.getByLabelText('redirect.password'), 'correct horse')
    await fireEvent.click(screen.getByRole('button', { name: 'redirect.unlock' }))
    await vi.waitFor(() => expect(state.assign).toHaveBeenCalledWith('/go/abc123/continue'))
  })

  it('waits for an explicit click on a confirmation preview', async () => {
    const setInterval = vi.spyOn(globalThis, 'setInterval')
    const expiresAt = '2026-08-14T02:30:00Z'
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      redirectMode: 'confirmation',
      intermediateDelaySeconds: null,
      expiresAt,
    })

    const { container } = mountPage()
    await flushPreview()

    expect(screen.getByText('redirect.confirmationTitle')).toBeTruthy()
    expect(screen.getByText('redirect.confirmationDescription')).toBeTruthy()
    expect(screen.getByText('abc123')).toBeTruthy()
    expect(screen.getByText('redirect.shortCode')).toBeTruthy()
    expect(screen.getByText('redirect.expiresAt')).toBeTruthy()
    expect(container.querySelector(`time[datetime="${expiresAt}"]`)).toBeTruthy()
    expect(container.querySelector('.redirect-page__countdown')).toBeNull()
    expect(setInterval).not.toHaveBeenCalled()
    expect(state.assign).not.toHaveBeenCalled()

    const continueButton = screen.getByRole('button', { name: 'redirect.confirmationContinue' })
    await fireEvent.click(continueButton)
    await fireEvent.click(continueButton)
    expect(state.assign).toHaveBeenCalledWith('/go/abc123/continue')
    expect(state.assign).toHaveBeenCalledTimes(1)
  })

  it('updates confirmation expiration when the application locale changes', async () => {
    const expiresAt = '2026-08-14T02:30:00Z'
    const formatOptions = {
      dateStyle: 'medium',
      timeStyle: 'short',
    } as const
    const date = new Date(expiresAt)
    const zhExpiration = new Intl.DateTimeFormat('zh-CN', formatOptions).format(date)
    const enExpiration = new Intl.DateTimeFormat('en', formatOptions).format(date)
    expect(zhExpiration).not.toBe(enExpiration)
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      redirectMode: 'confirmation',
      intermediateDelaySeconds: null,
      expiresAt,
    })

    const { container } = mountPage()
    await flushPreview()

    const expiration = container.querySelector(`time[datetime="${expiresAt}"]`)
    expect(expiration?.textContent).toBe(zhExpiration)

    state.locale.value = 'en'
    await nextTick()

    expect(expiration?.textContent).toBe(enExpiration)
  })

  it('omits expiration metadata from confirmation previews without an expiration', async () => {
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      redirectMode: 'confirmation',
      intermediateDelaySeconds: null,
      expiresAt: null,
    })

    const { container } = mountPage()
    await flushPreview()

    expect(screen.getByText('abc123')).toBeTruthy()
    expect(screen.queryByText('redirect.expiresAt')).toBeNull()
    expect(container.querySelector('time')).toBeNull()
  })

  it('falls back to the raw expiration value when preview time formatting fails', async () => {
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      redirectMode: 'confirmation',
      intermediateDelaySeconds: null,
      expiresAt: 'invalid-time',
    })

    const { container } = mountPage()
    await flushPreview()

    expect(screen.getByText('invalid-time')).toBeTruthy()
    expect(container.querySelector('time')?.getAttribute('datetime')).toBe('invalid-time')
  })

  it('reloads a confirmation preview after a continue failure and allows retry', async () => {
    state.route!.query = { reason: 'continue-failed' }
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      redirectMode: 'confirmation',
      intermediateDelaySeconds: null,
      expiresAt: null,
    })

    mountPage()
    await flushPreview()

    expect(getPublicShortLinkPreview).toHaveBeenCalledWith('abc123')
    expect(screen.getByText('redirect.continueFailed')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'redirect.confirmationContinue' }))
    expect(state.assign).toHaveBeenCalledWith('/go/abc123/continue')
  })

  it('does not automatically retry a direct preview after a continue failure', async () => {
    state.route!.query = { reason: 'continue-failed' }
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      redirectMode: 'direct',
      intermediateDelaySeconds: null,
      expiresAt: null,
    })

    mountPage()
    await flushPreview()

    expect(screen.getByText('redirect.continueFailed')).toBeTruthy()
    expect(state.assign).not.toHaveBeenCalled()
    await fireEvent.click(screen.getByRole('button', { name: 'redirect.continue' }))
    expect(state.assign).toHaveBeenCalledWith('/go/abc123/continue')
  })

  it('does not restart an intermediate countdown after a continue failure', async () => {
    state.route!.query = { reason: 'continue-failed' }
    const setInterval = vi.spyOn(globalThis, 'setInterval')
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      redirectMode: 'intermediate',
      intermediateDelaySeconds: 5,
      expiresAt: null,
    })

    mountPage()
    await flushPreview()

    expect(screen.getByText('redirect.continueFailed')).toBeTruthy()
    expect(setInterval).not.toHaveBeenCalled()
    await fireEvent.click(screen.getByRole('button', { name: 'redirect.continue' }))
    expect(state.assign).toHaveBeenCalledWith('/go/abc123/continue')
  })

  it.each([
    { redirectMode: 'direct' as const, intermediateDelaySeconds: null },
    { redirectMode: 'intermediate' as const, intermediateDelaySeconds: 5 },
  ])('waits for a manual retry after password reauthorization in $redirectMode mode', async (preview) => {
    state.route!.query = { reason: 'continue-failed' }
    const setInterval = vi.spyOn(globalThis, 'setInterval')
    mockUnauthorizedPreview()
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      expiresAt: null,
      ...preview,
    })

    mountPage()
    await flushPreview()
    await fireEvent.update(screen.getByLabelText('redirect.password'), 'correct horse')
    await fireEvent.click(screen.getByRole('button', { name: 'redirect.unlock' }))
    await vi.waitFor(() => expect(screen.getByText('redirect.continueFailed')).toBeTruthy())

    expect(state.assign).not.toHaveBeenCalled()
    expect(setInterval.mock.calls.some(([, delay]) => delay === 1_000)).toBe(false)
    await fireEvent.click(screen.getByRole('button', { name: 'redirect.continue' }))
    expect(state.assign).toHaveBeenCalledWith('/go/abc123/continue')
  })

  it('keeps a protected confirmation preview waiting after unlock', async () => {
    state.route!.query = { reason: 'password' }
    mockUnauthorizedPreview()
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      redirectMode: 'confirmation',
      intermediateDelaySeconds: null,
      expiresAt: null,
    })
    mountPage()
    await flushPreview()

    await fireEvent.update(screen.getByLabelText('redirect.password'), 'correct horse')
    await fireEvent.click(screen.getByRole('button', { name: 'redirect.unlock' }))
    await vi.waitFor(() => expect(screen.getByText('redirect.confirmationTitle')).toBeTruthy())

    expect(state.assign).not.toHaveBeenCalled()
    await fireEvent.click(screen.getByRole('button', { name: 'redirect.confirmationContinue' }))
    expect(state.assign).toHaveBeenCalledWith('/go/abc123/continue')
  })

  it('shows an invalid-password error without navigating', async () => {
    state.route!.query = { reason: 'password' }
    mockUnauthorizedPreview()
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      redirectMode: 'intermediate',
      intermediateDelaySeconds: 5,
      expiresAt: null,
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
  ])('shows the password rate-limit state for query %s or unlock error %s', async (query, unlockError) => {
    state.route!.query = query
    mockUnauthorizedPreview()
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      redirectMode: 'intermediate',
      intermediateDelaySeconds: 5,
      expiresAt: null,
    })
    mountPage()
    await flushPreview()

    if (unlockError) {
      vi.mocked(unlockShortLink).mockRejectedValueOnce(unlockError)
      await fireEvent.update(screen.getByLabelText('redirect.password'), 'wrongpass')
      await fireEvent.click(screen.getByRole('button', { name: 'redirect.unlock' }))
    }
    expect(screen.getByText('redirect.rateLimitedWithoutDeadline')).toBeTruthy()
    expect(state.assign).not.toHaveBeenCalled()
  })

  it('requires a non-empty password before sending an unlock request', async () => {
    state.route!.query = { reason: 'password' }
    mockUnauthorizedPreview()
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      redirectMode: 'intermediate',
      intermediateDelaySeconds: 5,
      expiresAt: null,
    })
    mountPage()
    await flushPreview()

    await fireEvent.click(screen.getByRole('button', { name: 'redirect.unlock' }))

    expect(screen.getByText('redirect.passwordRequired')).toBeTruthy()
    expect(unlockShortLink).not.toHaveBeenCalled()
  })

  it('lets the backend re-evaluate a rate-limited unlock request', async () => {
    state.route!.query = { reason: 'rate-limited' }
    mockUnauthorizedPreview()
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      redirectMode: 'direct',
      intermediateDelaySeconds: null,
      expiresAt: null,
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
    mockUnauthorizedPreview()
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      redirectMode: 'direct',
      intermediateDelaySeconds: null,
      expiresAt: null,
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
    mockUnauthorizedPreview()
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      redirectMode: 'direct',
      intermediateDelaySeconds: null,
      expiresAt: null,
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
  ])('maps unlock error %s to safe message %s', async (error, messageKey) => {
    state.route!.query = { reason: 'password' }
    mockUnauthorizedPreview()
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      redirectMode: 'intermediate',
      intermediateDelaySeconds: 5,
      expiresAt: null,
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
    mockUnauthorizedPreview()
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      redirectMode: 'direct',
      intermediateDelaySeconds: null,
      expiresAt: null,
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
    mockUnauthorizedPreview()
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      redirectMode: 'direct',
      intermediateDelaySeconds: null,
      expiresAt: null,
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
    mockUnauthorizedPreview()
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      targetHost: 'example.com',
      redirectMode: 'direct',
      intermediateDelaySeconds: null,
      expiresAt: null,
    } as never)
    mountPage()
    await flushPreview()

    await fireEvent.update(screen.getByLabelText('redirect.password'), 'correct horse')
    await fireEvent.click(screen.getByRole('button', { name: 'redirect.unlock' }))

    expect(unlockShortLink).toHaveBeenCalledWith({ slug: 'abc123', password: 'correct horse' })
    expect(state.assign).toHaveBeenCalledWith('/go/abc123/continue')
  })

  it('unlocks with the route slug and navigates with the canonical preview slug', async () => {
    state.route!.params = { slug: 'AbC123' }
    state.route!.query = { reason: 'password' }
    mockUnauthorizedPreview()
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      redirectMode: 'direct',
      intermediateDelaySeconds: null,
      expiresAt: null,
    })
    mountPage()
    await flushPreview()

    await fireEvent.update(screen.getByLabelText('redirect.password'), 'correct horse')
    await fireEvent.click(screen.getByRole('button', { name: 'redirect.unlock' }))

    expect(unlockShortLink).toHaveBeenCalledWith({ slug: 'AbC123', password: 'correct horse' })
    expect(state.assign).toHaveBeenCalledWith('/go/abc123/continue')
  })

  it('ignores duplicate unlock submissions while the first request is pending', async () => {
    state.route!.query = { reason: 'password' }
    mockUnauthorizedPreview()
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      redirectMode: 'direct',
      intermediateDelaySeconds: null,
      expiresAt: null,
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
    mockUnauthorizedPreview()
    vi.mocked(getPublicShortLinkPreview)
      .mockResolvedValueOnce({
        slug: 'def456',
        targetHost: 'other.example.com',
        redirectMode: 'intermediate',
        intermediateDelaySeconds: 5,
        expiresAt: null,
      })
    const unlock = createDeferred<{ unlocked: true }>()
    vi.mocked(unlockShortLink).mockReturnValueOnce(unlock.promise)
    mountPage()
    await flushPreview()
    await fireEvent.update(screen.getByLabelText('redirect.password'), 'correct horse')
    await fireEvent.click(screen.getByRole('button', { name: 'redirect.unlock' }))

    state.route!.params.slug = 'def456'
    await vi.waitFor(() => expect(screen.getByText('other.example.com')).toBeTruthy())

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

  it('ignores an authorized preview that resolves after navigating to another slug', async () => {
    state.route!.query = { reason: 'password' }
    const authorizedPreview = createDeferred<{
      slug: string
      targetHost: string
      redirectMode: 'intermediate'
      intermediateDelaySeconds: number
      expiresAt: null
    }>()
    vi.mocked(getPublicShortLinkPreview)
      .mockRejectedValueOnce(new ApiClientError(200111, 'Password required'))
      .mockReturnValueOnce(authorizedPreview.promise)
      .mockResolvedValueOnce({
        slug: 'def456',
        targetHost: 'other.example.com',
        redirectMode: 'intermediate',
        intermediateDelaySeconds: 5,
        expiresAt: null,
      })
    mountPage()
    await flushPreview()
    await fireEvent.update(screen.getByLabelText('redirect.password'), 'correct horse')
    await fireEvent.click(screen.getByRole('button', { name: 'redirect.unlock' }))
    await vi.waitFor(() => expect(getPublicShortLinkPreview).toHaveBeenCalledTimes(2))

    state.route!.params.slug = 'def456'
    state.route!.query = {}
    await vi.waitFor(() => expect(getPublicShortLinkPreview).toHaveBeenCalledTimes(3))
    await flushPreview()
    expect(screen.getByText('other.example.com')).toBeTruthy()

    authorizedPreview.resolve({
      slug: 'abc123',
      targetHost: 'example.com',
      redirectMode: 'intermediate',
      intermediateDelaySeconds: 5,
      expiresAt: null,
    })
    await flushPreview()

    expect(screen.getByText('other.example.com')).toBeTruthy()
    expect(state.assign).not.toHaveBeenCalled()
  })

  it('starts the intermediate countdown after unlocking', async () => {
    state.route!.query = { reason: 'password' }
    mockUnauthorizedPreview()
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      redirectMode: 'intermediate',
      intermediateDelaySeconds: 3,
      expiresAt: null,
    })
    mountPage()
    await flushPreview()

    await fireEvent.update(screen.getByLabelText('redirect.password'), 'correct horse')
    await fireEvent.click(screen.getByRole('button', { name: 'redirect.unlock' }))
    await vi.waitFor(() => expect(screen.getByText('3')).toBeTruthy())

    await vi.advanceTimersByTimeAsync(3_000)
    expect(state.assign).toHaveBeenCalledWith('/go/abc123/continue')
  })

  it('falls back to the route slug when an intermediate preview omits its slug', async () => {
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      targetHost: 'example.com',
      redirectMode: 'intermediate',
      intermediateDelaySeconds: 3,
      expiresAt: null,
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
      redirectMode: 'intermediate'
      intermediateDelaySeconds: number
      expiresAt: null
    }>()
    const setInterval = vi.spyOn(globalThis, 'setInterval')
    vi.mocked(getPublicShortLinkPreview).mockReturnValueOnce(preview.promise)
    const view = mountPage()

    view.unmount()
    preview.resolve({
      slug: 'abc123',
      targetHost: 'example.com',
      redirectMode: 'intermediate',
      intermediateDelaySeconds: 5,
      expiresAt: null,
    })
    await flushPreview()
    await vi.advanceTimersByTimeAsync(10_000)

    expect(setInterval).not.toHaveBeenCalled()
    expect(state.assign).not.toHaveBeenCalled()
  })

  it('ignores a successful unlock that resolves after unmount', async () => {
    state.route!.query = { reason: 'password' }
    mockUnauthorizedPreview()
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      redirectMode: 'direct',
      intermediateDelaySeconds: null,
      expiresAt: null,
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
    mockUnauthorizedPreview()
    vi.mocked(getPublicShortLinkPreview).mockResolvedValueOnce({
      slug: 'abc123',
      targetHost: 'example.com',
      redirectMode: 'intermediate',
      intermediateDelaySeconds: 5,
      expiresAt: null,
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
