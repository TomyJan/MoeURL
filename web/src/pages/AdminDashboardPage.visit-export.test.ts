import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { nextTick } from 'vue'
import { setImmediate } from 'node:timers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { toast } from 'vue-sonner'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import { revokeAccountIdentity } from '@/shared/preferences/useAccountPreferences'
import AdminDashboardPage from './AdminDashboardPage.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ locale: { value: 'en-US' }, t: (key: string, params?: Record<string, string>) => params ? `${key} ${Object.values(params).join(' ')}` : key }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('vuetify', () => ({ useTheme: () => ({ global: { current: { value: { colors: { primary: 'blue', 'on-surface-variant': 'black', outline: 'gray' } } } } }) }))
vi.mock('chart.js', () => ({ Chart: class { static register() {} destroy() {} }, LineController: class {}, LineElement: class {}, PointElement: class {}, LinearScale: class {}, CategoryScale: class {}, Tooltip: class {} }))
const required = ['admin:access', 'statistics:read_all', 'statistics:export_visits', 'short_link:read_all', 'short_link:read_visits']
const range = { startDate: '2026-10-16', endDate: '2026-10-22', timeZone: 'UTC' }
const dashboard = { range, generatedAt: '2026-10-22T01:02:03Z', summary: { userCount: 3, activeUserCount: 2, linkCount: 5, activeLinkCount: 4, todayCreatedLinkCount: 1, todayVisitCount: 9, rangeVisitCount: 0 }, trend: [{ date: '2026-10-22', visitCount: 0 }], topLinks: [] }
const file = { fileName: 'moeurl-site-visits-2026-10-16-2026-10-22.csv', contentType: 'text/csv;charset=utf-8', content: '\uFEFFshort_link_id,start_date,end_date,time_zone,event_id,occurred_at,referrer_host,device_type,browser_family,os_family,country_code\r\n' }
const clients: QueryClient[] = []
let downloads: string[]
/** Supplies current database-style grants without replacing identity observers. */
function user(permissions = required, id = 'admin') { return { id, username: id, nickname: '', group: 'admin', permissions } }
/** Encodes the production response envelope. */
function json(data: unknown, code = 0) { return new Response(JSON.stringify({ code, message: 'OK', data, meta: {} })) }
/** Mounts the actual dashboard and download component with a shared real cache. */
function mount(permissions = required, existing?: QueryClient) {
  const client = existing ?? new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  if (!existing) { clients.push(client); client.setQueryData(['auth', 'me'], { user: user(permissions) }) }
  const view = render(AdminDashboardPage, { global: { stubs: componentStubs, plugins: [[VueQueryPlugin, { queryClient: client }]] } })
  return { ...view, client }
}
/** Drains actual network decoding and Vue jobs without a fixed sleep. */
async function settle() { await new Promise<void>(resolve => setImmediate(resolve)); await nextTick() }
beforeEach(() => {
  downloads = []; vi.clearAllMocks()
  vi.stubGlobal('fetch', async (path: string) => json(path.includes('/visits/export') ? file : dashboard))
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:site-visits')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download) })
})
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('dashboard site visit export', () => {
  it('downloads the actual applied UTC range even when the dashboard result is empty', async () => {
    const paths: string[] = []
    vi.stubGlobal('fetch', async (path: string) => { paths.push(path); return json(path.includes('/visits/export') ? file : dashboard) })
    mount()
    await screen.findByText('dashboard.empty')
    await fireEvent.click(screen.getByRole('button', { name: 'siteVisitExport.csv' }))
    await waitFor(() => expect(downloads).toEqual([file.fileName]))
    expect(paths).toEqual(['/api/v1/admin/dashboard?days=7', '/api/v1/admin/dashboard/visits/export?startDate=2026-10-16&endDate=2026-10-22'])
    expect(screen.getByText('siteVisitExport.description')).toBeTruthy()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:site-visits')
    expect(document.querySelector('a[download]')).toBeNull()
  })
  it.each(required)('requires the independent site intersection: %s', async permission => {
    mount(required.filter(key => key !== permission))
    await settle()
    expect(screen.queryByTestId('visit-export')).toBeNull()
  })
  it('blocks pending, refresh and failed dashboard reads, then allows a successful retry', async () => {
    const initial = createDeferred<Response>(); const refresh = createDeferred<Response>()
    let reads = 0
    vi.stubGlobal('fetch', async (path: string) => {
      if (path.includes('/visits/export')) return json(file)
      reads++
      return reads === 1 ? initial.promise : reads === 2 ? refresh.promise : json(dashboard)
    })
    mount()
    expect((screen.getByTestId('visit-export') as HTMLButtonElement).disabled).toBe(true)
    initial.resolve(json(dashboard)); await screen.findByText('dashboard.empty')
    expect((screen.getByTestId('visit-export') as HTMLButtonElement).disabled).toBe(false)
    await fireEvent.update(screen.getByRole('combobox', { name: 'analytics.dateRange' }), '30')
    expect((screen.getByTestId('visit-export') as HTMLButtonElement).disabled).toBe(true)
    refresh.resolve(json(null, 900000)); await screen.findByText('insights.loadFailed')
    expect((screen.getByTestId('visit-export') as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.click(screen.getByRole('button', { name: 'analytics.retry' }))
    await screen.findByText('dashboard.empty')
    await fireEvent.click(screen.getByTestId('visit-export'))
    await waitFor(() => expect(downloads).toEqual([file.fileName]))
  })
  it.each([200120, 100001, 900000])('shows the current site failure %s without downloading and permits retry', async code => {
    let attempts = 0
    vi.stubGlobal('fetch', async (path: string) => {
      if (!path.includes('/visits/export')) return json(dashboard)
      return ++attempts === 1 ? json(null, code) : json(file)
    })
    mount(); await screen.findByText('dashboard.empty')
    await fireEvent.click(screen.getByTestId('visit-export'))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(code === 200120 ? 'siteVisitExport.limitExceeded' : 'visitExport.failed'))
    expect(downloads).toEqual([])
    await fireEvent.click(screen.getByTestId('visit-export'))
    await waitFor(() => expect(downloads).toEqual([file.fileName]))
    expect(toast.success).toHaveBeenCalledWith('visitExport.started')
  })
  it.each(['dates', 'permission', 'switch', 'relogin', 'unmount'])('abandons late site success and failure after %s changes', async transition => {
    for (const failure of [false, true]) {
      const pending = createDeferred<Response>()
      const paths: string[] = []
      vi.stubGlobal('fetch', async (path: string) => { paths.push(path); return path.includes('/visits/export') ? pending.promise : json(dashboard) })
      const view = mount()
      await screen.findByText('dashboard.empty')
      await fireEvent.click(screen.getByTestId('visit-export'))
      await waitFor(() => expect(paths.filter(path => path.includes('/visits/export'))).toHaveLength(1))
      if (transition === 'dates') {
        await fireEvent.update(screen.getByRole('combobox', { name: 'analytics.dateRange' }), '30')
        await screen.findByText('dashboard.empty')
        await fireEvent.update(screen.getByRole('combobox', { name: 'analytics.dateRange' }), '7')
      }
      if (transition === 'permission') { view.client.setQueryData(['auth', 'me'], { user: user([]) }); view.client.setQueryData(['auth', 'me'], { user: user() }) }
      if (transition === 'switch') view.client.setQueryData(['auth', 'me'], { user: user(required, 'other') })
      if (transition === 'relogin') { void revokeAccountIdentity(view.client); view.client.setQueryData(['auth', 'me'], { user: user() }) }
      if (transition === 'unmount') { view.unmount(); mount(required, view.client) }
      pending.resolve(json(failure ? null : file, failure ? 120001 : 0))
      await pending.promise; await settle()
      expect(downloads).toEqual([])
      expect(toast.success).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
      cleanup()
    }
  })
})
