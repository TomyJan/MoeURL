import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { defineComponent, h, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { componentStubs } from '@/test/component-stubs'
import { createPageSizeSelectStub } from '@/test/page-size-select-stub'
import { createDeferred } from '@/test/deferred'
import { downloadCsv } from '@/shared/download/csv'
import MyLinksPage from './MyLinksPage.vue'
import AdminLinksPage from './AdminLinksPage.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/shared/download/csv', () => ({ downloadCsv: vi.fn() }))
const clients: QueryClient[] = []
const actor = { id: '00000000-0000-0000-0000-000000000001', username: 'reader', nickname: '', group: 'admin' }
const csv = '\uFEFFid,short_url,slug,target_url,title,tags,status,redirect_mode,intermediate_delay_seconds,expires_at,password_enabled,max_visits,visits_used,created_at,updated_at,owner_id,owner_username\r\n'
const rows = Array.from({ length: 101 }, (_, index) => ({
  id: `00000000-0000-0000-0000-${String(index + 100).padStart(12, '0')}`,
  slug: `pagination${index}`, url: `https://short.example/pagination${index}`, targetUrl: 'https://example.com',
  title: index === 0 ? 'page-one-row' : index === 20 ? 'page-two-row' : `row-${index}`, tags: [], status: 'active',
  updatedAt: '2026-11-03T00:00:00.123456Z', createdAt: '2026-11-03T00:00:00Z', redirectMode: 'direct',
  intermediateDelaySeconds: 5, expiresAt: null, expired: false, passwordEnabled: false, maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false,
}))

/** Uses complete server envelopes and actual page/client behavior at the HTTP boundary. */
function response(data: unknown, total = 21, page = 1, pageSize = 20) {
  return new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: { page, pageSize, total } }))
}

/** Keeps the real query and permission code; only the external server is replaced. */
function mount(context: 'own' | 'admin', write = true, bulkCreate = false, initialTotal = 21) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client)
  const suffix = context === 'own' ? 'own' : 'all'
  const user = { ...actor, permissions: ['admin:access', 'short_link:export', 'short_link:set_metadata', 'short_link:create', 'domain:use_default', ...(write ? ['read', 'update', 'delete'] : ['read']).map(action => `short_link:${action}_${suffix}`)] }
  client.setQueryData(['auth', 'me'], { user })
  const items = context === 'own' ? rows : rows.map(row => ({ ...row, owner: { id: actor.id, username: actor.username, nickname: actor.nickname } }))
  let total = initialTotal
  const envelope = (page: number, count = total, title?: string, size = 20) => response({ items: items.slice((page - 1) * size, Math.min(page * size, count)).map(row => title ? { ...row, title } : row) }, count, page, size)
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname.endsWith('/auth/me')) return response({ user })
    if (url.pathname.endsWith('/export')) return response({ fileName: context === 'own' ? 'moeurl-links-own.csv' : 'moeurl-links-all.csv', contentType: 'text/csv;charset=utf-8', content: csv })
    if (url.pathname.endsWith('/note') || url.pathname.endsWith('/note/update')) return response({ id: rows[0]!.id, note: init?.method === 'POST' ? JSON.parse(init.body as string).note : 'private text', updatedAt: '2026-11-03T00:00:00.123456789Z' })
    if (url.pathname.endsWith('/search')) {
      const body = JSON.parse(init!.body as string)
      return envelope(body.page, total, undefined, body.pageSize)
    }
    if (init?.method === 'POST') return response({ affectedCount: 1 })
    const page = Number(url.searchParams.get('page') ?? 1)
    return envelope(page, total, undefined, Number(url.searchParams.get('pageSize') ?? 20))
  })
  vi.stubGlobal('fetch', fetcher)
  let queuedNext!: () => void, queuedRetry!: () => void, queuedSize!: (value: unknown) => void
  const select = createPageSizeSelectStub(emit => { queuedSize = emit })
  const button = defineComponent({ inheritAttrs: false, props: { disabled: Boolean, loading: Boolean }, emits: ['click'], setup(props, { attrs, emit, slots }) {
    if (attrs['aria-label'] === 'pagination.next') queuedNext = () => emit('click')
    if (attrs['aria-label'] === 'pagination.retry') queuedRetry = () => emit('click')
    return () => h(componentStubs.VBtn!, { ...attrs, ...props, onClick: () => emit('click') }, slots)
  } })
  const remount = () => render(context === 'own' ? MyLinksPage : AdminLinksPage, { global: {
    plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: { ...componentStubs, VBtn: button, VSelect: select, ...bulkCreate ? {} : { BulkCreateDialog: true }, PersonalTagBrowser: true, AdminTagBrowser: true },
  } })
  return { ...remount(), client, fetcher, remount, user, envelope, setTotal: (value: number) => { total = value }, queuedNext: () => queuedNext(), queuedRetry: () => queuedRetry(), queuedSize: (value: unknown) => queuedSize(value), prefix: context === 'own' ? 'short-link' : 'admin-short-link' }
}

