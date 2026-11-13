import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { componentStubs } from '@/test/component-stubs'
import AdminSettingsPage from './AdminSettingsPage.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
const version = '2026-11-13T01:00:00.123456Z'
const savedVersion = '2026-11-13T01:00:01.654321Z'
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
    else if (path === '/api/v1/admin/system/target-host-suffix-denylist') data = { suffixes: ['blocked.example'], updatedAt: version }
    else if (path === '/api/v1/admin/system/target-host-suffix-denylist/update') data = { suffixes: requests.filter(r => r.path.endsWith('/update')).length === 1 ? ['example.com', 'example.net'] : [], updatedAt: savedVersion }
    else throw new Error('Unexpected transport: ' + path)
    return new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }))
  })
})
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals() })

// A missing registration or a merged general form must fail before any write;
// coercing the draft or reusing a submitted revision must fail at the transport.
it('mounts and saves the independent suffix denylist with confirmed canonical values and full revisions', async () => {
  render(AdminSettingsPage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: { ...componentStubs, TargetCIDRAllowlistEditor: true, TargetIPDenylistEditor: true, TargetCIDRDenylistEditor: true, TargetHostSuffixAllowlistEditor: true, HomeContentEditor: true, AppearanceEditor: true, FooterLinksEditor: true, TargetHostDenylistEditor: true, TargetHostAllowlistEditor: true, AccountDailyCreateQuotaEditor: true, AdminAuthenticationPage: true } } })
  await waitFor(() => expect(screen.getByLabelText('settings.siteName')).toHaveProperty('value', 'MoeURL'))
  expect(screen.getByRole('heading', { name: 'targetSuffixPolicy.heading' })).toBeTruthy()
  const form = screen.getByRole('form', { name: 'targetSuffixPolicy.form' })
  expect(form).not.toBe(screen.getByLabelText('settings.siteName').closest('form'))
  const first = await screen.findByRole('textbox', { name: 'targetSuffixPolicy.host 1' })
  await waitFor(() => expect(first).toHaveProperty('disabled', false))
  await fireEvent.update(first, ' Example.NET. ')
  await fireEvent.click(screen.getByRole('button', { name: 'targetSuffixPolicy.add' }))
  await fireEvent.update(screen.getByRole('textbox', { name: 'targetSuffixPolicy.host 2' }), 'example.com')
  await fireEvent.submit(form)
  await waitFor(() => expect(screen.getByText('targetSuffixPolicy.saved')).toBeTruthy())
  expect(requests.find(r => r.path.endsWith('/update'))?.body).toEqual({ suffixes: [' Example.NET. ', 'example.com'], expectedUpdatedAt: version })
  expect(screen.getByRole('textbox', { name: 'targetSuffixPolicy.host 1' })).toHaveProperty('value', 'example.com')
  expect(screen.getByRole('textbox', { name: 'targetSuffixPolicy.host 2' })).toHaveProperty('value', 'example.net')
  await fireEvent.click(screen.getByRole('button', { name: 'targetSuffixPolicy.clear' }))
  await fireEvent.submit(form)
  await waitFor(() => expect(requests.filter(r => r.path.endsWith('/update'))).toHaveLength(2))
  expect(requests.filter(r => r.path.endsWith('/update'))[1]?.body).toEqual({ suffixes: [], expectedUpdatedAt: savedVersion })
  expect(requests.some(r => r.path === '/api/v1/admin/system/settings/update')).toBe(false)
})
