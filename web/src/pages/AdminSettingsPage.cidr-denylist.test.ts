import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { componentStubs } from '@/test/component-stubs'
import AdminSettingsPage from './AdminSettingsPage.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
const version = '2026-11-13T01:00:00.123456Z'
const savedVersion = '2026-11-13T01:00:01.654321Z'
const endpoint = '/api/v1/admin/system/target-cidr-denylist'
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
    else if (path === endpoint) data = { prefixes: ['192.0.2.0/24'], updatedAt: version }
    else if (path === endpoint + '/update') data = { prefixes: ['192.0.2.0/24', '2001:db8::/48'], updatedAt: savedVersion }
    else throw new Error('Unexpected transport: ' + path)
    return new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }))
  })
})
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals() })

// Omitting the independent editor loses both the scope warning and the raw CIDR write.
it('TestAdminSettingsCIDRDenylistCard: shows literal-IP network scope and saves independently with the full revision', async () => {
  render(AdminSettingsPage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: { ...componentStubs, HomeContentEditor: true, AppearanceEditor: true, FooterLinksEditor: true, TargetHostDenylistEditor: true, TargetHostAllowlistEditor: true, TargetHostSuffixDenylistEditor: true, TargetHostSuffixAllowlistEditor: true, TargetCIDRAllowlistEditor: true, TargetIPDenylistEditor: true, AccountDailyCreateQuotaEditor: true, AdminAuthenticationPage: true } } })
  await waitFor(() => expect(screen.getByLabelText('settings.siteName')).toHaveProperty('value', 'MoeURL'))
  expect(screen.getByRole('heading', { name: 'targetCIDRPolicy.heading' })).toBeTruthy()
  expect(screen.getByText('targetCIDRPolicy.hint')).toBeTruthy()
  expect(screen.getByText('targetCIDRPolicy.scope')).toBeTruthy()
  const form = screen.getByRole('form', { name: 'targetCIDRPolicy.form' })
  expect(form).not.toBe(screen.getByLabelText('settings.siteName').closest('form'))
  const first = await screen.findByRole('textbox', { name: 'targetCIDRPolicy.prefix 1' })
  await waitFor(() => expect(first).toHaveProperty('disabled', false))
  await fireEvent.update(first, ' 2001:0DB8:0:0::1/48 ')
  await fireEvent.click(screen.getByRole('button', { name: 'targetCIDRPolicy.add' }))
  await fireEvent.update(screen.getByRole('textbox', { name: 'targetCIDRPolicy.prefix 2' }), '192.0.2.129/24')
  expect(requests.filter(request => request.path.endsWith('/update'))).toHaveLength(0)
  await fireEvent.submit(form)
  await waitFor(() => expect(screen.getByText('targetCIDRPolicy.saved')).toBeTruthy())
  expect(requests.filter(request => request.path === endpoint + '/update').map(request => request.body)).toEqual([
    { prefixes: [' 2001:0DB8:0:0::1/48 ', '192.0.2.129/24'], expectedUpdatedAt: version },
  ])
  expect(screen.getByRole('textbox', { name: 'targetCIDRPolicy.prefix 1' })).toHaveProperty('value', '192.0.2.0/24')
  expect(screen.getByRole('textbox', { name: 'targetCIDRPolicy.prefix 2' })).toHaveProperty('value', '2001:db8::/48')
  expect(requests.some(request => request.path === '/api/v1/admin/system/settings/update')).toBe(false)
})
