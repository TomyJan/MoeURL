import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { componentStubs } from '@/test/component-stubs'
import AdminSettingsPage from './AdminSettingsPage.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
const version = '2026-11-12T05:00:00.123456Z'
const savedVersion = '2026-11-12T05:00:01.654321Z'
const settings = { siteName: 'MoeURL', defaultLanguage: 'en', defaultTheme: 'system', footerText: '', showPoweredBy: true, localLoginEnabled: true, updatedAt: version }
let client: QueryClient
let requests: Array<{ path: string; body: unknown }>
beforeEach(() => {
  requests = []
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  client.setQueryDefaults(['auth', 'me'], { gcTime: Infinity })
  client.setQueryData(['auth', 'me'], { user: { id: 'admin-a', username: 'admin', group: 'admin', permissions: ['admin:access', 'system:manage'] } })
  vi.stubGlobal('fetch', async (path: string, init?: RequestInit) => {
    const body: unknown = init?.body ? JSON.parse(String(init.body)) : undefined
    requests.push({ path, body })
    let data: unknown
    if (path === '/api/v1/admin/system/settings') data = settings
    else if (path === '/api/v1/admin/system/account-daily-create-quota') data = { dailyLimit: null, updatedAt: version }
    else if (path === '/api/v1/admin/system/account-daily-create-quota/update') data = { dailyLimit: requests.filter(r => r.path.endsWith('/update')).length === 1 ? 1 : null, updatedAt: savedVersion }
    else throw new Error('Unexpected transport: ' + path)
    return new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }))
  })
})
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals() })

// Missing registration, merged forms, coercing null to zero, or keeping the
// submitted revision instead of the confirmed server document must fail here.
it('mounts and saves the independent nullable daily quota using confirmed server values and revisions', async () => {
  render(AdminSettingsPage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: { ...componentStubs, HomeContentEditor: true, AppearanceEditor: true, FooterLinksEditor: true, TargetHostSuffixDenylistEditor: true, TargetHostDenylistEditor: true, TargetHostAllowlistEditor: true, AdminAuthenticationPage: true } } })
  await waitFor(() => expect(screen.getByLabelText('settings.siteName')).toHaveProperty('value', 'MoeURL'))
  expect(screen.getByRole('heading', { name: 'dailyCreateQuota.heading' })).toBeTruthy()
  const form = screen.getByRole('form', { name: 'dailyCreateQuota.form' })
  expect(form).not.toBe(screen.getByLabelText('settings.siteName').closest('form'))
  const toggle = screen.getByRole('checkbox', { name: 'dailyCreateQuota.enabled' })
  await waitFor(() => expect(toggle).toHaveProperty('disabled', false))
  expect(toggle).toHaveProperty('checked', false)
  await fireEvent.click(toggle)
  const input = screen.getByLabelText('dailyCreateQuota.limit')
  await fireEvent.update(input, '0')
  await fireEvent.submit(form)
  await waitFor(() => expect(screen.getByText('dailyCreateQuota.saved')).toBeTruthy())
  expect(requests.find(r => r.path.endsWith('/update'))?.body).toEqual({ dailyLimit: 0, expectedUpdatedAt: version })
  expect(input).toHaveProperty('value', '1')
  await fireEvent.click(toggle)
  await fireEvent.submit(form)
  await waitFor(() => expect(requests.filter(r => r.path.endsWith('/update'))).toHaveLength(2))
  expect(requests.filter(r => r.path.endsWith('/update'))[1]?.body).toEqual({ dailyLimit: null, expectedUpdatedAt: savedVersion })
  expect(requests.some(r => r.path === '/api/v1/admin/system/settings/update')).toBe(false)
})
