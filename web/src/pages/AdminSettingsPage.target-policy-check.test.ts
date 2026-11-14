import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { componentStubs } from '@/test/component-stubs'
import AdminSettingsPage from './AdminSettingsPage.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
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
    if (path === '/api/v1/admin/system/settings') data = { siteName: 'MoeURL', defaultLanguage: 'en', defaultTheme: 'system', footerText: '', showPoweredBy: true, localLoginEnabled: true, updatedAt: '2026-11-14T00:00:00Z' }
    else if (path === '/api/v1/admin/system/target-policy/check') data = { outcome: 'allowed' }
    else throw new Error('Unexpected transport: ' + path)
    return new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }))
  })
})
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals() })

it('TestAdminSettingsTargetPolicyCheckCard: checks only on explicit submit outside the general settings form', async () => {
  render(AdminSettingsPage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: { ...componentStubs, TargetCIDRAllowlistEditor: true, TargetCIDRDenylistEditor: true, HomeContentEditor: true, AppearanceEditor: true, FooterLinksEditor: true, TargetHostDenylistEditor: true, TargetHostAllowlistEditor: true, TargetHostSuffixDenylistEditor: true, TargetHostSuffixAllowlistEditor: true, TargetIPDenylistEditor: true, AccountDailyCreateQuotaEditor: true, AdminAuthenticationPage: true } } })
  await waitFor(() => expect(screen.getByLabelText('settings.siteName')).toHaveProperty('value', 'MoeURL'))
  expect(screen.getByRole('heading', { name: 'targetPolicyCheck.heading' })).toBeTruthy()
  expect(screen.getByText('targetPolicyCheck.hint')).toBeTruthy()
  expect(screen.getByText('targetPolicyCheck.scope')).toBeTruthy()
  const form = screen.getByRole('form', { name: 'targetPolicyCheck.form' })
  expect(form).not.toBe(screen.getByLabelText('settings.siteName').closest('form'))
  expect(requests.filter(r => r.path.endsWith('/check'))).toHaveLength(0)
  const input = screen.getByRole('textbox', { name: 'targetPolicyCheck.target' })
  await fireEvent.update(input, 'https://example.com/private?secret=fixture')
  expect(requests.filter(r => r.path.endsWith('/check'))).toHaveLength(0)
  await fireEvent.submit(form)
  await waitFor(() => expect(screen.getByText('targetPolicyCheck.allowed')).toBeTruthy())
  expect(requests.filter(r => r.path.endsWith('/check')).map(r => r.body)).toEqual([{ targetUrl: 'https://example.com/private?secret=fixture' }])
  expect(requests.some(r => r.path.endsWith('/settings/update'))).toBe(false)
})
