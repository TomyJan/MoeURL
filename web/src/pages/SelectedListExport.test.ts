import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { componentStubs } from '@/test/component-stubs'
import { downloadCsv } from '@/shared/download/csv'
import { toast } from 'vue-sonner'
import { createDeferred } from '@/test/deferred'
import { revokeAccountIdentity } from '@/shared/preferences/useAccountPreferences'
import MyLinksPage from './MyLinksPage.vue'
import AdminLinksPage from './AdminLinksPage.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/shared/download/csv', () => ({ downloadCsv: vi.fn() }))
const clients: QueryClient[] = []
const actorId = '10000000-0000-0000-0000-000000000001'
const header = '\uFEFFid,short_url,slug,target_url,title,tags,status,redirect_mode,intermediate_delay_seconds,expires_at,password_enabled,max_visits,visits_used,created_at,updated_at,owner_id,owner_username\r\n'
const items = [20, 21].map((value, index) => ({
  id: '00000000-0000-0000-0000-' + String(value).padStart(12, '0'), slug: 'selected' + index,
  url: 'https://short.example/selected' + index, targetUrl: 'https://example.com/' + index,
  title: '', tags: [], createdAt: '2026-11-16T00:00:00Z', updatedAt: '2026-11-16T00:00:00.123456Z',
  status: 'active', redirectMode: 'direct', intermediateDelaySeconds: 5, expiresAt: null,
  expired: false, passwordEnabled: false, maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false,
}))
/** Supplies the actual API envelope without replacing page state or list/export entities. */
function response(data: unknown, code = 0) {
  return new Response(JSON.stringify({ code, message: 'private', data, meta: { page: 1, pageSize: 20, total: 2 } }))
}
/** Mounts both real parents with a confirmed UUID actor and two visible selectable rows. */
function mount(context: 'own' | 'admin') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client)
  client.setQueryData(['auth', 'me'], { user: { id: actorId, username: 'actor', nickname: '', group: 'admin',
    permissions: ['short_link:export', 'short_link:read_own', 'admin:access', 'short_link:read_all'] } })
  const file = { fileName: context === 'own' ? 'moeurl-links-own-selected.csv' : 'moeurl-links-all-selected.csv',
    contentType: 'text/csv;charset=utf-8', content: header }
  const fetcher = vi.fn<typeof fetch>(async url => {
    if (String(url).endsWith('/user/list-preference')) return response({ preference: { pageSize: null, updatedAt: null } })
    if (String(url).endsWith('/export/selected')) return response(file)
    return response({ items: context === 'own' ? items : items.map(link => ({ ...link, owner: { id: actorId, username: 'actor', nickname: '' } })) })
  })
  vi.stubGlobal('fetch', fetcher)
  const view = render(context === 'own' ? MyLinksPage : AdminLinksPage, {
    global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: componentStubs },
  })
  return { ...view, client, fetcher, file }
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('selected CSV page integration', () => {
  it.each(['own', 'admin'] as const)('rejects a queued %s whole-list click before selected pending props rerender', async context => {
    const view = mount(context)
    await screen.findByTestId('console-link-list')
    await fireEvent.click(screen.getAllByRole('checkbox')[1]!)
    const request = createDeferred<Response>()
    view.fetcher.mockReturnValueOnce(request.promise)
    const before = view.fetcher.mock.calls.length
    const selected = screen.getByTestId('short-link-selected-export') as HTMLButtonElement
    const whole = screen.getByTestId('short-link-list-export') as HTMLButtonElement
    selected.click(); whole.click()
    expect(view.fetcher.mock.calls.slice(before).map(call => call[0])).toEqual([
      '/api/v1/' + (context === 'admin' ? 'admin/' : '') + 'short-link/export/selected',
    ])
    request.resolve(response(view.file))
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledExactlyOnceWith(view.file))
  })
  // Removing the selected action or wiring it to legacy all-results export must break this behavior.
  it.each(['own', 'admin'] as const)('downloads only the complete selected %s set through its independent POST', async context => {
    const view = mount(context)
    await screen.findByTestId('console-link-list')
    const action = await screen.findByTestId('short-link-selected-export')
    expect((action as HTMLButtonElement).disabled).toBe(true)
    const boxes = screen.getAllByRole('checkbox')
    await fireEvent.click(boxes[2]!)
    await fireEvent.click(boxes[1]!)
    await waitFor(() => expect((action as HTMLButtonElement).disabled).toBe(false))
    const reads = view.fetcher.mock.calls.length
    await fireEvent.click(action)
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledExactlyOnceWith(view.file))
    expect(view.fetcher).toHaveBeenCalledTimes(reads + 1)
    expect(view.fetcher.mock.calls.at(-1)).toEqual([
      '/api/v1/' + (context === 'admin' ? 'admin/' : '') + 'short-link/export/selected',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ ids: [items[0]!.id, items[1]!.id] }),
        signal: expect.any(AbortSignal), headers: expect.objectContaining({ 'X-MoeURL-Expected-User-ID': actorId }) }),
    ])
    expect((boxes[1] as HTMLInputElement).checked).toBe(true)
    expect((boxes[2] as HTMLInputElement).checked).toBe(true)
    expect(screen.getByTestId('short-link-list-export')).toBeTruthy()
  })
  it.each(['own', 'admin'] as const)('keeps %s selected and whole-list exports mutually exclusive without self-cancellation', async context => {
    const view = mount(context)
    await screen.findByTestId('console-link-list')
    await fireEvent.click(screen.getAllByRole('checkbox')[1]!)
    const selected = screen.getByTestId('short-link-selected-export') as HTMLButtonElement
    const whole = screen.getByTestId('short-link-list-export') as HTMLButtonElement
    const first = createDeferred<Response>()
    view.fetcher.mockReturnValueOnce(first.promise)
    await fireEvent.click(selected)
    expect(selected.disabled).toBe(true); expect(whole.disabled).toBe(true)
    expect(view.fetcher.mock.calls.at(-1)?.[1]?.signal?.aborted).toBe(false)
    const reads = view.fetcher.mock.calls.length
    await fireEvent.click(whole); await fireEvent.click(selected)
    expect(view.fetcher).toHaveBeenCalledTimes(reads)
    first.resolve(response(view.file))
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledExactlyOnceWith(view.file))
    await waitFor(() => expect(selected.disabled).toBe(false))
    expect(whole.disabled).toBe(false)
    const second = createDeferred<Response>()
    view.fetcher.mockReturnValueOnce(second.promise)
    await fireEvent.click(whole)
    expect(selected.disabled).toBe(true)
    const full = { ...view.file, fileName: context === 'own' ? 'moeurl-links-own.csv' : 'moeurl-links-all.csv' }
    second.resolve(response(full))
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledTimes(2))
    expect(downloadCsv).toHaveBeenLastCalledWith(full)
    await waitFor(() => expect(selected.disabled).toBe(false))
  })
  it.each(['own', 'admin'] as const)('retires %s callbacks on synchronous permission loss and preserves a newer pending download', async context => {
    for (const failed of [false, true]) {
      const view = mount(context)
      await screen.findByTestId('console-link-list')
      await fireEvent.click(screen.getAllByRole('checkbox')[1]!)
      const old = createDeferred<Response>(), current = createDeferred<Response>()
      view.fetcher.mockReturnValueOnce(old.promise)
      await fireEvent.click(screen.getByTestId('short-link-selected-export'))
      const oldSignal = view.fetcher.mock.calls.at(-1)?.[1]?.signal
      const auth = view.client.getQueryData<{ user: { permissions: string[] } }>(['auth', 'me'])!
      view.client.setQueryData(['auth', 'me'], { user: { ...auth.user, permissions: auth.user.permissions.filter(value => value !== 'short_link:export') } })
      view.client.setQueryData(['auth', 'me'], auth)
      expect(oldSignal?.aborted).toBe(true)
      await waitFor(() => expect((screen.getByTestId('short-link-selected-export') as HTMLButtonElement).disabled).toBe(false))
      view.fetcher.mockReturnValueOnce(current.promise)
      await fireEvent.click(screen.getByTestId('short-link-selected-export'))
      if (failed) old.reject(new Error('private'))
      else old.resolve(response(view.file))
      await old.promise.catch(() => undefined)
      await waitFor(() => expect((screen.getByTestId('short-link-list-export') as HTMLButtonElement).disabled).toBe(true))
      expect(downloadCsv).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled()
      current.resolve(response(view.file))
      await waitFor(() => expect(downloadCsv).toHaveBeenCalledExactlyOnceWith(view.file))
      view.unmount(); vi.clearAllMocks()
    }
  })
  it.each(['own', 'admin'] as const)('suppresses %s late results after raw filters, cache and login epoch changes', async context => {
    for (const transition of ['filter', 'cache', 'identity'] as const) {
      const view = mount(context)
      await screen.findByTestId('console-link-list')
      await fireEvent.click(screen.getAllByRole('checkbox')[1]!)
      const request = createDeferred<Response>()
      view.fetcher.mockReturnValueOnce(request.promise)
      await fireEvent.click(screen.getByTestId('short-link-selected-export'))
      const signal = view.fetcher.mock.calls.at(-1)?.[1]?.signal
      if (transition === 'filter') {
        const field = screen.getByLabelText('filter.keyword')
        const first = fireEvent.update(field, 'changed')
        const second = fireEvent.update(field, '')
        await Promise.all([first, second])
      }
      if (transition === 'cache') {
        const query = view.client.getQueryCache().findAll({ queryKey: [context === 'own' ? 'short-link' : 'admin-short-link'] })[0]!
        const data = query.state.data as { items: typeof items }
        view.client.setQueryData(query.queryKey, { ...data, items: data.items.slice(1) })
        view.client.setQueryData(query.queryKey, data)
      }
      if (transition === 'identity') {
        const auth = view.client.getQueryData(['auth', 'me'])
        void revokeAccountIdentity(view.client)
        view.client.setQueryData(['auth', 'me'], auth)
      }
      expect(signal?.aborted).toBe(true)
      request.resolve(response(view.file))
      await request.promise
      await waitFor(() => expect((screen.getByTestId('short-link-list-export') as HTMLButtonElement).disabled).toBe(false))
      expect(downloadCsv).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled()
      view.unmount(); vi.clearAllMocks()
    }
  })
})
