import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { computed, defineComponent, nextTick, ref, shallowRef, watch } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { messages } from '@/app/i18n'
import { downloadCsv } from '@/shared/download/csv'
import { useShortLinkAccess } from '@/features/short-link-batch/useShortLinkBatch'
import { revokeAccountIdentity } from '@/shared/preferences/useAccountPreferences'
import { createDeferred } from '@/test/deferred'
import { componentStubs } from '@/test/component-stubs'
import { useSelectedListExport, type SelectedListExportState } from './useSelectedListExport'
import ShortLinkSelectedExportButton from './ShortLinkSelectedExportButton.vue'
import { exportSelectedShortLinkList } from '@/entities/short-link/selected-list-export'

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/shared/download/csv', () => ({ downloadCsv: vi.fn() }))
// Default calls keep the real entity and HTTP parser; only two flush-order cases control its settlement boundary.
vi.mock('@/entities/short-link/selected-list-export', async importOriginal => {
  const actual = await importOriginal<typeof import('@/entities/short-link/selected-list-export')>()
  return { ...actual, exportSelectedShortLinkList: vi.fn(actual.exportSelectedShortLinkList) }
})
const actor = '10000000-0000-0000-0000-000000000001'
const id1 = '00000000-0000-0000-0000-000000000020', id2 = '00000000-0000-0000-0000-000000000021'
const permissions = ['short_link:read_own', 'short_link:export', 'admin:access', 'short_link:read_all']
const header = '\uFEFFid,short_url,slug,target_url,title,tags,status,redirect_mode,intermediate_delay_seconds,expires_at,password_enabled,max_visits,visits_used,created_at,updated_at,owner_id,owner_username\r\n'
const file = { fileName: 'moeurl-links-own-selected.csv', contentType: 'text/csv;charset=utf-8', content: header }
const clients: QueryClient[] = []
/** Returns a complete confirmed identity at the cache boundary used by the real access hook. */
function user(grants = permissions, id = actor) { return { id, username: 'actor', nickname: '', group: 'admin', permissions: grants } }
/** Keeps the real entity and transport parser in the state-machine tests. */
function response(data: unknown = file, code = 0) { return new Response(JSON.stringify({ code, message: 'private', data, meta: {} })) }
/** Exposes raw parent refs so same-tick ABA cannot be hidden by a child prop rerender. */
function mount(options: { context?: 'own' | 'admin'; selection?: string[]; ids?: string[]; locale?: 'zh-CN' | 'en-US'; canStart?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  clients.push(client)
  client.setQueryData(['auth', 'me'], { user: user() })
  const context = ref(options.context ?? 'own'), key = shallowRef<readonly unknown[]>(['selected-test', actor])
  const selection = ref(options.selection ?? [id1]), blocked = ref(false), collection = ref<unknown>(['private A', 1])
  const gate = ref(true), data = { items: (options.ids ?? [id1, id2]).map(id => ({ id })), meta: { page: 1, pageSize: 20, total: 2 } }
  client.setQueryData(key.value, data)
  const fetcher = vi.fn<typeof fetch>(async () => response({ ...file, fileName: context.value === 'own' ? file.fileName : 'moeurl-links-all-selected.csv' }))
  vi.stubGlobal('fetch', fetcher)
  let state!: SelectedListExportState
  const harness = defineComponent({ components: { ShortLinkSelectedExportButton }, setup() {
    state = useSelectedListExport({ access: useShortLinkAccess('own'), context, queryKey: key, selection, blocked,
      collection: computed(() => collection.value), ...(options.canStart ? { canStart: () => gate.value } : {}) })
    return { state }
  }, template: '<ShortLinkSelectedExportButton :state="state" />' })
  const i18n = createI18n({ legacy: false, locale: options.locale ?? 'en-US', messages })
  const view = render(harness, { global: { plugins: [[VueQueryPlugin, { queryClient: client }], i18n], stubs: componentStubs } })
  return { ...view, state, client, context, key, selection, blocked, collection, gate, data, fetcher }
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('selected export lifecycle', () => {
  it.each([false, true])('rechecks real queued parent watchers after entity settlement, failed=%s', async failed => {
    const view = mount(), descriptor = createDeferred<Awaited<ReturnType<typeof exportSelectedShortLinkList>>>(), changed = ref(false)
    vi.mocked(exportSelectedShortLinkList).mockReturnValueOnce(descriptor.promise)
    const stop = watch(changed, () => { view.selection.value = [id2] }, { flush: 'post' })
    try {
      const run = view.state.submit()
      await nextTick()
      if (failed) descriptor.reject(new Error('private'))
      else descriptor.resolve({ ...file, contentType: 'text/csv;charset=utf-8' })
      // The hook continuation is queued first; a real parent post-flush watcher retires it during nextTick.
      changed.value = true
      await run
      expect(downloadCsv).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled()
      expect(view.state.pending.value).toBe(false)
    } finally { stop() }
  })
  it.each(['own', 'admin'] as const)('exports a complete %s page-ordered selection without self-cancelling or additional list reads', async context => {
    const view = mount({ context, selection: [id2, id1] })
    await fireEvent.click(screen.getByTestId('short-link-selected-export'))
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledOnce())
    expect(view.fetcher).toHaveBeenCalledOnce()
    expect(view.fetcher.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ ids: [id1, id2] }))
    expect(view.fetcher.mock.calls[0]?.[1]?.headers).toEqual(expect.objectContaining({ 'X-MoeURL-Expected-User-ID': actor }))
    expect(view.state.pending.value).toBe(false)
  })
  it('permits 100 unique selected IDs and rejects a page larger than its bound', async () => {
    const ids = Array.from({ length: 100 }, (_, index) => '00000000-0000-0000-0000-' + String(index + 1).padStart(12, '0'))
    const view = mount({ ids, selection: [...ids].reverse() })
    await view.state.submit()
    expect(view.fetcher.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ ids }))
    view.client.setQueryData(view.key.value, { ...view.data, items: [...view.data.items, { id: '00000000-0000-0000-0000-000000000101' }] })
    expect(view.state.disabled.value).toBe(true)
  })
  it.each([[], [id1, id1], ['unknown'], [id1, id2, '00000000-0000-0000-0000-000000000099'], Array(101).fill(id1)].map(selection => ({ selection })))('never takes an intersection or normalizes invalid selection %#', async ({ selection }) => {
    const view = mount({ selection })
    expect(view.state.disabled.value).toBe(true)
    await view.state.submit()
    expect(view.fetcher).not.toHaveBeenCalled()
  })
  it.each([[], [id1, id1], ['invalid'], [id1, 'invalid']].map(ids => ({ ids })))('rejects an empty, ambiguous or invalid cached page %#', async ({ ids }) => {
    const view = mount({ ids })
    await view.state.submit()
    expect(view.state.disabled.value).toBe(true)
    expect(view.fetcher).not.toHaveBeenCalled()
  })
  it.each(['missing', 'pending', 'fetching', 'invalidated', 'error'] as const)('requires the exact successful idle non-invalidated cache: %s', async condition => {
    const view = mount()
    const query = view.client.getQueryCache().find({ queryKey: view.key.value, exact: true })!
    if (condition === 'missing') view.client.removeQueries({ queryKey: view.key.value, exact: true })
    if (condition === 'pending') query.setState({ status: 'pending' })
    if (condition === 'fetching') query.setState({ fetchStatus: 'fetching' })
    if (condition === 'invalidated') query.setState({ isInvalidated: true })
    if (condition === 'error') query.setState({ status: 'error', error: new Error('private') })
    await view.state.submit()
    expect(view.state.disabled.value).toBe(true)
    expect(view.fetcher).not.toHaveBeenCalled()
  })
  it.each([
    user([]), user(['short_link:export']), user(['short_link:read_own']), user(permissions, ''),
    { ...user(), group: 'guest' }, { ...user(), username: 'guest' }, user(permissions, 'bad-id'),
  ])('hides and refuses incomplete confirmed export authority %#', async identity => {
    const view = mount()
    view.client.setQueryData(['auth', 'me'], { user: identity })
    await nextTick()
    expect(screen.queryByTestId('short-link-selected-export')).toBeNull()
    await view.state.submit()
    expect(view.fetcher).not.toHaveBeenCalled()
  })
  it.each([['short_link:export', 'short_link:read_own'], ['short_link:export', 'short_link:read_all'], ['short_link:export', 'admin:access']].map(grants => ({ grants })))('requires the complete administrative intersection %#', async ({ grants }) => {
    const view = mount({ context: 'admin' })
    view.client.setQueryData(['auth', 'me'], { user: user(grants) })
    await view.state.submit()
    expect(view.state.visible.value).toBe(false)
    expect(view.fetcher).not.toHaveBeenCalled()
  })
  it('requires a confirmed auth cache and live optional parent gates', async () => {
    const view = mount({ canStart: true })
    view.gate.value = false
    await view.state.submit(); expect(view.fetcher).not.toHaveBeenCalled()
    view.gate.value = true; view.blocked.value = true
    await view.state.submit(); expect(view.fetcher).not.toHaveBeenCalled()
    view.blocked.value = false
    view.client.getQueryCache().find({ queryKey: ['auth', 'me'], exact: true })!.setState({ status: 'pending' })
    await view.state.submit(); expect(view.state.visible.value).toBe(false)
    view.client.removeQueries({ queryKey: ['auth', 'me'], exact: true })
    expect(view.state.visible.value).toBe(false)
  })
  it.each(['request', 'limit', 'browser'] as const)('reports a safe %s error and allows only explicit retry', async failure => {
    const view = mount()
    if (failure === 'request') view.fetcher.mockRejectedValueOnce(new Error('private'))
    if (failure === 'limit') view.fetcher.mockResolvedValueOnce(response(null, 200118))
    if (failure === 'browser') vi.mocked(downloadCsv).mockImplementationOnce(() => { throw new Error('private') })
    await view.state.submit()
    expect(toast.error).toHaveBeenCalledWith(failure === 'limit' ? 'Selection exceeds the export limit. Choose fewer links and retry.' : 'Export failed. Please try again.')
    expect(view.state.pending.value).toBe(false)
    expect(view.fetcher).toHaveBeenCalledOnce()
    await view.state.submit()
    expect(toast.success).toHaveBeenCalledOnce()
  })
  it.each(['selection', 'collection', 'context', 'query-key', 'blocked', 'gate', 'permission', 'identity', 'cache-replace', 'cache-invalidated', 'cache-fetching', 'cache-error', 'cache-removed'] as const)('retires same-tick %s ABA without letting old success, error or finally affect a newer attempt', async transition => {
    for (const failed of [false, true]) {
      const view = mount({ canStart: true }), old = createDeferred<Response>(), current = createDeferred<Response>()
      view.fetcher.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
      const oldRun = view.state.submit()
      await view.state.submit(); expect(view.fetcher).toHaveBeenCalledOnce()
      const originalKey = view.key.value
      const query = view.client.getQueryCache().find({ queryKey: originalKey, exact: true })!
      if (transition === 'selection') { view.selection.value = [id2]; view.selection.value = [id1] }
      if (transition === 'collection') { view.collection.value = ['B', 2]; view.collection.value = ['private A', 1] }
      if (transition === 'context') { view.context.value = 'admin'; view.context.value = 'own' }
      if (transition === 'query-key') { view.key.value = ['other']; view.key.value = originalKey }
      if (transition === 'blocked') { view.blocked.value = true; view.blocked.value = false }
      if (transition === 'gate') { view.gate.value = false; view.gate.value = true }
      if (transition === 'permission') { view.client.setQueryData(['auth', 'me'], { user: user([]) }); view.client.setQueryData(['auth', 'me'], { user: user() }) }
      if (transition === 'identity') { void revokeAccountIdentity(view.client); view.client.setQueryData(['auth', 'me'], { user: user() }) }
      if (transition === 'cache-replace') { view.client.setQueryData(originalKey, { ...view.data, items: [{ id: id2 }] }); view.client.setQueryData(originalKey, view.data) }
      if (transition === 'cache-invalidated') { query.setState({ isInvalidated: true }); query.setState({ isInvalidated: false }) }
      if (transition === 'cache-fetching') { query.setState({ fetchStatus: 'fetching' }); query.setState({ fetchStatus: 'idle' }) }
      if (transition === 'cache-error') { query.setState({ status: 'error' }); query.setState({ status: 'success' }) }
      if (transition === 'cache-removed') { view.client.removeQueries({ queryKey: originalKey, exact: true }); view.client.setQueryData(originalKey, view.data) }
      expect(view.fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true)
      expect(view.state.pending.value).toBe(false)
      const newRun = view.state.submit()
      expect(view.state.pending.value).toBe(true)
      if (failed) old.reject(new Error('private'))
      else old.resolve(response())
      await oldRun
      expect(downloadCsv).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
      expect(view.state.pending.value).toBe(true)
      current.resolve(response()); await newRun
      expect(downloadCsv).toHaveBeenCalledExactlyOnceWith(file)
      expect(view.state.pending.value).toBe(false)
      view.unmount(); vi.clearAllMocks()
    }
  })
  it.each([false, true])('retires unmount and refuses later direct submit, failure=%s', async failed => {
    const view = mount(), request = createDeferred<Response>()
    view.fetcher.mockReturnValueOnce(request.promise)
    const run = view.state.submit()
    view.unmount()
    if (failed) request.reject(new Error('private'))
    else request.resolve(response())
    await run; await view.state.submit()
    expect(downloadCsv).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled()
    expect(view.fetcher).toHaveBeenCalledOnce()
  })
  it('ignores unrelated cache events while preserving the current request', async () => {
    const view = mount(), request = createDeferred<Response>()
    view.fetcher.mockReturnValueOnce(request.promise)
    const run = view.state.submit()
    view.client.setQueryData(['unrelated'], { value: 1 })
    expect(view.state.pending.value).toBe(true)
    expect(view.fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(false)
    request.resolve(response()); await run
    expect(downloadCsv).toHaveBeenCalledExactlyOnceWith(file)
  })
  it.each([['zh-CN', '导出所选 CSV'], ['en-US', 'Export selected CSV']] as const)('uses real %s wording', (locale, label) => {
    mount({ locale })
    expect(screen.getByRole('button', { name: label })).toBeTruthy()
  })
})
