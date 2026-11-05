import { cleanup, render } from '@testing-library/vue'
import { defineComponent, h } from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'vue-sonner'
import { createDeferred } from '@/test/deferred'
import { useShortLinkAccess } from '@/features/short-link-batch/useShortLinkBatch'
import { useBatchTagRename } from './useBatchTagRename'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const actor = '00000000-0000-0000-0000-000000000001', other = '00000000-0000-0000-0000-000000000002'
const target = { id: '00000000-0000-0000-0000-000000000020', expectedUpdatedAt: '2026-11-05T00:00:00.123456789Z', url: 'https://short.example/a', tags: ['old', 'a'] }
const grants = ['short_link:read_own', 'short_link:update_own', 'short_link:set_metadata', 'admin:access', 'short_link:read_all', 'short_link:update_all']
const user = (permissions = grants, id = actor) => ({ id, username: 'owner', nickname: '', group: 'admin', permissions })
const response = (data: unknown = { changedCount: 1, unchangedCount: 0 }, code = 0, status = 200) => new Response(JSON.stringify({ code, message: 'sensitive-canary', data, meta: {} }), { status })
const clients: QueryClient[] = []
/** Runs real cache authority and HTTP validation; deferred IO controls only external boundaries. */
function mount(context: 'own' | 'admin' = 'own', permissions = grants) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } }); clients.push(client)
  client.setQueryData(['auth', 'me'], { user: user(permissions) })
  const fetcher = vi.fn<typeof fetch>(async () => response()); vi.stubGlobal('fetch', fetcher)
  const cleared = vi.fn(), reload = vi.fn<(current: () => boolean) => Promise<boolean>>(async () => true)
  let state!: ReturnType<typeof useBatchTagRename>
  const view = render(defineComponent({ setup() { state = useBatchTagRename(context, useShortLinkAccess(context), cleared, reload); return () => h('div') } }), { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } })
  return { ...view, state, client, fetcher, cleared, reload }
}
function approved(view: ReturnType<typeof mount>) {
  view.state.open([target]); view.state.setFromTag('old'); view.state.setToTag('new'); view.state.approve()
  expect(view.state.canConfirm.value).toBe(true)
}
beforeEach(() => vi.clearAllMocks())
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals() })

