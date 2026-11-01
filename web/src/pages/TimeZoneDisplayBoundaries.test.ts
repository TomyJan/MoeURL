import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick, ref, type Component } from 'vue'
import ConsoleLinkList from './ConsoleLinkList.vue'
import ConsoleOverviewPage from './ConsoleOverviewPage.vue'
import AdminUsersPage from './AdminUsersPage.vue'
import AnalyticsPage from './AnalyticsPage.vue'
import AdminAuditPage from './AdminAuditPage.vue'
import VisitRecordsPanel from '@/features/visit-records/VisitRecordsPanel.vue'
import UserGroupPermissionEditor from '@/features/user-group-permissions/UserGroupPermissionEditor.vue'
import ShortLinkSettingsDialog from '@/features/short-link-settings/ShortLinkSettingsDialog.vue'
import { provideDateTimeDisplay } from '@/shared/preferences/useDateTimeDisplay'
import { componentStubs } from '@/test/component-stubs'
import { getShortLinkOverview, listShortLinks, getShortLinkStatistics } from '@/entities/short-link/api'
import { listUsers } from '@/entities/user/api'
import { downloadCsv } from '@/shared/download/csv'

const id = '00000000-0000-4000-8000-000000000001'
const instant = '2026-01-01T00:30:00.123456789Z'
const range = { startDate: '2025-12-26', endDate: '2026-01-01', timeZone: 'UTC' as const }
const version = '2026-11-01T00:00:00.123456789Z'
const locale = ref('en-US')
vi.mock('vue-i18n', () => ({ useI18n: () => ({ locale, t: (key: string, params?: Record<string, string>) => params ? key + ' ' + Object.values(params).join(' ') : key }) }))
vi.mock('vue-router', () => ({ useRoute: () => ({ path: '/link/00000000-0000-4000-8000-000000000001/analytics', params: { shortLinkId: '00000000-0000-4000-8000-000000000001' } }) }))
vi.mock('vuetify', () => ({ useTheme: () => ({ global: { current: { value: { colors: { primary: 'blue', 'on-surface-variant': 'black', outline: 'gray' } } } } }) }))
vi.mock('chart.js', () => ({ Chart: class { static register() {} destroy() {} }, LineController: class {}, LineElement: class {}, PointElement: class {}, LinearScale: class {}, CategoryScale: class {}, Tooltip: class {} }))
vi.mock('@/entities/short-link/api', () => ({ getShortLinkOverview: vi.fn(), listShortLinks: vi.fn(), getShortLinkStatistics: vi.fn(), getAdminShortLinkStatistics: vi.fn() }))
vi.mock('@/entities/user/api', () => ({ listUsers: vi.fn(), updateUser: vi.fn(), resetUserPassword: vi.fn() }))
vi.mock('@/shared/download/csv', () => ({ downloadCsv: vi.fn() }))
const clients: QueryClient[] = []
const link = { id, slug: 'instant36', url: 'https://go.example/instant36', targetUrl: 'https://example.com', title: '', tags: [], status: 'active' as const, redirectMode: 'direct' as const, intermediateDelaySeconds: 5, expiresAt: instant, expired: false, passwordEnabled: false, maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false, createdAt: instant, stats: { visitCount: 1, todayVisitCount: 1, lastVisitedAt: instant } }
const user = { id, username: 'alice', nickname: '', group: 'admin', permissions: ['admin:access', 'short_link:read_own', 'short_link:read_visits', 'short_link:export_visits', 'short_link:set_expiration', 'audit:read', 'audit:export'] }
const csv = { fileName: 'moeurl-audit-2025-12-26-2026-01-01.csv', contentType: 'text/csv;charset=utf-8', content: '\uFEFFstart_date,end_date,time_zone,audit_id,occurred_at,actor_id,actor_username,resource_type,resource_id,action,changed_fields\r\n2025-12-26,2026-01-01,UTC,9223372036854775807,' + instant + ',,,user,' + id + ',update,\r\n' }
const visitCsv = { fileName: 'moeurl-visits-' + id + '-2025-12-26-2026-01-01.csv', contentType: 'text/csv;charset=utf-8', content: '\uFEFFshort_link_id,start_date,end_date,time_zone,event_id,occurred_at,referrer_host,device_type,browser_family,os_family,country_code\r\n' + id + ',2025-12-26,2026-01-01,UTC,' + id + ',' + instant + ',visible.example,,,,\r\n' }
const visit = { id, occurredAt: instant, referrerHost: 'visible.example', deviceType: null, browserFamily: null, osFamily: null, countryCode: null }
const audit = { id: '9223372036854775807', occurredAt: instant, actorId: null, actorUsername: null, resourceType: 'user', resourceId: id, action: 'update', changedFields: [] }

