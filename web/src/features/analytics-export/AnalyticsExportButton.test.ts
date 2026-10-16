import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { me, type CurrentUser, type UserResponse } from '@/entities/auth/api'
import { exportShortLinkStatistics, type StatisticsExport } from '@/entities/short-link/export'
import type { ShortLinkStatisticsResponse } from '@/entities/short-link/model'
import { downloadCsv } from '@/shared/download/csv'
import { revokeAccountIdentity } from '@/shared/preferences/useAccountPreferences'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import { messages } from '@/app/i18n'
import AnalyticsExportButton from './AnalyticsExportButton.vue'

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/entities/auth/api', () => ({ me: vi.fn() }))
vi.mock('@/entities/short-link/export', () => ({ exportShortLinkStatistics: vi.fn() }))
vi.mock('@/shared/download/csv', () => ({ downloadCsv: vi.fn() }))
const clients: QueryClient[] = []
const ownPermissions = ['short_link:export_statistics', 'short_link:read_own']
const allPermissions = [...ownPermissions, 'admin:access', 'short_link:read_all']
const descriptor: StatisticsExport = { fileName: 'moeurl-statistics-abc-2026-10-09-2026-10-15.csv', contentType: 'text/csv;charset=utf-8', content: '\uFEFFsection,key,value,visit_count\r\n' }
const statistics = { shortLink: { id: 'link' }, range: { startDate: '2026-10-09', endDate: '2026-10-15', timeZone: 'UTC' } } as ShortLinkStatisticsResponse
/** Supplies a confirmed identity with the requested permission boundary. */
function user(permissions = ownPermissions, id = 'A'): CurrentUser {
  return { id, username: id, nickname: '', group: 'user', permissions }
}
/** Mounts the real component against an isolated shared auth query cache. */
function mount(options: { user?: CurrentUser | null; context?: 'own' | 'admin'; blocked?: boolean; statistics?: ShortLinkStatisticsResponse | null; locale?: string } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  clients.push(client)
  if (options.user !== null) client.setQueryData(['auth', 'me'], { user: options.user ?? user() })
  const locale = options.locale ?? 'test'
  const i18n = createI18n({ legacy: false, locale, messages: locale === 'test' ? {} : messages, missingWarn: false, fallbackWarn: false })
  const view = render(AnalyticsExportButton, { props: { id: 'link', context: options.context ?? 'own', blocked: options.blocked ?? false, statistics: options.statistics === null ? undefined : options.statistics ?? statistics, appliedRangeKey: '7' }, global: { plugins: [[VueQueryPlugin, { queryClient: client }], i18n], stubs: componentStubs } })
  return { ...view, client }
}
/** Clicks the export action, including repeated events while its request is outstanding. */
async function click() { await fireEvent.click(screen.getByTestId('analytics-export')) }
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(exportShortLinkStatistics).mockReset().mockResolvedValue(descriptor)
  vi.mocked(me).mockReset().mockResolvedValue({ user: user() })
  vi.mocked(downloadCsv).mockReset()
})
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()) })
describe('AnalyticsExportButton', () => {
  it.each([
    [user([]), 'own'], [user(['short_link:read_own']), 'own'], [user(['short_link:export_statistics']), 'own'],
    [user(ownPermissions), 'admin'], [user(['short_link:export_statistics', 'short_link:read_all']), 'admin'],
    [user(['short_link:export_statistics', 'admin:access']), 'admin'],
    [{ ...user(allPermissions), group: 'guest' }, 'own'], [{ ...user(allPermissions), username: 'guest' }, 'own'],
    [user(allPermissions, ''), 'own'],
  ] as const)('hides the action without the complete confirmed permission boundary %#', (identity, context) => {
    mount({ user: identity, context })
    expect(screen.queryByTestId('analytics-export')).toBeNull()
  })
  it('waits for a confirmed identity and does not mount an account preferences query', async () => {
    const identity = createDeferred<UserResponse>()
    vi.mocked(me).mockReturnValue(identity.promise)
    const view = mount({ user: null })
    expect(screen.queryByTestId('analytics-export')).toBeNull()
    identity.resolve({ user: user() })
    await screen.findByTestId('analytics-export')
    expect(view.client.getQueriesData({ queryKey: ['user', 'preferences'] })).toEqual([])
    expect(me).toHaveBeenCalledOnce()
  })
  it.each([
    { blocked: true }, { statistics: null }, { statistics: { ...statistics, shortLink: { ...statistics.shortLink, id: 'other' } } },
  ])('disables export without a successful current statistics result %#', async (options) => {
    mount(options)
    expect((screen.getByTestId('analytics-export') as HTMLButtonElement).disabled).toBe(true)
    await click()
    expect(exportShortLinkStatistics).not.toHaveBeenCalled()
  })
  it.each(['own', 'admin'] as const)('exports the actual UTC dates once in %s context and reports browser initiation', async (context) => {
    const exporting = createDeferred<StatisticsExport>()
    vi.mocked(exportShortLinkStatistics).mockReturnValue(exporting.promise)
    mount({ user: user(allPermissions), context })
    await click()
    await click()
    expect(exportShortLinkStatistics).toHaveBeenCalledExactlyOnceWith('link', { startDate: '2026-10-09', endDate: '2026-10-15' }, context)
    expect((screen.getByTestId('analytics-export') as HTMLButtonElement).disabled).toBe(true)
    exporting.resolve(descriptor)
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledExactlyOnceWith(descriptor))
    expect(toast.success).toHaveBeenCalledWith('analytics.exportStarted')
    expect((screen.getByTestId('analytics-export') as HTMLButtonElement).disabled).toBe(false)
  })
  it.each(['request', 'browser'])('shows friendly %s errors and permits only manual retry', async (stage) => {
    if (stage === 'request') vi.mocked(exportShortLinkStatistics).mockRejectedValueOnce(new Error('private'))
    else vi.mocked(downloadCsv).mockImplementationOnce(() => { throw new Error('private') })
    mount()
    await click()
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('analytics.exportFailed'))
    expect(toast.success).not.toHaveBeenCalled()
    expect(exportShortLinkStatistics).toHaveBeenCalledOnce()
    await click()
    await waitFor(() => expect(toast.success).toHaveBeenCalledOnce())
    expect(exportShortLinkStatistics).toHaveBeenCalledTimes(2)
  })
  it.each(['id', 'context', 'range', 'applied', 'blocked', 'logout', 'switch', 'relogin', 'permission', 'unmount'])('ignores late successful and failed responses after %s', async (transition) => {
    for (const failed of [false, true]) {
      const exporting = createDeferred<StatisticsExport>()
      vi.mocked(exportShortLinkStatistics).mockReturnValue(exporting.promise)
      const view = mount({ user: user(allPermissions) })
      await click()
      if (transition === 'id') { await view.rerender({ id: 'other' }); await view.rerender({ id: 'link' }) }
      if (transition === 'context') { await view.rerender({ context: 'admin' }); await view.rerender({ context: 'own' }) }
      if (transition === 'range') { await view.rerender({ statistics: { ...statistics, range: { ...statistics.range, startDate: '2026-10-10' } } }); await view.rerender({ statistics }) }
      if (transition === 'applied') { await view.rerender({ appliedRangeKey: '30' }); await view.rerender({ appliedRangeKey: '7' }) }
      if (transition === 'blocked') { await view.rerender({ blocked: true }); await view.rerender({ blocked: false }) }
      if (transition === 'logout' || transition === 'relogin') void revokeAccountIdentity(view.client)
      if (transition === 'switch') view.client.setQueryData(['auth', 'me'], { user: user(allPermissions, 'B') })
      if (transition === 'relogin') view.client.setQueryData(['auth', 'me'], { user: user(allPermissions) })
      if (transition === 'permission') { view.client.setQueryData(['auth', 'me'], { user: user([]) }); await nextTick() }
      if (transition === 'unmount') view.unmount()
      if (failed) exporting.reject(new Error('private'))
      else exporting.resolve(descriptor)
      await exporting.promise.catch(() => undefined)
      await Promise.resolve()
      expect(downloadCsv).not.toHaveBeenCalled()
      expect(toast.success).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
      cleanup()
    }
  })
  it.each([['zh-CN', '导出 CSV', '已发起 CSV 下载，请在浏览器中确认保存。'], ['en', 'Export CSV', 'CSV download started. Confirm saving in your browser.']])('localizes the action and truthful success feedback in %s', async (locale, label, success) => {
    mount({ locale })
    await fireEvent.click(screen.getByRole('button', { name: label }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(success))
  })
})
