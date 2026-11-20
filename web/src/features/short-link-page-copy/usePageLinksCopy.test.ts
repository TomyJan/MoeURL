import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { computed, defineComponent, h, nextTick, ref } from 'vue'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'vue-sonner'
import { messages } from '@/app/i18n'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import { revokeAccountIdentity } from '@/shared/preferences/useAccountPreferences'
import { useShortLinkAccess } from '@/features/short-link-batch/useShortLinkBatch'
import type { CurrentUser } from '@/entities/auth/api'
import { usePageLinksCopy } from './usePageLinksCopy'
import ShortLinkPageCopyButton from './ShortLinkPageCopyButton.vue'

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const clients: QueryClient[] = []
const ownKey = ['short-link', 'A', 1] as const
/** Gives the real authorization helper a complete confirmed identity, without export or write grants. */
function user(permissions = ['short_link:read_own'], id = 'A'): CurrentUser {
  return { id, username: id, nickname: '', group: 'user', permissions }
}
/** Runs real cache/lifecycle logic; the Clipboard API is the sole side-effect substitute. */
function mount(options: { context?: 'own' | 'admin'; user?: CurrentUser; count?: number; locale?: string; selection?: string[]; selectionItems?: { id: string; url: string; targetUrl: string }[]; pair?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  clients.push(client)
  client.setQueryData(['auth', 'me'], { user: options.user ?? user() })
  const key = ref<readonly unknown[]>(ownKey), blocked = ref(false), context = ref(['page1'])
  const items = Array.from({ length: options.count ?? 2 }, (_, index) => ({ id: String(index + 1), url: `https://sho.rt/${index + 1}`, targetUrl: `https://private.test/${index}` }))
  client.setQueryData(ownKey, { items })
  let clipboard = ''
  const writeText = vi.fn(async (text: string) => { clipboard = text })
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
  let state!: ReturnType<typeof usePageLinksCopy>
  let other!: ReturnType<typeof usePageLinksCopy>
  const selection = ref(options.selection ?? []), lock = ref<symbol | null>(null)
  const selectionItems = computed(() => options.selectionItems ?? items.filter(item => selection.value.includes(item.id)))
  const host = defineComponent({ setup() {
    const access = useShortLinkAccess(options.context ?? 'own')
    state = usePageLinksCopy({ access, queryKey: key, blocked, context, ...(options.selection ? { selection, selectionItems } : {}), ...(options.pair ? { lock } : {}) })
    if (options.pair) other = usePageLinksCopy({ access, queryKey: key, blocked, context, lock })
    return () => h(ShortLinkPageCopyButton, { state, ...(options.selection ? { mode: 'selected' as const } : {}) })
  } })
  const view = render(host, { global: { plugins: [[VueQueryPlugin, { queryClient: client }], createI18n({ legacy: false, locale: options.locale ?? 'en', messages })], stubs: componentStubs } })
  return { ...view, client, key, blocked, context, state, other, selection, lock, items, writeText, readClipboard: () => clipboard }
}
beforeEach(() => vi.clearAllMocks())
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); Reflect.deleteProperty(navigator, 'clipboard') })

