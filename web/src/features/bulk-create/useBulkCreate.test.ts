import { render, waitFor } from '@testing-library/vue'
import { onlineManager, QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { defineComponent, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'vue-sonner'
import { createDeferred } from '@/test/deferred'
import { useBulkCreate } from './useBulkCreate'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const actor = { id: '00000000-0000-0000-0000-000000003881', username: 'bulk-ui', nickname: '', group: 'user', permissions: ['short_link:read_own', 'short_link:create', 'domain:use_default'] }
const clients: QueryClient[] = []
/** Produces one new wire body for each actual response. */
function response(data: unknown, code = 0, status = 200) { return new Response(JSON.stringify({ code, message: 'private detail', data, meta: {} }), { status }) }
/** Mounts the real composition lifecycle, auth cache and API boundary. */
function mount(user: unknown = actor) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client); client.setQueryData(['auth', 'me'], { user })
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith('/auth/me')) return response({ user: actor })
    const body = JSON.parse(init!.body as string) as { requestId: string; targetUrls: string[] }
    return response({ requestId: body.requestId, createdCount: body.targetUrls.length })
  })
  vi.stubGlobal('fetch', fetcher)
  let state!: ReturnType<typeof useBulkCreate>
  const view = render(defineComponent({ setup() { state = useBulkCreate(); return () => null } }), { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } })
  return { ...view, state, client, fetcher, invalidations: vi.spyOn(client, 'invalidateQueries') }
}
/** Captures two real target strings under one new explicit preview. */
function preview(state: ReturnType<typeof useBulkCreate>) {
  state.begin(); state.draft.value = ' https://example.com/one \r\nhttps://example.org/two'; state.preview()
  return state.snapshot.value!
}
afterEach(() => { onlineManager.setOnline(true); clients.splice(0).forEach(client => client.clear()); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks() })

