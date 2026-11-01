import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { nextTick } from 'vue'
import { setImmediate } from 'node:timers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { toast } from 'vue-sonner'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import AdminAuditPage from './AdminAuditPage.vue'
import ConsoleShell from '@/widgets/console-shell/ConsoleShell.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ locale: { value: 'en-US' }, t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const clients: QueryClient[] = []
const actorId = '00000000-0000-0000-0000-000000000001'
const range = { startDate: '2026-10-16', endDate: '2026-10-22', timeZone: 'UTC' }
const first = { range, pageSize: 25, hasMore: true, nextCursor: 'page2', retentionDays: 180, items: [{ id: '9223372036854775807', occurredAt: '2026-10-22T01:02:03.123456Z', actorId: null, actorUsername: null, resourceType: 'user', resourceId: actorId, action: 'update', changedFields: [] }] }
const permissions = ['admin:access', 'audit:read', 'audit:export']
const csv = { fileName: 'moeurl-audit-2026-10-16-2026-10-22.csv', contentType: 'text/csv;charset=utf-8', content: '\uFEFFstart_date,end_date,time_zone,audit_id,occurred_at,actor_id,actor_username,resource_type,resource_id,action,changed_fields\r\n' }
let downloads: string[]
/** Keeps both audit and authorization decoding real. */
function json(data: unknown, code = 0) { return new Response(JSON.stringify({ code, message: 'OK', data, meta: {} })) }
/** Mounts the real page and query lifecycle with a seeded authenticated cache. */
function mount(grants = permissions) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  clients.push(client)
  client.setQueryData(['auth', 'me'], { user: { id: 'A', username: 'admin', nickname: '', group: 'admin', permissions: grants } })
  return { client, ...render(AdminAuditPage, { global: { stubs: componentStubs, plugins: [[VueQueryPlugin, { queryClient: client }]] } }) }
}
/** Drains response decoding and all queued reactive work without a timed sleep. */
async function settle() { await new Promise<void>(resolve => setImmediate(resolve)); await nextTick() }
beforeEach(() => {
  downloads = []; vi.clearAllMocks()
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:audit')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download) })
})
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('audit page CSV export', () => {
  it('exports applied filters and actual loaded dates from an empty second page without pagination', async () => {
    const requested: string[] = []
    vi.stubGlobal('fetch', async (path: string) => { requested.push(path); return json(path.includes('/export?') ? csv : path.includes('cursor=page2') ? { ...first, items: [], hasMore: false, nextCursor: '' } : first) })
    mount()
    await screen.findByText('9223372036854775807')
    await fireEvent.update(screen.getByLabelText('audit.actorId'), actorId)
    await fireEvent.update(screen.getByRole('combobox', { name: 'audit.resourceType' }), 'user')
    await fireEvent.update(screen.getByRole('combobox', { name: 'audit.action' }), 'update')
    expect((screen.getByTestId('audit-export') as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.click(screen.getByRole('button', { name: 'audit.applyFilters' }))
    await waitFor(() => expect((screen.getByTestId('audit-export') as HTMLButtonElement).disabled).toBe(false))
    await fireEvent.click(screen.getByRole('button', { name: 'insights.next' }))
    await screen.findByText('audit.empty')
    await fireEvent.click(screen.getByTestId('audit-export'))
    await waitFor(() => expect(downloads).toEqual([csv.fileName]))
    expect(requested.at(-1)).toBe(`/api/v1/admin/audit/export?startDate=2026-10-16&endDate=2026-10-22&actorId=${actorId}&resourceType=user&action=update`)
  })
  it.each(['actor', 'resource', 'action'])('blocks an unapplied %s draft and permits restoring it', async field => {
    vi.stubGlobal('fetch', async () => json(first))
    mount(); await screen.findByText('9223372036854775807')
    const input = screen.getByLabelText(field === 'actor' ? 'audit.actorId' : field === 'resource' ? 'audit.resourceType' : 'audit.action')
    await fireEvent.update(input, field === 'actor' ? actorId : field === 'resource' ? 'user' : 'update')
    expect((screen.getByTestId('audit-export') as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.update(input, '')
    expect((screen.getByTestId('audit-export') as HTMLButtonElement).disabled).toBe(false)
  })
  it('keeps invalid actor drafts blocked after validation fails', async () => {
    vi.stubGlobal('fetch', async () => json(first))
    mount(); await screen.findByText('9223372036854775807')
    await fireEvent.update(screen.getByLabelText('audit.actorId'), 'invalid')
    await fireEvent.click(screen.getByRole('button', { name: 'audit.applyFilters' }))
    expect(screen.getByText('audit.invalidActor')).toBeTruthy()
    await fireEvent.update(screen.getByLabelText('audit.actorId'), '')
    expect((screen.getByTestId('audit-export') as HTMLButtonElement).disabled).toBe(true)
  })
  it.each(['00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000000A'])('rejects a noncanonical actor %s without applying it or enabling export', async value => {
    const paths: string[] = []
    vi.stubGlobal('fetch', async (path: string) => { paths.push(path); return json(first) })
    mount(); await screen.findByText('9223372036854775807')
    await fireEvent.update(screen.getByLabelText('audit.actorId'), value)
    await fireEvent.click(screen.getByRole('button', { name: 'audit.applyFilters' }))
    expect(screen.getByText('audit.invalidActor')).toBeTruthy()
    expect(paths).toEqual(['/api/v1/admin/audit/list?days=7'])
    expect((screen.getByTestId('audit-export') as HTMLButtonElement).disabled).toBe(true)
  })
  it.each(['actor', 'resource', 'action', 'range', 'cursor', 'filters', 'refresh', 'error'])('invalidates late success and denial after synchronous %s round trips', async transition => {
    for (const failure of [false, true]) {
      const exporting = createDeferred<Response>()
      const refreshing = createDeferred<Response>()
      let read = false
      vi.stubGlobal('fetch', (path: string) => {
        if (path.includes('/export?')) return exporting.promise
        if (read && ['refresh', 'error'].includes(transition)) return refreshing.promise
        read = true; return Promise.resolve(json(first))
      })
      const view = mount(); await screen.findByText('9223372036854775807')
      await fireEvent.click(screen.getByTestId('audit-export'))
      if (['actor', 'resource', 'action', 'range'].includes(transition)) {
        const input = screen.getByLabelText(transition === 'actor' ? 'audit.actorId' : transition === 'resource' ? 'audit.resourceType' : transition === 'action' ? 'audit.action' : 'analytics.dateRange') as HTMLInputElement
        const event = transition === 'actor' ? 'input' : 'change'
        input.value = transition === 'actor' ? actorId : transition === 'resource' ? 'user' : transition === 'action' ? 'update' : '30'
        input.dispatchEvent(new Event(event, { bubbles: true }))
        input.value = transition === 'range' ? '7' : ''; input.dispatchEvent(new Event(event, { bubbles: true }))
      }
      if (transition === 'cursor') {
        screen.getByRole('button', { name: 'insights.next' }).dispatchEvent(new MouseEvent('click', { bubbles: true }))
        screen.getByRole('button', { name: 'insights.previous' }).dispatchEvent(new MouseEvent('click', { bubbles: true }))
      }
      if (transition === 'filters') {
        const input = screen.getByLabelText('audit.actorId') as HTMLInputElement
        input.value = actorId; input.dispatchEvent(new Event('input', { bubbles: true }))
        screen.getByRole('button', { name: 'audit.applyFilters' }).dispatchEvent(new MouseEvent('click', { bubbles: true }))
        input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }))
        screen.getByRole('button', { name: 'audit.applyFilters' }).dispatchEvent(new MouseEvent('click', { bubbles: true }))
      }
      if (['refresh', 'error'].includes(transition)) {
        void view.client.invalidateQueries({ queryKey: ['insights', 'audit'] })
        await waitFor(() => expect(view.client.isFetching({ queryKey: ['insights', 'audit'] })).toBe(1))
        if (transition === 'error') { refreshing.reject(new Error('offline')); await screen.findByText('insights.loadFailed') }
      }
      exporting.resolve(json(failure ? null : csv, failure ? 120001 : 0)); await exporting.promise; await settle()
      expect(downloads).toEqual([]); expect(toast.error).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled()
      if (transition === 'refresh') { refreshing.resolve(json(first)); await settle() }
      cleanup()
    }
  })
  it('requires only the existing navigation read grants while hiding an unavailable export action', async () => {
    vi.stubGlobal('fetch', async () => json(first))
    mount(['admin:access', 'audit:read']); await screen.findByText('9223372036854775807')
    expect(screen.queryByTestId('audit-export')).toBeNull()
  })
  it('preserves custom date submission and validation while the shared picker publishes preset changes synchronously', async () => {
    const paths: string[] = []
    vi.stubGlobal('fetch', async (path: string) => { paths.push(path); return json(first) })
    mount(); await screen.findByText('9223372036854775807')
    await fireEvent.update(screen.getByLabelText('analytics.dateRange'), '30')
    await waitFor(() => expect(paths.at(-1)).toBe('/api/v1/admin/audit/list?days=30'))
    await fireEvent.update(screen.getByLabelText('analytics.dateRange'), 'custom')
    await fireEvent.update(screen.getByLabelText('analytics.startDate'), '2026-10-16')
    await fireEvent.update(screen.getByLabelText('analytics.endDate'), '2026-10-22')
    expect(paths).toHaveLength(2)
    await fireEvent.click(screen.getByRole('button', { name: 'analytics.apply' }))
    await waitFor(() => expect(paths.at(-1)).toBe('/api/v1/admin/audit/list?startDate=2026-10-16&endDate=2026-10-22'))
    await fireEvent.update(screen.getByLabelText('analytics.startDate'), '')
    await fireEvent.update(screen.getByLabelText('analytics.endDate'), '')
    await fireEvent.click(screen.getByRole('button', { name: 'analytics.apply' }))
    expect(await screen.findAllByText('analytics.invalidDate')).toHaveLength(2)
    await fireEvent.update(screen.getByLabelText('analytics.startDate'), '2026-10-22')
    await fireEvent.update(screen.getByLabelText('analytics.endDate'), '2026-10-16')
    await fireEvent.click(screen.getByRole('button', { name: 'analytics.apply' }))
    expect(await screen.findByText('analytics.invalidRange')).toBeTruthy()
    await fireEvent.update(screen.getByLabelText('analytics.startDate'), '9999-01-01')
    await fireEvent.update(screen.getByLabelText('analytics.endDate'), '9999-01-02')
    await fireEvent.click(screen.getByRole('button', { name: 'analytics.apply' }))
    expect(await screen.findByText('analytics.futureDate')).toBeTruthy()
    expect(paths).toHaveLength(3)
  })
  it.each(['readable', 'denied', 'failed', 'newer-empty', 'newer-read-then-empty', 'navigated-away'])(
    'coordinates a real Shell authorization refresh with the %s result', async outcome => {
      const refresh = createDeferred<Response>()
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: Infinity } } })
      clients.push(client)
      const auth = (grants = permissions) => ({ user: { id: 'A', username: 'admin', nickname: '', group: 'admin', permissions: grants } })
      const read = ['admin:access', 'audit:read']
      client.setQueryData(['auth', 'me'], auth())
      let reads = 0
      vi.stubGlobal('fetch', async (path: string) => {
        if (path.endsWith('/auth/me')) { reads++; return refresh.promise }
        return path.includes('/export?') ? json(null, 120001) : json(first)
      })
      const router = createRouter({ history: createMemoryHistory(), routes: [
        { path: '/', component: { template: '<p>Public home</p>' } },
        { path: '/other', component: { template: '<p>Other page</p>' } },
        { path: '/admin', component: ConsoleShell, meta: { requiresAdmin: true }, children: [{ path: 'audit', component: AdminAuditPage, meta: { insightCapability: 'audit:read' } }] },
      ] })
      await router.push('/admin/audit'); await router.isReady()
      render(RouterView, { global: { plugins: [router, [VueQueryPlugin, { queryClient: client }]], stubs: { ...componentStubs, RouterView: false, ConsoleSidebar: true, ConsoleTopbar: true, ShortLinkCreatePanel: true } } })
      await screen.findByText('9223372036854775807')
      await fireEvent.click(screen.getByTestId('audit-export'))
      await waitFor(() => expect(reads).toBe(1)); await settle()
      expect(client.getQueryData(['auth', 'me'])).toEqual(auth([]))
      expect(screen.queryByRole('table')).toBeNull()
      expect(router.currentRoute.value.path).toBe('/admin/audit')
      expect(screen.getByText('insights.noAccess')).toBeTruthy()
      if (outcome === 'newer-empty') client.setQueryData(['auth', 'me'], auth([]))
      if (outcome === 'newer-read-then-empty') { client.setQueryData(['auth', 'me'], auth(read)); client.setQueryData(['auth', 'me'], auth([])) }
      if (outcome === 'navigated-away') await router.push('/other')
      if (outcome === 'failed') refresh.reject(new Error('offline'))
      else refresh.resolve(json(auth(outcome === 'denied' ? [] : read)))
      await settle()
      if (outcome === 'readable') {
        await screen.findByText('9223372036854775807')
        expect(router.currentRoute.value.path).toBe('/admin/audit')
      } else if (outcome === 'navigated-away') {
        expect(router.currentRoute.value.path).toBe('/other')
        expect(screen.getByText('Other page')).toBeTruthy()
      } else await screen.findByText('Public home')
      expect(client.getQueryData(['auth', 'me'])).toEqual(auth(['readable', 'navigated-away'].includes(outcome) ? read : []))
      expect(screen.queryByTestId('audit-export')).toBeNull()
      expect(downloads).toEqual([])
      expect(toast.error).toHaveBeenCalledTimes(1)
    },
  )
})
