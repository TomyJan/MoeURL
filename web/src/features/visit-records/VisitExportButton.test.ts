import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { nextTick, reactive } from 'vue'
import { setImmediate } from 'node:timers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import type { CurrentUser } from '@/entities/auth/api'
import { messages } from '@/app/i18n'
import { revokeAccountIdentity } from '@/shared/preferences/useAccountPreferences'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import VisitExportButton from './VisitExportButton.vue'

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const id = '00000000-0000-0000-0000-000000000001'
const range = { startDate: '2026-10-16', endDate: '2026-10-22' }
const own = ['short_link:export_visits', 'short_link:read_visits', 'short_link:read_own']
const all = [...own, 'admin:access', 'short_link:read_all']
const file = { fileName: `moeurl-visits-${id}-2026-10-16-2026-10-22.csv`, contentType: 'text/csv;charset=utf-8', content: '\uFEFFshort_link_id,start_date,end_date,time_zone,event_id,occurred_at,referrer_host,device_type,browser_family,os_family,country_code\r\n' }
const clients: QueryClient[] = []
let downloads: string[]
let blobs: Blob[]
let released: string[]
/** Builds the real auth cache shape; no identity or query observers are replaced. */
function user(permissions = all, userId = 'A'): CurrentUser { return { id: userId, username: userId, nickname: '', group: 'user', permissions } }
/** Sends complete JSON at the network boundary. */
function json(data: unknown = file, code = 0, status = 200) { return new Response(JSON.stringify({ code, message: 'OK', data, meta: {} }), { status }) }
/** Mounts a reactive parent so same-tick changes reach the actual component contract. */
function mount(options: { identity?: CurrentUser | null; context?: 'own' | 'admin'; blocked?: boolean; range?: typeof range; locale?: string; client?: QueryClient } = {}) {
  const client = options.client ?? new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  if (!options.client) clients.push(client)
  if (options.identity !== null) client.setQueryData(['auth', 'me'], { user: options.identity ?? user() })
  const props = reactive({ id, context: options.context ?? 'own', range: options.range, filters: { deviceType: 'unknown', countryCode: 'US' }, blocked: options.blocked ?? false, contextRevision: 0 })
  if (!('range' in options)) props.range = range
  const locale = options.locale ?? 'test'
  const i18n = createI18n({ legacy: false, locale, messages: locale === 'test' ? {} : messages, missingWarn: false, fallbackWarn: false })
  let unavailable = 0
  const view = render({ components: { VisitExportButton }, setup: () => ({ props, invalidate: () => { unavailable++ } }), template: '<VisitExportButton v-bind="props" @unavailable="invalidate" />' }, { global: { plugins: [[VueQueryPlugin, { queryClient: client }], i18n], stubs: componentStubs } })
  return { ...view, client, props, unavailable: () => unavailable }
}
/** Drives the real standard button. */
async function click() { await fireEvent.click(screen.getByTestId('visit-export')) }
/** Drains network decoding and Vue jobs at an event-loop boundary without a timed sleep. */
async function settle() { await new Promise<void>(resolve => setImmediate(resolve)); await nextTick() }
beforeEach(() => {
  vi.clearAllMocks()
  downloads = []; blobs = []; released = []
  vi.stubGlobal('fetch', async () => json())
  vi.spyOn(URL, 'createObjectURL').mockImplementation(blob => { blobs.push(blob as Blob); return 'blob:visits' })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(url => { released.push(url) })
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download) })
})
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('VisitExportButton', () => {
  it.each([
    ...all.map(permission => ({ identity: user(all.filter(item => item !== permission)), context: (permission === 'short_link:read_own' ? 'own' : 'admin') as 'own' | 'admin' })),
    { identity: { ...user(), group: 'guest' } }, { identity: { ...user(), username: 'guest' } }, { identity: user(all, '') },
  ])('hides export without each required permission or an active identity %#', options => {
    mount(options)
    expect(screen.queryByTestId('visit-export')).toBeNull()
  })
  it('waits for auth and keeps account preferences unloaded', async () => {
    const auth = createDeferred<Response>()
    vi.stubGlobal('fetch', () => auth.promise)
    const view = mount({ identity: null })
    expect(screen.queryByTestId('visit-export')).toBeNull()
    auth.resolve(json({ user: user() }))
    await screen.findByTestId('visit-export')
    expect(view.client.getQueriesData({ queryKey: ['user', 'preferences'] })).toEqual([])
  })
  it.each([{ blocked: true }, { range: undefined }])('disables export without a successful applicable result %#', async options => {
    mount(options)
    expect((screen.getByTestId('visit-export') as HTMLButtonElement).disabled).toBe(true)
    await click()
    expect(downloads).toEqual([])
  })
  it.each(['own', 'admin'] as const)('downloads once through the real CSV boundary in %s context', async context => {
    const pending = createDeferred<Response>()
    const paths: string[] = []
    vi.stubGlobal('fetch', (path: string) => { paths.push(path); return pending.promise })
    mount({ context })
    await click(); await click()
    expect(paths).toEqual([`/api/v1/${context === 'admin' ? 'admin/' : ''}short-link/visits/export?id=${id}&startDate=2026-10-16&endDate=2026-10-22&deviceType=unknown&countryCode=US`])
    expect((screen.getByTestId('visit-export') as HTMLButtonElement).disabled).toBe(true)
    pending.resolve(json())
    await waitFor(() => expect(downloads).toEqual([file.fileName]))
    expect(blobs[0]?.type).toBe('text/csv;charset=utf-8')
    expect(released).toEqual(['blob:visits'])
    expect(document.querySelector('a[download]')).toBeNull()
    expect(toast.success).toHaveBeenCalledWith('visitExport.started')
  })
  it.each(['network', 'browser', 'object', 'invalid'])('keeps filters and allows retry after %s failure', async stage => {
    if (stage === 'network') vi.stubGlobal('fetch', (() => { let first = true; return async () => { if (first) { first = false; throw new Error('private') }; return json() } })())
    if (stage === 'browser') vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementationOnce(() => { throw new Error('save') })
    if (stage === 'object') vi.spyOn(URL, 'createObjectURL').mockImplementationOnce(() => { throw new Error('prepare') })
    if (stage === 'invalid') vi.stubGlobal('fetch', (() => { let first = true; return async () => { if (first) { first = false; return json({ ...file, content: 'unsafe' }) }; return json() } })())
    const view = mount()
    await click()
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('visitExport.failed'))
    expect(document.querySelector('a[download]')).toBeNull()
    expect(view.props.filters).toEqual({ deviceType: 'unknown', countryCode: 'US' })
    await click()
    await waitFor(() => expect(downloads).toEqual([file.fileName]))
    if (stage === 'browser') expect(released).toEqual(['blob:visits', 'blob:visits'])
  })
  it.each(['revision', 'id', 'context', 'range', 'filters', 'blocked', 'logout', 'switch', 'relogin', 'permission', 'unmount'])('ignores late success and failure after %s transitions', async transition => {
    for (const failure of [false, true]) {
      const pending = createDeferred<Response>()
      vi.stubGlobal('fetch', () => pending.promise)
      const view = mount()
      await click()
      if (transition === 'revision') view.props.contextRevision += 2
      if (transition === 'id') { view.props.id = 'other'; await nextTick(); view.props.id = id }
      if (transition === 'context') { view.props.context = 'admin'; await nextTick(); view.props.context = 'own' }
      if (transition === 'range') { view.props.range = { ...range, startDate: '2026-10-17' }; await nextTick(); view.props.range = range }
      if (transition === 'filters') { view.props.filters.countryCode = 'JP'; await nextTick(); view.props.filters.countryCode = 'US' }
      if (transition === 'blocked') { view.props.blocked = true; await nextTick(); view.props.blocked = false }
      if (transition === 'logout' || transition === 'relogin') void revokeAccountIdentity(view.client)
      if (transition === 'relogin') view.client.setQueryData(['auth', 'me'], { user: user() })
      if (transition === 'switch') view.client.setQueryData(['auth', 'me'], { user: user(all, 'B') })
      if (transition === 'permission') { view.client.setQueryData(['auth', 'me'], { user: user([]) }); view.client.setQueryData(['auth', 'me'], { user: user() }) }
      if (transition === 'unmount') { view.unmount(); mount({ client: view.client }) }
      pending.resolve(json(failure ? null : file, failure ? 120001 : 0))
      await pending.promise
      await settle()
      expect(downloads).toEqual([])
      expect(toast.error).not.toHaveBeenCalled()
      expect(toast.success).not.toHaveBeenCalled()
      expect(view.client.getQueryData<{ user: CurrentUser }>(['auth', 'me'])?.user.permissions).toEqual(transition === 'logout' ? [] : all)
      cleanup()
    }
  })
  it('checks synchronous cache revocation before starting a request', async () => {
    let exports = 0
    vi.stubGlobal('fetch', async () => { exports++; return json() })
    const view = mount()
    view.client.setQueryData(['auth', 'me'], { user: user([]) })
    await click()
    expect(exports).toBe(0)
  })
  it('waits for the parent revision before issuing an already queued click', async () => {
    let requests = 0
    vi.stubGlobal('fetch', async () => { requests++; return json() })
    const view = mount()
    screen.getByTestId('visit-export').dispatchEvent(new MouseEvent('click', { bubbles: true }))
    view.props.contextRevision++
    await settle()
    expect(requests).toBe(0)
    expect(downloads).toEqual([])
    expect(toast.error).not.toHaveBeenCalled()
    expect((screen.getByTestId('visit-export') as HTMLButtonElement).disabled).toBe(false)
  })
  it.each([120001, 401, 403])('clears rejected authorization before a guarded identity refresh for %s', async code => {
    const refresh = createDeferred<Response>()
    let reading = false
    vi.stubGlobal('fetch', (path: string) => { if (path.endsWith('/auth/me')) { reading = true; return refresh.promise }; return Promise.resolve(json(null, code === 120001 ? code : 0, code === 120001 ? 200 : code)) })
    const view = mount()
    await click()
    await waitFor(() => expect(reading).toBe(true))
    expect(view.client.getQueryData<{ user: CurrentUser }>(['auth', 'me'])?.user.permissions).toEqual([])
    expect(screen.queryByTestId('visit-export')).toBeNull()
    view.client.setQueryData(['auth', 'me'], { user: user(all, 'B') })
    refresh.resolve(json({ user: user([]) }))
    await refresh.promise
    await settle()
    expect(view.client.getQueryData<{ user: CurrentUser }>(['auth', 'me'])?.user.id).toBe('B')
    expect(downloads).toEqual([])
  })
  it.each(['current', 'failed', 'unmounted'])('handles an authorization refresh for the %s lifecycle', async lifecycle => {
    const refresh = createDeferred<Response>()
    let reads = 0
    vi.stubGlobal('fetch', (path: string) => {
      if (path.endsWith('/auth/me')) { reads++; return refresh.promise }
      return Promise.resolve(json(null, 120001))
    })
    const view = mount()
    await click()
    await waitFor(() => expect(reads).toBe(1))
    expect(view.client.getQueryData<{ user: CurrentUser }>(['auth', 'me'])?.user.permissions).toEqual([])
    if (lifecycle === 'unmounted') view.unmount()
    if (lifecycle === 'failed') refresh.reject(new Error('offline'))
    else refresh.resolve(json({ user: user(own) }))
    await settle()
    expect(view.client.getQueryData<{ user: CurrentUser }>(['auth', 'me'])?.user.permissions).toEqual(lifecycle === 'current' ? own : [])
    expect(downloads).toEqual([])
    expect(toast.error).toHaveBeenCalledTimes(1)
  })
  it('refreshes unavailable records instead of downloading a stale result', async () => {
    vi.stubGlobal('fetch', async () => json(null, 200104))
    const view = mount()
    await click()
    await waitFor(() => expect(view.unavailable()).toBe(1))
    expect(downloads).toEqual([])
  })
  it.each([['zh-CN', '导出访问记录 CSV', '导出超过 1000 条或 8 MiB，请缩小日期范围或筛选条件后重试。'], ['en', 'Export visit records CSV', 'Export exceeds 1000 records or 8 MiB. Narrow the date range or filters and try again.']])('shows the localized limit and action in %s', async (locale, label, limit) => {
    vi.stubGlobal('fetch', async () => json(null, 200120))
    mount({ locale })
    await fireEvent.click(screen.getByRole('button', { name: label }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(limit))
    expect(downloads).toEqual([])
  })
})
