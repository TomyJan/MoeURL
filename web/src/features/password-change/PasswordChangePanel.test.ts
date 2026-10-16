import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { changePassword, getPasswordStatus } from '@/entities/auth/password'
import { ApiClientError } from '@/shared/api/client'
import { componentStubs } from '@/test/component-stubs'
import PasswordChangePanel from './PasswordChangePanel.vue'
import ProfilePage from '@/pages/ProfilePage.vue'
import { me } from '@/entities/auth/api'
import { updateProfile } from '@/entities/user/api'

const state = vi.hoisted(() => ({ replace: vi.fn() }))
vi.mock('vue-router', () => ({ useRouter: () => ({ replace: state.replace }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/entities/auth/password', () => ({ getPasswordStatus: vi.fn(), changePassword: vi.fn() }))
vi.mock('@/entities/auth/api', () => ({ me: vi.fn() }))
vi.mock('@/entities/user/api', () => ({ updateProfile: vi.fn() }))

const clients: QueryClient[] = []
/** Creates a controlled promise without timing assumptions. */
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
/** Mounts with real query state and a fresh cache per scenario. */
function mountPanel(client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }), profile = false) {
  clients.push(client)
  const i18n = createI18n({ legacy: false, locale: 'test', missingWarn: false, fallbackWarn: false, messages: {} })
  return { ...render(profile ? ProfilePage : PasswordChangePanel, { global: { plugins: [[VueQueryPlugin, { queryClient: client }], i18n], stubs: { ...componentStubs, PreferenceSwitcher: true, AccountPreferencesPanel: { props: ['active'], template: '<section data-testid="account-preferences-panel" :data-active="active" />' } } } }), client }
}
/** Enters a draft using visible password fields. */
async function fill(currentPassword = 'old', newPassword = 'newpassword', confirmPassword = newPassword) {
  await screen.findByLabelText('passwordChange.currentPassword')
  await fireEvent.update(screen.getByLabelText('passwordChange.currentPassword'), currentPassword)
  await fireEvent.update(screen.getByLabelText('passwordChange.newPassword'), newPassword)
  await fireEvent.update(screen.getByLabelText('passwordChange.confirmPassword'), confirmPassword)
}
/** Submits the actual form, including keyboard submission paths. */
async function submit() {
  await fireEvent.submit(screen.getByTestId('password-change-form'))
}
/** Verifies that all three local inputs have been cleared. */
function expectCleared() {
  for (const input of screen.getAllByLabelText(/passwordChange\.(current|new|confirm)Password/)) {
    expect((input as HTMLInputElement).value).toBe('')
  }
}

/** Verifies that only the inert guest identity survives account-cache removal. */
function expectGuestCache(client: QueryClient) {
  expect(client.getQueryCache().getAll().map((query) => query.queryKey)).toEqual([['auth', 'me']])
  expect(client.getQueryData(['auth', 'me'])).toMatchObject({ user: { group: 'guest', permissions: [] } })
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getPasswordStatus).mockResolvedValue({ canChangePassword: true })
  vi.mocked(changePassword).mockResolvedValue({ changed: true })
})
afterEach(() => {
  cleanup()
  for (const client of clients.splice(0)) client.clear()
})

