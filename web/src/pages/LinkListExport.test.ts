import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { nextTick } from 'vue'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import { downloadCsv } from '@/shared/download/csv'
import MyLinksPage from './MyLinksPage.vue'
import AdminLinksPage from './AdminLinksPage.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/shared/download/csv', () => ({ downloadCsv: vi.fn() }))
const clients: QueryClient[] = []
const header = '\uFEFFid,short_url,slug,target_url,title,tags,status,redirect_mode,intermediate_delay_seconds,expires_at,password_enabled,max_visits,visits_used,created_at,updated_at,owner_id,owner_username\r\n'
const link = { id: '00000000-0000-0000-0000-000000000020', slug: 'export', url: 'https://short.example/export', targetUrl: 'https://example.com', title: '', tags: [], createdAt: '2026-10-23T00:00:00Z', status: 'active', redirectMode: 'direct', intermediateDelaySeconds: 5, expiresAt: null, expired: false, passwordEnabled: false, maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false }
const adminLink = { ...link, owner: { id: 'old', username: 'original', nickname: '' }, updatedAt: '2026-10-23T00:00:00.123456Z' }
/** Builds authentic envelopes while exercising the real list/export APIs. */
function response(data: unknown, code = 0) { return new Response(JSON.stringify({ code, message: 'private', data, meta: { total: 1 } })) }
/** Mounts each complete list page against isolated auth and controlled network responses. */
function mount(context: 'own' | 'admin', initial?: Promise<Response>, empty = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client)
  client.setQueryData(['auth', 'me'], { user: { id: 'actor', username: 'actor', nickname: '', group: 'admin', permissions: ['short_link:export', 'short_link:read_own', 'short_link:update_own', 'short_link:delete_own', 'admin:access', 'short_link:read_all', 'short_link:update_all', 'short_link:delete_all'] } })
  const fetcher = vi.fn<typeof fetch>(async url => {
    if (String(url).includes('/export')) return response({ fileName: context === 'own' ? 'moeurl-links-own.csv' : 'moeurl-links-all.csv', contentType: 'text/csv;charset=utf-8', content: header })
    return initial ?? response({ items: empty ? [] : [context === 'own' ? link : adminLink] })
  })
  vi.stubGlobal('fetch', fetcher)
  const view = render(context === 'own' ? MyLinksPage : AdminLinksPage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: componentStubs } })
  return { ...view, client, fetcher, prefix: context === 'own' ? 'short-link' : 'admin-short-link' }
}
/** Reads the visible export gate instead of internal page implementation state. */
function disabled() { return (screen.getByTestId('short-link-list-export') as HTMLButtonElement).disabled }
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks() })

describe('list CSV page integration', () => {
  it.each(['own', 'admin'] as const)('exports applied %s filters without mutating list or selection', async context => {
    const view = mount(context)
    await screen.findByTestId('console-link-list')
    await waitFor(() => expect(disabled()).toBe(false))
    await fireEvent.click(screen.getAllByRole('checkbox')[1]!)
    const reads = view.fetcher.mock.calls.length
    await fireEvent.click(screen.getByTestId('short-link-list-export'))
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledOnce())
    expect((screen.getAllByRole('checkbox')[1] as HTMLInputElement).checked).toBe(true)
    expect(view.fetcher).toHaveBeenCalledTimes(reads + 1)
    expect(view.fetcher.mock.calls.at(-1)?.[0]).toBe(`/api/v1/${context === 'admin' ? 'admin/' : ''}short-link/export`)
    vi.useFakeTimers()
    await fireEvent.update(screen.getByLabelText('filter.keyword'), ' term ')
    await fireEvent.update(screen.getByLabelText('filter.tag'), '\u0085tag\u0085')
    expect(disabled()).toBe(true)
    await fireEvent.click(screen.getByTestId('short-link-list-export'))
    expect(downloadCsv).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(500)
    vi.useRealTimers()
    await waitFor(() => expect(disabled()).toBe(false))
    await fireEvent.update(screen.getByLabelText('filter.status'), 'disabled')
    await waitFor(() => expect(disabled()).toBe(false))
    await fireEvent.click(screen.getByTestId('short-link-list-export'))
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledTimes(2))
    expect(view.fetcher.mock.calls.at(-1)?.[0]).toBe(`/api/v1/${context === 'admin' ? 'admin/' : ''}short-link/export?status=disabled&q=term&tag=tag`)
    await fireEvent.update(screen.getByLabelText('filter.keyword'), '\u0085 term \u0085')
    await fireEvent.update(screen.getByLabelText('filter.tag'), '\u0085 tag \u0085')
    expect(disabled()).toBe(false)
    await fireEvent.update(screen.getByLabelText('filter.tag'), 'bad\u0000')
    expect(disabled()).toBe(true)
  })
  it.each(['own', 'admin'] as const)('gates initial load, refetch, cached failure and row writes in %s', async context => {
    const initial = createDeferred<Response>()
    const view = mount(context, initial.promise)
    expect(disabled()).toBe(true)
    initial.resolve(response({ items: [context === 'own' ? link : adminLink] }))
    await waitFor(() => expect(disabled()).toBe(false))
    const refreshed = createDeferred<Response>()
    view.fetcher.mockReturnValueOnce(refreshed.promise)
    const refresh = view.client.invalidateQueries({ queryKey: [view.prefix] })
    await waitFor(() => expect(disabled()).toBe(true))
    refreshed.reject(new Error('private'))
    await refresh
    await screen.findByRole('alert')
    expect(disabled()).toBe(true)
    view.fetcher.mockResolvedValueOnce(response({ items: [context === 'own' ? link : adminLink] }))
    await view.client.invalidateQueries({ queryKey: [view.prefix] })
    await waitFor(() => expect(disabled()).toBe(false))
    const writing = createDeferred<Response>()
    view.fetcher.mockReturnValueOnce(writing.promise)
    await fireEvent.click(screen.getByRole('button', { name: 'links.actions.more' }))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'links.actions.disable' }))
    await waitFor(() => expect(disabled()).toBe(true))
    writing.reject(new Error('private'))
    await waitFor(() => expect(disabled()).toBe(false))
    await fireEvent.click(screen.getByRole('button', { name: 'links.actions.more' }))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'links.actions.configure' }))
    expect(disabled()).toBe(true)
  })
  it.each(['own', 'admin'] as const)('allows empty %s files', async context => {
    mount(context, undefined, true)
    await waitFor(() => expect(disabled()).toBe(false))
    await fireEvent.click(screen.getByTestId('short-link-list-export'))
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledWith(expect.objectContaining({ content: header })))
  })
  it('blocks an administrative transfer and ignores a late file after a draft begins', async () => {
    const view = mount('admin')
    await waitFor(() => expect(disabled()).toBe(false))
    const exporting = createDeferred<Response>()
    view.fetcher.mockReturnValueOnce(exporting.promise)
    await fireEvent.click(screen.getByTestId('short-link-list-export'))
    await fireEvent.update(screen.getByLabelText('filter.keyword'), 'draft')
    exporting.resolve(response({ fileName: 'moeurl-links-all.csv', contentType: 'text/csv;charset=utf-8', content: header }))
    await exporting.promise
    await nextTick()
    expect(downloadCsv).not.toHaveBeenCalled()
    await fireEvent.update(screen.getByLabelText('filter.keyword'), '')
    await waitFor(() => expect(disabled()).toBe(false))
    await fireEvent.click(screen.getByRole('button', { name: 'links.actions.more' }))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'transfer.action' }))
    expect(disabled()).toBe(true)
  })
})