function mount(component: Component, props: Record<string, unknown> = {}, paginate = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } })
  clients.push(client)
  client.setQueryData(['auth', 'me'], { user })
  const requests: string[] = []
  const cursor = 'opaque.2026-01-01T00:30:00.123456789Z'
  vi.stubGlobal('fetch', vi.fn(async (path: string) => {
    requests.push(path)
    let data: unknown
    if (path === '/api/v1/auth/me') data = { user }
    else if (path === '/api/v1/user/time-zone-preference') data = { preference: { timeZone: 'America/New_York', updatedAt: version } }
    else if (path.includes('/export?')) data = path.includes('/visits/') ? visitCsv : csv
    else if (path.includes('/visits?')) data = { range, pageSize: 25, hasMore: paginate && !path.includes('cursor='), nextCursor: paginate && !path.includes('cursor=') ? cursor : '', items: [visit] }
    else if (path.includes('/admin/audit/list?')) data = { range, pageSize: 25, hasMore: paginate && !path.includes('cursor='), nextCursor: paginate && !path.includes('cursor=') ? cursor : '', retentionDays: 180, items: [audit] }
    else throw new Error('Unexpected request ' + path)
    return new Response(JSON.stringify({ code: 0, message: '', data, meta: {} }))
  }))
  vi.mocked(listShortLinks).mockResolvedValue({ items: [link], meta: { page: 1, pageSize: 5, total: 1 } })
  vi.mocked(getShortLinkOverview).mockResolvedValue({ totalLinkCount: 1, activeLinkCount: 1, visitCount: 1, todayVisitCount: 1 })
  vi.mocked(getShortLinkStatistics).mockResolvedValue({ shortLink: link, range, stats: { rangeVisitCount: 1, visitCount: 1, todayVisitCount: 1, lastVisitedAt: instant, trend: [{ date: '2026-01-01', visitCount: 1 }], referrers: [], devices: [], countries: [] } })
  vi.mocked(listUsers).mockResolvedValue({ items: [{ ...user, builtin: false, status: 'active', createdAt: instant, updatedAt: version }], meta: { page: 1, pageSize: 20, total: 1 } })
  let observer!: ReturnType<typeof provideDateTimeDisplay>
  const Provider = defineComponent({ setup() { observer = provideDateTimeDisplay(ref(true)); return () => h(component, props) } })
  const view = render(Provider, { global: { stubs: { ...componentStubs, VCheckbox: true }, plugins: [[VueQueryPlugin, { queryClient: client }]] } })
  return { ...view, client, requests, observer }
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks() })