describe('fixed tag rename approval', () => {
  it.each(['own', 'admin'] as const)('previews immutable ordered tags then writes once under the pinned %s snapshot', async context => {
    const view = mount(context), targets = [{ ...target, tags: ['old', 'a'] }, { ...target, id: other, tags: ['old', 'a', 'new'] }, { ...target, id: actor, tags: ['a'] }]
    view.state.open(targets); targets[0]!.tags.splice(0); targets[0]!.url = 'changed'
    view.state.setFromTag('　old '); view.state.setToTag(' new ')
    expect(view.state.preview.value?.items.map(item => item.after)).toEqual([['new', 'a'], ['a', 'new'], ['a']])
    expect(view.state.preview.value?.changedCount).toBe(2); expect(view.state.preview.value?.unchangedCount).toBe(1)
    expect(view.state.targets.value?.[0]?.url).toBe(target.url)
    await view.state.confirm(); expect(view.fetcher).not.toHaveBeenCalled()
    view.state.approve(); const deferred = createDeferred<Response>(); view.fetcher.mockReturnValueOnce(deferred.promise)
    const saving = view.state.confirm(); await view.state.confirm(); view.state.close(); view.state.open([target]); view.state.setToTag('other')
    expect(view.state.saving.value).toBe(true); expect(view.state.draft.value.toTag).toBe(' new ')
    expect(JSON.parse(view.fetcher.mock.calls[0]![1]!.body as string)).toEqual({ items: targets.map(item => ({ id: item.id, expectedUpdatedAt: item.expectedUpdatedAt })), fromTag: 'old', toTag: 'new' })
    deferred.resolve(response({ changedCount: 2, unchangedCount: 1 })); await saving
    expect(view.state.targets.value).toBeNull(); expect(view.cleared).toHaveBeenCalledOnce(); expect(toast.success).toHaveBeenCalledOnce()
  })
  it('retires old approval and confirm closures after draft ABA and close/reopen', async () => {
    const view = mount(); approved(view); const confirm = view.state.confirm, approve = view.state.approve
    view.state.setToTag('B'); view.state.setToTag('new'); approve(); await confirm(); await view.state.confirm()
    expect(view.state.canConfirm.value).toBe(false); expect(view.fetcher).not.toHaveBeenCalled()
    view.state.approve(); await confirm(); expect(view.fetcher).not.toHaveBeenCalled()
    const freshConfirm = view.state.confirm; view.state.close(); approved(view); await freshConfirm(); expect(view.fetcher).not.toHaveBeenCalled()
    await view.state.confirm(); expect(view.cleared).toHaveBeenCalledOnce()
  })
  it('rejects invalid targets and drafts and all-no-op approval', async () => {
    const view = mount()
    for (const items of [[], [target, target], [{ ...target, id: '' }], [{ ...target, expectedUpdatedAt: 'bad' }], [{ ...target, tags: ['x', 'x'] }]]) view.state.open(items)
    expect(view.state.targets.value).toBeNull()
    view.state.setFromTag('old'); view.state.open([target]); view.state.setFromTag(null); view.state.setToTag(1)
    expect(view.state.draft.value).toEqual({ fromTag: '', toTag: '' })
    view.state.setFromTag('old'); view.state.setToTag('\tnew'); view.state.approve(); await view.state.confirm(); expect(view.state.preview.value).toBeNull()
    view.state.setFromTag('absent'); view.state.setToTag('new'); view.state.approve(); await view.state.confirm()
    expect(view.state.canConfirm.value).toBe(false); expect(view.fetcher).not.toHaveBeenCalled()
    view.state.close(); view.unmount(); view.state.open([target]); expect(view.state.canRestoreFocus()).toBe(false)
  })
  it.each(['transport', 'http500', 'badEnvelope', 'badResult', 'infrastructure'] as const)('locks %s outcomes across edits, close and reopen until successful fresh idle read', async kind => {
    const view = mount(); approved(view)
    if (kind === 'transport') view.fetcher.mockRejectedValueOnce(new Error('sensitive-canary'))
    else view.fetcher.mockResolvedValueOnce(kind === 'http500' ? response(null, 0, 500) : kind === 'badEnvelope' ? new Response('bad') : kind === 'badResult' ? response({ changedCount: 2, unchangedCount: 0 }) : response(null, 900000))
    await view.state.confirm(); expect(view.state.unknown.value).toBe(true)
    view.state.setToTag('other'); view.state.approve(); view.state.close(); view.state.open([target]); await view.state.confirm()
    expect(view.state.draft.value.toTag).toBe('new'); expect(view.state.targets.value).not.toBeNull(); expect(view.fetcher).toHaveBeenCalledOnce()
    view.reload.mockResolvedValueOnce(false); await view.state.reload(); expect(view.state.unknown.value).toBe(true); expect(view.state.error.value).toBe('loadFailed')
    const reading = createDeferred<boolean>(); view.reload.mockReturnValueOnce(reading.promise); const task = view.state.reload(); await view.state.reload()
    expect(view.state.loading.value).toBe(true); expect(view.cleared).not.toHaveBeenCalled()
    reading.resolve(true); await task
    expect(view.state.targets.value).toBeNull(); expect(view.cleared).toHaveBeenCalledOnce(); expect(view.fetcher).toHaveBeenCalledOnce(); expect(toast.success).not.toHaveBeenCalled()
  })
  it.each([200116, 200104])('keeps a known %s stale-target barrier until actual reload without claiming an unknown outcome', async code => {
    const view = mount(); approved(view); view.fetcher.mockResolvedValueOnce(response(null, code)); await view.state.confirm()
    expect(view.state.recovery.value).toBe('stale'); expect(view.state.unknown.value).toBe(false)
    view.state.close(); view.state.open([target]); view.state.approve(); await view.state.confirm(); expect(view.fetcher).toHaveBeenCalledOnce()
    view.reload.mockRejectedValueOnce(new Error('offline')); await view.state.reload(); expect(view.state.recovery.value).toBe('stale')
    await view.state.reload(); expect(view.state.targets.value).toBeNull(); expect(view.cleared).toHaveBeenCalledOnce()
  })
  it('retains an ordinary rejected draft but requires a new approval', async () => {
    const view = mount(); approved(view); view.fetcher.mockResolvedValueOnce(response(null, 100001)); await view.state.confirm()
    expect(view.state.error.value).toBe('saveFailed'); expect(view.state.canConfirm.value).toBe(false); expect(view.state.recovery.value).toBe('')
    await view.state.confirm(); expect(view.fetcher).toHaveBeenCalledOnce(); view.state.approve(); await view.state.confirm(); expect(view.cleared).toHaveBeenCalledOnce()
  })
  it('retires old approval and confirmation callbacks after a rejected write even when the draft does not change', async () => {
    const view = mount(); approved(view); const oldConfirm = view.state.confirm, oldApprove = view.state.approve
    view.fetcher.mockResolvedValueOnce(response(null, 100001)); await view.state.confirm()
    oldApprove(); expect(view.state.approved.value).toBeNull()
    view.state.approve(); await oldConfirm(); expect(view.fetcher).toHaveBeenCalledOnce()
    await view.state.confirm(); expect(view.fetcher).toHaveBeenCalledTimes(2)
  })
  it.each([120001, 401, 403])('erases denied authority for %s and refreshes auth without a write retry', async code => {
    const view = mount(); approved(view); view.fetcher.mockResolvedValueOnce(response(null, code, code === 120001 ? 200 : code)); await view.state.confirm()
    expect(view.state.targets.value).toBeNull(); expect(view.state.canRestoreFocus()).toBe(false); expect(view.cleared).not.toHaveBeenCalled()
    expect(JSON.stringify(vi.mocked(toast.error).mock.calls)).not.toContain('sensitive-canary')
  })
  for (const phase of ['write', 'reload'] as const) for (const outcome of ['success', 'failure'] as const) {
    it.each(['identity', 'grants', 'status', 'reset', 'unmount'] as const)(`drops late ${phase} ${outcome} and finally after %s`, async retirement => {
      const view = mount(); approved(view)
      const write = createDeferred<Response>(), read = createDeferred<boolean>(); let running: Promise<void>
      if (phase === 'write') { view.fetcher.mockReturnValueOnce(write.promise); running = view.state.confirm() }
      else { view.fetcher.mockRejectedValueOnce(new Error('offline')); await view.state.confirm(); view.reload.mockReturnValueOnce(read.promise); running = view.state.reload() }
      if (retirement === 'identity') { view.client.setQueryData(['auth', 'me'], { user: user(grants, other) }); view.client.setQueryData(['auth', 'me'], { user: user() }) }
      else if (retirement === 'grants') { view.client.setQueryData(['auth', 'me'], { user: user([]) }); view.client.setQueryData(['auth', 'me'], { user: user() }) }
      else if (retirement === 'status') { view.client.getQueryCache().find({ queryKey: ['auth', 'me'], exact: true })!.setState({ status: 'error' }); view.client.setQueryData(['auth', 'me'], { user: user() }) }
      else if (retirement === 'reset') view.state.reset()
      else view.unmount()
      const settleOld = () => {
        if (phase === 'write') { if (outcome === 'success') write.resolve(response()); else write.reject(new Error('sensitive-canary')) }
        else { if (outcome === 'success') read.resolve(true); else read.reject(new Error('sensitive-canary')) }
      }
      if (retirement !== 'unmount') { approved(view); const fresh = createDeferred<Response>(); view.fetcher.mockReturnValueOnce(fresh.promise); const newer = view.state.confirm(); settleOld(); await running; expect(view.state.saving.value).toBe(true); fresh.resolve(response()); await newer }
      else { settleOld(); await running }
      expect(view.cleared.mock.calls).toHaveLength(retirement === 'unmount' ? 0 : 1)
    })
  }
  it('rechecks each success side effect after a synchronous identity change in the first callback', async () => {
    const view = mount(); approved(view)
    const invalidate = vi.spyOn(view.client, 'invalidateQueries')
    view.cleared.mockImplementationOnce(() => view.client.setQueryData(['auth', 'me'], { user: user(grants, other) }))
    await view.state.confirm(); expect(invalidate).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled(); expect(view.state.targets.value).toBeNull()
  })
  it('does not reset a newer opening after the recovery callback synchronously changes the account', async () => {
    const view = mount(); approved(view); view.fetcher.mockRejectedValueOnce(new Error('lost')); await view.state.confirm()
    view.cleared.mockImplementationOnce(() => { view.client.setQueryData(['auth', 'me'], { user: user(grants, other) }); approved(view) })
    await view.state.reload(); expect(view.state.targets.value).not.toBeNull(); expect(view.state.canConfirm.value).toBe(true)
  })
  it.each(['unknown', 'stale'] as const)('marks every derived view stale after a successful %s recovery read', async kind => {
    const view = mount(); approved(view)
    const keys = ['short-link', 'admin-short-link', 'short-link-overview', 'short-link-statistics', 'insights']
    for (const key of keys) view.client.setQueryData([key, 'cached-view'], { old: true })
    if (kind === 'unknown') view.fetcher.mockRejectedValueOnce(new Error('lost reply'))
    else view.fetcher.mockResolvedValueOnce(response(null, 200116))
    await view.state.confirm(); await view.state.reload()
    for (const key of keys) expect(view.client.getQueryState([key, 'cached-view'])?.isInvalidated).toBe(true)
    expect(view.state.targets.value).toBeNull()
  })
  it('stops recovery cache effects when the first invalidation synchronously changes account', async () => {
    const view = mount(); approved(view)
    const keys = ['short-link', 'admin-short-link', 'short-link-overview', 'short-link-statistics', 'insights']
    for (const key of keys) view.client.setQueryData([key, 'cached-view'], { old: true })
    view.fetcher.mockRejectedValueOnce(new Error('lost reply')); await view.state.confirm()
    const stop = view.client.getQueryCache().subscribe(event => {
      if (event.type === 'updated' && event.action.type === 'invalidate' && event.query.queryKey[0] === 'short-link') {
        view.client.setQueryData(['auth', 'me'], { user: user(grants, other) })
      }
    })
    await view.state.reload(); stop()
    expect(view.client.getQueryState(['short-link', 'cached-view'])?.isInvalidated).toBe(true)
    for (const key of keys.slice(1)) expect(view.client.getQueryState([key, 'cached-view'])?.isInvalidated).toBe(false)
    expect(view.state.targets.value).toBeNull()
  })
  it('does not refresh a new account after a synchronous permission-error toast listener switches login', async () => {
    const view = mount(); approved(view); const reset = vi.spyOn(view.client, 'resetQueries')
    view.fetcher.mockResolvedValueOnce(response(null, 120001))
    vi.mocked(toast.error).mockImplementationOnce(() => { view.client.setQueryData(['auth', 'me'], { user: user(grants, other) }); return 1 })
    await view.state.confirm(); expect(reset).not.toHaveBeenCalled(); expect(view.state.targets.value).toBeNull()
  })
  it('erases denied state even when resetting an inactive auth cache does not dispatch an auth event', async () => {
    const view = mount(); approved(view); vi.spyOn(view.client, 'resetQueries').mockResolvedValueOnce()
    view.fetcher.mockResolvedValueOnce(response(null, 120001)); await view.state.confirm()
    expect(view.state.targets.value).toBeNull(); expect(view.state.canRestoreFocus()).toBe(false)
  })
})
