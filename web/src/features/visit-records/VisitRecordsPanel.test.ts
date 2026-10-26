import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { reactive } from 'vue'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import VisitRecordsPanel from './VisitRecordsPanel.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string, params?: Record<string, string>) => params ? `${key} ${Object.values(params).join(' ')}` : key }) }))
const clients: QueryClient[] = []
const range = { startDate: '2026-10-16', endDate: '2026-10-22', timeZone: 'UTC' }
const first = { range, pageSize: 25, hasMore: true, nextCursor: 'page2', items: [{ id: '00000000-0000-0000-0000-000000000001', occurredAt: '2026-10-22T01:02:03.123456Z', referrerHost: 'private.first.example', deviceType: null, browserFamily: null, osFamily: null, countryCode: null }] }
const exportPermissions = ['short_link:read_own', 'short_link:read_visits', 'short_link:export_visits']
const csv = { fileName: 'moeurl-visits-00000000-0000-0000-0000-000000000001-2026-10-16-2026-10-22.csv', contentType: 'text/csv;charset=utf-8', content: '\uFEFFshort_link_id,start_date,end_date,time_zone,event_id,occurred_at,referrer_host,device_type,browser_family,os_family,country_code\r\n' }
/** Returns actual wire responses through the real API decoder and query observer. */
function json(data: unknown, code = 0) { return new Response(JSON.stringify({ code, message: 'OK', data, meta: {} })) }
/** Mounts an authenticated observer whose cache can be changed synchronously by each test. */
function mount(permissions: string[] | null = ['short_link:read_own', 'short_link:read_visits'], existingClient?: QueryClient) {
  const client = existingClient ?? new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  if (!existingClient) clients.push(client)
  if (permissions) client.setQueryData(['auth', 'me'], { user: { id: 'A', username: 'alice', nickname: '', group: 'user', permissions } })
  const props = reactive({ id: '00000000-0000-0000-0000-000000000001', context: 'own' as 'own' | 'admin', range: { days: 7 as 7 | 30 | 90 } })
  const view = render({ components: { VisitRecordsPanel }, setup: () => ({ props }), template: '<VisitRecordsPanel v-bind="props" />' }, { global: { stubs: componentStubs, plugins: [[VueQueryPlugin, { queryClient: client }]] } })
  return { client, props, ...view }
}
afterEach(() => { clients.splice(0).forEach((client) => client.clear()); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('anonymous visit records', () => {
  it('exports all applied filters from the second page, including empty results, without pagination', async () => {
    const requested: string[] = []
    const downloads: string[] = []
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:visits')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download) })
    vi.stubGlobal('fetch', async (path: string) => { requested.push(path); return json(path.includes('/export?') ? csv : path.includes('cursor=page2') ? { ...first, items: [], hasMore: false, nextCursor: '' } : first) })
    mount(exportPermissions)
    await screen.findByText('private.first.example')
    await fireEvent.update(screen.getByRole('combobox', { name: 'visits.device' }), 'unknown')
    await fireEvent.update(screen.getByLabelText('visits.country'), 'US')
    expect((screen.getByTestId('visit-export') as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.click(screen.getByRole('button', { name: 'audit.applyFilters' }))
    await waitFor(() => expect((screen.getByTestId('visit-export') as HTMLButtonElement).disabled).toBe(false))
    await fireEvent.click(screen.getByRole('button', { name: 'insights.next' }))
    await screen.findByText('visits.empty')
    await fireEvent.click(screen.getByTestId('visit-export'))
    await waitFor(() => expect(downloads).toEqual([csv.fileName]))
    expect(requested.at(-1)).toBe('/api/v1/short-link/visits/export?id=00000000-0000-0000-0000-000000000001&startDate=2026-10-16&endDate=2026-10-22&deviceType=unknown&countryCode=US')
  })
  it.each(['range', 'country', 'device', 'refresh', 'error'])('invalidates pending export after same-tick %s changes or query state changes', async transition => {
    const exporting = createDeferred<Response>()
    const refreshing = createDeferred<Response>()
    const downloads: string[] = []
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:visits')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download) })
    let read = false
    vi.stubGlobal('fetch', (path: string) => {
      if (path.includes('/export?')) return exporting.promise
      if (read && (transition === 'refresh' || transition === 'error')) return refreshing.promise
      read = true
      return Promise.resolve(json(first))
    })
    const view = mount(exportPermissions)
    await screen.findByText('private.first.example')
    await fireEvent.click(screen.getByTestId('visit-export'))
    if (transition === 'range') { view.props.range = { days: 30 }; view.props.range = { days: 7 } }
    if (transition === 'country') {
      const input = screen.getByLabelText('visits.country') as HTMLInputElement
      input.value = 'US'; input.dispatchEvent(new Event('input', { bubbles: true }))
      input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    if (transition === 'device') {
      const select = screen.getByRole('combobox', { name: 'visits.device' }) as HTMLSelectElement
      select.value = 'mobile'; select.dispatchEvent(new Event('change', { bubbles: true }))
      select.value = ''; select.dispatchEvent(new Event('change', { bubbles: true }))
    }
    if (transition === 'refresh' || transition === 'error') {
      void view.client.invalidateQueries({ queryKey: ['insights', 'visits'] })
      await waitFor(() => expect((screen.getByTestId('visit-export') as HTMLButtonElement).disabled).toBe(true))
      if (transition === 'error') { refreshing.reject(new Error('offline')); await screen.findByText('insights.loadFailed') }
    }
    exporting.resolve(json(csv))
    await exporting.promise
    await waitFor(() => expect(screen.getByTestId('visit-export').hasAttribute('disabled')).toBe(transition === 'refresh' || transition === 'error'))
    expect(downloads).toEqual([])
    if (transition === 'refresh') { refreshing.resolve(json(first)); await waitFor(() => expect(screen.getByTestId('visit-export').hasAttribute('disabled')).toBe(false)) }
  })
  it('blocks stale cached export after the server reports an unavailable link and retries records', async () => {
    const refresh = createDeferred<Response>()
    let reads = 0
    vi.stubGlobal('fetch', (path: string) => path.includes('/export?') ? Promise.resolve(json(null, 200104)) : ++reads === 1 ? Promise.resolve(json(first)) : refresh.promise)
    mount(exportPermissions)
    await screen.findByText('private.first.example')
    await fireEvent.click(screen.getByTestId('visit-export'))
    await waitFor(() => expect(reads).toBe(2))
    expect((screen.getByTestId('visit-export') as HTMLButtonElement).disabled).toBe(true)
    refresh.resolve(json(null, 200104))
    await screen.findByText('insights.noAccess')
    expect((screen.getByTestId('visit-export') as HTMLButtonElement).disabled).toBe(true)
  })
  it('requires a fresh read after unmounting and remounting against the same authenticated cache', async () => {
    const fresh = createDeferred<Response>()
    const fetcher = vi.fn().mockResolvedValueOnce(json(first)).mockImplementation(() => fresh.promise)
    vi.stubGlobal('fetch', fetcher)
    const previous = mount()
    await screen.findByText('private.first.example')
    previous.unmount()
    mount(['short_link:read_own', 'short_link:read_visits'], previous.client)
    expect(screen.queryByText('private.first.example')).toBeNull()
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    fresh.resolve(json({ ...first, items: [], hasMore: false, nextCursor: '' }))
    await screen.findByText('visits.empty')
  })

  it('rejects an old instance’s late response while a remounted instance waits for its own read', async () => {
    const abandoned = createDeferred<Response>()
    const fresh = createDeferred<Response>()
    const fetcher = vi.fn().mockImplementationOnce(() => abandoned.promise).mockImplementation(() => fresh.promise)
    vi.stubGlobal('fetch', fetcher)
    const previous = mount()
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    previous.unmount()
    mount(['short_link:read_own', 'short_link:read_visits'], previous.client)
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    abandoned.resolve(json(first))
    await waitFor(() => expect(previous.client.isFetching({ queryKey: ['insights', 'visits'] })).toBe(1))
    expect(screen.queryByText('private.first.example')).toBeNull()
    fresh.resolve(json({ ...first, items: [{ ...first.items[0], referrerHost: 'current.instance.example' }] }))
    await screen.findByText('current.instance.example')
    expect(screen.queryByText('private.first.example')).toBeNull()
  })
  it('does not revive a cached page when a link leaves and returns before a fresh response', async () => {
    const pending = createDeferred<Response>()
    const fetcher = vi.fn().mockResolvedValueOnce(json(first)).mockImplementation(async () => (await pending.promise).clone())
    vi.stubGlobal('fetch', fetcher)
    const { props } = mount()
    await screen.findByText('private.first.example')
    props.id = '00000000-0000-0000-0000-000000000002'
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    props.id = '00000000-0000-0000-0000-000000000001'
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
    expect(screen.queryByText('private.first.example')).toBeNull()
    pending.resolve(json({ ...first, items: [], hasMore: false, nextCursor: '' }))
    await screen.findByText('visits.empty')
  })
  it('stays private before identity resolves and displays concrete anonymous categories with unknown referrers', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/auth/me') ? json({ user: { id: '', username: 'guest', group: 'guest', permissions: [] } }) : json({ ...first, items: [{ ...first.items[0], referrerHost: null, deviceType: 'desktop', browserFamily: 'chrome', osFamily: 'windows', countryCode: 'US' }] })))
    const { client } = mount(null)
    expect(screen.queryByRole('table')).toBeNull()
    await screen.findByText('insights.noAccess')
    await waitFor(() => expect(client.getQueryState(['auth', 'me'])?.fetchStatus).toBe('idle'))
    client.setQueryData(['auth', 'me'], { user: { id: 'A', username: 'alice', group: 'user', permissions: ['short_link:read_own', 'short_link:read_visits'] } })
    await screen.findByRole('cell', { name: 'US' })
    expect(screen.getByRole('cell', { name: 'visits.dimensions.chrome' })).toBeTruthy()
    expect(screen.getByRole('cell', { name: 'analytics.unknown' })).toBeTruthy()
  })
  it('shows the applied server range, legacy unknown buckets, exact UTC timestamp and real table rows', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(first)))
    mount()
    expect(await screen.findByRole('cell', { name: 'private.first.example' })).toBeTruthy()
    expect(screen.getByText('2026-10-22T01:02:03.123456Z')).toBeTruthy()
    expect(screen.getAllByRole('cell', { name: 'analytics.unknown' })).toHaveLength(4)
    expect(screen.getByText('insights.appliedRange 2026-10-16 2026-10-22')).toBeTruthy()
  })
  it('prevents duplicate pagination while loading, returns to the previous cursor and resets after filters and applied dates', async () => {
    const pending = createDeferred<Response>()
    const fetcher = vi.fn(async (url: string) => url.includes('cursor=page2') ? pending.promise : json(first))
    vi.stubGlobal('fetch', fetcher)
    const { props } = mount()
    await screen.findByText('private.first.example')
    await fireEvent.click(screen.getByRole('button', { name: 'insights.next' }))
    expect((screen.getByRole('button', { name: 'insights.next' }) as HTMLButtonElement).disabled).toBe(true)
    pending.resolve(json({ ...first, items: [], hasMore: false, nextCursor: '' }))
    await screen.findByText('visits.empty')
    await fireEvent.click(screen.getByRole('button', { name: 'insights.previous' }))
    await screen.findByText('private.first.example')
    await fireEvent.update(screen.getByRole('combobox', { name: 'visits.device' }), 'unknown')
    await waitFor(() => expect(fetcher.mock.calls.at(-1)?.[0]).toContain('deviceType=unknown'))
    expect(fetcher.mock.calls.at(-1)?.[0]).not.toContain('cursor=')
    await fireEvent.update(screen.getByLabelText('visits.country'), 'us')
    await fireEvent.click(screen.getByRole('button', { name: 'audit.applyFilters' }))
    expect(screen.getByText('visits.invalidCountry')).toBeTruthy()
    await fireEvent.update(screen.getByLabelText('visits.country'), 'US')
    await fireEvent.click(screen.getByRole('button', { name: 'audit.applyFilters' }))
    await waitFor(() => expect(fetcher.mock.calls.at(-1)?.[0]).toContain('countryCode=US'))
    props.range = { days: 30 }
    await waitFor(() => expect(fetcher.mock.calls.at(-1)?.[0]).toContain('days=30'))
    expect(fetcher.mock.calls.at(-1)?.[0]).not.toContain('cursor=')
  })
  it('hides errors instead of rendering empty success and retries the active request', async () => {
    const fetcher = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(json({ ...first, items: [], hasMore: false, nextCursor: '' }))
    vi.stubGlobal('fetch', fetcher)
    mount()
    await screen.findByText('insights.loadFailed')
    expect(screen.queryByText('visits.empty')).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: 'analytics.retry' }))
    expect(await screen.findByText('visits.empty')).toBeTruthy()
  })
  it.each([120001, 401, 403])('does not leak cached rows on a server authorization failure %s', async (code) => {
    vi.stubGlobal('fetch', vi.fn(async () => json(null, code)))
    mount()
    expect(await screen.findByText('insights.noAccess')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })
  it('never requests records without the permission intersection', async () => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    mount(['short_link:read_own'])
    expect(await screen.findByText('insights.noAccess')).toBeTruthy()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('isolates switch-link, switch-account, revocation, restoration and late responses', async () => {
    const late = createDeferred<Response>()
    const fetcher = vi.fn().mockResolvedValueOnce(json(first)).mockImplementation(() => late.promise)
    vi.stubGlobal('fetch', fetcher)
    const { client, props } = mount()
    await screen.findByText('private.first.example')
    props.id = '00000000-0000-0000-0000-000000000002'
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('private.first.example')).toBeNull()
    client.setQueryData(['auth', 'me'], { user: { id: 'B', username: 'bob', group: 'user', permissions: ['short_link:read_own', 'short_link:read_visits'] } })
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3))
    client.setQueryData(['auth', 'me'], { user: { id: 'B', username: 'bob', group: 'user', permissions: ['short_link:read_own'] } })
    await screen.findByText('insights.noAccess')
    late.resolve(json(first))
    await Promise.resolve()
    expect(screen.queryByText('private.first.example')).toBeNull()
    const restored = createDeferred<Response>()
    fetcher.mockImplementation(() => restored.promise)
    client.setQueryData(['auth', 'me'], { user: { id: 'B', username: 'bob', group: 'user', permissions: ['short_link:read_own', 'short_link:read_visits'] } })
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(4))
    expect(screen.queryByText('private.first.example')).toBeNull()
    restored.resolve(json({ ...first, items: [], hasMore: false, nextCursor: '' }))
    await screen.findByText('visits.empty')
    props.context = 'admin'
    await screen.findByText('insights.noAccess')
  })
})
