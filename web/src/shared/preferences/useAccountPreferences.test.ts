import { cleanup, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { getAccountPreferences, type AccountPreferences } from '@/entities/user/preferences'
import { useAccountPreferences, revokeAccountIdentity } from './useAccountPreferences'
import { useAppPreferences } from './useAppPreferences'
import { createDeferred } from '@/test/deferred'

const runtime = vi.hoisted(() => ({ theme: { value: 'moeurlLight' } }))
vi.mock('vuetify', () => ({ useTheme: () => ({ global: { name: runtime.theme } }) }))
vi.mock('@/entities/user/preferences', async (original) => ({ ...await original<typeof import('@/entities/user/preferences')>(), getAccountPreferences: vi.fn() }))
const clients: QueryClient[] = []
const saved: AccountPreferences = { language: 'en', theme: 'dark', updatedAt: '2026-10-16T01:02:03Z' }
/** Replaces the shared current-session result, as login and auth/me do in production. */
function identity(client: QueryClient, id: string | null) {
  client.setQueryData(['auth', 'me'], { user: { id: id ?? '', username: id ?? 'guest', group: id ? 'user' : 'guest', nickname: '', permissions: [] } })
}
/** Mounts a real observer and exposes rendered preferences plus the normal browser setters. */
function mount(client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })) {
  clients.push(client)
  let preferences!: ReturnType<typeof useAppPreferences>
  const component = defineComponent({ setup() {
    preferences = useAppPreferences()
    useAccountPreferences()
    return () => h('output', { 'data-testid': 'effective' }, `${preferences.language.value}/${preferences.themeMode.value}`)
  } })
  const view = render(component, { global: { plugins: [[VueQueryPlugin, { queryClient: client }], createI18n({ legacy: false, locale: 'zh-CN', messages: {} })] } })
  return { ...view, client, preferences }
}
beforeEach(() => { vi.mocked(getAccountPreferences).mockReset(); vi.mocked(getAccountPreferences).mockResolvedValue(saved) })
afterEach(() => { cleanup(); for (const client of clients.splice(0)) { revokeAccountIdentity(client); client.clear() } })
describe('account preference identity synchronization', () => {
  it('hydrates a cached signed-in identity on refresh and shares its request across observers', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
    identity(client, 'A')
    mount(client)
    mount(client)
    await waitFor(() => expect(screen.getAllByTestId('effective').every((output) => output.textContent === 'en/dark')).toBe(true))
    expect(getAccountPreferences).toHaveBeenCalledTimes(1)
  })
  it('waits for a confirmed account and hydrates once without persisting the account', async () => {
    const { client, preferences } = mount()
    expect(getAccountPreferences).not.toHaveBeenCalled()
    preferences.setLanguage('zh-CN')
    preferences.setTheme('light')
    const store = vi.spyOn(Storage.prototype, 'setItem')
    identity(client, 'A')
    await waitFor(() => expect(screen.getByTestId('effective').textContent).toBe('en/dark'))
    expect(store).not.toHaveBeenCalled()
    preferences.setLanguage('zh-CN')
    vi.mocked(getAccountPreferences).mockResolvedValue({ ...saved, theme: 'system' })
    await client.invalidateQueries({ queryKey: ['user', 'preferences', 'A'] })
    expect(screen.getByTestId('effective').textContent).toBe('zh-CN/dark')
    identity(client, null)
    await waitFor(() => expect(screen.getByTestId('effective').textContent).toBe('zh-CN/light'))
    expect(client.getQueriesData({ queryKey: ['user', 'preferences', 'A'] })).toEqual([])
    store.mockRestore()
  })
  it('keeps manual fields over late initial hydration and ignores a late A response after switching to B', async () => {
    const first = createDeferred<AccountPreferences>()
    const second = createDeferred<AccountPreferences>()
    vi.mocked(getAccountPreferences).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const { client, preferences } = mount()
    identity(client, 'A')
    await waitFor(() => expect(getAccountPreferences).toHaveBeenCalledTimes(1))
    identity(client, 'B')
    await waitFor(() => expect(getAccountPreferences).toHaveBeenCalledTimes(2))
    preferences.setLanguage('zh-CN')
    second.resolve(saved)
    await waitFor(() => expect(screen.getByTestId('effective').textContent).toBe('zh-CN/dark'))
    first.resolve({ ...saved, language: 'en', theme: 'light' })
    await first.promise
    await nextTick()
    expect(screen.getByTestId('effective').textContent).toBe('zh-CN/dark')
    expect(client.getQueriesData({ queryKey: ['user', 'preferences', 'A'] })).toEqual([])
  })
  it('does not confuse same-ID relogin with the previous identity epoch', async () => {
    const first = createDeferred<AccountPreferences>()
    vi.mocked(getAccountPreferences).mockReturnValueOnce(first.promise)
    const { client } = mount()
    identity(client, 'A')
    await waitFor(() => expect(getAccountPreferences).toHaveBeenCalledTimes(1))
    revokeAccountIdentity(client)
    identity(client, 'A')
    await waitFor(() => expect(getAccountPreferences).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByTestId('effective').textContent).toBe('en/dark'))
    first.resolve({ ...saved, language: 'zh-CN', theme: 'light' })
    await first.promise
    await nextTick()
    expect(screen.getByTestId('effective').textContent).toBe('en/dark')
  })
  it('cancels a pending me response during revocation and keeps the usable guest baseline after read failure', async () => {
    vi.mocked(getAccountPreferences).mockRejectedValueOnce(new Error('offline'))
    const { client, preferences } = mount()
    preferences.setLanguage('zh-CN')
    preferences.setTheme('light')
    identity(client, 'A')
    await waitFor(() => expect(getAccountPreferences).toHaveBeenCalledTimes(1))
    const lateIdentity = createDeferred<{ user: { id: string; group: string } }>()
    const fetching = client.fetchQuery({ queryKey: ['auth', 'me'], queryFn: () => lateIdentity.promise })
    const ignored = fetching.catch(() => undefined)
    revokeAccountIdentity(client)
    lateIdentity.resolve({ user: { id: 'A', group: 'user' } })
    await ignored
    expect(client.getQueryData<{ user: { group: string } }>(['auth', 'me'])?.user.group).toBe('guest')
    expect(screen.getByTestId('effective').textContent).toBe('zh-CN/light')
  })
})