describe('PasswordChangePanel', () => {
  it('waits for authoritative status before showing a form', async () => {
    const status = deferred<{ canChangePassword: boolean }>()
    vi.mocked(getPasswordStatus).mockReturnValue(status.promise)
    mountPanel()
    expect(screen.getByRole('progressbar')).toBeTruthy()
    expect(screen.queryByTestId('password-change-form')).toBeNull()
    status.resolve({ canChangePassword: true })
    await screen.findByTestId('password-change-form')
    expect(screen.getByText('passwordChange.loginPolicyNote')).toBeTruthy()
    expect(screen.getByLabelText('passwordChange.currentPassword').getAttribute('autocomplete')).toBe('current-password')
    expect(screen.getByLabelText('passwordChange.newPassword').getAttribute('autocomplete')).toBe('new-password')
  })

  it.each([new Error('private failure'), new ApiClientError(100001, 'private failure')])('keeps a persistent error and manually retries without automatic retries: %#', async (error) => {
    vi.mocked(getPasswordStatus).mockRejectedValueOnce(error)
    mountPanel()
    await screen.findByText('passwordChange.statusFailed')
    expect(getPasswordStatus).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('password-change-form')).toBeNull()
    await fireEvent.click(screen.getByText('passwordChange.retry'))
    await screen.findByTestId('password-change-form')
    expect(screen.queryByText('private failure')).toBeNull()
  })

  it('shows an external identity explanation without a password form', async () => {
    vi.mocked(getPasswordStatus).mockResolvedValue({ canChangePassword: false })
    mountPanel()
    await screen.findByText('passwordChange.externalIdentity')
    expect(screen.queryByTestId('password-change-form')).toBeNull()
  })

  it('clears stale identity and returns to login when the status request has an expired session', async () => {
    vi.mocked(getPasswordStatus).mockRejectedValue(new ApiClientError(401, 'private detail'))
    const { client } = mountPanel()
    client.setQueryData(['auth', 'me'], { user: 'stale' })
    await waitFor(() => expect(state.replace).toHaveBeenCalledWith('/login?redirect=/profile'))
    expectGuestCache(client)
    expect(toast.error).toHaveBeenCalledWith('passwordChange.sessionExpired')
  })

  it('does not navigate or announce success if unmounted while identity reads are being cancelled', async () => {
    const cancelled = deferred<void>()
    const { client, unmount } = mountPanel()
    const cancel = vi.spyOn(client, 'cancelQueries').mockReturnValue(cancelled.promise)
    await fill()
    await submit()
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1))
    unmount()
    cancelled.resolve()
    await cancelled.promise
    expectGuestCache(client)
    expect(state.replace).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('allows an existing short password at the exact 4096 UTF-8 byte boundary', async () => {
    const request = deferred<{ changed: true }>()
    vi.mocked(changePassword).mockReturnValue(request.promise)
    mountPanel()
    await fill('é'.repeat(2048))
    await submit()
    expect(changePassword).toHaveBeenCalledWith({ currentPassword: 'é'.repeat(2048), newPassword: 'newpassword' })
    request.reject(new Error('private detail'))
    await waitFor(expectCleared)
  })

  it('blocks stale cached availability during a failed background refresh', async () => {
    const client = new QueryClient()
    client.setQueryData(['auth', 'password', 'status'], { canChangePassword: true })
    vi.mocked(getPasswordStatus).mockRejectedValue(new Error('private failure'))
    mountPanel(client)
    await screen.findByText('passwordChange.statusFailed')
    expect(screen.queryByTestId('password-change-form')).toBeNull()
    expect(changePassword).not.toHaveBeenCalled()
  })

  it('locks cached forms while status is being rechecked', async () => {
    const client = new QueryClient()
    client.setQueryData(['auth', 'password', 'status'], { canChangePassword: true })
    const status = deferred<{ canChangePassword: boolean }>()
    vi.mocked(getPasswordStatus).mockReturnValue(status.promise)
    mountPanel(client)
    await fill()
    await submit()
    expect(changePassword).not.toHaveBeenCalled()
    expect((screen.getByText('passwordChange.submit').closest('button') as HTMLButtonElement).disabled).toBe(true)
    status.resolve({ canChangePassword: true })
    await waitFor(() => expect((screen.getByText('passwordChange.submit').closest('button') as HTMLButtonElement).disabled).toBe(false))
  })

  it.each([
    ['', 'newpassword', 'newpassword', 'currentInvalid'],
    ['é'.repeat(2049), 'newpassword', 'newpassword', 'currentInvalid'],
    ['\ud800', 'newpassword', 'newpassword', 'currentInvalid'],
    ['old', '😀'.repeat(7), '😀'.repeat(7), 'newInvalid'],
    ['old', '😀'.repeat(129), '😀'.repeat(129), 'newInvalid'],
    ['old', 'abcdefg\udfff', 'abcdefg\udfff', 'newInvalid'],
    ['newpassword', 'newpassword', 'newpassword', 'mustDiffer'],
    ['old', 'newpassword', 'different', 'confirmationMismatch'],
  ])('validates credential and confirmation boundary %#', async (current, next, confirm, message) => {
    mountPanel()
    await fill(current, next, confirm)
    await submit()
    await screen.findByText(`passwordChange.${message}`)
    expect(changePassword).not.toHaveBeenCalled()
  })

  it('shows the basic current and new password requirements for an empty form', async () => {
    mountPanel()
    await screen.findByTestId('password-change-form')
    await submit()
    expect(screen.getByText('passwordChange.currentInvalid')).toBeTruthy()
    expect(screen.getByText('passwordChange.newInvalid')).toBeTruthy()
    expect(screen.queryByText('passwordChange.mustDiffer')).toBeNull()
    expect(changePassword).not.toHaveBeenCalled()
  })

  it.each(['😀'.repeat(8), '😀'.repeat(128), '  特殊"\\$<>&密码  '])('preserves valid Unicode and original values %#', async (next) => {
    const request = deferred<{ changed: true }>()
    vi.mocked(changePassword).mockReturnValue(request.promise)
    mountPanel()
    await fill(' old ', next)
    await submit()
    expect(changePassword).toHaveBeenCalledWith({ currentPassword: ' old ', newPassword: next })
    request.reject(new ApiClientError(110101, 'private detail'))
    await waitFor(expectCleared)
  })

  it('shares the pending lock and keeps credentials out of both query and mutation caches', async () => {
    const request = deferred<{ changed: true }>()
    vi.mocked(changePassword).mockReturnValue(request.promise)
    const { client } = mountPanel()
    await fill()
    await submit()
    await submit()
    expect(changePassword).toHaveBeenCalledTimes(1)
    expect(client.getMutationCache().getAll()).toEqual([])
    expect(JSON.stringify(client.getQueryCache().getAll().map((query) => query.state.data))).not.toContain('newpassword')
    expect((screen.getByLabelText('passwordChange.currentPassword') as HTMLInputElement).disabled).toBe(true)
    request.reject(new Error('private failure'))
    await waitFor(expectCleared)
  })

  it.each([
    [new ApiClientError(100001, 'private detail'), 'invalidRequest'],
    [new ApiClientError(110101, 'private detail'), 'wrongPassword'],
    [new ApiClientError(110103, 'private detail'), 'rateLimited'],
    [new ApiClientError(500, 'private detail'), 'failed'],
    [new ApiClientError(900000, 'private detail'), 'failed'],
    [new Error('private detail'), 'failed'],
  ])('localizes service failures and clears the draft %#', async (error, message) => {
    vi.mocked(changePassword).mockRejectedValue(error)
    mountPanel()
    await fill()
    await submit()
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(`passwordChange.${message}`))
    expectCleared()
    expect(state.replace).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalledWith(expect.stringContaining('private'))
  })

  it('refreshes availability when local credentials become unavailable', async () => {
    vi.mocked(changePassword).mockRejectedValue(new ApiClientError(110105, 'private detail'))
    vi.mocked(getPasswordStatus).mockResolvedValueOnce({ canChangePassword: true }).mockResolvedValueOnce({ canChangePassword: false })
    mountPanel()
    await fill()
    await submit()
    await screen.findByText('passwordChange.externalIdentity')
    expect(toast.error).toHaveBeenCalledWith('passwordChange.unavailable')
    expect(getPasswordStatus).toHaveBeenCalledTimes(2)
  })

  it.each(['success', 'expired'] as const)('cancels and clears all cached identities before replacing the route: %s', async (outcome) => {
    if (outcome === 'expired') vi.mocked(changePassword).mockRejectedValue(new ApiClientError(401, 'private detail'))
    const { client, unmount } = mountPanel()
    client.setQueryData(['links'], { private: true })
    const cancel = vi.spyOn(client, 'cancelQueries')
    const remove = vi.spyOn(client, 'removeQueries')
    state.replace.mockImplementation(() => {
      expectGuestCache(client)
      unmount()
      return Promise.resolve()
    })
    await fill()
    await submit()
    await waitFor(() => expect(state.replace).toHaveBeenCalledWith('/login?redirect=/profile'))
    expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(remove.mock.invocationCallOrder[0]!)
    expect(remove.mock.invocationCallOrder[0]).toBeLessThan(state.replace.mock.invocationCallOrder[0]!)
    expect(outcome === 'success' ? toast.success : toast.error).toHaveBeenCalledWith(`passwordChange.${outcome === 'success' ? 'success' : 'sessionExpired'}`)
  })

  it.each(['success', 'failure', 'expired'] as const)('clears request references and ignores an in-flight response after unmount: %s', async (outcome) => {
    const request = deferred<{ changed: true }>()
    vi.mocked(changePassword).mockReturnValue(request.promise)
    const { client, unmount } = mountPanel()
    await fill()
    await submit()
    const input = vi.mocked(changePassword).mock.calls[0]![0]
    unmount()
    expect(input).toEqual({ currentPassword: '', newPassword: '' })
    if (outcome === 'success') request.resolve({ changed: true })
    else request.reject(outcome === 'expired' ? new ApiClientError(401, 'private detail') : new Error('private detail'))
    await request.promise.catch(() => undefined)
    if (outcome !== 'failure') await waitFor(() => expectGuestCache(client))
    expect(state.replace).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('prevents an unmounted profile from restoring identity after an in-flight password change completes', async () => {
    const user = { id: 'user-id', username: 'alice', nickname: 'Alice', group: 'user', permissions: [] }
    vi.mocked(me).mockResolvedValue({ user })
    const nickname = deferred<{ user: typeof user }>()
    const password = deferred<{ changed: true }>()
    vi.mocked(updateProfile).mockReturnValue(nickname.promise)
    vi.mocked(changePassword).mockReturnValue(password.promise)
    const { client, unmount } = mountPanel(undefined, true)
    await fill()
    await fireEvent.update(screen.getByLabelText('profile.nicknameLabel'), 'Renamed')
    await fireEvent.click(screen.getByText('profile.saveNickname'))
    await submit()
    const nicknameMutation = client.getMutationCache().getAll()[0]!
    unmount()
    password.resolve({ changed: true })
    await waitFor(() => expectGuestCache(client))
    const setIdentity = vi.spyOn(client, 'setQueryData')
    nickname.resolve({ user: { ...user, nickname: 'Renamed' } })
    await nickname.promise
    await waitFor(() => expect(nicknameMutation.state.status).toBe('success'))
    await waitFor(() => expectGuestCache(client))
    expect(setIdentity).not.toHaveBeenCalled()
    expect(state.replace).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it.each(['success', 'failure'] as const)('blocks an in-flight nickname callback as soon as the password session is revoked: %s', async (outcome) => {
    const user = { id: 'user-id', username: 'alice', nickname: 'Alice', group: 'user', permissions: [] }
    vi.mocked(me).mockResolvedValue({ user })
    const nickname = deferred<{ user: typeof user }>()
    vi.mocked(updateProfile).mockReturnValue(nickname.promise)
    const { client, unmount } = mountPanel(undefined, true)
    await fill()
    await fireEvent.update(screen.getByLabelText('profile.nicknameLabel'), 'Renamed')
    await fireEvent.click(screen.getByText('profile.saveNickname'))
    expect(updateProfile).toHaveBeenCalledTimes(1)
    const cancelGate = deferred<void>()
    const cancel = vi.spyOn(client, 'cancelQueries').mockReturnValue(cancelGate.promise)
    const setIdentity = vi.spyOn(client, 'setQueryData')
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    await submit()
    await waitFor(() => expect(cancel).toHaveBeenCalledTimes(1))
    if (outcome === 'success') nickname.resolve({ user: { ...user, nickname: 'Renamed' } })
    else nickname.reject(new Error('private nickname failure'))
    await nickname.promise.catch(() => undefined)
    await waitFor(() => expect(client.getMutationCache().getAll()[0]?.state.status).toBe(outcome === 'success' ? 'success' : 'error'))
    expect(setIdentity).toHaveBeenCalledTimes(1)
    expect(setIdentity).toHaveBeenCalledWith(['auth', 'me'], expect.objectContaining({ user: expect.objectContaining({ group: 'guest' }) }))
    expect(invalidate).not.toHaveBeenCalled()
    expect(screen.queryByText('profile.saveSuccess')).toBeNull()
    expect(screen.queryByText('profile.saveFailed')).toBeNull()
    await fireEvent.submit(screen.getByLabelText('profile.nicknameLabel').closest('form')!)
    expect(updateProfile).toHaveBeenCalledTimes(1)
    state.replace.mockImplementation(() => { unmount(); return Promise.resolve() })
    cancelGate.resolve()
    await waitFor(() => expect(state.replace).toHaveBeenCalledWith('/login?redirect=/profile'))
    expectGuestCache(client)
  })
})
