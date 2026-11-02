import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { defineComponent, h, nextTick } from 'vue'
import type { SetupContext } from 'vue'
import { messages } from '@/app/i18n'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import { useShortLinkAccess } from '@/features/short-link-batch/useShortLinkBatch'
import PersonalTagBrowser from './PersonalTagBrowser.vue'

const actor = { id: 'tag-reader', username: 'tag-reader', nickname: '', group: 'user', permissions: ['short_link:read_own'] }
const clients: QueryClient[] = []
/** Builds authentic fresh response bodies for the strict entity contract. */
function response(tags: string[] = ['Original'], hasMore = false) {
  return new Response(JSON.stringify({ code: 0, message: 'OK', data: { items: tags.map(tag => ({ tag, linkCount: 2 })), hasMore }, meta: {} }))
}
/** Uses the actual identity tracker, query client and HTTP entity; only the network is controlled. */
function mount(locale = 'en', user = actor, bufferClicks = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client); client.setQueryData(['auth', 'me'], { user })
  const fetcher = vi.fn<typeof fetch>(async () => response())
  vi.stubGlobal('fetch', fetcher)
  const selected = vi.fn()
  const bufferedNames = new Set<string>()
  const queued: Array<() => void> = []
  // This stub models a public control callback that was already queued before its control disappeared.
  const QueuedButton = { inheritAttrs: false, setup(_props: Record<string, unknown>, { attrs, slots }: SetupContext) {
    return () => h('button', { ...attrs, onClick: (event: MouseEvent) => {
      const dispatch = attrs.onClick as () => void
      if (bufferedNames.has((event.currentTarget as HTMLElement).textContent!.trim())) queued.push(dispatch)
      else dispatch()
    } }, slots.default?.())
  } }
  const Harness = defineComponent({ setup() { const access = useShortLinkAccess('own'); return () => h(PersonalTagBrowser, { access, onSelect: selected }) } })
  return { ...render(Harness, { global: { plugins: [[VueQueryPlugin, { queryClient: client }], createI18n({ legacy: false, locale, messages })], stubs: { ...componentStubs, ...(bufferClicks ? { VBtn: QueuedButton } : {}) } } }), client, fetcher, selected, bufferedNames, queued }
}
/** Waits for the visible, selectable result rather than assuming that promise resolution has rendered. */
async function open() { await fireEvent.click(screen.getByRole('button', { name: 'My tags' })); return screen.findByRole('button', { name: 'Original · 2' }) }
/** Settles the documented search debounce deterministically without real-time sleeps. */
async function typeSearch(value: string) {
  vi.useFakeTimers()
  await fireEvent.update(screen.getByLabelText('Find my tags'), value)
  await vi.advanceTimersByTimeAsync(250)
  vi.useRealTimers()
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.useRealTimers() })

