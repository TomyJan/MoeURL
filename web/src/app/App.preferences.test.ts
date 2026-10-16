import { cleanup, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { me, type UserResponse } from '@/entities/auth/api'
import { getPublicConfig, type PublicConfig } from '@/entities/system/api'
import { getAccountPreferences, type AccountPreferences } from '@/entities/user/preferences'
import { revokeAccountIdentity } from '@/shared/preferences/useAccountPreferences'
import { useAppPreferences } from '@/shared/preferences/useAppPreferences'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import App from './App.vue'

vi.mock('vuetify', () => ({ useTheme: () => ({ global: { name: { value: 'moeurlLight' } } }) }))
vi.mock('@/entities/auth/api', () => ({ me: vi.fn() }))
vi.mock('@/entities/system/api', () => ({ getPublicConfig: vi.fn() }))
vi.mock('@/entities/user/preferences', async (original) => ({ ...await original<typeof import('@/entities/user/preferences')>(), getAccountPreferences: vi.fn() }))
const clients: QueryClient[] = []
const controls = defineComponent({ setup() {
  const preferences = useAppPreferences()
  return () => h('output', { 'data-testid': 'app-preferences' }, `${preferences.language.value}/${preferences.themeMode.value}`)
} })
/** Exercises the actual application startup observers with an isolated query cache. */
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  clients.push(client)
  render(App, { global: { plugins: [[VueQueryPlugin, { queryClient: client }], createI18n({ legacy: false, locale: 'zh-CN', missingWarn: false, messages: {} })], stubs: { ...componentStubs, SiteFooter: true, RouterView: { components: { Controls: controls }, template: '<Controls />' } } } })
  return client
}
beforeEach(() => {
  vi.clearAllMocks()
  localStorage.setItem('moeurl.language', 'zh-CN')
  localStorage.setItem('moeurl.theme', 'light')
})
afterEach(() => { cleanup(); for (const client of clients.splice(0)) { revokeAccountIdentity(client); client.clear() } })
describe('App account preference startup', () => {
  it('revokes account reads immediately while allowing an unrelated public config read to finish', async () => {
    const account = createDeferred<AccountPreferences>()
    const defaults = createDeferred<PublicConfig>()
    vi.mocked(me).mockResolvedValue({ user: { id: 'A', username: 'alice', nickname: 'Alice', group: 'user', permissions: [] } })
    vi.mocked(getAccountPreferences).mockReturnValue(account.promise)
    vi.mocked(getPublicConfig).mockReturnValue(defaults.promise)
    const client = mount()
    await waitFor(() => expect(getAccountPreferences).toHaveBeenCalledTimes(1))
    await revokeAccountIdentity(client)
    defaults.resolve({ siteName: 'After logout', defaultLanguage: 'en', defaultTheme: 'dark', footerText: '', showPoweredBy: true })
    account.resolve({ language: 'en', theme: 'dark', updatedAt: '2026-10-16T01:02:03Z' })
    await waitFor(() => expect(document.title).toBe('After logout'))
    expect(screen.getByTestId('app-preferences').textContent).toBe('zh-CN/light')
  })
  it('loads a confirmed identity on full refresh and protects its account values from late site defaults', async () => {
    const session = createDeferred<UserResponse>()
    const account = createDeferred<AccountPreferences>()
    const defaults = createDeferred<PublicConfig>()
    vi.mocked(me).mockReturnValue(session.promise)
    vi.mocked(getAccountPreferences).mockReturnValue(account.promise)
    vi.mocked(getPublicConfig).mockReturnValue(defaults.promise)
    const client = mount()
    expect(screen.getByTestId('app-preferences').textContent).toBe('zh-CN/light')
    expect(getAccountPreferences).not.toHaveBeenCalled()
    session.resolve({ user: { id: 'A', username: 'alice', nickname: 'Alice', group: 'user', permissions: [] } })
    await waitFor(() => expect(getAccountPreferences).toHaveBeenCalledTimes(1))
    account.resolve({ language: 'en', theme: 'dark', updatedAt: '2026-10-16T01:02:03Z' })
    await waitFor(() => expect(screen.getByTestId('app-preferences').textContent).toBe('en/dark'))
    defaults.resolve({ siteName: 'Late site', defaultLanguage: 'zh-CN', defaultTheme: 'light', footerText: '', showPoweredBy: true })
    await waitFor(() => expect(document.title).toBe('Late site'))
    expect(screen.getByTestId('app-preferences').textContent).toBe('en/dark')
    expect(localStorage.getItem('moeurl.language')).toBe('zh-CN')
    expect(localStorage.getItem('moeurl.theme')).toBe('light')
    await revokeAccountIdentity(client)
    await waitFor(() => expect(screen.getByTestId('app-preferences').textContent).toBe('zh-CN/light'))
  })
  it('keeps browser controls usable when the initial identity read fails', async () => {
    vi.mocked(me).mockRejectedValue(new Error('offline'))
    vi.mocked(getPublicConfig).mockRejectedValue(new Error('offline'))
    const client = mount()
    await waitFor(() => expect(client.getQueryState(['auth', 'me'])?.status).toBe('error'))
    expect(screen.getByTestId('app-preferences').textContent).toBe('zh-CN/light')
    expect(getAccountPreferences).not.toHaveBeenCalled()
  })
})
