import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, expect, it, vi } from 'vitest'
import ProfilePage from './ProfilePage.vue'
import { componentStubs } from '@/test/component-stubs'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key, locale: { value: 'en' } }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const clients: QueryClient[] = []
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals() })

// Removing the panel or implicitly saving a selection breaks this real profile flow.
it('explicitly saves and clears the independent list default with its full CAS revision', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
  clients.push(client)
  const user = { id: '00000000-0000-0000-0000-000000000391', username: 'alice', nickname: 'Alice', group: 'user', permissions: [] }
  client.setQueryData(['auth', 'me'], { user })
  const writes: unknown[] = []
  let preference = { pageSize: null as number | null, updatedAt: '2026-11-02T00:00:00.123456789Z' }
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    let data: unknown
    if (path === '/api/v1/auth/me') data = { user }
    else if (path === '/api/v1/user/list-preference') data = { preference }
    else if (path === '/api/v1/user/list-preference/update') {
      const body = JSON.parse(init.body as string)
      writes.push(body)
      expect(init.headers).toMatchObject({ 'X-MoeURL-Expected-User-ID': user.id })
      preference = { pageSize: body.pageSize, updatedAt: '2026-11-02T00:00:01.654321Z' }
      data = { preference }
    } else throw new Error('Unexpected request ' + path)
    return new Response(JSON.stringify({ code: 0, message: '', data }))
  }))
  render(ProfilePage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: { ...componentStubs, PasswordChangePanel: true, AccountPreferencesPanel: true, DomainPreferencePanel: true, TimeZonePreferencePanel: true, RedirectPreferencePanel: true, PreferenceSwitcher: true } } })
  const select = await screen.findByLabelText('listPreference.pageSize')
  await waitFor(() => expect(select).toHaveProperty('disabled', false))
  await fireEvent.update(select, '50')
  expect(writes).toEqual([])
  await fireEvent.submit(screen.getByTestId('list-preference-form'))
  await waitFor(() => expect(writes).toEqual([{ pageSize: 50, expectedUpdatedAt: '2026-11-02T00:00:00.123456789Z' }]))
  await waitFor(() => expect(screen.getByTestId('list-preference-save')).toHaveProperty('disabled', false))
  await fireEvent.update(select, '')
  expect(writes).toHaveLength(1)
  await fireEvent.submit(screen.getByTestId('list-preference-form'))
  await waitFor(() => expect(writes[1]).toEqual({ pageSize: null, expectedUpdatedAt: '2026-11-02T00:00:01.654321Z' }))
  await waitFor(() => expect(client.getQueriesData({ queryKey: ['user', 'list-preference'] })[0]?.[1]).toMatchObject({ preference: { pageSize: null, updatedAt: '2026-11-02T00:00:01.654321Z' } }))
})
