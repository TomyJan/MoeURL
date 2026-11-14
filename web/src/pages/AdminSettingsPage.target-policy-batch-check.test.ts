import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
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
    else if (path === '/api/v1/admin/system/target-policy/check') data = { outcome: 'restricted' }
    else if (path === '/api/v1/admin/system/target-policy/check-batch') data = { items: [{ index: 1, outcome: 'allowed' }, { index: 2, outcome: 'invalid_target' }, { index: 3, outcome: 'allowed' }] }
    else throw new Error('Unexpected transport: ' + path)
    return new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }))
  })
})
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals() })

// Removing the real batch card or sharing its draft/result with the single
// check must break this page-level behavior, without importing a missing module.
it('TestAdminSettingsBatchTargetPolicyCard: submits original lines explicitly and isolates both cards from general settings', async () => {
  render(AdminSettingsPage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: { ...componentStubs, TargetCIDRAllowlistEditor: true, TargetCIDRDenylistEditor: true, HomeContentEditor: true, AppearanceEditor: true, FooterLinksEditor: true, TargetHostDenylistEditor: true, TargetHostAllowlistEditor: true, TargetHostSuffixDenylistEditor: true, TargetHostSuffixAllowlistEditor: true, TargetIPDenylistEditor: true, AccountDailyCreateQuotaEditor: true, AdminAuthenticationPage: true } } })
  await waitFor(() => expect(screen.getByLabelText('settings.siteName')).toHaveProperty('value', 'MoeURL'))
  expect(screen.getByRole('heading', { name: 'targetPolicyBatchCheck.heading' })).toBeTruthy()
  expect(screen.getByText('targetPolicyBatchCheck.hint')).toBeTruthy()
  expect(screen.getByText('targetPolicyBatchCheck.scope')).toBeTruthy()
  const batch = screen.getByRole('form', { name: 'targetPolicyBatchCheck.form' })
  const single = screen.getByRole('form', { name: 'targetPolicyCheck.form' })
  expect(batch).not.toBe(screen.getByLabelText('settings.siteName').closest('form'))
  expect(batch).not.toBe(single)
  const batchInput = screen.getByRole('textbox', { name: 'targetPolicyBatchCheck.targets' })
  const singleInput = screen.getByRole('textbox', { name: 'targetPolicyCheck.target' })
  await fireEvent.update(singleInput, 'https://single.example/')
  await fireEvent.update(batchInput, 'https://example.com/\nhttps://localhost/\nhttps://example.com/')
  expect(requests.filter(r => /\/check(?:-batch)?$/.test(r.path))).toHaveLength(0)
  await fireEvent.submit(single)
  await waitFor(() => expect(screen.getByText('targetPolicyCheck.restricted')).toBeTruthy())
  await fireEvent.submit(batch)
  const results = await screen.findByRole('list', { name: 'targetPolicyBatchCheck.results' })
  const rows = within(results).getAllByRole('listitem')
  expect(rows).toHaveLength(3)
  expect(within(rows[0]!).getByText('targetPolicyBatchCheck.allowed')).toBeTruthy()
  expect(within(rows[1]!).getByText('targetPolicyBatchCheck.invalid_target')).toBeTruthy()
  expect(within(rows[2]!).getByText('targetPolicyBatchCheck.allowed')).toBeTruthy()
  expect(requests.filter(r => r.path.endsWith('/check-batch')).map(r => r.body)).toEqual([{ targetUrls: ['https://example.com/', 'https://localhost/', 'https://example.com/'] }])
  expect(results.textContent).not.toContain('https://')
  await fireEvent.update(singleInput, 'https://other.example/')
  expect(screen.queryByText('targetPolicyCheck.restricted')).toBeNull()
  expect(within(results).getAllByRole('listitem')).toHaveLength(3)
  await fireEvent.submit(single)
  await waitFor(() => expect(screen.getByText('targetPolicyCheck.restricted')).toBeTruthy())
  await fireEvent.update(batchInput, 'https://next.example/')
  expect(screen.queryByRole('list', { name: 'targetPolicyBatchCheck.results' })).toBeNull()
  expect(screen.getByText('targetPolicyCheck.restricted')).toBeTruthy()
  expect(requests.filter(r => r.path.endsWith('/check-batch'))).toHaveLength(1)
  expect(requests.some(r => r.path.endsWith('/settings/update'))).toBe(false)
})
