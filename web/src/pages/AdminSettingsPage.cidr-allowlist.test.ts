import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { componentStubs } from '@/test/component-stubs'
import AdminSettingsPage from './AdminSettingsPage.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
const version = '2026-11-13T01:00:00.123456Z'
const savedVersion = '2026-11-13T01:00:01.654321Z'
const endpoint = '/api/v1/admin/system/target-cidr-allowlist'
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
    else if (path === endpoint) data = { enabled: false, prefixes: [], updatedAt: version }
    else if (path === endpoint + '/update') data = { enabled: true, prefixes: ['192.0.2.0/24', '2001:db8::/48'], updatedAt: savedVersion }
    else throw new Error('Unexpected transport: ' + path)
    return new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }))
  })
})
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals() })

// Omitting the independent editor loses both the scope warning and the raw CIDR write.
it('TestAdminSettingsCIDRAllowlistCard: shows literal-IP network scope and saves independently with the full revision', async () => {
  render(AdminSettingsPage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: { ...componentStubs, TargetCIDRDenylistEditor: true, HomeContentEditor: true, AppearanceEditor: true, FooterLinksEditor: true, TargetHostDenylistEditor: true, TargetHostAllowlistEditor: true, TargetHostSuffixDenylistEditor: true, TargetHostSuffixAllowlistEditor: true, TargetIPDenylistEditor: true, AccountDailyCreateQuotaEditor: true, AdminAuthenticationPage: true } } })
  await waitFor(() => expect(screen.getByLabelText('settings.siteName')).toHaveProperty('value', 'MoeURL'))
  expect(screen.getByRole('heading', { name: 'targetCIDRAllowlist.heading' })).toBeTruthy()
  expect(screen.getByText('targetCIDRAllowlist.hint')).toBeTruthy()
  expect(screen.getByText('targetCIDRAllowlist.scope')).toBeTruthy()
  expect(screen.getByText('targetCIDRAllowlist.wideWarning')).toBeTruthy()
  const form = screen.getByRole('form', { name: 'targetCIDRAllowlist.form' })
  expect(form).not.toBe(screen.getByLabelText('settings.siteName').closest('form'))
  const toggle = screen.getByRole('checkbox', { name: 'targetCIDRAllowlist.enabled' })
  await waitFor(() => expect(toggle).toHaveProperty('disabled', false))
  expect(toggle).toHaveProperty('checked', false)
  expect(screen.queryAllByRole('textbox', { name: /^targetCIDRAllowlist.prefix / })).toHaveLength(0)
  await fireEvent.click(toggle)
  await fireEvent.click(screen.getByRole('button', { name: 'targetCIDRAllowlist.add' }))
  const first = await screen.findByRole('textbox', { name: 'targetCIDRAllowlist.prefix 1' })
  await waitFor(() => expect(first).toHaveProperty('disabled', false))
  await fireEvent.update(first, ' 2001:0DB8:0:0::1/48 ')
  await fireEvent.click(screen.getByRole('button', { name: 'targetCIDRAllowlist.add' }))
  await fireEvent.update(screen.getByRole('textbox', { name: 'targetCIDRAllowlist.prefix 2' }), '192.0.2.129/24')
  expect(requests.filter(request => request.path.endsWith('/update'))).toHaveLength(0)
  await fireEvent.submit(form)
  await waitFor(() => expect(screen.getByText('targetCIDRAllowlist.saved')).toBeTruthy())
  expect(requests.filter(request => request.path === endpoint + '/update').map(request => request.body)).toEqual([
    { enabled: true, prefixes: [' 2001:0DB8:0:0::1/48 ', '192.0.2.129/24'], expectedUpdatedAt: version },
  ])
  expect(screen.getByRole('textbox', { name: 'targetCIDRAllowlist.prefix 1' })).toHaveProperty('value', '192.0.2.0/24')
  expect(screen.getByRole('textbox', { name: 'targetCIDRAllowlist.prefix 2' })).toHaveProperty('value', '2001:db8::/48')
  expect(requests.some(request => request.path === '/api/v1/admin/system/settings/update')).toBe(false)
})