describe('batch lifecycle and retry safety', () => {
  // Default online queuing would leave this attempt pending, then send it on reconnect.
  it.each(['initial', 'retry'])('finishes an offline %s attempt without queuing a write for reconnect', async kind => {
    const { state, fetcher } = mount(); const input = preview(state)
    fetcher.mockRejectedValue(new Error('offline transport'))
    if (kind === 'retry') await state.submit()
    const previous = fetcher.mock.calls.length
    onlineManager.setOnline(false)
    const request = state.submit()
    try {
      await waitFor(() => expect(state.pending.value).toBe(false))
      expect(state.unknown.value).toBe(true); expect(state.snapshot.value).toBe(input)
      expect(fetcher).toHaveBeenCalledTimes(previous + 1)
    } finally { onlineManager.setOnline(true); await request }
    await nextTick()
    expect(fetcher).toHaveBeenCalledTimes(previous + 1)
    fetcher.mockResolvedValueOnce(response({ requestId: input.requestId, createdCount: 2 }))
    await state.submit()
    expect(fetcher).toHaveBeenCalledTimes(previous + 2)
    expect(fetcher.mock.calls.at(-1)![1]!.body).toBe(JSON.stringify(input))
    expect(state.opened.value).toBe(false)
  })
  // A check only before mutateAsync misses the microtask before mutationFn sends.
  it.each(['account', 'revoke and restore', 'auth error and restore', 'unmount'])('does not send after same-tick %s retires the attempt', async transition => {
    const { state, client, fetcher, invalidations, unmount } = mount(); preview(state)
    const request = state.submit()
    if (transition === 'unmount') unmount()
    else if (transition === 'account') client.setQueryData(['auth', 'me'], { user: { ...actor, id: '00000000-0000-0000-0000-000000003882' } })
    else {
      if (transition === 'revoke and restore') client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: [] } })
      else client.getQueryCache().find({ queryKey: ['auth', 'me'], exact: true })!.setState({ status: 'error' })
      client.setQueryData(['auth', 'me'], { user: actor })
    }
    await request
    expect(fetcher).not.toHaveBeenCalled(); expect(invalidations).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled()
  })
  // A fetch without a deadline would never release this real controller's pending state.
  it('recovers a stalled attempt as unknown and retries the unchanged key only on explicit submission', async () => {
    vi.useFakeTimers()
    const { state, fetcher } = mount(); const input = preview(state), stalled = createDeferred<Response>()
    fetcher.mockImplementationOnce((_url, init) => {
      init?.signal?.addEventListener('abort', () => stalled.reject(new DOMException('aborted', 'AbortError')), { once: true })
      return stalled.promise
    })
    const request = state.submit()
    try {
      await vi.advanceTimersByTimeAsync(20_000)
      expect(state.pending.value).toBe(false); expect(state.unknown.value).toBe(true)
      expect(state.errorKey.value).toBe('bulkCreate.unknown'); expect(state.snapshot.value).toBe(input)
    } finally { stalled.resolve(response({ requestId: input.requestId, createdCount: 2 })); await request; vi.useRealTimers() }
    expect(fetcher).toHaveBeenCalledTimes(1)
    await state.submit()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[0]![1]!.body).toBe(fetcher.mock.calls[1]![1]!.body)
    expect(state.opened.value).toBe(false)
  })
  it('keeps immutable previews separate from edits and refreshes only after an acknowledged commit', async () => {
    const { state, fetcher, invalidations } = mount()
    state.preview(); await state.submit(); state.close(); state.discard()
    expect(state.snapshot.value).toBeNull(); expect(fetcher).not.toHaveBeenCalled()
    state.begin(); state.draft.value = 'bad'; state.preview()
    expect(state.errorKey.value).toBe('bulkCreate.invalid')
    state.edit(); expect(state.errorKey.value).toBe('')
    const input = preview(state)
    expect(Object.isFrozen(input)).toBe(true); expect(Object.isFrozen(input.targetUrls)).toBe(true)
    state.draft.value = 'https://example.com/changed'
    expect(input.targetUrls).toEqual(['https://example.com/one', 'https://example.org/two'])
    state.edit(); state.preview()
    expect(state.snapshot.value!.requestId).not.toBe(input.requestId)
    await state.submit()
    expect(state.opened.value).toBe(false); expect(state.pending.value).toBe(false)
    expect(state.draft.value).toBe(''); expect(state.snapshot.value).toBeNull()
    expect(invalidations).toHaveBeenNthCalledWith(1, { queryKey: ['short-link'] })
    expect(invalidations).toHaveBeenNthCalledWith(2, { queryKey: ['short-link-overview'] })
    expect(toast.success).toHaveBeenCalledWith('bulkCreate.success')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each(['network', '500', 'bad-response'])('retries %s only by explicit action, retaining the exact payload and key', async kind => {
    const { state, fetcher } = mount(); const input = preview(state)
    fetcher.mockImplementationOnce(async () => {
      if (kind === 'network') throw new Error('lost response')
      return kind === '500' ? response(null, 0, 500) : response({ requestId: input.requestId, createdCount: 99 })
    })
    await state.submit(); await nextTick()
    expect(state.unknown.value).toBe(true); expect(state.errorKey.value).toBe('bulkCreate.unknown')
    expect(fetcher).toHaveBeenCalledTimes(1); expect(state.pending.value).toBe(false)
    state.edit(); state.preview()
    expect(state.snapshot.value).toBe(input)
    await state.submit()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[0]![1]!.body).toBe(fetcher.mock.calls[1]![1]!.body)
    expect(state.opened.value).toBe(false)
  })
  it('keeps an earlier unknown result even when a later attempt is definitely rejected', async () => {
    const { state, fetcher } = mount(); const input = preview(state)
    fetcher.mockRejectedValueOnce(new Error('lost'))
    await state.submit()
    fetcher.mockResolvedValueOnce(response(null, 200114))
    await state.submit()
    expect(state.unknown.value).toBe(true); expect(state.snapshot.value).toBe(input)
    state.close(); expect(state.opened.value).toBe(true); expect(state.closing.value).toBe(true)
    await state.submit(); expect(fetcher).toHaveBeenCalledTimes(2)
    state.cancelClose(); expect(state.closing.value).toBe(false)
    state.close(); state.discard()
    expect(state.opened.value).toBe(false); expect(state.snapshot.value).toBeNull(); expect(state.draft.value).toBe('')
  })
  it.each([200103, 200120])('preserves editable input after a definite initial refusal %i', async code => {
    const { state, fetcher } = mount(); const input = preview(state)
    fetcher.mockResolvedValueOnce(response(null, code))
    await state.submit()
    expect(state.unknown.value).toBe(false); expect(state.snapshot.value).toBe(input)
    expect(state.errorKey.value).toBe(code === 200120 ? 'bulkCreate.conflict' : 'bulkCreate.failed')
    state.edit(); expect(state.snapshot.value).toBeNull(); expect(state.draft.value).toContain('https://example.com/one')
    state.close(); expect(state.opened.value).toBe(false)
  })
  it.each([120001, 401, 403])('retires a server-denied batch %i and revalidates current authority', async code => {
    const { state, fetcher, client } = mount(); preview(state)
    const reset = vi.spyOn(client, 'resetQueries')
    fetcher.mockResolvedValueOnce(response(null, code === 120001 ? code : 0, code === 120001 ? 200 : code))
    await state.submit()
    expect(state.opened.value).toBe(false); expect(state.draft.value).toBe(''); expect(state.snapshot.value).toBeNull()
    expect(toast.error).toHaveBeenCalledWith('bulkCreate.accessChanged')
    expect(reset).toHaveBeenCalledWith({ queryKey: ['auth', 'me'], exact: true })
  })
  it('blocks duplicate writes, changes and dismissal while pending, and warns on native reload', async () => {
    const { state, fetcher } = mount()
    const idle = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(idle); expect(idle.defaultPrevented).toBe(false)
    const input = preview(state), pending = createDeferred<Response>()
    fetcher.mockReturnValueOnce(pending.promise)
    const request = state.submit()
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    state.begin(); state.edit(); state.preview(); state.close(); state.discard(); await state.submit()
    expect(state.pending.value).toBe(true); expect(state.snapshot.value).toBe(input); expect(fetcher).toHaveBeenCalledTimes(1)
    const unloading = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unloading); expect(unloading.defaultPrevented).toBe(true)
    pending.reject(new Error('unknown')); await request
    const unknown = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unknown); expect(unknown.defaultPrevented).toBe(true)
    state.close(); state.discard()
    const closed = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(closed); expect(closed.defaultPrevented).toBe(false)
  })
  it.each([null, { ...actor, id: '' }, { ...actor, group: 'guest' }, { ...actor, username: 'guest' }, { ...actor, permissions: ['domain:use_default'] }, { ...actor, permissions: ['short_link:create'] }])('rejects unconfirmed or insufficient authority %j', async user => {
    const { state, fetcher } = mount(user)
    expect(state.allowed.value).toBe(false)
    state.begin(); state.preview(); await state.submit()
    expect(state.opened.value).toBe(false); expect(fetcher).not.toHaveBeenCalled()
  })
})

