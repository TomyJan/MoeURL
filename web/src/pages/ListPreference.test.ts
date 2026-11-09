import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { componentStubs } from '@/test/component-stubs'
import { createPageSizeSelectStub } from '@/test/page-size-select-stub'
import MyLinksPage from './MyLinksPage.vue'
import AdminLinksPage from './AdminLinksPage.vue'
import ListPreferencePanel from '@/features/list-preference/ListPreferencePanel.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const clients: QueryClient[] = []
const collections = new WeakMap<QueryClient, Record<'own' | 'admin', URL[]>>()
const user = { id: '00000000-0000-0000-0000-000000000001', username: 'reader', nickname: '', group: 'admin', permissions: ['admin:access', 'short_link:read_own', 'short_link:read_all'] }
async function flushPromises() { await new Promise<void>(resolve => setImmediate(resolve)) }
function response(data: unknown, meta?: unknown) { return new Response(JSON.stringify({ code: 0, message: 'OK', data, ...(meta ? { meta } : {}) })) }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}
function mount(context: 'own' | 'admin', preference?: Promise<Response> | (() => Promise<Response>), sharedClient?: QueryClient) {
  const client = sharedClient ?? new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client)
  client.setQueryData(['auth', 'me'], { user })
  const requests: URL[] = []
  const sharedRequests = collections.get(client) ?? { own: [], admin: [] }
  sharedRequests[context] = requests
  collections.set(client, sharedRequests)
  const preferenceRequests: RequestInit[] = []
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname.endsWith('/auth/me')) return response({ user })
    if (url.pathname.endsWith('/user/list-preference')) {
      preferenceRequests.push(init ?? {})
      return typeof preference === 'function' ? preference() : preference ?? response({ preference: { pageSize: 50, updatedAt: '2026-11-09T00:00:00.123456Z' } })
    }
    if (url.pathname === '/api/v1/short-link/list' || url.pathname === '/api/v1/admin/short-link/list') {
      sharedRequests[url.pathname.includes('/admin/') ? 'admin' : 'own'].push(url)
      return response({ items: [] }, { page: 1, pageSize: Number(url.searchParams.get('pageSize')), total: 0 })
    }
    throw new Error(`Unexpected HTTP ${url.pathname}`)
  }))
  const view = render(context === 'own' ? MyLinksPage : AdminLinksPage, { global: {
    plugins: [[VueQueryPlugin, { queryClient: client }]],
    stubs: { ...componentStubs, VSelect: createPageSizeSelectStub(() => {}), BulkCreateDialog: true, PersonalTagBrowser: true, AdminTagBrowser: true },
  } })
  return { ...view, client, requests, preferenceRequests }
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('account default list page size', () => {
  // A hard-coded 20 or applying the preference only after the first list request breaks this contract.
  it.each(['own', 'admin'] as const)('usesSavedSizeForTheFirstRequest in %s', async context => {
    const view = mount(context)
    await waitFor(() => expect(view.requests.length).toBe(1))
    expect(view.requests[0]!.searchParams.get('pageSize')).toBe('50')
    await waitFor(() => expect((screen.getByLabelText('pagination.pageSize') as HTMLSelectElement).value).toBe('50'))
    await fireEvent.update(screen.getByLabelText('pagination.pageSize'), '100')
    await waitFor(() => expect(view.requests.at(-1)!.searchParams.get('pageSize')).toBe('100'))
  })

  // Marking ready only when the number changes loses an explicit choice of the displayed 20.
  it.each([['own', 20], ['admin', 20], ['own', 100], ['admin', 100]] as const)('locks an explicit pending choice in %s at %s', async (context, size) => {
    const pending = deferred<Response>()
    const view = mount(context, pending.promise)
    await flushPromises()
    expect(view.requests).toHaveLength(0)
    await fireEvent.update(screen.getByLabelText('pagination.pageSize'), String(size))
    await waitFor(() => expect(view.requests).toHaveLength(1))
    expect(view.requests[0]!.searchParams.get('pageSize')).toBe(String(size))
    pending.resolve(response({ preference: { pageSize: 50, updatedAt: '2026-11-09T00:00:00Z' } }))
    await flushPromises()
    expect(view.requests).toHaveLength(1)
    expect((screen.getByLabelText('pagination.pageSize') as HTMLSelectElement).value).toBe(String(size))
  })

  it.each(['own', 'admin'] as const)('bounds the first wait and ignores late data in %s', async context => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = deferred<Response>()
    const view = mount(context, pending.promise)
    await flushPromises()
    await vi.advanceTimersByTimeAsync(2999)
    expect(view.requests).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(1)
    await flushPromises()
    expect(view.requests).toHaveLength(1)
    expect(view.requests[0]!.searchParams.get('pageSize')).toBe('20')
    expect(view.client.getQueriesData({ queryKey: ['user', 'list-preference'] }).every(([, data]) => data === undefined)).toBe(true)
    pending.resolve(response({ preference: { pageSize: 100, updatedAt: '2026-11-09T00:00:00Z' } }))
    await flushPromises()
    expect(view.requests).toHaveLength(1)
    expect((screen.getByLabelText('pagination.pageSize') as HTMLSelectElement).value).toBe('20')
  })

  // A surviving deadline or late preference must not reset a user's explicit selection.
  it.each(['own', 'admin'] as const)('keeps manual 100 across the deadline and a late 50 in %s', async context => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = deferred<Response>()
    const view = mount(context, pending.promise)
    await flushPromises()
    await fireEvent.update(screen.getByLabelText('pagination.pageSize'), '100')
    await flushPromises()
    expect(view.requests.map(url => url.searchParams.get('pageSize'))).toEqual(['100'])
    await vi.advanceTimersByTimeAsync(3001)
    await flushPromises()
    expect(screen.getByLabelText('pagination.pageSize')).toHaveProperty('value', '100')
    expect(view.requests.map(url => url.searchParams.get('pageSize'))).toEqual(['100'])
    pending.resolve(response({ preference: { pageSize: 50, updatedAt: '2026-11-09T00:00:00Z' } }))
    await flushPromises()
    expect(screen.getByLabelText('pagination.pageSize')).toHaveProperty('value', '100')
    expect(view.requests.map(url => url.searchParams.get('pageSize'))).toEqual(['100'])
    await fireEvent.update(screen.getByLabelText('filter.status'), 'disabled')
    await flushPromises()
    expect(view.requests.map(url => url.searchParams.get('pageSize'))).toEqual(['100', '100'])
    expect(view.requests[1]!.searchParams.get('status')).toBe('disabled')
  })

  // Accepting an old epoch's GET would change both the actual list request and settings draft.
  it.each([['own', 'other account'], ['admin', 'other account'], ['own', 'same account'], ['admin', 'same account']] as const)('isolates a pending old read from the new %s list and settings after %s login', async (context, identity) => {
    const oldRead = deferred<Response>()
    const newRead = deferred<Response>()
    let reads = 0
    const view = mount(context, () => ++reads === 1 ? oldRead.promise : newRead.promise)
    const panel = render(ListPreferencePanel, { props: { userId: user.id, active: true }, global: {
      plugins: [[VueQueryPlugin, { queryClient: view.client }]], stubs: { ...componentStubs, VSelect: createPageSizeSelectStub(() => {}) },
    } })
    await flushPromises()
    expect(reads).toBe(1)
    expect(view.requests).toHaveLength(0)
    if (identity === 'same account') {
      view.client.setQueryData(['auth', 'me'], { user: { ...user, id: '', username: 'guest', group: 'guest', permissions: [] } })
      await panel.rerender({ active: false })
      await flushPromises()
    }
    const next = identity === 'same account' ? user : { ...user, id: '00000000-0000-0000-0000-000000000002', username: 'next' }
    view.client.setQueryData(['auth', 'me'], { user: next })
    await panel.rerender({ userId: next.id, active: true })
    await flushPromises()
    expect(reads).toBe(2)
    expect(view.requests).toHaveLength(0)
    newRead.resolve(response({ preference: { pageSize: 100, updatedAt: '2026-11-09T00:00:01Z' } }))
    await waitFor(() => expect(view.requests.map(url => url.searchParams.get('pageSize'))).toEqual(['100']))
    await waitFor(() => expect(screen.getByLabelText('listPreference.pageSize')).toHaveProperty('value', '100'))
    await fireEvent.update(screen.getByLabelText('listPreference.pageSize'), '20')
    oldRead.resolve(response({ preference: { pageSize: 50, updatedAt: '2026-11-09T00:00:00Z' } }))
    await flushPromises()
    expect(screen.getByLabelText('pagination.pageSize')).toHaveProperty('value', '100')
    expect(screen.getByLabelText('listPreference.pageSize')).toHaveProperty('value', '20')
    expect(screen.queryByText('listPreference.conflict')).toBeNull()
    expect(view.requests.map(url => url.searchParams.get('pageSize'))).toEqual(['100'])
    await fireEvent.update(screen.getByLabelText('filter.status'), 'disabled')
    await waitFor(() => expect(view.requests.map(url => url.searchParams.get('pageSize'))).toEqual(['100', '100']))
    expect(view.requests[1]!.searchParams.get('status')).toBe('disabled')
    expect(screen.getByLabelText('listPreference.pageSize')).toHaveProperty('value', '20')
  })

  it.each(['own', 'admin'] as const)('opens with 20 after a failed preference read in %s', async context => {
    const pending = deferred<Response>()
    const view = mount(context, pending.promise)
    pending.reject(new Error('offline'))
    await waitFor(() => expect(view.requests).toHaveLength(1))
    expect(view.requests[0]!.searchParams.get('pageSize')).toBe('20')
  })

  it('keeps a shared read alive when one list unmounts', async () => {
    const pending = deferred<Response>()
    const first = mount('own', pending.promise)
    await flushPromises()
    const second = mount('admin', pending.promise, first.client)
    await flushPromises()
    first.unmount()
    pending.resolve(response({ preference: { pageSize: 100, updatedAt: '2026-11-09T00:00:00Z' } }))
    await waitFor(() => expect(second.requests).toHaveLength(1))
    expect(second.requests[0]!.searchParams.get('pageSize')).toBe('100')
    expect(first.requests).toHaveLength(0)
  })

  // A shared timeout or a fabricated cached 20 would make the later consumer open too early.
  it('keeps staggered consumer deadlines independent while sharing the real response', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = deferred<Response>()
    const first = mount('own', pending.promise)
    await flushPromises()
    await vi.advanceTimersByTimeAsync(2000)
    const second = mount('admin', pending.promise, first.client)
    await flushPromises()
    await vi.advanceTimersByTimeAsync(1000)
    await flushPromises()
    expect(first.requests[0]!.searchParams.get('pageSize')).toBe('20')
    expect(second.requests).toHaveLength(0)
    pending.resolve(response({ preference: { pageSize: 100, updatedAt: '2026-11-09T00:00:00Z' } }))
    await flushPromises()
    expect(second.requests[0]!.searchParams.get('pageSize')).toBe('100')
    expect(first.requests).toHaveLength(1)
    expect(first.client.getQueriesData({ queryKey: ['user', 'list-preference'] })[0]?.[1]).toMatchObject({ preference: { pageSize: 100 } })
    expect(first.preferenceRequests.length + second.preferenceRequests.length).toBe(1)
  })

  it.each(['own', 'admin'] as const)('adopts a saved cache only for a new instance in %s', async context => {
    const first = mount(context)
    await waitFor(() => expect(first.requests).toHaveLength(1))
    const [key, data] = first.client.getQueriesData<{ userId: string; epoch: number }>({ queryKey: ['user', 'list-preference'] })[0]!
    first.client.setQueryData(key, { ...data, preference: { pageSize: 100, updatedAt: '2026-11-09T00:00:01Z' } })
    await flushPromises()
    expect(first.requests).toHaveLength(1)
    expect((screen.getByLabelText('pagination.pageSize') as HTMLSelectElement).value).toBe('50')
    first.unmount()
    const second = mount(context, undefined, first.client)
    await waitFor(() => expect(second.requests).toHaveLength(1))
    expect(second.requests[0]!.searchParams.get('pageSize')).toBe('100')
    expect(second.preferenceRequests).toHaveLength(0)
  })

  it.each(['own', 'admin'] as const)('retires an old collection on account switch and same-account login in %s', async context => {
    const view = mount(context)
    await waitFor(() => expect(view.requests).toHaveLength(1))
    await fireEvent.update(screen.getByLabelText('pagination.pageSize'), '100')
    await waitFor(() => expect(view.requests.at(-1)!.searchParams.get('pageSize')).toBe('100'))
    const next = { ...user, id: '00000000-0000-0000-0000-000000000002', username: 'next' }
    view.client.setQueryData(['auth', 'me'], { user: next })
    await waitFor(() => expect(view.preferenceRequests).toHaveLength(2))
    await waitFor(() => expect((screen.getByLabelText('pagination.pageSize') as HTMLSelectElement).value).toBe('50'))
    expect(view.preferenceRequests[1]!.headers).toMatchObject({ 'X-MoeURL-Expected-User-ID': next.id })
    view.client.setQueryData(['auth', 'me'], { user: { ...next, id: '', username: 'guest', group: 'guest', permissions: [] } })
    await flushPromises()
    view.client.setQueryData(['auth', 'me'], { user: next })
    await waitFor(() => expect(view.preferenceRequests).toHaveLength(3))
    await waitFor(() => expect((screen.getByLabelText('pagination.pageSize') as HTMLSelectElement).value).toBe('50'))
  })

  it.each(['own', 'admin'] as const)('does not initialize without read permission and restores from the current cache in %s', async context => {
    const view = mount(context)
    await waitFor(() => expect(view.requests).toHaveLength(1))
    view.client.setQueryData(['auth', 'me'], { user: { ...user, permissions: [] } })
    await flushPromises()
    expect(screen.queryByLabelText('pagination.pageSize')).toBeNull()
    const count = view.requests.length
    await flushPromises()
    expect(view.requests).toHaveLength(count)
    view.client.setQueryData(['auth', 'me'], { user })
    await waitFor(() => expect((screen.getByLabelText('pagination.pageSize') as HTMLSelectElement).value).toBe('50'))
    expect(view.preferenceRequests).toHaveLength(1)
  })

  it('clears an unmounted list deadline without writing a fallback cache', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = deferred<Response>()
    const view = mount('own', pending.promise)
    await flushPromises()
    view.unmount()
    await vi.advanceTimersByTimeAsync(3000)
    expect(view.requests).toHaveLength(0)
    expect(view.client.getQueriesData({ queryKey: ['user', 'list-preference'] }).every(([, data]) => data === undefined)).toBe(true)
    pending.resolve(response({ preference: { pageSize: 100, updatedAt: '2026-11-09T00:00:00Z' } }))
    await flushPromises()
    expect(view.requests).toHaveLength(0)
  })
})