describe('current-page clipboard lifecycle', () => {
  // Copying a destination, sorting the rows or appending a newline breaks this literal payload.
  it('writes ordered public URLs synchronously in the user click and reports the copied count', async () => {
    const view = mount()
    const button = screen.getByRole('button', { name: 'Copy links on this page' })
    button.click()
    expect(view.readClipboard()).toBe('https://sho.rt/1\nhttps://sho.rt/2')
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Copied 2 links from this page'))
    expect(view.client.getQueryCache().getAll()).toHaveLength(2)
  })
  it.each([1, 100])('copies the complete valid page of %i rows', async count => {
    const view = mount({ count })
    await view.state.copy()
    const lines = view.readClipboard().split('\n')
    expect(lines).toHaveLength(count)
    expect(lines[0]).toBe('https://sho.rt/1')
    expect(lines.at(-1)).toBe(`https://sho.rt/${count}`)
    expect(view.readClipboard().endsWith('\n')).toBe(false)
  })
  it('copies cross-page selected snapshots in selection order without exposing destinations', async () => {
    const view = mount({ selection: ['page-two', 'page-one'], selectionItems: [
      { id: 'page-one', url: 'https://sho.rt/one', targetUrl: 'https://private.one' },
      { id: 'page-two', url: 'https://sho.rt/two', targetUrl: 'https://private.two' },
    ] })
    await view.state.copy()
    expect(view.readClipboard()).toBe('https://sho.rt/two\nhttps://sho.rt/one')
    expect(view.readClipboard()).not.toContain('private.')
  })
  it.each([0, 101])('rejects the entire out-of-range page of %i rows', async count => {
    const view = mount({ count })
    expect((screen.getByRole('button', { name: 'Copy links on this page' }) as HTMLButtonElement).disabled).toBe(true)
    await view.state.copy()
    expect(view.readClipboard()).toBe('')
    expect(toast.success).not.toHaveBeenCalled()
  })
  it.each([
    ['own', user([])], ['own', { ...user(), group: 'guest' }], ['own', { ...user(), username: 'guest' }], ['own', user(['short_link:export'])],
    ['admin', user(['short_link:read_all'])], ['admin', user(['admin:access'])], ['own', user(['short_link:read_own'], '')],
  ] as const)('hides the action without live read authority %#', async (context, actor) => {
    const view = mount({ context, user: actor })
    expect(screen.queryByRole('button')).toBeNull()
    await view.state.copy()
    expect(view.readClipboard()).toBe('')
  })
  it('permits an administrator with read grants but no export or update permissions', async () => {
    const view = mount({ context: 'admin', user: user(['admin:access', 'short_link:read_all']) })
    await fireEvent.click(screen.getByRole('button', { name: 'Copy links on this page' }))
    expect(view.readClipboard()).toBe('https://sho.rt/1\nhttps://sho.rt/2')
  })
  it.each(['blocked', 'missing', 'invalidated', 'fetching', 'error', 'removed', 'invalid-url', 'invalid-scheme'] as const)('rechecks synchronous %s state before a queued click', async stage => {
    const view = mount()
    if (stage === 'blocked') view.blocked.value = true
    if (stage === 'missing') view.key.value = ['short-link', 'unread']
    if (stage === 'invalidated') void view.client.invalidateQueries({ queryKey: ownKey })
    if (stage === 'fetching') view.client.getQueryCache().find({ queryKey: ownKey })!.setState({ fetchStatus: 'fetching' })
    if (stage === 'error') view.client.getQueryCache().find({ queryKey: ownKey })!.setState({ status: 'error', error: new Error('private') })
    if (stage === 'removed') view.client.removeQueries({ queryKey: ownKey })
    if (stage === 'invalid-url') view.client.setQueryData(ownKey, { items: [{ url: 'https://sho.rt/1\nhttps://private.test/2' }] })
    if (stage === 'invalid-scheme') view.client.setQueryData(ownKey, { items: [{ url: 'ftp://sho.rt/1' }] })
    await view.state.copy()
    expect(view.readClipboard()).toBe('')
    await nextTick()
    expect((screen.getByRole('button', { name: 'Copy links on this page' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it.each(['unsupported', 'sync-throw', 'reject'] as const)('reports a friendly %s failure without disclosing errors or retrying', async stage => {
    const view = mount({ locale: 'zh-CN' })
    if (stage === 'unsupported') Reflect.deleteProperty(navigator, 'clipboard')
    if (stage === 'sync-throw') view.writeText.mockImplementation(() => { throw new Error('private') })
    if (stage === 'reject') view.writeText.mockRejectedValue(new Error('private'))
    await view.state.copy()
    expect(toast.error).toHaveBeenCalledExactlyOnceWith('复制失败，请检查浏览器剪贴板权限后重试。')
    expect(view.state.pending.value).toBe(false)
    expect(toast.success).not.toHaveBeenCalled()
    expect(view.writeText.mock.calls.length).toBe(stage === 'unsupported' ? 0 : 1)
  })
  it('does not send a second write while the first attempt is outstanding', async () => {
    const view = mount(), write = createDeferred<void>()
    view.writeText.mockReturnValue(write.promise)
    const first = view.state.copy()
    await view.state.copy()
    expect(view.writeText).toHaveBeenCalledTimes(1)
    expect(view.state.pending.value).toBe(true)
    write.resolve(); await first
    expect(view.state.pending.value).toBe(false)
  })
  // Removing any generation boundary revives old feedback when a context returns in the same tick.
  it.each(['blocked', 'filter-roundtrip', 'page-roundtrip', 'permission-roundtrip', 'invalidation-roundtrip', 'identity-roundtrip', 'unmount'] as const)('retires both late outcomes after %s', async transition => {
    for (const failure of [false, true]) {
      const view = mount(), write = createDeferred<void>()
      view.writeText.mockReturnValueOnce(write.promise)
      const pending = view.state.copy()
      if (transition === 'blocked') { view.blocked.value = true; view.blocked.value = false }
      if (transition === 'filter-roundtrip') { view.context.value = ['secret']; view.context.value = ['page1'] }
      if (transition === 'page-roundtrip') { view.key.value = ['short-link', 'A', 2]; view.key.value = ownKey }
      if (transition === 'permission-roundtrip') { view.client.setQueryData(['auth', 'me'], { user: user([]) }); view.client.setQueryData(['auth', 'me'], { user: user() }) }
      if (transition === 'invalidation-roundtrip') { void view.client.invalidateQueries({ queryKey: ownKey }); view.client.setQueryData(ownKey, { items: view.items }) }
      if (transition === 'identity-roundtrip') { void revokeAccountIdentity(view.client); view.client.setQueryData(['auth', 'me'], { user: user() }) }
      if (transition === 'unmount') view.unmount()
      if (failure) write.reject(new Error('private'))
      else write.resolve()
      await pending
      expect(toast.success).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
      cleanup(); vi.clearAllMocks()
    }
  })
  it('keeps a newer write pending when an old retired finally completes', async () => {
    const view = mount(), old = createDeferred<void>(), current = createDeferred<void>()
    view.writeText.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const first = view.state.copy()
    view.context.value = ['changed']
    const second = view.state.copy()
    old.resolve(); await first
    expect(view.state.pending.value).toBe(true)
    expect(toast.success).not.toHaveBeenCalled()
    current.resolve(); await second
    expect(view.state.pending.value).toBe(false)
    expect(toast.success).toHaveBeenCalledOnce()
  })
})

describe('selected public URLs and shared copy ownership', () => {
  // Ignoring the selected IDs or using click order copies a wrong literal payload.
  it('copies selected rows in page order synchronously and reports selected count', async () => {
    const view = mount({ count: 3, selection: ['3', '1'] })
    screen.getByRole('button', { name: 'Copy selected links' }).click()
    expect(view.readClipboard()).toBe('https://sho.rt/1\nhttps://sho.rt/3')
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Copied 2 selected links'))
  })
  it.each([1, 100])('copies the valid selection of %i without a trailing newline', async count => {
    const view = mount({ count, selection: Array.from({ length: count }, (_, i) => String(i + 1)) })
    await view.state.copy()
    expect(view.readClipboard().split('\n')).toHaveLength(count)
    expect(view.readClipboard().split('\n').at(-1)).toBe(`https://sho.rt/${count}`)
    expect(view.readClipboard().endsWith('\n')).toBe(false)
  })
  it.each([[], ['missing'], ['1', 'missing'], ['1', '1'], [''], Array.from({ length: 101 }, (_, i) => String(i + 1))].map(selection => ({ selection })))('rejects the entire invalid selection %#', async ({ selection }) => {
    const view = mount({ selection })
    await view.state.copy()
    expect(view.readClipboard()).toBe('')
    expect(view.state.disabled.value).toBe(true)
    expect(toast.success).not.toHaveBeenCalled()
  })
  it.each(['missing-id', 'duplicate-id', 'bad-selected-url', 'empty-page', 'oversize-page'] as const)('rejects ambiguous or invalid selected page %s', async stage => {
    const view = mount({ selection: ['1'] })
    const items = stage === 'missing-id' ? [{ url: 'https://sho.rt/1' }]
      : stage === 'duplicate-id' ? [view.items[0], view.items[0]]
        : stage === 'bad-selected-url' ? [{ ...view.items[0], url: 'https://sho.rt/1\nprivate' }]
          : stage === 'empty-page' ? [] : Array.from({ length: 101 }, (_, i) => ({ id: String(i + 1), url: `https://sho.rt/${i}` }))
    view.client.setQueryData(ownKey, { items })
    await view.state.copy()
    expect(view.readClipboard()).toBe('')
    expect(view.state.disabled.value).toBe(true)
  })
  it('ignores an unselected invalid URL and copies only the selected address', async () => {
    const view = mount({ selection: ['1'] })
    view.client.setQueryData(ownKey, { items: [view.items[0], { ...view.items[1], url: 'private\ninvalid' }] })
    await view.state.copy()
    expect(view.readClipboard()).toBe('https://sho.rt/1')
  })
  // A selection change that returns to its original value must still retire the old callbacks.
  it.each([false, true])('retires selection roundtrips and preserves newer pending, failure=%s', async failure => {
    const view = mount({ selection: ['1'] }), old = createDeferred<void>(), current = createDeferred<void>()
    view.writeText.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const first = view.state.copy()
    view.selection.value.push('2'); view.selection.value.pop()
    const second = view.state.copy()
    expect(view.writeText.mock.calls).toEqual([['https://sho.rt/1'], ['https://sho.rt/1']])
    if (failure) old.reject(new Error('private')); else old.resolve()
    await first
    expect(view.state.pending.value).toBe(true)
    expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled()
    current.resolve(); await second
    expect(view.state.pending.value).toBe(false)
    expect(toast.success).toHaveBeenCalledExactlyOnceWith('Copied 1 selected link')
  })
  // Sharing a boolean pending or releasing a foreign lock would let a third write overlap.
  it.each([false, true])('keeps the other owner locked when a retired write settles, failure=%s', async failure => {
    const view = mount({ selection: ['1'], pair: true }), old = createDeferred<void>(), current = createDeferred<void>()
    view.writeText.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const first = view.state.copy()
    expect(view.other.disabled.value).toBe(true)
    await view.other.copy()
    expect(view.writeText).toHaveBeenCalledTimes(1)
    view.selection.value = ['2']
    expect(view.other.disabled.value).toBe(false)
    const second = view.other.copy(), owner = view.lock.value
    expect(view.state.disabled.value).toBe(true)
    view.selection.value = ['1'] // Retiring the first instance must not release the other's lock.
    expect(view.lock.value).toBe(owner)
    if (failure) old.reject(new Error('private')); else old.resolve()
    await first
    expect(view.other.pending.value).toBe(true)
    expect(view.lock.value).toBe(owner)
    await view.state.copy()
    expect(view.writeText).toHaveBeenCalledTimes(2)
    expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled()
    current.resolve(); await second
    expect(view.lock.value).toBeNull()
    expect(view.state.disabled.value).toBe(false)
    expect(toast.success).toHaveBeenCalledExactlyOnceWith('Copied 2 links from this page')
  })
  it('blocks selected copies while the page owner is writing and releases on unmount', async () => {
    const view = mount({ selection: ['2'], pair: true }), write = createDeferred<void>()
    view.writeText.mockReturnValue(write.promise)
    const first = view.other.copy()
    const blocked = view.state.copy()
    expect(view.writeText.mock.calls).toEqual([['https://sho.rt/1\nhttps://sho.rt/2']])
    view.unmount()
    expect(view.lock.value).toBeNull()
    write.resolve(); await first; await blocked
    expect(toast.success).not.toHaveBeenCalled()
  })
})
