import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import AnalyticsPage from './AnalyticsPage.vue'
import { getShortLinkStatistics, getAdminShortLinkStatistics } from '@/entities/short-link/api'
import type { ShortLinkStatisticsResponse, StatisticsRangeInput } from '@/entities/short-link/model'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'

const state = vi.hoisted(() => ({ route: {} as { path: string; params: { shortLinkId: string } } }))
vi.mock('vue-router', () => ({ useRoute: () => state.route }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string, params?: Record<string, string>) => params ? `${key} ${Object.values(params).join(' ')}` : key }) }))
vi.mock('vuetify', () => ({ useTheme: () => ({ global: { current: { value: { colors: { primary: 'blue', 'on-surface-variant': 'black', outline: 'gray' } } } } }) }))
vi.mock('chart.js', () => ({ Chart: class { static register() {} destroy() {} }, LineController: class {}, LineElement: class {}, PointElement: class {}, LinearScale: class {}, CategoryScale: class {}, Tooltip: class {} }))
vi.mock('@/entities/short-link/api', () => ({ getShortLinkStatistics: vi.fn(), getAdminShortLinkStatistics: vi.fn() }))

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
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  clients.push(client)
  return render(AnalyticsPage, { global: { stubs: componentStubs, plugins: [[VueQueryPlugin, { queryClient: client }]] } })
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
    vi.useRealTimers()
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
    await clients[0]!.refetchQueries({ queryKey: ['short-link-statistics', 'own', 'link-id', { days: 7 }], exact: true })
    expect(getShortLinkStatistics).toHaveBeenLastCalledWith('link-id', { days: 7 })
  })
})