describe('personal tag browser privacy and lifecycle', () => {
  it.each(['en', 'zh-CN'])('starts collapsed and renders literal keyboard buttons in %s', async locale => {
    const view = mount(locale)
    const title = locale === 'en' ? 'My tags' : '我的标签'
    view.fetcher.mockImplementation(async () => response(['<b>Literal</b>', '😀'.repeat(32)]))
    const toggle = screen.getByRole('button', { name: title })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(view.fetcher).not.toHaveBeenCalled()
    await fireEvent.click(toggle)
    const button = await screen.findByRole('button', { name: '<b>Literal</b> · 2' })
    expect(button.querySelector('b')).toBeNull()
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(document.getElementById(toggle.getAttribute('aria-controls')!)).toBeTruthy()
    await fireEvent.click(button)
    expect(view.selected).toHaveBeenCalledWith('<b>Literal</b>')
    await fireEvent.click(toggle)
    expect(screen.queryByRole('button', { name: '<b>Literal</b> · 2' })).toBeNull()
  })
  it('explains empty, no matches and the first 50 results without changing list filters', async () => {
    const view = mount()
    view.fetcher.mockImplementation(async () => response([]))
    await fireEvent.click(screen.getByRole('button', { name: 'My tags' }))
    await screen.findByText('Your links have no tags yet.')
    await typeSearch('missing')
    await screen.findByText('No matching tags.')
    const tags = Array.from({ length: 50 }, (_, i) => 'tag'+i)
    view.fetcher.mockImplementation(async () => response(tags, true))
    await typeSearch('tag')
    await screen.findByRole('button', { name: 'tag49 · 2' })
    expect(screen.getByText(/Showing the first 50 matches/)).toBeTruthy()
    expect(view.selected).not.toHaveBeenCalled()
  })
  it('debounces literal search, hides old results immediately and blocks raw invalid drafts', async () => {
    const view = mount(); await open()
    vi.useFakeTimers()
    await fireEvent.update(screen.getByLabelText('Find my tags'), ' %_\\文 ')
    expect(screen.queryByRole('button', { name: 'Original · 2' })).toBeNull()
    await vi.advanceTimersByTimeAsync(249)
    expect(view.fetcher).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1); vi.useRealTimers()
    await waitFor(() => expect(view.fetcher).toHaveBeenCalledTimes(2))
    expect(new URL(String(view.fetcher.mock.calls[1]?.[0]), 'http://localhost').searchParams.get('q')).toBe('%_\\文')
    await screen.findByRole('button', { name: 'Original · 2' })
    for (const invalid of ['bad\u0000', '😀'.repeat(33), '\ud800']) {
      await typeSearch(invalid)
      expect(screen.getAllByText('Use at most 32 characters without control characters.').length).toBeGreaterThan(0)
      expect(screen.queryByRole('button', { name: 'Original · 2' })).toBeNull()
      expect(view.fetcher).toHaveBeenCalledTimes(2)
    }
    await typeSearch('😀'.repeat(32))
    await screen.findByRole('button', { name: 'Original · 2' })
    expect(view.fetcher).toHaveBeenCalledTimes(3)
    // Cancel the pending debounce when a further draft is superseded by unmounting.
    await fireEvent.update(screen.getByLabelText('Find my tags'), 'retired')
    view.unmount()
    vi.useFakeTimers(); await vi.runAllTimersAsync(); vi.useRealTimers()
    expect(view.fetcher).toHaveBeenCalledTimes(3)
  })
  it('ignores older search success and failure after a newer search begins', async () => {
    const view = mount(); await open()
    const old = createDeferred<Response>(), current = createDeferred<Response>()
    view.fetcher.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    await typeSearch('old'); await typeSearch('new')
    old.resolve(response(['Old private']))
    await old.promise; await nextTick()
    expect(screen.queryByRole('button', { name: 'Old private · 2' })).toBeNull()
    current.resolve(response(['Current']))
    await screen.findByRole('button', { name: 'Current · 2' })
    const staleFailure = createDeferred<Response>()
    view.fetcher.mockReturnValueOnce(staleFailure.promise).mockImplementation(async () => response(['Newest']))
    await typeSearch('older'); await typeSearch('newest')
    await screen.findByRole('button', { name: 'Newest · 2' })
    staleFailure.reject(new Error('private error'))
    await nextTick()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByRole('button', { name: 'Newest · 2' })).toBeTruthy()
  })
  it('rereads every opening and never revives an earlier pending read', async () => {
    const view = mount(), old = createDeferred<Response>()
    view.fetcher.mockReturnValueOnce(old.promise)
    await fireEvent.click(screen.getByRole('button', { name: 'My tags' }))
    await waitFor(() => expect(view.fetcher).toHaveBeenCalledTimes(1))
    await fireEvent.click(screen.getByRole('button', { name: 'My tags' }))
    view.fetcher.mockImplementation(async () => response(['Reopened']))
    await fireEvent.click(screen.getByRole('button', { name: 'My tags' }))
    await screen.findByRole('button', { name: 'Reopened · 2' })
    old.resolve(response(['Old opening'])); await old.promise; await nextTick()
    expect(screen.queryByRole('button', { name: 'Old opening · 2' })).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: 'My tags' }))
    await fireEvent.click(screen.getByRole('button', { name: 'My tags' }))
    await screen.findByRole('button', { name: 'Reopened · 2' })
    expect(view.fetcher).toHaveBeenCalledTimes(3)
  })
  it('clears A to B to A in the same tick, retaining neither the draft nor late A results', async () => {
    const view = mount(), old = createDeferred<Response>()
    view.fetcher.mockReturnValueOnce(old.promise)
    await fireEvent.click(screen.getByRole('button', { name: 'My tags' }))
    await waitFor(() => expect(view.fetcher).toHaveBeenCalledTimes(1))
    await fireEvent.update(screen.getByLabelText('Find my tags'), 'private draft')
    view.client.setQueryData(['auth', 'me'], { user: { ...actor, id: 'B', username: 'B' } })
    view.client.setQueryData(['auth', 'me'], { user: actor })
    await nextTick()
    expect(screen.queryByLabelText('Find my tags')).toBeNull()
    view.fetcher.mockImplementation(async () => response(['Fresh A']))
    await fireEvent.click(screen.getByRole('button', { name: 'My tags' }))
    expect((screen.getByLabelText('Find my tags') as HTMLInputElement).value).toBe('')
    await screen.findByRole('button', { name: 'Fresh A · 2' })
    old.resolve(response(['Old A'])); await old.promise; await nextTick()
    expect(screen.queryByRole('button', { name: 'Old A · 2' })).toBeNull()
  })
  it('retires same-account revoke and restore synchronously, rejecting a queued old selection or toggle', async () => {
    const view = mount(), oldButton = await open(), oldToggle = screen.getByRole('button', { name: 'My tags' })
    view.client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: [] } })
    await fireEvent.click(oldToggle)
    view.client.setQueryData(['auth', 'me'], { user: actor })
    await fireEvent.click(oldButton)
    expect(view.selected).not.toHaveBeenCalled()
    expect(screen.queryByLabelText('Find my tags')).toBeNull()
    view.fetcher.mockImplementation(async () => response(['Restored']))
    await fireEvent.click(screen.getByRole('button', { name: 'My tags' }))
    await screen.findByRole('button', { name: 'Restored · 2' })
    expect(screen.queryByRole('button', { name: 'Original · 2' })).toBeNull()
  })
  it('consumes family invalidation, suppresses cached results on error and retries only the current search', async () => {
    const view = mount(), oldButton = await open(), refresh = createDeferred<Response>()
    view.fetcher.mockReturnValueOnce(refresh.promise)
    const invalidated = view.client.invalidateQueries({ queryKey: ['short-link'] })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Original · 2' })).toBeNull())
    await fireEvent.click(oldButton)
    expect(view.selected).not.toHaveBeenCalled()
    refresh.reject(new Error('private-storage-error')); await invalidated
    expect((await screen.findByRole('alert')).textContent).not.toContain('private-storage-error')
    const retryButton = screen.getByRole('button', { name: 'Retry loading tags' })
    view.fetcher.mockImplementation(async () => response(['Recovered']))
    await fireEvent.click(retryButton)
    await screen.findByRole('button', { name: 'Recovered · 2' })
    await fireEvent.click(screen.getByRole('button', { name: 'My tags' }))
    await fireEvent.click(retryButton)
    expect(view.fetcher).toHaveBeenCalledTimes(3)
  })
  it('hides admin without read-own and guests, and clears successful data on guest transition', async () => {
    const denied = mount('en', { ...actor, group: 'admin', permissions: ['admin:access', 'short_link:read_all'] })
    expect(screen.queryByRole('button', { name: 'My tags' })).toBeNull()
    expect(denied.fetcher).not.toHaveBeenCalled(); denied.unmount()
    const view = mount(); await open()
    view.client.setQueryData(['auth', 'me'], { user: { ...actor, username: 'guest', group: 'guest', permissions: [] } })
    await nextTick()
    expect(screen.queryByRole('button', { name: 'Original · 2' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'My tags' })).toBeNull()
  })
  it('does not repopulate after unmount while a request is pending', async () => {
    const view = mount(), pending = createDeferred<Response>()
    view.fetcher.mockReturnValueOnce(pending.promise)
    await fireEvent.click(screen.getByRole('button', { name: 'My tags' }))
    await waitFor(() => expect(view.fetcher).toHaveBeenCalledTimes(1))
    view.unmount(); pending.resolve(response(['Unmounted secret'])); await pending.promise; await nextTick()
    expect(screen.queryByText(/Unmounted secret/)).toBeNull()
    expect(view.selected).not.toHaveBeenCalled()
  })
  it('rejects buffered result and retry callbacks after the visible search has changed', async () => {
    const view = mount('en', actor, true), button = await open()
    view.bufferedNames.add('Original · 2')
    await fireEvent.click(button)
    await fireEvent.update(screen.getByLabelText('Find my tags'), 'new draft')
    view.queued.shift()!()
    expect(view.selected).not.toHaveBeenCalled()
    view.fetcher.mockImplementation(async () => { throw new Error('offline') })
    await typeSearch('fail')
    await screen.findByRole('alert')
    view.bufferedNames.add('Retry loading tags')
    await fireEvent.click(screen.getByRole('button', { name: 'Retry loading tags' }))
    await fireEvent.update(screen.getByLabelText('Find my tags'), 'bad\u0000')
    const reads = view.fetcher.mock.calls.length
    view.queued.shift()!()
    expect(view.fetcher).toHaveBeenCalledTimes(reads)
    expect(screen.queryByRole('button', { name: 'Original · 2' })).toBeNull()
  })
})
