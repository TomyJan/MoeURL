import { cleanup, render } from '@testing-library/vue'
import { defineComponent, h, nextTick } from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'vue-sonner'
import { createDeferred } from '@/test/deferred'
import { useShortLinkAccess } from '@/features/short-link-batch/useShortLinkBatch'
import { useBatchNoteReplace } from './useBatchNoteReplace'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const actor = '00000000-0000-0000-0000-000000000001', other = '00000000-0000-0000-0000-000000000002'
const target = { id: '00000000-0000-0000-0000-000000000020', expectedUpdatedAt: '2026-11-05T00:00:00.123456789Z' }
const version = '2026-11-05T01:00:00.987654321Z'
const grants = ['short_link:read_own', 'short_link:update_own', 'short_link:set_metadata', 'admin:access', 'short_link:read_all', 'short_link:update_all']
const user = (permissions = grants, id = actor) => ({ id, username: 'owner', nickname: '', group: 'admin', permissions })
const preview = (willChange = true) => ({ items: [{ ...target, expectedNoteUpdatedAt: version, willChange }], changedCount: willChange ? 1 : 0, unchangedCount: willChange ? 0 : 1 })
const response = (data: unknown, code = 0, status = 200) => new Response(JSON.stringify({ code, message: 'private-canary', data, meta: {} }), { status })
const clients: QueryClient[] = []
/** Keeps cache identity and the client real; only the HTTP boundary is controlled. */
function mount(context: 'own' | 'admin' = 'own', permissions = grants) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  clients.push(client); client.setQueryData(['auth', 'me'], { user: user(permissions) })
  const fetcher = vi.fn<typeof fetch>(async path => response(String(path).endsWith('/auth/me') ? { user: user(permissions) }
    : String(path).endsWith('/preview') ? preview() : { changedCount: 1, unchangedCount: 0 }))
  vi.stubGlobal('fetch', fetcher)
  const replaced = vi.fn()
  let state!: ReturnType<typeof useBatchNoteReplace>
  const view = render(defineComponent({ setup() {
    state = useBatchNoteReplace(context, useShortLinkAccess(context), replaced)
    return () => h('div')
  } }), { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } })
  return { ...view, state, client, fetcher, replaced }
}
/** Explicitly edits and reads; opening alone must never start a request. */
async function approved(view: ReturnType<typeof mount>, note = 'new') {
  view.state.open([target]); view.state.setDraft(note); await view.state.preview()
  expect(view.state.canConfirm.value).toBe(true)
}
beforeEach(() => vi.clearAllMocks())
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals() })

