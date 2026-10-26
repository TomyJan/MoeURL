import { fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import AnalyticsPage from './AnalyticsPage.vue'
import { getShortLinkStatistics, getAdminShortLinkStatistics } from '@/entities/short-link/api'
import type { ShortLinkStatisticsResponse, StatisticsRangeInput } from '@/entities/short-link/model'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import { exportShortLinkStatistics } from '@/entities/short-link/export'
import { downloadCsv } from '@/shared/download/csv'
import type { StatisticsExport } from '@/entities/short-link/export'
import { toast } from 'vue-sonner'
import { ApiClientError } from '@/shared/api/client'
import type { UserResponse } from '@/entities/auth/api'
import { setImmediate } from 'node:timers'

const state = vi.hoisted(() => ({ route: {} as { path: string; params: { shortLinkId: string } } }))
vi.mock('vue-router', () => ({ useRoute: () => state.route }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string, params?: Record<string, string>) => params ? `${key} ${Object.values(params).join(' ')}` : key }) }))
vi.mock('vuetify', () => ({ useTheme: () => ({ global: { current: { value: { colors: { primary: 'blue', 'on-surface-variant': 'black', outline: 'gray' } } } } }) }))
vi.mock('chart.js', () => ({ Chart: class { static register() {} destroy() {} }, LineController: class {}, LineElement: class {}, PointElement: class {}, LinearScale: class {}, CategoryScale: class {}, Tooltip: class {} }))
vi.mock('@/entities/short-link/api', () => ({ getShortLinkStatistics: vi.fn(), getAdminShortLinkStatistics: vi.fn() }))
vi.mock('@/entities/short-link/export', () => ({ exportShortLinkStatistics: vi.fn() }))
vi.mock('@/shared/download/csv', () => ({ downloadCsv: vi.fn() }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const clients: QueryClient[] = []
/** Builds a server-shaped payload whose range and count identify the resolved request. */
function response(id = 'link-id', startDate = '2026-10-09', endDate = '2026-10-15', count = 7): ShortLinkStatisticsResponse {
  return { shortLink: { id, url: `https://go.example/${id}`, slug: id, targetUrl: 'https://example.com', title: '', tags: [],
    status: 'active', redirectMode: 'direct', intermediateDelaySeconds: 5, expiresAt: null, expired: false,
    passwordEnabled: false, maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false, createdAt: '2026-10-01T00:00:00Z' },
    range: { startDate, endDate, timeZone: 'UTC' },
    stats: { rangeVisitCount: count, visitCount: 100, todayVisitCount: 2, lastVisitedAt: null, trend: [], referrers: [], devices: [], countries: [] } }
}
/** Uses a real query observer to exercise reactive cache isolation. */
function mount(extraPermissions: string[] = []) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  clients.push(client)
  client.setQueryData(['auth', 'me'], { user: { id: 'A', username: 'A', group: 'user', permissions: ['short_link:export_statistics', 'short_link:read_own', 'short_link:read_all', 'admin:access', ...extraPermissions] } })
  return { client, ...render(AnalyticsPage, { global: { stubs: componentStubs, plugins: [[VueQueryPlugin, { queryClient: client }]] } }) }
}
/** Changes a range through the user's selector. */
async function choose(value: string) {
  await fireEvent.update(screen.getByRole('combobox', { name: 'analytics.dateRange' }), value)
}
/** Enters a custom draft without applying it. */
async function draft(start: string, end: string) {
  await fireEvent.update(screen.getByLabelText('analytics.startDate'), start)
  await fireEvent.update(screen.getByLabelText('analytics.endDate'), end)
}

describe('analytics date range', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-15T23:59:00Z'))
    state.route = reactive({ path: '/link/link-id/analytics', params: { shortLinkId: 'link-id' } })
    vi.mocked(getShortLinkStatistics).mockResolvedValue(response())
    vi.mocked(getAdminShortLinkStatistics).mockResolvedValue(response())
  })
  afterEach(() => {
    clients.splice(0).forEach((client) => client.clear())
    vi.mocked(downloadCsv).mockReset()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it.each(['own', 'admin'])('isolates %s aggregate identity, late responses and live permission loss without requiring visit access', async (context) => {
    if (context === 'admin') state.route.path = '/admin/link/link-id/analytics'
    const read = vi.mocked(context === 'admin' ? getAdminShortLinkStatistics : getShortLinkStatistics)
    const abandoned = createDeferred<ShortLinkStatisticsResponse>()
    const current = createDeferred<ShortLinkStatisticsResponse>()
    read.mockResolvedValueOnce(response()).mockImplementationOnce(() => abandoned.promise).mockImplementation(() => current.promise)
    const { client } = mount()
    await screen.findByText('https://go.example/link-id')
    await choose('30')
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2))
    client.setQueryData(['auth', 'me'], { user: { id: 'B', username: 'B', group: 'admin', permissions: ['admin:access', 'short_link:read_all', 'short_link:read_own'] } })
    await waitFor(() => expect(read).toHaveBeenCalledTimes(3))
    expect(screen.queryByText('https://go.example/link-id')).toBeNull()
    abandoned.resolve(response('abandoned-account'))
    await abandoned.promise
    await Promise.resolve()
    expect(screen.queryByText('https://go.example/abandoned-account')).toBeNull()
    expect(screen.queryByTestId('analytics-summary')).toBeNull()
    current.resolve(response('current-account'))
    await screen.findByText('https://go.example/current-account')
    client.setQueryData(['auth', 'me'], { user: { id: 'B', username: 'B', group: 'user', permissions: [] } })
    await screen.findByText('insights.noAccess')
    expect(screen.queryByText('https://go.example/current-account')).toBeNull()
    expect(screen.queryByTestId('analytics-summary')).toBeNull()
  })

  it('hides the aggregate URL and old range after a confirmed business denial, including a deferred range return', async () => {
    const fresh = createDeferred<ShortLinkStatisticsResponse>()
    vi.mocked(getShortLinkStatistics).mockResolvedValueOnce(response()).mockRejectedValueOnce(new ApiClientError(120001, 'denied')).mockImplementation(() => fresh.promise)
    mount()
    await screen.findByText('https://go.example/link-id')
    await choose('30')
    await screen.findByText('insights.noAccess')
    expect(screen.queryByText('https://go.example/link-id')).toBeNull()
    await choose('7')
    await waitFor(() => expect(getShortLinkStatistics).toHaveBeenCalledTimes(3))
    expect(screen.queryByText('https://go.example/link-id')).toBeNull()
    expect(screen.queryByTestId('analytics-summary')).toBeNull()
    fresh.resolve(response('fresh-range'))
    await screen.findByText('https://go.example/fresh-range')
  })

  it('keeps visits on the displayed resolved dates across UTC midnight and resets cursors when those dates change', async () => {
    const id = '00000000-0000-0000-0000-000000000001'
    state.route.params.shortLinkId = id
    vi.mocked(getShortLinkStatistics).mockResolvedValue(response(id))
    const fetcher = vi.fn(async (url: string) => {
      const params = new URL(url, 'https://console.example').searchParams
      const endDate = params.get('endDate') ?? new Date().toISOString().slice(0, 10)
      const startDate = params.get('startDate') ?? (endDate === '2026-10-15' ? '2026-10-09' : '2026-10-10')
      return new Response(JSON.stringify({ code: 0, message: 'OK', meta: {}, data: {
        range: { startDate, endDate, timeZone: 'UTC' }, pageSize: 25, hasMore: true, nextCursor: 'next-visit',
        items: [{ id, occurredAt: `${endDate}T00:00:00Z`, referrerHost: `${endDate}.example`, deviceType: null, browserFamily: null, osFamily: null, countryCode: null }],
      } }))
    })
    vi.stubGlobal('fetch', fetcher)
    const { client } = mount(['short_link:read_visits'])
    const records = within(await screen.findByTestId('visit-records'))
    await records.findByText('2026-10-15.example')
    vi.setSystemTime(new Date('2026-10-16T00:01:00Z'))
    await fireEvent.update(records.getByRole('combobox', { name: 'visits.device' }), 'mobile')
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    await records.findByText('insights.appliedRange 2026-10-09 2026-10-15')
    expect(screen.getByText('analytics.rangeDescription 2026-10-09 2026-10-15')).toBeTruthy()
    await fireEvent.update(records.getByLabelText('visits.country'), 'US')
    await fireEvent.click(records.getByRole('button', { name: 'audit.applyFilters' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
    await records.findByText('2026-10-15.example')
    await fireEvent.click(records.getByRole('button', { name: 'insights.next' }))
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4))
    await records.findByText('2026-10-15.example')
    for (const [url] of fetcher.mock.calls) {
      const params = new URL(url, 'https://console.example').searchParams
      expect(params.get('startDate')).toBe('2026-10-09')
      expect(params.get('endDate')).toBe('2026-10-15')
      expect(params.has('days')).toBe(false)
    }
    expect(new URL(fetcher.mock.calls.at(-1)![0], 'https://console.example').searchParams.get('cursor')).toBe('next-visit')
    const aggregateKey = client.getQueryCache().find({ queryKey: ['short-link-statistics', 'own', id], exact: false })!.queryKey
    client.setQueryData(aggregateKey, response(id, '2026-10-10', '2026-10-16'))
    await records.findByText('2026-10-16.example')
    const updated = new URL(fetcher.mock.calls.at(-1)![0], 'https://console.example').searchParams
    expect(updated.get('startDate')).toBe('2026-10-10')
    expect(updated.get('endDate')).toBe('2026-10-16')
    expect(updated.has('cursor')).toBe(false)
    expect((records.getByRole('button', { name: 'insights.previous' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it.each(['current', 'unmounted', 'other-account', 'newer-read', 'newer-empty'])(
    'recovers readable analytics after export denial unmounts its button, guarding %s authorization', async transition => {
      const id = '00000000-0000-0000-0000-000000000001'
      state.route.params.shortLinkId = id
      vi.mocked(getShortLinkStatistics).mockResolvedValue(response(id))
      const refresh = createDeferred<Response>()
      const readPermissions = ['short_link:read_own', 'short_link:read_visits']
      const auth = (permissions = readPermissions, userId = 'A'): UserResponse => ({ user: { id: userId, username: userId, nickname: '', group: 'user', permissions } })
      let authReads = 0
      vi.stubGlobal('fetch', async (path: string) => {
        if (path.endsWith('/auth/me')) { authReads++; return refresh.promise }
        if (path.includes('/visits/export?')) return new Response(JSON.stringify({ code: 120001, message: 'denied', data: null }))
        return new Response(JSON.stringify({ code: 0, message: 'OK', data: {
          range: { startDate: '2026-10-09', endDate: '2026-10-15', timeZone: 'UTC' }, pageSize: 25, hasMore: false, nextCursor: '',
          items: [{ id, occurredAt: '2026-10-15T00:00:00Z', referrerHost: 'readable.example', deviceType: null, browserFamily: null, osFamily: null, countryCode: null }],
        } }))
      })
      const view = mount(['short_link:read_visits', 'short_link:export_visits'])
      await screen.findByText('readable.example')
      await fireEvent.click(screen.getByTestId('visit-export'))
      await screen.findByText('insights.noAccess')
      expect(authReads).toBe(1)
      expect(screen.queryByTestId('visit-records')).toBeNull()
      expect(screen.queryByTestId('analytics-summary')).toBeNull()
      expect(view.client.getQueryData<UserResponse>(['auth', 'me'])?.user.permissions).toEqual([])
      const newer = transition === 'other-account' ? auth(readPermissions, 'B')
        : transition === 'newer-read' ? auth(['short_link:read_own']) : auth([])
      if (transition.startsWith('newer-') || transition === 'other-account') view.client.setQueryData(['auth', 'me'], newer)
      if (transition === 'unmounted') view.unmount()
      refresh.resolve(new Response(JSON.stringify({ code: 0, message: 'OK', data: auth() })))
      await refresh.promise
      await new Promise<void>(resolve => setImmediate(resolve))
      if (transition === 'current') {
        await screen.findByText('readable.example')
        expect(screen.queryByText('insights.noAccess')).toBeNull()
        expect(screen.getByTestId('analytics-summary')).toBeTruthy()
      }
      expect(view.client.getQueryData(['auth', 'me'])).toEqual(['current', 'unmounted'].includes(transition) ? auth() : newer)
      expect(screen.queryByTestId('visit-export')).toBeNull()
      expect(downloadCsv).not.toHaveBeenCalled()
      expect(toast.success).not.toHaveBeenCalled()
      expect(toast.error).toHaveBeenCalledTimes(1)
    },
  )

  it('remounts visit records with a fresh read when parent statistics unmount them during A to B to A navigation', async () => {
    const a = '00000000-0000-0000-0000-000000000001'
    const b = '00000000-0000-0000-0000-000000000002'
    state.route.params.shortLinkId = a
    const pendingStatistics = createDeferred<ShortLinkStatisticsResponse>()
    vi.mocked(getShortLinkStatistics).mockImplementation((id) => id === b ? pendingStatistics.promise : Promise.resolve(response(a)))
    const pendingVisits = createDeferred<Response>()
    const page = { range: { startDate: '2026-10-09', endDate: '2026-10-15', timeZone: 'UTC' }, pageSize: 25, hasMore: false, nextCursor: '' }
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, message: 'OK', meta: {}, data: { ...page, items: [{ id: a, occurredAt: '2026-10-15T00:00:00Z', referrerHost: 'old.parent.instance.example', deviceType: null, browserFamily: null, osFamily: null, countryCode: null }] } }))).mockImplementation(() => pendingVisits.promise)
    vi.stubGlobal('fetch', fetcher)
    mount(['short_link:read_visits'])
    await screen.findByText('old.parent.instance.example')
    state.route.params.shortLinkId = b
    await waitFor(() => expect(screen.queryByTestId('visit-records')).toBeNull())
    state.route.params.shortLinkId = a
    await screen.findByTestId('visit-records')
    expect(screen.queryByText('old.parent.instance.example')).toBeNull()
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    pendingStatistics.resolve(response(b))
    pendingVisits.resolve(new Response(JSON.stringify({ code: 0, message: 'OK', meta: {}, data: { ...page, items: [] } })))
    await screen.findByText('visits.empty')
    expect(screen.queryByText('old.parent.instance.example')).toBeNull()
  })

  it.each([0, 100001])('requests server-confirmed visit dates across a slow browser UTC clock and handles server code %s', async code => {
    vi.setSystemTime(new Date('2026-10-25T23:59:55Z'))
    const id = '00000000-0000-0000-0000-000000000001'
    state.route.params.shortLinkId = id
    vi.mocked(getShortLinkStatistics).mockResolvedValue(response(id, '2026-10-20', '2026-10-26'))
    const file = { fileName: `moeurl-visits-${id}-2026-10-20-2026-10-26.csv`, contentType: 'text/csv;charset=utf-8', content: '\uFEFFshort_link_id,start_date,end_date,time_zone,event_id,occurred_at,referrer_host,device_type,browser_family,os_family,country_code\r\n' }
    const exports: string[] = []
    const downloads: string[] = []
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:server-dates')
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download) })
    const realDownload = await vi.importActual<typeof import('@/shared/download/csv')>('@/shared/download/csv')
    vi.mocked(downloadCsv).mockImplementationOnce(realDownload.downloadCsv)
    vi.stubGlobal('fetch', async (path: string) => {
      if (path.includes('/visits/export?')) {
        exports.push(path)
        return new Response(JSON.stringify({ code, message: 'server result', data: code ? null : file }))
      }
      return new Response(JSON.stringify({ code: 0, message: 'OK', data: {
        range: { startDate: '2026-10-20', endDate: '2026-10-26', timeZone: 'UTC' }, pageSize: 25, hasMore: false, nextCursor: '', items: [],
      } }))
    })
    mount(['short_link:read_visits', 'short_link:export_visits'])
    await screen.findByText('visits.empty')
    await fireEvent.click(screen.getByTestId('visit-export'))
    await waitFor(() => expect(exports).toEqual([`/api/v1/short-link/visits/export?id=${id}&startDate=2026-10-20&endDate=2026-10-26`]))
    if (code === 0) {
      await waitFor(() => expect(downloads).toEqual([file.fileName]))
      expect(revoked).toHaveBeenCalledWith('blob:server-dates')
      expect(document.querySelector('a[download]')).toBeNull()
    } else {
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('visitExport.failed'))
      expect(downloads).toEqual([])
      expect((screen.getByTestId('visit-export') as HTMLButtonElement).disabled).toBe(false)
    }
  })

  it('exports the displayed dates while custom edits remain unapplied and disables during active reads', async () => {
    const file: StatisticsExport = { fileName: 'moeurl-statistics-abc-2026-10-09-2026-10-15.csv', contentType: 'text/csv;charset=utf-8', content: '\uFEFFsection,key,value,visit_count\r\n' }
    vi.mocked(exportShortLinkStatistics).mockResolvedValue(file)
    mount()
    expect((screen.getByTestId('analytics-export') as HTMLButtonElement).disabled).toBe(true)
    await screen.findByTestId('analytics-summary')
    await choose('custom')
    await draft('2026-10-12', '2026-10-14')
    await fireEvent.click(screen.getByTestId('analytics-export'))
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledWith(file))
    expect(exportShortLinkStatistics).toHaveBeenCalledExactlyOnceWith('link-id', { startDate: '2026-10-09', endDate: '2026-10-15' }, 'own')
    const loading = createDeferred<ShortLinkStatisticsResponse>()
    vi.mocked(getShortLinkStatistics).mockReturnValue(loading.promise)
    await fireEvent.click(screen.getByRole('button', { name: 'analytics.apply' }))
    expect((screen.getByTestId('analytics-export') as HTMLButtonElement).disabled).toBe(true)
    loading.reject(new Error('offline'))
    await screen.findByText('analytics.loadFailed')
    expect((screen.getByTestId('analytics-export') as HTMLButtonElement).disabled).toBe(true)
  })

  it('invalidates a pending export when the route leaves and returns to the same cached analytics', async () => {
    const exporting = createDeferred<StatisticsExport>()
    vi.mocked(exportShortLinkStatistics).mockReturnValue(exporting.promise)
    mount()
    await screen.findByTestId('analytics-summary')
    await fireEvent.click(screen.getByTestId('analytics-export'))
    state.route.params.shortLinkId = 'other'
    await waitFor(() => expect(getShortLinkStatistics).toHaveBeenLastCalledWith('other', { days: 7 }))
    state.route.params.shortLinkId = 'link-id'
    await screen.findByTestId('analytics-summary')
    exporting.resolve({ fileName: 'moeurl-statistics-abc-2026-10-09-2026-10-15.csv', contentType: 'text/csv;charset=utf-8', content: '\uFEFFsection,key,value,visit_count\r\n' })
    await exporting.promise
    await Promise.resolve()
    expect(downloadCsv).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('remembers a route round trip even when both transitions happen before the next render', async () => {
    const exporting = createDeferred<StatisticsExport>()
    vi.mocked(exportShortLinkStatistics).mockReturnValue(exporting.promise)
    mount()
    await screen.findByTestId('analytics-summary')
    await fireEvent.click(screen.getByTestId('analytics-export'))
    state.route.params.shortLinkId = 'other'
    state.route.params.shortLinkId = 'link-id'
    exporting.resolve({ fileName: 'moeurl-statistics-abc-2026-10-09-2026-10-15.csv', contentType: 'text/csv;charset=utf-8', content: '\uFEFFsection,key,value,visit_count\r\n' })
    await exporting.promise
    await Promise.resolve()
    expect(downloadCsv).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
  })

  it.each(['success', 'failure'])('drops an already queued export %s before a synchronous route round trip renders', async (outcome) => {
    const exporting = createDeferred<StatisticsExport>()
    vi.mocked(exportShortLinkStatistics).mockReturnValue(exporting.promise)
    mount()
    await screen.findByTestId('analytics-summary')
    await fireEvent.click(screen.getByTestId('analytics-export'))
    if (outcome === 'success') {
      exporting.resolve({ fileName: 'moeurl-statistics-abc-2026-10-09-2026-10-15.csv', contentType: 'text/csv;charset=utf-8', content: '\uFEFFsection,key,value,visit_count\r\n' })
    } else exporting.reject(new Error('private'))
    state.route.params.shortLinkId = 'other'
    state.route.params.shortLinkId = 'link-id'
    await exporting.promise.catch(() => undefined)
    await Promise.resolve()
    await waitFor(() => expect((screen.getByTestId('analytics-export') as HTMLButtonElement).disabled).toBe(false))
    expect(downloadCsv).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('shows lifetime metrics separately from the actual server range and applies presets', async () => {
    mount()
    await screen.findByTestId('analytics-summary')
    expect(screen.getByText('analytics.rangeDescription 2026-10-09 2026-10-15')).toBeTruthy()
    expect(screen.getByText('analytics.rangeVisitCount')).toBeTruthy()
    expect(screen.getByText('analytics.lifetimeVisitCount')).toBeTruthy()
    expect(getShortLinkStatistics).toHaveBeenCalledWith('link-id', { days: 7 })
    await choose('30')
    await waitFor(() => expect(getShortLinkStatistics).toHaveBeenLastCalledWith('link-id', { days: 30 }))
    await choose('90')
    await waitFor(() => expect(getShortLinkStatistics).toHaveBeenLastCalledWith('link-id', { days: 90 }))
    await choose('7')
    await waitFor(() => expect(getShortLinkStatistics).toHaveBeenLastCalledWith('link-id', { days: 7 }))
  })

  it('requests a custom range only after a valid draft is applied and keeps invalid drafts local', async () => {
    mount()
    await screen.findByTestId('analytics-summary')
    await choose('custom')
    await draft('2026-10-12', '2026-10-14')
    expect(getShortLinkStatistics).toHaveBeenCalledTimes(1)
    await fireEvent.click(screen.getByRole('button', { name: 'analytics.apply' }))
    await waitFor(() => expect(getShortLinkStatistics).toHaveBeenLastCalledWith('link-id', { startDate: '2026-10-12', endDate: '2026-10-14' }))
    await draft('', '')
    await fireEvent.click(screen.getByRole('button', { name: 'analytics.apply' }))
    expect(await screen.findAllByText('analytics.invalidDate')).toHaveLength(2)
    await draft('2026-10-14', '2026-10-12')
    await fireEvent.click(screen.getByRole('button', { name: 'analytics.apply' }))
    expect(await screen.findByText('analytics.invalidRange')).toBeTruthy()
    await draft('2026-01-01', '2026-04-01')
    await fireEvent.click(screen.getByRole('button', { name: 'analytics.apply' }))
    expect(await screen.findByText('analytics.invalidRange')).toBeTruthy()
    await draft('2026-10-15', '2026-10-16')
    await fireEvent.click(screen.getByRole('button', { name: 'analytics.apply' }))
    expect(await screen.findByText('analytics.futureDate')).toBeTruthy()
    expect(getShortLinkStatistics).toHaveBeenCalledTimes(2)
  })

  it('hides old results during switching, retries the active range, and ignores late responses', async () => {
    const thirty = createDeferred<ShortLinkStatisticsResponse>()
    const ninety = createDeferred<ShortLinkStatisticsResponse>()
    vi.mocked(getShortLinkStatistics).mockImplementation((_id, range?: StatisticsRangeInput) => {
      if (range?.days === 30) return thirty.promise
      if (range?.days === 90) return ninety.promise
      return Promise.resolve(response())
    })
    mount()
    await screen.findByTestId('analytics-summary')
    await choose('30')
    expect(screen.queryByTestId('analytics-summary')).toBeNull()
    await choose('90')
    ninety.reject(new Error('offline'))
    await screen.findByText('analytics.loadFailed')
    thirty.resolve(response('link-id', '2026-09-16', '2026-10-15', 30))
    expect(screen.queryByTestId('analytics-summary')).toBeNull()
    vi.mocked(getShortLinkStatistics).mockResolvedValue(response('link-id', '2026-07-18', '2026-10-15', 90))
    await fireEvent.click(screen.getByRole('button', { name: 'analytics.retry' }))
    await screen.findByTestId('analytics-summary')
    expect(getShortLinkStatistics).toHaveBeenLastCalledWith('link-id', { days: 90 })
    expect(screen.getByText('analytics.rangeDescription 2026-07-18 2026-10-15')).toBeTruthy()
    expect(screen.queryByText('30')).toBeNull()
  })

  it('resets selection and drafts on link change and isolates owner and administrator cache entries', async () => {
    mount()
    await screen.findByTestId('analytics-summary')
    await choose('custom')
    await draft('2026-10-12', '2026-10-14')
    await fireEvent.click(screen.getByRole('button', { name: 'analytics.apply' }))
    await waitFor(() => expect(getShortLinkStatistics).toHaveBeenCalledTimes(2))
    state.route.params.shortLinkId = 'other-id'
    await waitFor(() => expect(getShortLinkStatistics).toHaveBeenLastCalledWith('other-id', { days: 7 }))
    expect((screen.getByRole('combobox') as HTMLSelectElement).value).toBe('7')
    await choose('custom')
    expect((screen.getByLabelText('analytics.startDate') as HTMLInputElement).value).toBe('')
    expect((screen.getByLabelText('analytics.endDate') as HTMLInputElement).value).toBe('')
    state.route.path = '/admin/link/other-id/analytics'
    await waitFor(() => expect(getAdminShortLinkStatistics).toHaveBeenCalledWith('other-id', { days: 7 }))
  })

  it('refetches an inactive cached range using that cache entry’s original parameters', async () => {
    mount()
    await screen.findByTestId('analytics-summary')
    await choose('30')
    await waitFor(() => expect(getShortLinkStatistics).toHaveBeenCalledTimes(2))
    await clients[0]!.refetchQueries({ queryKey: ['short-link-statistics', 'own', 'link-id', { days: 7 }] })
    expect(getShortLinkStatistics).toHaveBeenLastCalledWith('link-id', { days: 7 })
  })
})
