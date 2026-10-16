import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { useQuery, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { login, me, type UserResponse } from '@/entities/auth/api'
import { getLoginMethods } from '@/entities/oidc/api'
import { getAccountPreferences, updateAccountPreferences, type AccountPreferences } from '@/entities/user/preferences'
import { queryClient } from '@/app/query'
import { useAccountPreferences, revokeAccountIdentity } from '@/shared/preferences/useAccountPreferences'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import AccountPreferencesPanel from '@/features/account-preferences/AccountPreferencesPanel.vue'
import LoginPage from './LoginPage.vue'

const navigation = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('vue-router', async (original) => ({ ...await original<typeof import('vue-router')>(), useRoute: () => ({ query: {} }), useRouter: () => navigation }))
vi.mock('vuetify', () => ({ useTheme: () => ({ global: { name: { value: 'moeurlLight' } } }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/entities/auth/api', () => ({ login: vi.fn(), me: vi.fn() }))
vi.mock('@/entities/oidc/api', async (original) => ({ ...await original<typeof import('@/entities/oidc/api')>(), getLoginMethods: vi.fn() }))
vi.mock('@/entities/user/preferences', async (original) => ({ ...await original<typeof import('@/entities/user/preferences')>(), getAccountPreferences: vi.fn(), updateAccountPreferences: vi.fn() }))

const identity: UserResponse = { user: { id: 'A', username: 'alice', nickname: 'New session', group: 'user', permissions: [] } }
const saved: AccountPreferences = { language: 'en', theme: 'dark', updatedAt: '2026-10-16T01:02:03Z' }
/** Mounts the actual login page alongside the same persistent account observers as the application. */
function mount(withEditor = false) {
  queryClient.setQueryData(['auth', 'me'], identity)
  const harness = defineComponent({ setup() {
    useQuery({ queryKey: ['auth', 'me'], queryFn: me, staleTime: Infinity })
    const account = useAccountPreferences()
    return () => h('div', [
      h(LoginPage),
      withEditor ? h(AccountPreferencesPanel, { userId: 'A', active: true }) : undefined,
      h('output', { 'data-testid': 'login-effective-preferences' }, `${account.preferences.language.value}/${account.preferences.themeMode.value}`),
      h('button', { onClick: () => { account.preferences.setLanguage('zh-CN'); account.preferences.setTheme('light') } }, 'Use browser choices'),
    ])
  } })
  return render(harness, { global: { plugins: [[VueQueryPlugin, { queryClient }], createI18n({ legacy: false, locale: 'test', messages: {}, missingWarn: false, fallbackWarn: false })], stubs: componentStubs } })
}
/** Signs in through visible form controls without first switching the cached account to guest. */
async function signIn() {
  await screen.findByLabelText('auth.username')
  await fireEvent.update(screen.getByLabelText('auth.username'), 'alice')
  await fireEvent.update(screen.getByLabelText('auth.password'), 'password')
  await fireEvent.click(screen.getByRole('button', { name: 'auth.loginSubmit' }))
  await waitFor(() => expect(navigation.push).toHaveBeenCalledWith('/'))
}
/** Captures the current account cache identity, including its login epoch. */
function accountKey() { return queryClient.getQueriesData({ queryKey: ['user', 'preferences', 'A'] })[0]![0] }
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(login).mockResolvedValue(identity)
  vi.mocked(me).mockResolvedValue(identity)
  vi.mocked(getLoginMethods).mockResolvedValue({ local: { enabled: true }, oidc: [] })
  vi.mocked(getAccountPreferences).mockResolvedValue(saved)
})
afterEach(async () => { cleanup(); await revokeAccountIdentity(queryClient); queryClient.clear() })

describe('LoginPage account preference identity transitions', () => {
  it('reloads the same signed-in account on successful login and discards the prior manual override', async () => {
    const nextRead = createDeferred<AccountPreferences>()
    vi.mocked(getAccountPreferences).mockResolvedValueOnce(saved).mockReturnValueOnce(nextRead.promise)
    mount()
    await waitFor(() => expect(screen.getByTestId('login-effective-preferences').textContent).toBe('en/dark'))
    const previousKey = accountKey()
    await fireEvent.click(screen.getByRole('button', { name: 'Use browser choices' }))
    expect(screen.getByTestId('login-effective-preferences').textContent).toBe('zh-CN/light')
    await signIn()
    await waitFor(() => expect(getAccountPreferences).toHaveBeenCalledTimes(2))
    expect(accountKey()).not.toEqual(previousKey)
    expect(queryClient.getQueryData(previousKey)).toBeUndefined()
    nextRead.resolve(saved)
    await waitFor(() => expect(screen.getByTestId('login-effective-preferences').textContent).toBe('en/dark'))
  })

  it('ignores old account and identity reads after a successful same-ID login', async () => {
    const previousRead = createDeferred<AccountPreferences>()
    const previousMe = createDeferred<UserResponse>()
    vi.mocked(getAccountPreferences).mockReturnValueOnce(previousRead.promise).mockResolvedValueOnce(saved)
    mount()
    await waitFor(() => expect(getAccountPreferences).toHaveBeenCalledTimes(1))
    const previousKey = accountKey()
    vi.mocked(me).mockReturnValueOnce(previousMe.promise)
    const refreshing = queryClient.refetchQueries({ queryKey: ['auth', 'me'] })
    await signIn()
    await waitFor(() => expect(getAccountPreferences).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByTestId('login-effective-preferences').textContent).toBe('en/dark'))
    previousRead.resolve({ language: 'zh-CN', theme: 'light', updatedAt: '2026-10-16T01:02:02Z' })
    previousMe.resolve({ user: { ...identity.user, nickname: 'Old session' } })
    await Promise.all([previousRead.promise, previousMe.promise, refreshing])
    await nextTick()
    expect(screen.getByTestId('login-effective-preferences').textContent).toBe('en/dark')
    expect(queryClient.getQueryData(['auth', 'me'])).toEqual(identity)
    expect(queryClient.getQueryData(previousKey)).toBeUndefined()
    expect(queryClient.getQueryData(accountKey())).toEqual(saved)
  })

  it('ignores a pending preference write from the prior same-ID login epoch', async () => {
    const previousWrite = createDeferred<AccountPreferences>()
    vi.mocked(updateAccountPreferences).mockReturnValue(previousWrite.promise)
    mount(true)
    await waitFor(() => expect((screen.getByTestId('account-preferences-save') as HTMLButtonElement).disabled).toBe(false))
    const previousKey = accountKey()
    await fireEvent.update(screen.getByLabelText('accountPreferences.theme'), 'light')
    await fireEvent.submit(screen.getByTestId('account-preferences-form'))
    expect(updateAccountPreferences).toHaveBeenCalledTimes(1)
    await signIn()
    await waitFor(() => expect(getAccountPreferences).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(queryClient.getQueryData(accountKey())).toEqual(saved))
    previousWrite.resolve({ language: 'zh-CN', theme: 'light', updatedAt: '2026-10-16T01:02:04Z' })
    await previousWrite.promise
    await nextTick()
    expect(toast.success).not.toHaveBeenCalled()
    expect(screen.getByTestId('login-effective-preferences').textContent).toBe('en/dark')
    expect(queryClient.getQueryData(previousKey)).toBeUndefined()
    expect(queryClient.getQueryData(accountKey())).toEqual(saved)
  })
})
