import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import AdminDashboardPage from './AdminDashboardPage.vue'
import AdminAuditPage from './AdminAuditPage.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string, params?: Record<string, string>) => params ? `${key} ${Object.values(params).join(' ')}` : key }) }))
vi.mock('vuetify', () => ({ useTheme: () => ({ global: { current: { value: { colors: { primary: 'blue', 'on-surface-variant': 'black', outline: 'gray' } } } } }) }))
vi.mock('chart.js', () => ({ Chart: class { static register() {} destroy() {} }, LineController: class {}, LineElement: class {}, PointElement: class {}, LinearScale: class {}, CategoryScale: class {}, Tooltip: class {} }))
const clients: QueryClient[] = []
const range = { startDate: '2026-10-16', endDate: '2026-10-22', timeZone: 'UTC' }
const id = '00000000-0000-0000-0000-000000000001'
const dashboard = { range, generatedAt: '2026-10-22T01:02:03Z', summary: { userCount: 3, activeUserCount: 2, linkCount: 5, activeLinkCount: 4, todayCreatedLinkCount: 1, todayVisitCount: 9, rangeVisitCount: 17 }, trend: [{ date: '2026-10-22', visitCount: 17 }], topLinks: [{ id, slug: 'deleted', title: 'A deleted link', url: 'https://go.example/deleted', deleted: true, visitCount: 17 }, { id, slug: 'active', title: '', url: 'https://go.example/active', deleted: false, visitCount: 1 }] }
const audit = { range, pageSize: 25, hasMore: false, nextCursor: '', retentionDays: 180, items: [{ id: '9223372036854775807', actorId: null, actorUsername: null, resourceType: 'short_link', resourceId: id, action: 'create', changedFields: ['title', 'status'], occurredAt: '2026-10-22T01:02:03.123456Z' }] }
/** Keeps the actual API and QueryClient while substituting the network boundary. */
function serve(data: unknown) { vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} })))) }
/** Mounts the real administrator page against a controllable identity cache. */
function mount(page: typeof AdminDashboardPage | typeof AdminAuditPage, permissions = ['admin:access', 'statistics:read_all', 'audit:read'], existingClient?: QueryClient) {
  const client = existingClient ?? new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  if (!existingClient) clients.push(client)
  client.setQueryData(['auth', 'me'], { user: { id: 'admin', username: 'admin', group: 'admin', permissions } })
  const view = render(page, { global: { stubs: componentStubs, plugins: [[VueQueryPlugin, { queryClient: client }]] } })
  return { client, ...view }
}
afterEach(() => { clients.splice(0).forEach((client) => client.clear()); vi.unstubAllGlobals() })
describe('administrator insight pages', () => {
  it.each([['dashboard', AdminDashboardPage, dashboard], ['audit', AdminAuditPage, audit]] as const)('does not revive %s data after a page is destroyed and recreated', async (name, page, data) => {
    serve(data)
    const firstView = mount(page)
    await screen.findByText(name === 'dashboard' ? 'A deleted link' : '9223372036854775807')
    firstView.unmount()
    const fresh = createDeferred<Response>()
    vi.stubGlobal('fetch', vi.fn(() => fresh.promise))
    mount(page, ['admin:access', 'statistics:read_all', 'audit:read'], firstView.client)
    expect(screen.queryByText(name === 'dashboard' ? 'A deleted link' : '9223372036854775807')).toBeNull()
    expect(await screen.findByRole('progressbar')).toBeTruthy()
    fresh.resolve(new Response(JSON.stringify({ code: 0, message: 'OK', data: name === 'dashboard' ? { ...dashboard, topLinks: [] } : { ...audit, items: [] }, meta: {} })))
    await screen.findByText(name === 'dashboard' ? 'dashboard.empty' : 'audit.empty')
  })
  it('shows non-system actors, an empty result, failure retry and stable audit cursor navigation', async () => {
    const next = { ...audit, hasMore: true, nextCursor: 'audit-next', items: [{ ...audit.items[0], actorId: id, actorUsername: 'Admin name', changedFields: [] }, { ...audit.items[0], id: '9223372036854775806', actorId: id, actorUsername: null }] }
    const fetcher = vi.fn(async (url: string) => {
      if (url.includes('cursor=audit-next')) return new Response(JSON.stringify({ code: 0, message: 'OK', data: { ...audit, items: [] }, meta: {} }))
      return new Response(JSON.stringify({ code: 0, message: 'OK', data: next, meta: {} }))
    })
    vi.stubGlobal('fetch', fetcher)
    mount(AdminAuditPage)
    await screen.findByText('Admin name')
    expect(screen.getByText('analytics.unknown')).toBeTruthy()
    expect(screen.getByText('—')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'insights.next' }))
    await screen.findByText('audit.empty')
    await fireEvent.click(screen.getByRole('button', { name: 'insights.previous' }))
    await screen.findByText('Admin name')
    fetcher.mockRejectedValueOnce(new Error('offline'))
    await fireEvent.click(screen.getByRole('button', { name: 'audit.applyFilters' }))
    await screen.findByText('insights.loadFailed')
    expect(screen.queryByText('Admin name')).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: 'analytics.retry' }))
    await screen.findByText('Admin name')
    expect((screen.getByRole('button', { name: 'insights.previous' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('shows real snapshot values and makes only undeleted popular links actionable', async () => {
    serve(dashboard)
    mount(AdminDashboardPage)
    await screen.findByText('A deleted link')
    expect(screen.getByText('dashboard.userCount').parentElement?.textContent).toContain('3')
    expect(screen.getAllByText('dashboard.rangeVisitCount')[0]?.parentElement?.textContent).toContain('17')
    expect(screen.getByText('dashboard.activeMeaning')).toBeTruthy()
    expect(screen.getByText('dashboard.deleted')).toBeTruthy()
    expect(screen.getAllByRole('link')).toHaveLength(1)
    expect(screen.getByRole('link').getAttribute('href')).toBe(`/admin/link/${id}/analytics`)
    expect(screen.queryByText('UV')).toBeNull()
    await fireEvent.update(screen.getByRole('combobox', { name: 'analytics.dateRange' }), '30')
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toBe('/api/v1/admin/dashboard?days=30'))
  })
  it('shows empty popular data, failure and a working retry without fake zero metrics', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(new Response(JSON.stringify({ code: 0, message: 'OK', data: { ...dashboard, topLinks: [] }, meta: {} }))))
    mount(AdminDashboardPage)
    await screen.findByText('insights.loadFailed')
    expect(screen.queryByText('dashboard.userCount')).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: 'analytics.retry' }))
    expect(await screen.findByText('dashboard.empty')).toBeTruthy()
  })
  it.each([AdminDashboardPage, AdminAuditPage])('requires the complete live permission intersection', async (page) => {
    serve(dashboard)
    mount(page, ['admin:access'])
    await screen.findByText('insights.noAccess')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('renders immutable system audit metadata without rounding IDs or times and applies validated filters', async () => {
    serve(audit)
    mount(AdminAuditPage)
    await screen.findByText('9223372036854775807')
    expect(screen.getByText('2026-10-22T01:02:03.123456Z')).toBeTruthy()
    expect(screen.getByText('audit.systemActor')).toBeTruthy()
    expect(screen.getByText('title, status')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /delete|save/i })).toBeNull()
    await fireEvent.update(screen.getByLabelText('audit.actorId'), 'not-a-uuid')
    await fireEvent.click(screen.getByRole('button', { name: 'audit.applyFilters' }))
    expect(screen.getByText('audit.invalidActor')).toBeTruthy()
    await fireEvent.update(screen.getByLabelText('audit.actorId'), id)
    await fireEvent.update(screen.getByRole('combobox', { name: 'audit.resourceType' }), 'short_link')
    await fireEvent.update(screen.getByRole('combobox', { name: 'audit.action' }), 'update')
    await fireEvent.click(screen.getByRole('button', { name: 'audit.applyFilters' }))
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toContain(`actorId=${id}&resourceType=short_link&action=update`))
    await fireEvent.update(screen.getByRole('combobox', { name: 'analytics.dateRange' }), '30')
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toContain(`days=30&actorId=${id}&resourceType=short_link&action=update`))
  })
  it('hides audit history immediately on account changes and permission loss', async () => {
    serve(audit)
    const { client } = mount(AdminAuditPage)
    await screen.findByText('9223372036854775807')
    client.setQueryData(['auth', 'me'], { user: { id: 'other', username: 'other', group: 'user', permissions: [] } })
    await screen.findByText('insights.noAccess')
    expect(screen.queryByText('9223372036854775807')).toBeNull()
  })
})
