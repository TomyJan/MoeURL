import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, expect, it, vi } from 'vitest'
import ProfilePage from './ProfilePage.vue'
import { componentStubs } from '@/test/component-stubs'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key, locale: { value: 'en' } }) }))
const clients: QueryClient[] = []
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals() })

// Missing profile integration or losing the server's microsecond CAS revision breaks this real UI flow.
it('PersonalRedirectEditor saves the selected mode using its independent complete revision', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
  clients.push(client)
  const user = { id: '00000000-0000-0000-0000-000000000391', username: 'alice', nickname: 'Alice', group: 'user', permissions: ['short_link:use_confirmation'] }
  client.setQueryData(['auth', 'me'], { user })
  const writes: unknown[] = []
  let preference = { redirectMode: null as string | null, updatedAt: '2026-11-02T00:00:00.123456Z' }
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
    let data: unknown
    if (path === '/api/v1/auth/me') data = { user }
    else if (path === '/api/v1/user/redirect-preference') data = { preference }
    else if (path === '/api/v1/user/redirect-preference/update') {
      const body = JSON.parse(init.body as string)
      writes.push(body)
      preference = { redirectMode: body.redirectMode, updatedAt: '2026-11-02T00:00:01.654321Z' }
      data = { preference }
    } else throw new Error('Unexpected request ' + path)
    return new Response(JSON.stringify({ code: 0, message: '', data, meta: {} }))
  }))
  render(ProfilePage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: { ...componentStubs, PasswordChangePanel: true, AccountPreferencesPanel: true, DomainPreferencePanel: true, TimeZonePreferencePanel: true, PreferenceSwitcher: true } } })
  const select = await screen.findByLabelText('redirectPreference.mode')
  await waitFor(() => expect(select).toHaveProperty('disabled', false))
  await fireEvent.update(select, 'confirmation')
  await fireEvent.submit(screen.getByTestId('redirect-preference-form'))
  await waitFor(() => expect(writes).toEqual([{ redirectMode: 'confirmation', expectedUpdatedAt: '2026-11-02T00:00:00.123456Z' }]))
  await waitFor(() => expect(client.getQueriesData({ queryKey: ['user', 'redirect-preference'] })[0]?.[1]).toMatchObject({ preference: { redirectMode: 'confirmation', updatedAt: '2026-11-02T00:00:01.654321Z' } }))
})