/** Waits for the actual query to settle before allowing an operation on its collection. */
async function ready() {
  await screen.findByTestId('console-link-list')
  await waitFor(() => expect((screen.getByTestId('short-link-list-export') as HTMLButtonElement).disabled).toBe(false))
}

afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('short-link list pagination', () => {
  // A hard-coded request size or retained selection would target the wrong collection after resizing.
  it.each(['own', 'admin'] as const)('changesPageSizeAndRetiresSelection in %s', async context => {
    const view = mount(context, true, false, 61); await ready()
    expect(screen.getAllByTestId('console-link-row')).toHaveLength(20)
    await fireEvent.click(screen.getAllByRole('checkbox')[1]!)
    await fireEvent.update(screen.getByLabelText('pagination.pageSize'), '50'); await ready()
    expect(screen.getAllByTestId('console-link-row')).toHaveLength(50)
    expect(screen.getAllByRole('checkbox').every(box => !(box as HTMLInputElement).checked)).toBe(true)
    let url = new URL(String(view.fetcher.mock.calls.at(-1)![0]), 'http://localhost')
    expect(url.searchParams.get('page')).toBe('1'); expect(url.searchParams.get('pageSize')).toBe('50')
    await fireEvent.click(screen.getByRole('button', { name: 'pagination.next' })); await ready()
    expect(screen.getAllByTestId('console-link-row')).toHaveLength(11)
    await fireEvent.update(screen.getByLabelText('pagination.pageSize'), '100'); await ready()
    expect(screen.getAllByTestId('console-link-row')).toHaveLength(61)
    expect((screen.getByRole('button', { name: 'pagination.next' }) as HTMLButtonElement).disabled).toBe(true)
    url = new URL(String(view.fetcher.mock.calls.at(-1)![0]), 'http://localhost')
    expect(url.searchParams.get('page')).toBe('1'); expect(url.searchParams.get('pageSize')).toBe('100')
  })

  // Unsupported queued values and repeated selections must not replace or refetch the current collection.
  it.each(['own', 'admin'] as const)('rejectsUnsupportedAndSameSize in %s', async context => {
    const view = mount(context); await ready()
    const before = view.fetcher.mock.calls.length
    for (const value of ['50', null, undefined, NaN, 20.5, 0, -1, 21, 200, 20]) view.queuedSize(value)
    await nextTick()
    expect(view.fetcher.mock.calls).toHaveLength(before)
    expect(screen.getAllByTestId('console-link-row')).toHaveLength(20)
    await fireEvent.update(screen.getByLabelText('pagination.pageSize'), '50'); await ready()
    const after = view.fetcher.mock.calls.length
    view.queuedSize(50); await nextTick()
    expect(view.fetcher.mock.calls).toHaveLength(after)
    expect(screen.getAllByTestId('console-link-row')).toHaveLength(21)
  })

  it.each(['own', 'admin'] as const)('preservesSizeForFilters with read-only grants in %s', async context => {
    const view = mount(context, false, false, 101); await ready()
    await fireEvent.update(screen.getByLabelText('pagination.pageSize'), '50'); await ready()
    await fireEvent.click(screen.getByRole('button', { name: 'pagination.next' })); await ready()
    await fireEvent.update(screen.getByLabelText('filter.keyword'), 'row'); await ready()
    const url = new URL(String(view.fetcher.mock.calls.at(-1)![0]), 'http://localhost')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ page: '1', pageSize: '50', q: 'row' })
    expect((screen.getByLabelText('pagination.pageSize') as HTMLSelectElement).value).toBe('50')
    expect(screen.queryByRole('checkbox')).toBeNull()
  })

  // Synchronous auth cache changes must retire the size even before component disabled props catch up.
  it.each(['own', 'admin'] as const)('resetsSizeForIdentityAndReadGrant in %s', async context => {
    const view = mount(context, true, false, 61); await ready()
    await fireEvent.update(screen.getByLabelText('pagination.pageSize'), '50'); await ready()
    view.client.setQueryData(['auth', 'me'], { user: { ...view.user, permissions: [] } })
    view.queuedSize(100); await nextTick()
    expect(screen.queryByTestId('console-link-list')).toBeNull()
    view.client.setQueryData(['auth', 'me'], { user: view.user }); await ready()
    expect((screen.getByLabelText('pagination.pageSize') as HTMLSelectElement).value).toBe('20')
    expect(screen.getAllByTestId('console-link-row')).toHaveLength(20)
    await fireEvent.update(screen.getByLabelText('pagination.pageSize'), '50'); await ready()
    view.client.setQueryData(['auth', 'me'], { user: { ...view.user, id: '00000000-0000-0000-0000-000000000002' } }); await ready()
    expect((screen.getByLabelText('pagination.pageSize') as HTMLSelectElement).value).toBe('20')
    expect(screen.getAllByTestId('console-link-row')).toHaveLength(20)
  })

  // Both transports must consume the same captured size; strict POST meta parsing rejects a stale size.
  it.each(['own', 'admin'] as const)('usesSizeForPrivatePost in %s', async context => {
    const view = mount(context, false, false, 61); await ready()
    await fireEvent.update(screen.getByLabelText('filter.noteQuery'), 'private word'); await ready()
    await fireEvent.update(screen.getByLabelText('pagination.pageSize'), '50'); await ready()
    expect(screen.getAllByTestId('console-link-row')).toHaveLength(50)
    const [url, init] = view.fetcher.mock.calls.at(-1)!
    expect(url).toBe(`/api/v1/${context === 'admin' ? 'admin/' : ''}short-link/note/search`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init!.body as string)).toEqual({ page: 1, pageSize: 50, status: '', q: '', tag: '', noteStatus: '', noteQuery: 'private word' })
    await fireEvent.click(screen.getByRole('button', { name: 'pagination.next' })); await ready()
    expect(screen.getAllByTestId('console-link-row')).toHaveLength(11)
    expect(JSON.parse(view.fetcher.mock.calls.at(-1)![1]!.body as string)).toMatchObject({ page: 2, pageSize: 50 })
    expect(window.location.href).not.toContain('private')
  })

  it.each((['own', 'admin'] as const).flatMap(context => [false, true].map(privateSearch => ({ context, privateSearch }))))('retiresLateSizeABA in $context/private=$privateSearch', async ({ context, privateSearch }) => {
    const view = mount(context, true, false, 61); await ready()
    if (privateSearch) { await fireEvent.update(screen.getByLabelText('filter.noteQuery'), 'private ABA'); await ready() }
    const old = createDeferred<Response>(), current = createDeferred<Response>()
    view.fetcher.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    await fireEvent.update(screen.getByLabelText('pagination.pageSize'), '50')
    const retiredSignal = view.fetcher.mock.calls.at(-1)![1]?.signal
    expect((screen.getByLabelText('pagination.pageSize') as HTMLSelectElement).disabled).toBe(false)
    await fireEvent.update(screen.getByLabelText('pagination.pageSize'), '20')
    if (privateSearch) expect(retiredSignal?.aborted).toBe(true)
    expect(screen.queryByTestId('console-link-list')).toBeNull()
    old.resolve(view.envelope(1, 61, 'retired size row', 50)); await nextTick(); await nextTick()
    expect(screen.queryByTestId('console-link-list')).toBeNull()
    current.resolve(view.envelope(1, 61, 'current size row')); await ready()
    expect(screen.queryByText('retired size row')).toBeNull()
    expect(screen.getAllByText('current size row')).toHaveLength(20)
  })

  it.each(['own', 'admin'] as const)('remountDefaultsWithoutRetiredRows in %s', async context => {
    const view = mount(context, true, false, 61); await ready()
    await fireEvent.update(screen.getByLabelText('pagination.pageSize'), '50'); await ready()
    view.unmount()
    const current = createDeferred<Response>(); view.fetcher.mockReturnValueOnce(current.promise)
    view.remount()
    expect(screen.queryByTestId('console-link-list')).toBeNull()
    expect((screen.getByLabelText('pagination.pageSize') as HTMLSelectElement).value).toBe('20')
    current.resolve(view.envelope(1, 61, 'new mounted collection')); await ready()
    expect(screen.getAllByText('new mounted collection')).toHaveLength(20)
    expect(new URL(String(view.fetcher.mock.calls.at(-1)![0]), 'http://localhost').searchParams.get('pageSize')).toBe('20')
  })

  it.each(['own', 'admin'] as const)('clampsSuccessfulTotalUsingCurrentSize and doesNotClampOnPendingOrError in %s', async context => {
    const view = mount(context, true, false, 101); await ready()
    await fireEvent.update(screen.getByLabelText('pagination.pageSize'), '50'); await ready()
    for (let n = 0; n < 2; n++) { await fireEvent.click(screen.getByRole('button', { name: 'pagination.next' })); await ready() }
    const pending = createDeferred<Response>(); view.fetcher.mockReturnValueOnce(pending.promise)
    const refresh = view.client.invalidateQueries({ queryKey: [view.prefix] })
    await waitFor(() => expect((screen.getByTestId('short-link-list-export') as HTMLButtonElement).disabled).toBe(true))
    const before = view.fetcher.mock.calls.length
    expect(screen.queryByTestId('short-link-pagination-summary')).toBeNull()
    expect(view.fetcher.mock.calls).toHaveLength(before)
    pending.reject(new Error('offline')); await refresh
    await screen.findByRole('alert')
    expect(view.fetcher.mock.calls).toHaveLength(before)
    expect((screen.getByLabelText('pagination.pageSize') as HTMLSelectElement).value).toBe('50')
    view.setTotal(50)
    await fireEvent.click(screen.getByRole('button', { name: 'pagination.retry' })); await ready()
    const requests = view.fetcher.mock.calls.slice(before).map(([url]) => Object.fromEntries(new URL(String(url), 'http://localhost').searchParams))
    expect(requests.map(p => [p.page, p.pageSize])).toEqual([['3', '50'], ['1', '50']])
    expect(screen.getAllByTestId('console-link-row')).toHaveLength(50)
  })

  it.each(['own', 'admin'] as const)('retryKeepsCurrentSize in %s', async context => {
    const view = mount(context, true, false, 101); await ready()
    await fireEvent.update(screen.getByLabelText('pagination.pageSize'), '100'); await ready()
    expect(screen.getAllByTestId('console-link-row')).toHaveLength(100)
    view.fetcher.mockRejectedValueOnce(new Error('offline'))
    await fireEvent.click(screen.getByRole('button', { name: 'pagination.next' }))
    await screen.findByRole('alert')
    await fireEvent.click(screen.getByRole('button', { name: 'pagination.retry' })); await ready()
    expect(screen.getAllByTestId('console-link-row')).toHaveLength(1)
    expect(Object.fromEntries(new URL(String(view.fetcher.mock.calls.at(-1)![0]), 'http://localhost').searchParams)).toMatchObject({ page: '2', pageSize: '100' })
  })

  it.each(['own', 'admin'] as const)('exportsAllMatchesFromSecondPage and blocksQueuedSizeForLiveLocks in %s', async context => {
    const view = mount(context, false, false, 61); await ready()
    await fireEvent.update(screen.getByLabelText('pagination.pageSize'), '50'); await ready()
    await fireEvent.click(screen.getByRole('button', { name: 'pagination.next' })); await ready()
    const pending = createDeferred<Response>(); view.fetcher.mockReturnValueOnce(pending.promise)
    const click = fireEvent.click(screen.getByTestId('short-link-list-export')); view.queuedSize(100); await click
    expect(screen.getAllByTestId('console-link-row')).toHaveLength(11)
    const url = new URL(String(view.fetcher.mock.calls.at(-1)![0]), 'http://localhost')
    expect(url.pathname.endsWith('/export')).toBe(true)
    expect(Object.fromEntries(url.searchParams)).toEqual({})
    pending.resolve(response({ fileName: context === 'own' ? 'moeurl-links-own.csv' : 'moeurl-links-all.csv', contentType: 'text/csv;charset=utf-8', content: csv }))
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledWith(expect.objectContaining({ content: csv })))
    expect((screen.getByLabelText('pagination.pageSize') as HTMLSelectElement).value).toBe('50')
  })
  // Omitting the page request or retaining selection across pages exposes the wrong write targets.
  it.each(['own', 'admin'] as const)('loadsSecondPageAndClearsSelection in %s', async context => {
    const view = mount(context)
    await ready()
    expect(screen.getAllByTestId('console-link-row')).toHaveLength(20)
    await fireEvent.click(screen.getAllByRole('checkbox')[1]!)
    await fireEvent.click(screen.getByRole('button', { name: 'pagination.next' }))
    await ready()
    expect(screen.getByText('page-two-row')).toBeTruthy()
    expect(screen.queryByText('page-one-row')).toBeNull()
    expect(screen.getAllByTestId('console-link-row')).toHaveLength(1)
    expect((screen.getAllByRole('checkbox')[1] as HTMLInputElement).checked).toBe(false)
    const url = new URL(String(view.fetcher.mock.calls.at(-1)![0]), 'http://localhost')
    expect(url.searchParams.get('page')).toBe('2')
    expect(url.searchParams.get('pageSize')).toBe('20')
    await fireEvent.click(screen.getByRole('button', { name: 'pagination.previous' }))
    await ready()
    expect(screen.getByText('page-one-row')).toBeTruthy()
    expect((screen.getAllByRole('checkbox')[1] as HTMLInputElement).checked).toBe(false)
  })
  // A page key reused after navigation or remount must never restore a retired collection.
  it.each(['own', 'admin'] as const)('ignoresRetiredPageResults in %s', async context => {
    const view = mount(context); await ready()
    const old = createDeferred<Response>(), current = createDeferred<Response>()
    view.fetcher.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    await fireEvent.click(screen.getByRole('button', { name: 'pagination.next' }))
    await fireEvent.click(screen.getByRole('button', { name: 'pagination.previous' }))
    expect(screen.queryByTestId('console-link-list')).toBeNull()
    old.resolve(view.envelope(2)); await nextTick(); await nextTick()
    expect(screen.queryByTestId('console-link-list')).toBeNull()
    current.resolve(view.envelope(1)); await ready()
    view.unmount()
    const fresh = createDeferred<Response>(); view.fetcher.mockReturnValueOnce(fresh.promise)
    view.remount()
    expect(screen.queryByTestId('console-link-list')).toBeNull()
    fresh.resolve(view.envelope(1, 1, 'fresh mount row')); await ready()
    expect(screen.getByText('fresh mount row')).toBeTruthy()
    expect(screen.queryByText('page-two-row')).toBeNull()
  })

  it.each((['own', 'admin'] as const).flatMap(context => (['status', 'noteStatus', 'keyword', 'tag'] as const).map(filter => ({ context, filter }))))('resetsPageForFiltersAndIdentity $context/$filter', async ({ context, filter }) => {
    const view = mount(context); await ready()
    await fireEvent.click(screen.getByRole('button', { name: 'pagination.next' })); await ready()
    const value = { status: 'active', noteStatus: 'present', keyword: 'page', tag: 'release' }[filter]
    await fireEvent.update(screen.getByLabelText(`filter.${filter}`), value); await ready()
    expect(screen.getByText('page-one-row')).toBeTruthy()
    const url = new URL(String(view.fetcher.mock.calls.at(-1)![0]), 'http://localhost')
    expect(url.searchParams.get('page')).toBe('1')
    expect(url.searchParams.get(filter === 'keyword' ? 'q' : filter)).toBe(value)
    await fireEvent.click(screen.getByRole('button', { name: 'pagination.next' })); await ready()
    view.client.setQueryData(['auth', 'me'], { user: { ...view.user, permissions: [] } })
    view.queuedNext()
    view.client.setQueryData(['auth', 'me'], { user: view.user }); await ready()
    expect(screen.getByText('page-one-row')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'pagination.next' })); await ready()
    view.client.setQueryData(['auth', 'me'], { user: { ...view.user, id: '00000000-0000-0000-0000-000000000002' } }); await ready()
    expect(screen.getByText('page-one-row')).toBeTruthy()
  })

  // Invalid and not-yet-applied drafts cannot silently change the active collection.
  it.each(['own', 'admin'] as const)('blocks queued changes with invalid or pending filters in %s', async context => {
    const view = mount(context); await ready()
    const before = view.fetcher.mock.calls.length
    await fireEvent.update(screen.getByLabelText('filter.tag'), 'x'.repeat(33)); view.queuedNext(); view.queuedSize(50); await nextTick()
    expect(view.fetcher.mock.calls).toHaveLength(before)
    expect(screen.getByText('page-one-row')).toBeTruthy()
    expect(screen.queryByTestId('short-link-pagination-summary')).toBeNull()
    expect(view.container.querySelector('.console-page__total')).toBeNull()
    await fireEvent.update(screen.getByLabelText('filter.tag'), 'release'); view.queuedNext(); view.queuedSize(50); await nextTick()
    expect(view.fetcher.mock.calls).toHaveLength(before)
    expect(screen.queryByTestId('short-link-pagination-summary')).toBeNull()
    expect(view.container.querySelector('.console-page__total')).toBeNull()
    await ready()
    expect(new URL(String(view.fetcher.mock.calls.at(-1)![0]), 'http://localhost').searchParams.get('page')).toBe('1')
  })

  // A conflict must block stale writes, not the read needed to recover from a failed refresh.
  it.each([
    { context: 'own', operation: 'tags' }, { context: 'admin', operation: 'tags' }, { context: 'admin', operation: 'transfer' },
  ] as const)('returns from page two after $context batch $operation conflict and failed refresh', async ({ context, operation }) => {
    const view = mount(context); await ready()
    await fireEvent.click(screen.getByRole('button', { name: 'pagination.next' })); await ready()
    await fireEvent.click(screen.getAllByRole('checkbox')[1]!)
    await fireEvent.click(screen.getByTestId(`batch-${operation}`))
    if (operation === 'tags') {
      await fireEvent.update(screen.getByLabelText('batchTags.tags'), 'updated')
      await fireEvent.click(screen.getByLabelText('batchTags.confirm'))
    } else {
      await fireEvent.update(screen.getByLabelText('transfer.recipient'), 'recipient')
      await fireEvent.click(screen.getByLabelText('transfer.confirm'))
    }
    view.fetcher.mockImplementation(async (_input, init) => {
      if (init?.method === 'POST') return new Response(JSON.stringify({ code: 200116, message: 'conflict', data: null }))
      throw new Error('refresh offline')
    })
    await fireEvent.click(operation === 'tags' ? screen.getByTestId('batch-tags-save') : screen.getByRole('button', { name: 'transfer.save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await screen.findByRole('alert')
    expect(screen.queryByTestId('console-link-list')).toBeNull()
    expect((screen.getByTestId(`batch-${operation}`) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'pagination.previous' }) as HTMLButtonElement).disabled).toBe(false)
    view.fetcher.mockImplementation(async input => view.envelope(Number(new URL(String(input), 'http://localhost').searchParams.get('page'))))
    await fireEvent.click(screen.getByRole('button', { name: 'pagination.previous' })); await ready()
    expect(screen.getByText('page-one-row')).toBeTruthy()
    expect(screen.queryByText('page-two-row')).toBeNull()
    expect(screen.getAllByRole('checkbox').every(box => !(box as HTMLInputElement).checked)).toBe(true)
    const writes = view.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0]![1]!.body as string).items).toEqual([{ id: rows[20]!.id, expectedUpdatedAt: rows[20]!.updatedAt }])
  })

  // A failed or pending read is not a successful zero-total response.
  it.each(['own', 'admin'] as const)('retriesOrReturnsAfterPageFailure in %s', async context => {
    const view = mount(context); await ready()
    view.fetcher.mockRejectedValueOnce(new Error('offline'))
    await fireEvent.click(screen.getByRole('button', { name: 'pagination.next' }))
    await screen.findByText(context === 'own' ? 'links.loadFailed' : 'adminLinks.loadFailed')
    expect(screen.queryByText('page-one-row')).toBeNull()
    expect(screen.queryByTestId('short-link-pagination-summary')).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: 'pagination.retry' })); await ready()
    expect(screen.getByText('page-two-row')).toBeTruthy()
    view.fetcher.mockRejectedValueOnce(new Error('offline again'))
    await view.client.invalidateQueries({ queryKey: [view.prefix] })
    await screen.findByText(context === 'own' ? 'links.loadFailed' : 'adminLinks.loadFailed')
    expect(screen.queryByText('page-two-row')).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: 'pagination.previous' })); await ready()
    expect(screen.getByText('page-one-row')).toBeTruthy()
  })

  it.each((['own', 'admin'] as const).flatMap(context => [0, 20].map(total => ({ context, total }))))('recoversEmptyLastPageOnlyAfterSuccess $context/$total', async ({ context, total }) => {
    const view = mount(context); await ready()
    await fireEvent.click(screen.getByRole('button', { name: 'pagination.next' })); await ready()
    const pending = createDeferred<Response>(); view.fetcher.mockReturnValueOnce(pending.promise)
    const refresh = view.client.invalidateQueries({ queryKey: [view.prefix] })
    await waitFor(() => expect((screen.getByTestId('short-link-list-export') as HTMLButtonElement).disabled).toBe(true))
    expect(screen.getByText('page-two-row')).toBeTruthy()
    expect(screen.queryByTestId('short-link-pagination-summary')).toBeNull()
    expect((screen.getByRole('button', { name: 'pagination.previous' }) as HTMLButtonElement).disabled).toBe(false)
    view.setTotal(total); pending.resolve(view.envelope(2, total)); await refresh
    if (total) await ready()
    else await screen.findByText('links.emptyTitle')
    await waitFor(() => expect(new URL(String(view.fetcher.mock.calls.at(-1)![0]), 'http://localhost').searchParams.get('page')).toBe('1'))
    expect((screen.getByRole('button', { name: 'pagination.previous' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'pagination.next' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it.each(['own', 'admin'] as const)('exportsAllAppliedFiltersFromSecondPage in %s', async context => {
    const view = mount(context, false); await ready()
    await fireEvent.update(screen.getByLabelText('filter.noteStatus'), 'present'); await ready()
    await fireEvent.click(screen.getByRole('button', { name: 'pagination.next' })); await ready()
    expect(screen.queryByRole('checkbox')).toBeNull()
    const pending = createDeferred<Response>(); view.fetcher.mockReturnValueOnce(pending.promise)
    await fireEvent.click(screen.getByTestId('short-link-list-export')); view.queuedNext()
    const url = new URL(String(view.fetcher.mock.calls.at(-1)![0]), 'http://localhost')
    expect(url.pathname).toBe(`/api/v1/${context === 'admin' ? 'admin/' : ''}short-link/export`)
    expect(Object.fromEntries(url.searchParams)).toEqual({ noteStatus: 'present' })
    expect(screen.getByText('page-two-row')).toBeTruthy()
    pending.resolve(response({ fileName: context === 'own' ? 'moeurl-links-own.csv' : 'moeurl-links-all.csv', contentType: 'text/csv;charset=utf-8', content: csv }))
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledWith(expect.objectContaining({ content: csv })))
  })

  it.each(['own', 'admin'] as const)('converges several retired pages directly to the confirmed last page in %s', async context => {
    const view = mount(context); view.setTotal(61); await ready()
    // The first request already captured its total, so refresh before navigating.
    await view.client.invalidateQueries({ queryKey: [view.prefix] }); await ready()
    for (let page = 2; page <= 4; page++) {
      await fireEvent.click(screen.getByRole('button', { name: 'pagination.next' })); await ready()
    }
    const before = view.fetcher.mock.calls.length
    view.setTotal(21)
    await view.client.invalidateQueries({ queryKey: [view.prefix] }); await ready()
    await screen.findByText('page-two-row')
    const requests = view.fetcher.mock.calls.slice(before).map(([url]) => new URL(String(url), 'http://localhost').searchParams.get('page'))
    expect(requests).toEqual(['4', '2'])
    expect(screen.getAllByTestId('console-link-row')).toHaveLength(1)
    expect((screen.getByRole('button', { name: 'pagination.next' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it.each(['row', 'batch'] as const)('keeps pagination locked through the %s transfer draft and request', async kind => {
    const view = mount('admin'); await ready()
    if (kind === 'batch') {
      await fireEvent.click(screen.getAllByRole('checkbox')[1]!)
      await fireEvent.click(screen.getByTestId('batch-transfer'))
    } else {
      await fireEvent.click(screen.getAllByRole('button', { name: 'links.actions.more' })[0]!)
      await fireEvent.click(screen.getByRole('menuitem', { name: 'transfer.action' }))
    }
    await fireEvent.update(screen.getByLabelText('transfer.recipient'), 'recipient')
    await fireEvent.click(screen.getByLabelText('transfer.confirm'))
    const before = view.fetcher.mock.calls.length
    view.queuedNext(); view.queuedSize(50); await nextTick()
    expect(view.fetcher.mock.calls).toHaveLength(before)
    const pending = createDeferred<Response>(); view.fetcher.mockReturnValueOnce(pending.promise)
    await fireEvent.click(screen.getByRole('button', { name: 'transfer.save' }))
    view.queuedNext(); view.queuedSize(50); await nextTick()
    expect(view.fetcher.mock.calls).toHaveLength(before + 1)
    expect(screen.getByText('page-one-row')).toBeTruthy()
    const [, init] = view.fetcher.mock.calls.at(-1)!
    const body = JSON.parse(init!.body as string)
    expect(kind === 'batch' ? body.items : [{ id: body.id, expectedUpdatedAt: body.expectedUpdatedAt }]).toEqual([{ id: rows[0]!.id, expectedUpdatedAt: rows[0]!.updatedAt }])
    pending.resolve(response(kind === 'batch' ? { transferredCount: 1, unchangedCount: 0 } : { id: rows[0]!.id, ownerId: '00000000-0000-0000-0000-000000000002', updatedAt: '2026-11-03T00:00:01.123456Z' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); await ready()
  })

  it.each(['own', 'admin'] as const)('keeps a loaded note draft and save attached to its opening page in %s', async context => {
    const view = mount(context); await ready()
    await fireEvent.click(screen.getAllByRole('button', { name: 'links.actions.more' })[0]!)
    await fireEvent.click(screen.getByRole('menuitem', { name: 'linkNote.action' }))
    await screen.findByDisplayValue('private text')
    await fireEvent.update(screen.getByLabelText('linkNote.text'), 'draft on page one')
    const before = view.fetcher.mock.calls.length
    view.queuedNext(); view.queuedSize(50); await nextTick()
    expect(view.fetcher.mock.calls).toHaveLength(before)
    expect(screen.getByDisplayValue('draft on page one')).toBeTruthy()
    const pending = createDeferred<Response>(); view.fetcher.mockReturnValueOnce(pending.promise)
    await fireEvent.click(screen.getByRole('button', { name: 'linkNote.save' }))
    view.queuedNext(); view.queuedSize(50); await nextTick()
    expect(view.fetcher.mock.calls).toHaveLength(before + 1)
    expect(screen.getByText('page-one-row')).toBeTruthy()
    pending.resolve(response({ id: rows[0]!.id, note: 'draft on page one', updatedAt: '2026-11-03T00:00:01.123456789Z' }))
    await waitFor(() => expect(view.client.isMutating()).toBe(0))
    await waitFor(() => expect(view.client.isFetching()).toBe(0))
    expect(screen.getByDisplayValue('draft on page one')).toBeTruthy()
  })

  it('keeps the current collection while the real bulk-create draft is open', async () => {
    const view = mount('own', true, true); await ready()
    const click = fireEvent.click(screen.getByTestId('bulk-create-open'))
    view.queuedNext(); view.queuedSize(50); await click
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByText('page-one-row')).toBeTruthy()
    expect(screen.queryByText('page-two-row')).toBeNull()
  })

  // Queued events may outlive disabled props; neither an invalid draft nor an absent next page can cause a read.
  it.each(['own', 'admin'] as const)('rejects queued retry with an invalid draft and next beyond the confirmed last page in %s', async context => {
    const view = mount(context); await ready()
    view.fetcher.mockRejectedValueOnce(new Error('offline'))
    await fireEvent.click(screen.getByRole('button', { name: 'pagination.next' }))
    await screen.findByRole('button', { name: 'pagination.retry' })
    await fireEvent.update(screen.getByLabelText('filter.tag'), 'x'.repeat(33))
    const failedReads = view.fetcher.mock.calls.length
    view.queuedRetry(); await nextTick()
    expect(view.fetcher.mock.calls).toHaveLength(failedReads)
    expect(screen.getByRole('alert').textContent).toContain(context === 'own' ? 'links.loadFailed' : 'adminLinks.loadFailed')
    await fireEvent.update(screen.getByLabelText('filter.tag'), '')
    await fireEvent.click(screen.getByRole('button', { name: 'pagination.retry' })); await ready()
    expect(screen.getByText('page-two-row')).toBeTruthy()
    const confirmedReads = view.fetcher.mock.calls.length
    view.queuedNext(); await nextTick()
    expect(view.fetcher.mock.calls).toHaveLength(confirmedReads)
    expect(screen.getByText('page-two-row')).toBeTruthy()
  })

  // Emitting a queued button click bypasses DOM disabled but must not bypass the page's live locks.
  it.each((['own', 'admin'] as const).flatMap(context => (['note', 'qr', 'settings', 'batch-delete', 'batch-write', 'row-write', 'batch-tags'] as const).map(operation => ({ context, operation }))))('rejectsQueuedPageChangesDuringOperations $context/$operation', async ({ context, operation }) => {
    const view = mount(context); await ready()
    await fireEvent.click(screen.getAllByRole('checkbox')[1]!)
    const pending = createDeferred<Response>()
    if (operation === 'batch-delete') await fireEvent.click(screen.getByTestId('batch-delete'))
    else if (operation === 'batch-tags') await fireEvent.click(screen.getByTestId('batch-tags'))
    else if (operation === 'batch-write') {
      view.fetcher.mockReturnValueOnce(pending.promise)
      const click = fireEvent.click(screen.getByTestId('batch-disable')); view.queuedNext(); view.queuedSize(50); await click
    } else {
      await fireEvent.click(screen.getAllByRole('button', { name: 'links.actions.more' })[0]!)
      if (operation === 'note' || operation === 'row-write') view.fetcher.mockReturnValueOnce(pending.promise)
      await fireEvent.click(screen.getByRole('menuitem', { name: { note: 'linkNote.action', qr: 'links.actions.qrCode', settings: 'links.actions.configure', 'row-write': 'links.actions.disable' }[operation] }))
    }
    const before = view.fetcher.mock.calls.length
    view.queuedNext(); view.queuedSize(50); await nextTick()
    expect(view.fetcher.mock.calls).toHaveLength(before)
    expect(screen.getByText('page-one-row')).toBeTruthy()
    expect(screen.queryByText('page-two-row')).toBeNull()
    pending.resolve(operation === 'note' ? response({ id: rows[0]!.id, note: 'private text', updatedAt: '2026-11-03T00:00:00.123456789Z' }) : response({ affectedCount: 1 }))
    await waitFor(() => expect(view.client.isMutating()).toBe(0))
    await waitFor(() => expect(view.client.isFetching()).toBe(0))
  })
})