describe('time-zone display protocol boundaries', () => {
  it.each(['audit', 'visits'])('keeps %s readable with the original instant if device Intl itself is unavailable', async kind => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function () { throw new RangeError('missing Intl data') })
    const view = mount(kind === 'audit' ? AdminAuditPage : VisitRecordsPanel, kind === 'audit' ? {} : { id, context: 'own', range })
    const time = await screen.findByText(instant)
    expect(time.getAttribute('datetime')).toBe(instant)
    expect(view.observer.preference.value?.timeZone).toBe('America/New_York')
  })
  it.each([
    ['link list', ConsoleLinkList, { links: [link] }, 'Dec 31, 2025, 19:30', 'Jan 1, 2026, 09:30'],
    ['overview', ConsoleOverviewPage, {}, 'Dec 31, 2025', 'Jan 1, 2026'],
    ['users', AdminUsersPage, {}, 'Dec 31, 2025', 'Jan 1, 2026'],
    ['analytics', AnalyticsPage, {}, 'Dec 31, 2025', 'Jan 1, 2026'],
    ['group version', UserGroupPermissionEditor, { dataValid: true, definitions: [], dirty: false, draftPermissions: [], group: { key: 'user', name: 'User', description: '', builtin: true, editable: true, permissions: [], updatedAt: instant }, pending: false, presets: [] }, 'Dec 31, 2025, 19:30', 'Jan 1, 2026, 09:30'],
    ['audit', AdminAuditPage, {}, 'Dec 31, 2025, 19:30', 'Jan 1, 2026, 09:30'],
    ['visit records', VisitRecordsPanel, { id, context: 'own', range }, 'Dec 31, 2025, 19:30', 'Jan 1, 2026, 09:30'],
  ] as const)('changes only the %s text, without refetching business data', async (_name, component, props, before, after) => {
    const view = mount(component, props)
    await waitFor(() => expect(view.container.textContent).toContain(before))
    const requests = [...view.requests]
    const statsReads = vi.mocked(getShortLinkStatistics).mock.calls.length
    view.observer.publish(view.observer.scope.value, { timeZone: 'Asia/Tokyo', updatedAt: version })
    await nextTick()
    expect(view.container.textContent).toContain(after)
    expect(view.requests).toEqual(requests)
    expect(vi.mocked(getShortLinkStatistics).mock.calls).toHaveLength(statsReads)
    for (const time of view.container.querySelectorAll('time')) expect(time.getAttribute('datetime')).toBe(instant)
    expect(link.expiresAt).toBe(instant)
    expect(link.createdAt).toBe(instant)
    expect(user.id).toBe(id)
    expect(view.observer.preference.value?.updatedAt).toBe(version)
    if (component === AnalyticsPage) {
      expect(getShortLinkStatistics).toHaveBeenCalledWith(id, { days: 7 })
      expect(range).toEqual({ startDate: '2025-12-26', endDate: '2026-01-01', timeZone: 'UTC' })
    }
  })
  it.each(['audit', 'visits'])('keeps %s CSV and loaded UTC date range independent of the account zone', async kind => {
    const view = mount(kind === 'audit' ? AdminAuditPage : VisitRecordsPanel, kind === 'audit' ? {} : { id, context: 'own', range }, true)
    const buttonId = kind === 'audit' ? 'audit-export' : 'visit-export'
    await waitFor(() => expect((screen.getByTestId(buttonId) as HTMLButtonElement).disabled).toBe(false))
    await fireEvent.click(screen.getByRole('button', { name: 'insights.next' }))
    await waitFor(() => expect(view.requests.some(path => path.includes('cursor=opaque.2026-01-01T00%3A30%3A00.123456789Z'))).toBe(true))
    await waitFor(() => expect((screen.getByTestId(buttonId) as HTMLButtonElement).disabled).toBe(false))
    view.observer.publish(view.observer.scope.value, { timeZone: 'Australia/Sydney', updatedAt: version })
    await nextTick()
    await fireEvent.click(screen.getByTestId(buttonId))
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledTimes(1))
    expect(vi.mocked(downloadCsv).mock.calls[0]?.[0]).toMatchObject({ content: kind === 'audit' ? csv.content : visitCsv.content })
    const exportPath = view.requests.find(path => path.includes('/export?'))!
    expect(exportPath).toContain('startDate=2025-12-26&endDate=2026-01-01')
    expect(exportPath).not.toMatch(/Sydney|timeZone|cursor/)
  })
  it('keeps datetime-local device input and its emitted instant unchanged by display-zone changes', async () => {
    const onSave = vi.fn()
    const source = '2027-01-01T00:30:00.123456Z'
    const view = mount(ShortLinkSettingsDialog, { link: { ...link, expiresAt: source }, open: true, pending: false, errorMessage: '', onSave })
    const input = await screen.findByLabelText('shortLinkSettings.expiresAt') as HTMLInputElement
    const date = new Date(source)
    const expected = String(date.getFullYear()) + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0') + 'T' + String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0')
    expect(input.value).toBe(expected)
    await waitFor(() => expect(view.observer.preference.value?.timeZone).toBe('America/New_York'))
    view.observer.publish(view.observer.scope.value, { timeZone: 'Asia/Tokyo', updatedAt: version })
    await nextTick()
    expect(input.value).toBe(expected)
    await fireEvent.update(input, '2027-02-03T04:05')
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.save' }))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ expiration: { mode: 'at', expiresAt: new Date('2027-02-03T04:05').toISOString() } }))
    expect(source).toBe('2027-01-01T00:30:00.123456Z')
  })
})