describe('batch note replacement approval', () => {
  it.each(['own', 'admin'] as const)('opens without dispatch, normalizes an explicit preview and writes once under the pinned %s versions', async context => {
    const view = mount(context)
    view.state.open([target]); expect(view.state.draft.value).toBe(''); expect(view.fetcher).not.toHaveBeenCalled()
    await view.state.preview(); await view.state.confirm(); expect(view.fetcher).not.toHaveBeenCalled()
    view.state.setDraft(' \r\nnew\t ')
    const value = preview(); value.items[0]!.expectedUpdatedAt = '2026-11-05T08:00:00.123456789+08:00'
    view.fetcher.mockResolvedValueOnce(response(value)); await view.state.preview()
    const request = createDeferred<Response>(); view.fetcher.mockReturnValueOnce(request.promise)
    const saving = view.state.confirm()
    view.state.setDraft('changed'); view.state.close(); view.state.open([target]); await view.state.preview(); await view.state.confirm()
    expect(view.state.saving.value).toBe(true); expect(view.state.draft.value).toBe(' \r\nnew\t ')
    expect(view.fetcher).toHaveBeenCalledTimes(2)
    expect(JSON.parse(view.fetcher.mock.calls[1]![1]!.body as string)).toEqual({ items: [{ ...target, expectedNoteUpdatedAt: version }], note: 'new' })
    request.resolve(response({ changedCount: 1, unchangedCount: 0 })); await saving
    expect(view.state.targets.value).toBeNull(); expect(view.state.draft.value).toBe('')
    expect(view.replaced).toHaveBeenCalledOnce(); expect(toast.success).toHaveBeenCalledOnce()
  })
  it('retires the preview and queued approval synchronously after A→B→A, including after a new actual preview', async () => {
    const view = mount(); await approved(view, 'A')
    const oldConfirm = view.state.confirm
    view.state.setDraft('B'); view.state.setDraft('A')
    expect(view.state.canConfirm.value).toBe(false); expect(view.state.data.value).toBeNull()
    await oldConfirm(); await view.state.confirm(); expect(view.fetcher).toHaveBeenCalledTimes(1)
    await view.state.preview(); expect(view.state.canConfirm.value).toBe(true)
    await oldConfirm(); expect(view.fetcher).toHaveBeenCalledTimes(2)
    await view.state.confirm(); expect(view.replaced).toHaveBeenCalledOnce()
    expect(JSON.parse(view.fetcher.mock.calls[2]![1]!.body as string).note).toBe('A')
  })
  it.each(['success', 'failure'] as const)('editing retires a pending preview %s and its finally without unlocking a newer read', async outcome => {
    const view = mount(); view.state.open([target]); view.state.setDraft('A')
    const old = createDeferred<Response>(); view.fetcher.mockReturnValueOnce(old.promise)
    const first = view.state.preview()
    view.state.setDraft('B'); expect(view.state.loading.value).toBe(false)
    const fresh = createDeferred<Response>(); view.fetcher.mockReturnValueOnce(fresh.promise)
    const second = view.state.preview()
    if (outcome === 'success') old.resolve(response(preview())); else old.reject(new Error('private-canary'))
    await first
    expect(view.state.loading.value).toBe(true); expect(view.state.data.value).toBeNull(); expect(view.state.error.value).toBe('')
    fresh.resolve(response(preview())); await second
    expect(view.state.loading.value).toBe(false); expect(view.state.canConfirm.value).toBe(true)
    await view.state.confirm(); expect(JSON.parse(view.fetcher.mock.calls[2]![1]!.body as string).note).toBe('B')
  })
  it.each(['transport', 'http500', 'badEnvelope', 'badResult', 'infrastructureCode'] as const)('locks a %s outcome until actual readback and a new explicit approval', async kind => {
    const view = mount(); await approved(view)
    if (kind === 'transport') view.fetcher.mockRejectedValueOnce(new Error('private-canary'))
    else view.fetcher.mockResolvedValueOnce(kind === 'http500' ? response(null, 900000, 500) : kind === 'badEnvelope' ? new Response('broken')
      : kind === 'badResult' ? response({ note: 'private-canary' }) : response(null, 900000))
    await view.state.confirm(); const stale = view.state.confirm
    expect(view.state.unknown.value).toBe(true); expect(view.state.canConfirm.value).toBe(false)
    view.state.setDraft('different'); expect(view.state.draft.value).toBe('new')
    await stale(); expect(view.fetcher).toHaveBeenCalledTimes(2)
    view.fetcher.mockRejectedValueOnce(new Error('read failed')); await view.state.preview()
    expect(view.state.unknown.value).toBe(true); expect(view.state.error.value).toBe('loadFailed')
    await view.state.preview(); expect(view.state.unknown.value).toBe(false); expect(view.state.canConfirm.value).toBe(true)
    expect(view.replaced).not.toHaveBeenCalled(); await stale(); expect(view.fetcher).toHaveBeenCalledTimes(4)
    await view.state.confirm(); expect(view.replaced).toHaveBeenCalledOnce()
  })
  it('offers no write for all unchanged targets and keeps known failure retry explicit', async () => {
    const view = mount(); view.fetcher.mockResolvedValueOnce(response(preview(false)))
    view.state.open([target]); view.state.setDraft('same'); await view.state.preview()
    expect(view.state.data.value).toEqual(preview(false)); expect(view.state.canConfirm.value).toBe(false)
    await view.state.confirm(); expect(view.fetcher).toHaveBeenCalledOnce()
    view.state.setDraft('new'); await view.state.preview()
    view.fetcher.mockResolvedValueOnce(response(null, 100001)); await view.state.confirm()
    expect(view.state.error.value).toBe('saveFailed'); expect(view.state.canConfirm.value).toBe(true)
    expect(view.state.unknown.value).toBe(false); expect(view.replaced).not.toHaveBeenCalled()
  })
  it('rejects invalid drafts, identities and fixed selections without leaking private state', async () => {
    const view = mount('own', ['short_link:read_own'])
    view.state.open([target]); expect(view.state.targets.value).toBeNull()
    view.client.setQueryData(['auth', 'me'], { user: user(grants, 'bad') }); view.state.open([target])
    view.client.setQueryData(['auth', 'me'], { user: user() })
    for (const items of [[], [target, target], [{ ...target, id: 'bad' }], [{ ...target, expectedUpdatedAt: 'bad' }], Array.from({ length: 101 }, () => target)]) view.state.open(items)
    expect(view.state.targets.value).toBeNull(); expect(view.fetcher).not.toHaveBeenCalled()
    view.state.setDraft('closed'); expect(view.state.draft.value).toBe('')
    view.state.open([target]); view.state.setDraft(null); expect(view.state.draft.value).toBe('')
    for (const note of ['', ' \t', '\ud800', '😀'.repeat(1001), '\u0085']) {
      view.state.setDraft(note); await view.state.preview(); expect(view.state.error.value).toBe('invalidNote')
    }
    expect(view.fetcher).not.toHaveBeenCalled(); view.state.close(); expect(view.state.draft.value).toBe('')
    view.unmount(); view.state.open([target]); view.state.setDraft('gone'); expect(view.state.canRestoreFocus()).toBe(false)
  })
  for (const phase of ['preview', 'write'] as const) {
    it.each([200116, 200104, 120001, 401, 403])(`retires a ${phase} rejected with %s without retry or private response`, async code => {
      const view = mount(); if (phase === 'write') await approved(view)
      else { view.state.open([target]); view.state.setDraft('new') }
      view.fetcher.mockResolvedValueOnce(response(null, code, code === 401 || code === 403 ? code : 200))
      await (phase === 'write' ? view.state.confirm() : view.state.preview())
      expect(view.state.targets.value).toBeNull(); expect(view.state.draft.value).toBe(''); expect(view.state.data.value).toBeNull()
      expect(view.replaced).not.toHaveBeenCalled(); expect(toast.error).toHaveBeenCalledOnce()
      expect(JSON.stringify(vi.mocked(toast.error).mock.calls)).not.toContain('private-canary')
    })
    for (const outcome of ['success', 'failure'] as const) {
      it.each(['identity', 'grants', 'status', 'reopen', 'reset', 'unmount'] as const)(`drops late ${phase} ${outcome} after %s, including its finally`, async retirement => {
        const view = mount(); if (phase === 'write') await approved(view)
        else { view.state.open([target]); view.state.setDraft('old') }
        const old = createDeferred<Response>(); view.fetcher.mockReturnValueOnce(old.promise)
        const operation = phase === 'write' ? view.state.confirm() : view.state.preview()
        if (retirement === 'identity') {
          view.client.setQueryData(['auth', 'me'], { user: user(grants, other) }); view.client.setQueryData(['auth', 'me'], { user: user() })
        } else if (retirement === 'grants') {
          view.client.setQueryData(['auth', 'me'], { user: user(['short_link:read_own']) }); view.client.setQueryData(['auth', 'me'], { user: user() })
        } else if (retirement === 'status') {
          view.client.getQueryCache().find({ queryKey: ['auth', 'me'], exact: true })!.setState({ status: 'error' })
          view.client.setQueryData(['auth', 'me'], { user: user() })
        } else if (retirement === 'unmount') view.unmount()
        else if (retirement === 'reopen' && phase === 'preview') view.state.close()
        else view.state.reset()
        const fresh = createDeferred<Response>()
        let newRead: Promise<void> | undefined
        if (retirement !== 'unmount') {
          view.fetcher.mockReturnValueOnce(fresh.promise); view.state.open([target]); view.state.setDraft('fresh'); newRead = view.state.preview()
        }
        const invalidate = vi.spyOn(view.client, 'invalidateQueries')
        if (outcome === 'success') old.resolve(response(phase === 'preview' ? preview() : { changedCount: 1, unchangedCount: 0 }))
        else old.reject(new Error('old failure'))
        await operation; await nextTick()
        expect(view.replaced).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled()
        expect(invalidate).not.toHaveBeenCalled(); expect(view.state.data.value).toBeNull()
        if (retirement !== 'unmount') {
          expect(view.state.loading.value).toBe(true); expect(view.state.draft.value).toBe('fresh')
          fresh.resolve(response(preview())); await newRead; expect(view.state.canConfirm.value).toBe(true)
        }
      })
    }
  }
  it.each(['selection', 'invalidation', 'notification'] as const)('stops remaining success effects when %s retires the current login', async phase => {
    const view = mount(); await approved(view)
    const retire = () => view.client.setQueryData(['auth', 'me'], { user: user(grants, other) })
    const invalidate = vi.spyOn(view.client, 'invalidateQueries')
    if (phase === 'selection') view.replaced.mockImplementationOnce(retire)
    else if (phase === 'invalidation') invalidate.mockImplementationOnce(() => { retire(); return Promise.resolve() })
    else vi.mocked(toast.success).mockImplementationOnce(() => { retire(); return '' })
    await view.state.confirm()
    expect(view.replaced).toHaveBeenCalledOnce(); expect(invalidate).toHaveBeenCalledTimes(phase === 'selection' ? 0 : 1)
    expect(toast.success).toHaveBeenCalledTimes(phase === 'notification' ? 1 : 0)
    expect(view.state.targets.value).toBeNull(); expect(view.state.canRestoreFocus()).toBe(false)
  })
})
