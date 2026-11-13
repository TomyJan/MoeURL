import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { componentStubs } from '@/test/component-stubs'
import AdminSettingsPage from './AdminSettingsPage.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
const version = '2026-11-13T01:00:00.123456Z'
const savedVersions = ['2026-11-13T01:00:01.654321Z', '2026-11-13T01:00:02.654322Z', '2026-11-13T01:00:03.654323Z']
const settings = { siteName: 'MoeURL', defaultLanguage: 'en', defaultTheme: 'system', footerText: '', showPoweredBy: true, localLoginEnabled: true, updatedAt: version }
const endpoint = '/api/v1/admin/system/target-host-suffix-allowlist'
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
    else if (path === endpoint) data = { enabled: false, suffixes: ['allowed.example'], updatedAt: version }
    else if (path === endpoint + '/update') {
      const input = body as { enabled: boolean; suffixes: string[] }
      const index = requests.filter(request => request.path === endpoint + '/update').length - 1
      data = { enabled: input.enabled, suffixes: input.suffixes.length ? ['example.com', 'example.net'] : [], updatedAt: savedVersions[index] }
    } else throw new Error('Unexpected transport: ' + path)
    return new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }))
  })
})
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals() })

it('TestAdminSettingsSuffixAllowlistCard: keeps its own form, explicit switch, raw draft and full revisions', async () => {
  render(AdminSettingsPage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: { ...componentStubs, HomeContentEditor: true, AppearanceEditor: true, FooterLinksEditor: true, TargetHostDenylistEditor: true, TargetHostAllowlistEditor: true, TargetHostSuffixDenylistEditor: true, AccountDailyCreateQuotaEditor: true, AdminAuthenticationPage: true } } })
  await waitFor(() => expect(screen.getByLabelText('settings.siteName')).toHaveProperty('value', 'MoeURL'))
  expect(screen.getByRole('heading', { name: 'targetSuffixAllowlist.heading' })).toBeTruthy()
  expect(screen.getByText('targetSuffixAllowlist.hint')).toBeTruthy()
  const form = screen.getByRole('form', { name: 'targetSuffixAllowlist.form' })
  expect(form).not.toBe(screen.getByLabelText('settings.siteName').closest('form'))
  const toggle = screen.getByRole('checkbox', { name: 'targetSuffixAllowlist.enabled' })
  const first = await screen.findByRole('textbox', { name: 'targetSuffixAllowlist.suffix 1' })
  await waitFor(() => expect(first).toHaveProperty('disabled', false))
  expect(toggle).toHaveProperty('checked', false)
  await fireEvent.update(first, ' Example.NET. ')
  await fireEvent.click(screen.getByRole('button', { name: 'targetSuffixAllowlist.add' }))
  await fireEvent.update(screen.getByRole('textbox', { name: 'targetSuffixAllowlist.suffix 2' }), 'example.com')
  await fireEvent.click(toggle)
  expect(requests.filter(request => request.path.endsWith('/update'))).toHaveLength(0)
  await fireEvent.submit(form)
  await waitFor(() => expect(screen.getByText('targetSuffixAllowlist.saved')).toBeTruthy())
  expect(requests.filter(request => request.path === endpoint + '/update')[0]?.body).toEqual({ enabled: true, suffixes: [' Example.NET. ', 'example.com'], expectedUpdatedAt: version })
  expect(screen.getByRole('textbox', { name: 'targetSuffixAllowlist.suffix 1' })).toHaveProperty('value', 'example.com')
  expect(screen.getByRole('textbox', { name: 'targetSuffixAllowlist.suffix 2' })).toHaveProperty('value', 'example.net')
  await fireEvent.click(toggle)
  await fireEvent.submit(form)
  await waitFor(() => expect(requests.filter(request => request.path === endpoint + '/update')).toHaveLength(2))
  await waitFor(() => expect(screen.getByRole('button', { name: 'targetSuffixAllowlist.save' })).toHaveProperty('disabled', false))
  expect(requests.filter(request => request.path === endpoint + '/update')[1]?.body).toEqual({ enabled: false, suffixes: ['example.com', 'example.net'], expectedUpdatedAt: savedVersions[0] })
  await fireEvent.click(screen.getByRole('button', { name: 'targetSuffixAllowlist.clear' }))
  expect(toggle).toHaveProperty('checked', false)
  await fireEvent.submit(form)
  await waitFor(() => expect(requests.filter(request => request.path === endpoint + '/update')).toHaveLength(3))
  expect(requests.filter(request => request.path === endpoint + '/update')[2]?.body).toEqual({ enabled: false, suffixes: [], expectedUpdatedAt: savedVersions[1] })
  expect(requests.some(request => request.path === '/api/v1/admin/system/settings/update')).toBe(false)
})