describe.each(['success', 'error'] as const)('late %s identity isolation', outcome => {
  it.each(['other account', 'guest and same account', 'permission and restore', 'auth pending', 'auth error'])('cannot change a newer batch after %s', async transition => {
    const { state, client, fetcher, invalidations } = mount()
    const oldInput = preview(state), oldResponse = createDeferred<Response>()
    fetcher.mockReturnValueOnce(oldResponse.promise)
    const oldRequest = state.submit()
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    if (transition === 'other account') client.setQueryData(['auth', 'me'], { user: { ...actor, id: '00000000-0000-0000-0000-000000003882' } })
    else if (transition === 'guest and same account') {
      client.setQueryData(['auth', 'me'], { user: { ...actor, group: 'guest' } }); client.setQueryData(['auth', 'me'], { user: actor })
    } else if (transition === 'permission and restore') {
      client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: [] } }); client.setQueryData(['auth', 'me'], { user: actor })
    } else {
      client.getQueryCache().find({ queryKey: ['auth', 'me'], exact: true })!.setState({ status: transition === 'auth pending' ? 'pending' : 'error', ...(transition === 'auth pending' ? { data: undefined } : {}) })
      client.setQueryData(['auth', 'me'], { user: actor })
    }
    expect(state.opened.value).toBe(false); expect(state.draft.value).toBe(''); expect(state.snapshot.value).toBeNull()
    const currentInput = preview(state), currentResponse = createDeferred<Response>()
    fetcher.mockReturnValueOnce(currentResponse.promise)
    const currentRequest = state.submit()
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    if (outcome === 'success') oldResponse.resolve(response({ requestId: oldInput.requestId, createdCount: 2 }))
    else oldResponse.reject(new Error('late private failure'))
    await oldRequest
    expect(state.pending.value).toBe(true); expect(state.snapshot.value).toBe(currentInput); expect(state.errorKey.value).toBe('')
    expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled(); expect(invalidations).not.toHaveBeenCalled()
    currentResponse.resolve(response({ requestId: currentInput.requestId, createdCount: 2 })); await currentRequest
    expect(state.opened.value).toBe(false); expect(state.pending.value).toBe(false); expect(toast.success).toHaveBeenCalledTimes(1)
  })
  it('has no feedback, invalidation or late finally mutation after unmount', async () => {
    const { state, fetcher, invalidations, unmount } = mount()
    const input = preview(state), pending = createDeferred<Response>()
    fetcher.mockReturnValueOnce(pending.promise)
    const request = state.submit(); await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1)); unmount()
    if (outcome === 'success') pending.resolve(response({ requestId: input.requestId, createdCount: 2 }))
    else pending.reject(new Error('late private failure'))
    await request
    expect(state.pending.value).toBe(true); expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled(); expect(invalidations).not.toHaveBeenCalled()
    const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(false)
  })
})
