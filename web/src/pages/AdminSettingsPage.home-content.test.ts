import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { componentStubs } from '@/test/component-stubs'
import AdminSettingsPage from './AdminSettingsPage.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
const settings = { siteName: 'MoeURL', defaultLanguage: 'en', defaultTheme: 'system', footerText: '', showPoweredBy: true, localLoginEnabled: true, updatedAt: '2026-10-29T07:00:00.123456Z' }
const content = { title: 'Instance title', summary: 'Instance summary', updatedAt: '2026-10-29T07:01:00.123456Z' }
let client: QueryClient
let requests: Array<{ path: string; body: unknown }>
function mountPage() {
  return render(AdminSettingsPage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: { ...componentStubs, AdminAuthenticationPage: { template: '<div>OIDC</div>' } } } })
}
describe('independent homepage editor in system settings', () => {
  beforeEach(() => {
    requests = []
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    client.setQueryDefaults(['auth', 'me'], { gcTime: Infinity })
    client.setQueryData(['auth', 'me'], { user: { id: 'admin-a', username: 'admin', group: 'admin', permissions: ['admin:access', 'system:manage'] } })
    vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : undefined
      requests.push({ path, body })
      const data = path.includes('target-host-denylist') ? { hosts: ['blocked.example'], updatedAt: '2026-11-11T04:00:00.123456Z' } : path.includes('footer-links') ? { links: [], updatedAt: '2026-10-30T04:00:00.123456Z' } : path.includes('home-content') ? content : settings
      return new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }), { status: 200 })
    }))
  })
  afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals() })
  it('mounts a separately named form outside the old general form and keeps both mutations independent', async () => {
    mountPage()
    await waitFor(() => expect(screen.getByLabelText('homeContent.title')).toHaveProperty('value', content.title))
    const title = screen.getByLabelText('homeContent.title')
    const siteName = screen.getByLabelText('settings.siteName')
    expect(title.closest('form')).not.toBe(siteName.closest('form'))
    await fireEvent.update(title, 'Unsaved homepage draft')
    await fireEvent.update(siteName, 'New site')
    await fireEvent.click(screen.getByRole('button', { name: 'settings.save' }))
    await waitFor(() => expect(requests.filter(r => r.path.endsWith('/settings/update'))).toHaveLength(1))
    expect(requests.some(r => r.path.endsWith('/home-content/update'))).toBe(false)
    expect(title).toHaveProperty('value', 'Unsaved homepage draft')
    await fireEvent.click(screen.getByRole('button', { name: 'homeContent.save' }))
    await waitFor(() => expect(requests.filter(r => r.path.endsWith('/home-content/update'))).toHaveLength(1))
    expect(requests.find(r => r.path.endsWith('/home-content/update'))?.body).toEqual({ title: 'Unsaved homepage draft', summary: content.summary, expectedUpdatedAt: content.updatedAt })
    expect(requests.filter(r => r.path.endsWith('/settings/update'))).toHaveLength(1)
  })
  it('mounts the independent named footer links form outside both existing settings forms', async () => {
    mountPage()
    await waitFor(() => expect(screen.getByLabelText('homeContent.title')).toHaveProperty('value', content.title))
    const footerForm = screen.getByRole('form', { name: 'footerLinks.form' })
    expect(footerForm).not.toBe(screen.getByLabelText('homeContent.title').closest('form'))
    expect(footerForm).not.toBe(screen.getByLabelText('settings.siteName').closest('form'))
    expect(footerForm.contains(screen.getByRole('button', { name: 'footerLinks.add' }))).toBe(true)
  })
  it('mounts the independent target host denylist outside existing forms and saves only its own document', async () => {
    mountPage()
    await waitFor(() => expect(screen.getByLabelText('homeContent.title')).toHaveProperty('value', content.title))
    const policyForm = screen.getByRole('form', { name: 'targetPolicy.form' })
    expect(policyForm).not.toBe(screen.getByLabelText('settings.siteName').closest('form'))
    expect(policyForm).not.toBe(screen.getByLabelText('homeContent.title').closest('form'))
    const host = await screen.findByRole('textbox', { name: 'targetPolicy.host 1' })
    await fireEvent.update(host, 'other.example')
    await fireEvent.submit(policyForm)
    await waitFor(() => expect(requests.find(r => r.path.endsWith('/target-host-denylist/update'))?.body).toEqual({ hosts: ['other.example'], expectedUpdatedAt: '2026-11-11T04:00:00.123456Z' }))
    expect(requests.some(r => r.path.endsWith('/settings/update') || r.path.endsWith('/home-content/update') || r.path.endsWith('/footer-links/update'))).toBe(false)
  })
})
