import { cleanup, render } from '@testing-library/vue'
import { defineComponent, h, nextTick } from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'vue-sonner'
import { createDeferred } from '@/test/deferred'
import { useShortLinkAccess } from '@/features/short-link-batch/useShortLinkBatch'
import { useBatchNoteAppend } from './useBatchNoteAppend'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const actor = '00000000-0000-0000-0000-000000000001', other = '00000000-0000-0000-0000-000000000002'
const target = { id: '00000000-0000-0000-0000-000000000020', expectedUpdatedAt: '2026-11-09T00:00:00.123456789Z' }
const version = '2026-11-09T01:00:00.987654321Z'
const grants = ['short_link:read_own', 'short_link:update_own', 'short_link:set_metadata', 'admin:access', 'short_link:read_all', 'short_link:update_all']
const user = (permissions = grants, id = actor) => ({ id, username: 'owner', nickname: '', group: 'admin', permissions })
const preview = (overflow = false) => ({ items: [{ ...target, expectedNoteUpdatedAt: version }], appendableCount: overflow ? 0 : 1, overflowCount: overflow ? 1 : 0 })
const response = (data: unknown, code = 0, status = 200) => new Response(JSON.stringify({ code, message: 'private-canary', data, meta: {} }), { status })
const clients: QueryClient[] = []
/** Keeps real identity epochs, query subscriptions and HTTP decoding in the tested path. */
function mount(context: 'own' | 'admin' = 'own', permissions = grants) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  clients.push(client); client.setQueryData(['auth', 'me'], { user: user(permissions) })
  const fetcher = vi.fn<typeof fetch>(async (path, init) => response(String(path).endsWith('/auth/me') ? { user: user(permissions) }
    : String(path).endsWith('/preview') ? preview() : { requestId: JSON.parse(init!.body as string).requestId, appendedCount: 1 }))
  vi.stubGlobal('fetch', fetcher)
  const appended = vi.fn()
  let state!: ReturnType<typeof useBatchNoteAppend>
  let access!: ReturnType<typeof useShortLinkAccess>
  const view = render(defineComponent({ setup() { access = useShortLinkAccess(context); state = useBatchNoteAppend(context, access, appended); return () => h('div') } }), { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } })
  return { ...view, state, access, client, fetcher, appended }
}
/** Only an explicit successful preview authorizes an initial append attempt. */
async function approved(view: ReturnType<typeof mount>, note = 'new') {
  view.state.open([target]); view.state.setDraft(note); await view.state.preview(); expect(view.state.canConfirm.value).toBe(true)
}
beforeEach(() => vi.clearAllMocks())
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('private batch append approval', () => {
  it.each(['epoch', 'grants'] as const)('checks live ' + '%s' + ' before retry even when a mutable shared source changed without a query notification', async boundary => {
    const view = mount(); await approved(view); view.fetcher.mockRejectedValueOnce(new Error('lost')); await view.state.confirm()
    expect(view.state.canRetry.value).toBe(true)
    const queued = view.state.retry
    if (boundary === 'epoch') view.access.identity.scope.value = { ...view.access.identity.scope.value, epoch: view.access.identity.scope.value.epoch + 1 }
    else view.client.getQueryData<{ user: ReturnType<typeof user> }>(['auth', 'me'])!.user.permissions = ['short_link:read_own']
    await queued()
    expect(view.fetcher).toHaveBeenCalledTimes(2); expect(view.appended).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled()
  })
  it('rejects an already queued retry while a newer same-key retry is saving and after that newer operation fails', async () => {
    const view = mount(); await approved(view); view.fetcher.mockRejectedValueOnce(new Error('lost')); await view.state.confirm()
    const stale = view.state.retry, pending = createDeferred<Response>(); view.fetcher.mockReturnValueOnce(pending.promise)
    const saving = view.state.retry(); await stale(); expect(view.fetcher).toHaveBeenCalledTimes(3)
    pending.reject(new Error('still unknown')); await saving; await stale(); expect(view.fetcher).toHaveBeenCalledTimes(3)
    await view.state.retry(); expect(view.appended).toHaveBeenCalledOnce()
  })
  it.each(['own', 'admin'] as const)('normalizes one explicit %s write and locks editing, closing and duplicate confirmation while saving', async context => {
    const view = mount(context); view.state.open([target]); await view.state.preview(); await view.state.confirm(); await view.state.retry()
    expect(view.fetcher).not.toHaveBeenCalled()
    view.state.setDraft(' \r\nnew\t '); await view.state.preview()
    const queued = view.state.confirm, request = createDeferred<Response>(); view.fetcher.mockReturnValueOnce(request.promise)
    const saving = queued(); const payload = JSON.parse(view.fetcher.mock.calls[1]![1]!.body as string)
    expect(payload).toEqual({ requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), items: [{ ...target, expectedNoteUpdatedAt: version }], note: 'new' })
    view.state.setDraft('changed'); view.state.close(); view.state.open([target]); await view.state.preview(); await queued()
    expect(view.state.saving.value).toBe(true); expect(view.state.draft.value).toBe(' \r\nnew\t '); expect(view.fetcher).toHaveBeenCalledTimes(2)
    request.resolve(response({ requestId: payload.requestId, appendedCount: 1 })); await saving
    expect(view.state.targets.value).toBeNull(); expect(view.state.requestId.value).toBe(''); expect(view.appended).toHaveBeenCalledOnce(); expect(toast.success).toHaveBeenCalledOnce()
  })
  it.each(['transport', 'http500', 'badEnvelope', 'badResult', 'infrastructure'] as const)('retains the exact frozen payload and key after %s; manual retry never previews or changes the key', async kind => {
    const view = mount(); await approved(view)
    if (kind === 'transport') view.fetcher.mockRejectedValueOnce(new Error('private-canary'))
    else view.fetcher.mockResolvedValueOnce(kind === 'http500' ? response(null, 900000, 500) : kind === 'badEnvelope' ? new Response('bad') : kind === 'badResult' ? response({ note: 'private-canary' }) : response(null, 900000))
    await view.state.confirm(); const first = view.fetcher.mock.calls[1]![1]!.body
    expect(view.state.unknown.value).toBe(true); expect(view.state.canRetry.value).toBe(true); expect(view.state.canPreview.value).toBe(false)
    view.state.setDraft('different'); await view.state.preview(); await view.state.confirm()
    expect(view.state.draft.value).toBe('new'); expect(view.fetcher).toHaveBeenCalledTimes(2)
    view.fetcher.mockRejectedValueOnce(new Error('still unknown')); await view.state.retry()
    expect(view.state.unknown.value).toBe(true); expect(view.fetcher.mock.calls[2]![1]!.body).toBe(first)
    await view.state.retry()
    expect(view.fetcher.mock.calls[3]![1]!.body).toBe(first); expect(view.fetcher.mock.calls.filter(([path]) => String(path).endsWith('/preview'))).toHaveLength(1)
    expect(view.appended).toHaveBeenCalledOnce(); expect(view.state.targets.value).toBeNull()
  })
  it('requires an explicit unknown-result discard and rejects a queued discard for a newer opening', async () => {
    const view = mount(); await approved(view); view.fetcher.mockRejectedValueOnce(new Error('lost')); await view.state.confirm()
    const key = view.state.requestId.value
    view.state.close(); expect(view.state.discardRequested.value).toBe(true); expect(view.state.requestId.value).toBe(key)
    const staleDiscard = view.state.discard
    view.state.cancelDiscard(); expect(view.state.discardRequested.value).toBe(false)
    await staleDiscard(); expect(view.state.unknown.value).toBe(true)
    view.state.close(); view.state.discard(); expect(view.state.targets.value).toBeNull()
    view.state.open([target]); view.state.setDraft('fresh'); staleDiscard(); expect(view.state.draft.value).toBe('fresh')
  })
  it('keeps overflow all-or-nothing and invalidates both a draft ABA and its old queued confirmation', async () => {
    const view = mount(); await approved(view, 'A'); const queued = view.state.confirm
    view.state.setDraft('B'); view.state.setDraft('A'); await queued(); expect(view.fetcher).toHaveBeenCalledOnce()
    view.fetcher.mockResolvedValueOnce(response(preview(true))); await view.state.preview()
    expect(view.state.canConfirm.value).toBe(false); await view.state.confirm(); expect(view.fetcher).toHaveBeenCalledTimes(2)
    view.state.setDraft('shorter'); await view.state.preview(); await queued(); expect(view.fetcher).toHaveBeenCalledTimes(3)
    await view.state.confirm(); expect(view.appended).toHaveBeenCalledOnce()
  })
  it('requires a new preview after a known validation failure and never replaces a request-conflict key silently', async () => {
    const view = mount(); await approved(view); view.fetcher.mockResolvedValueOnce(response(null, 100001)); await view.state.confirm()
    expect(view.state.unknown.value).toBe(false); expect(view.state.error.value).toBe('saveFailed'); expect(view.state.canConfirm.value).toBe(false)
    view.state.setDraft('fixed'); await view.state.preview(); view.fetcher.mockResolvedValueOnce(response(null, 200120)); await view.state.confirm()
    expect(view.state.targets.value).toBeNull(); expect(toast.error).toHaveBeenCalledOnce(); expect(view.appended).not.toHaveBeenCalled()
  })
  it('fails closed before network when secure UUID generation is unavailable', async () => {
    const view = mount(); await approved(view); vi.spyOn(crypto, 'randomUUID').mockImplementationOnce(() => { throw new Error('unavailable') })
    await view.state.confirm(); expect(view.fetcher).toHaveBeenCalledOnce(); expect(view.state.unknown.value).toBe(false); expect(view.state.error.value).toBe('saveFailed')
  })
  it('rejects an invalid secure-generator result before any write can escape', async () => {
    const view = mount(); await approved(view)
    vi.spyOn(crypto, 'randomUUID').mockReturnValueOnce('00000000-0000-0000-0000-000000000000')
    await view.state.confirm()
    expect(view.fetcher).toHaveBeenCalledOnce(); expect(view.state.requestId.value).toBe(''); expect(view.state.error.value).toBe('saveFailed')
  })
  it('rejects invalid drafts, unavailable identities and invalid selections without dispatch', async () => {
    const view = mount('own', ['short_link:read_own']); view.state.open([target]); expect(view.state.targets.value).toBeNull()
    view.client.setQueryData(['auth', 'me'], { user: user(grants, 'bad') }); view.state.open([target]); expect(view.state.targets.value).toBeNull()
    view.client.setQueryData(['auth', 'me'], { user: user() })
    for (const items of [[], [target, target], [{ ...target, id: 'bad' }], [{ ...target, expectedUpdatedAt: 'bad' }], Array(101).fill(target)]) view.state.open(items)
    expect(view.state.targets.value).toBeNull(); view.state.setDraft('closed'); expect(view.state.draft.value).toBe('')
    view.state.open([target]); view.state.setDraft(null)
    for (const text of ['', ' \t', '\ud800', '\u0085', '😀'.repeat(1001)]) { view.state.setDraft(text); await view.state.preview(); expect(view.state.error.value).toBe('invalidNote') }
    expect(view.fetcher).not.toHaveBeenCalled(); view.unmount(); view.state.open([target]); view.state.setDraft('gone'); expect(view.state.canRestoreFocus()).toBe(false)
  })
  for (const phase of ['preview', 'write', 'retry'] as const) {
    it.each([200116, 200104, 120001, 401, 403, 200120])('retires a ' + phase + ' rejected with %s without further requests', async code => {
      const view = mount(); if (phase === 'preview') { view.state.open([target]); view.state.setDraft('new') } else await approved(view)
      if (phase === 'retry') { view.fetcher.mockRejectedValueOnce(new Error('lost')); await view.state.confirm() }
      view.fetcher.mockResolvedValueOnce(response(null, code, code === 401 || code === 403 ? code : 200))
      await (phase === 'preview' ? view.state.preview() : phase === 'write' ? view.state.confirm() : view.state.retry())
      expect(view.state.targets.value).toBeNull(); expect(view.state.draft.value).toBe(''); expect(view.appended).not.toHaveBeenCalled()
      expect(JSON.stringify(vi.mocked(toast.error).mock.calls)).not.toContain('private-canary')
    })
    for (const outcome of ['success', 'failure'] as const) {
      it.each(['identity', 'grants', 'status', 'reset', 'unmount'] as const)('drops late ' + phase + ' ' + outcome + ' and finally after %s, including identity/revoke ABA', async retirement => {
        const view = mount(); if (phase === 'preview') { view.state.open([target]); view.state.setDraft('old') } else await approved(view)
        if (phase === 'retry') { view.fetcher.mockRejectedValueOnce(new Error('lost')); await view.state.confirm() }
        const old = createDeferred<Response>(); view.fetcher.mockReturnValueOnce(old.promise)
        const running = phase === 'preview' ? view.state.preview() : phase === 'write' ? view.state.confirm() : view.state.retry()
        const payload = view.fetcher.mock.calls.at(-1)![1]!.body as string
        if (retirement === 'identity') { view.client.setQueryData(['auth', 'me'], { user: user(grants, other) }); view.client.setQueryData(['auth', 'me'], { user: user() }) }
        else if (retirement === 'grants') { view.client.setQueryData(['auth', 'me'], { user: user(['short_link:read_own']) }); view.client.setQueryData(['auth', 'me'], { user: user() }) }
        else if (retirement === 'status') { view.client.getQueryCache().find({ queryKey: ['auth', 'me'], exact: true })!.setState({ status: 'error' }); view.client.setQueryData(['auth', 'me'], { user: user() }) }
        else if (retirement === 'unmount') view.unmount(); else view.state.reset()
        const fresh = createDeferred<Response>(); let newRead: Promise<void> | undefined
        if (retirement !== 'unmount') { view.fetcher.mockReturnValueOnce(fresh.promise); view.state.open([target]); view.state.setDraft('fresh'); newRead = view.state.preview() }
        const invalidate = vi.spyOn(view.client, 'invalidateQueries')
        if (outcome === 'success') old.resolve(response(phase === 'preview' ? preview() : { requestId: JSON.parse(payload).requestId, appendedCount: 1 })); else old.reject(new Error('old private failure'))
        await running; await nextTick()
        expect(view.appended).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled(); expect(invalidate).not.toHaveBeenCalled()
        if (retirement !== 'unmount') { expect(view.state.loading.value).toBe(true); expect(view.state.draft.value).toBe('fresh'); fresh.resolve(response(preview())); await newRead; expect(view.state.canConfirm.value).toBe(true) }
      })
    }
  }
  it('synchronously retires a pending preview when a newer draft is read and ignores old success/finally', async () => {
    const view = mount(); view.state.open([target]); view.state.setDraft('A'); const old = createDeferred<Response>(); view.fetcher.mockReturnValueOnce(old.promise); const first = view.state.preview()
    view.state.setDraft('B'); const fresh = createDeferred<Response>(); view.fetcher.mockReturnValueOnce(fresh.promise); const second = view.state.preview()
    old.resolve(response(preview())); await first; expect(view.state.loading.value).toBe(true); expect(view.state.data.value).toBeNull()
    fresh.resolve(response(preview())); await second; expect(view.state.canConfirm.value).toBe(true)
  })
  it.each(['selection', 'invalidation', 'notification'] as const)('stops later success effects after %s retires authority', async phase => {
    const view = mount(); await approved(view)
    const retire = () => view.client.setQueryData(['auth', 'me'], { user: user(grants, other) }), invalidate = vi.spyOn(view.client, 'invalidateQueries')
    if (phase === 'selection') view.appended.mockImplementationOnce(retire)
    else if (phase === 'invalidation') invalidate.mockImplementationOnce(() => { retire(); return Promise.resolve() })
    else vi.mocked(toast.success).mockImplementationOnce(() => { retire(); return '' })
    await view.state.confirm(); expect(view.appended).toHaveBeenCalledOnce(); expect(invalidate).toHaveBeenCalledTimes(phase === 'selection' ? 0 : 1)
    expect(toast.success).toHaveBeenCalledTimes(phase === 'notification' ? 1 : 0); expect(view.state.canRestoreFocus()).toBe(false)
  })
})
