/* eslint-disable vue/one-component-per-file -- Parent and child harnesses exercise same-tick prop delivery. */
import { cleanup, render, waitFor } from '@testing-library/vue'
import { computed, defineComponent, h, nextTick, ref } from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'vue-sonner'
import { me, type CurrentUser } from '@/entities/auth/api'
import { batchShortLinks } from '@/entities/short-link/batch'
import { revokeAccountIdentity } from '@/shared/preferences/useAccountPreferences'
import { createDeferred } from '@/test/deferred'
import { useShortLinkAccess, useShortLinkBatch } from './useShortLinkBatch'

vi.mock('@/entities/auth/api', () => ({ me: vi.fn() }))
vi.mock('@/entities/short-link/batch', () => ({ batchShortLinks: vi.fn() }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const clients: QueryClient[] = []
const permissions = ['short_link:read_own', 'short_link:update_own', 'short_link:delete_own', 'admin:access', 'short_link:read_all', 'short_link:update_all', 'short_link:delete_all']
/** Builds a confirmed account with explicit capabilities. */
function user(grants = permissions, id = 'A'): CurrentUser { return { id, username: id, nickname: '', group: 'user', permissions: grants } }
/** Mounts the actual state machine with reactive page inputs and a real shared auth cache. */
function mount(context: 'own' | 'admin' = 'own', account: CurrentUser | null = user(), existingClient?: QueryClient) {
  const client = existingClient ?? new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  clients.push(client)
  if (account) client.setQueryData(['auth', 'me'], { user: account })
  const ids = ref(['one', 'two'])
  const blocked = ref(false)
  const filter = ref('')
  let batch!: ReturnType<typeof useShortLinkBatch>
  let access!: ReturnType<typeof useShortLinkAccess>
  const view = render(defineComponent({ setup() {
    access = useShortLinkAccess(context)
    batch = useShortLinkBatch({ context, access, ids: computed(() => ids.value), blocked, filters: computed(() => filter.value) })
    return () => null
  } }), { global: { plugins: [[VueQueryPlugin, { queryClient: client }], createI18n({ legacy: false, locale: 'test', messages: {}, missingWarn: false })] } })
  return { ...view, client, ids, blocked, filter, batch, access }
}
beforeEach(() => { vi.clearAllMocks(); vi.mocked(batchShortLinks).mockReset().mockResolvedValue({ affectedCount: 1 }); vi.mocked(me).mockResolvedValue({ user: user() }) })
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()) })
describe('batch selection and atomic submission', () => {
  it.each(['filter', 'unmount'] as const)('invalidates cached lists and overview after a late success following %s without changing current selection or feedback', async transition => {
    const first = mount()
    const keys = [['short-link', 'list', 'A', 1], ['short-link', 'overview'], ['admin-short-link', 'list', 'A', 1]]
    for (const key of keys) first.client.setQueryData(key, { items: ['one', 'two'] })
    const request = createDeferred<{ affectedCount: number }>()
    vi.mocked(batchShortLinks).mockReturnValueOnce(request.promise)
    first.batch.toggle('one', true)
    const writing = first.batch.submit('disable')
    let current = first
    if (transition === 'filter') first.filter.value = 'B'
    else {
      first.unmount()
      current = mount('admin', user(), first.client)
      current.batch.toggle('two', true)
    }
    const selection = [...current.batch.selected.value]
    request.resolve({ affectedCount: 1 })
    await writing
    expect(keys.map(key => first.client.getQueryState(key)?.isInvalidated)).toEqual([true, true, true])
    expect(current.batch.selected.value).toEqual(selection)
    expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled()
    expect(batchShortLinks).toHaveBeenCalledOnce()
  })
  it('does not invalidate successful cached reads after a failed batch or retry the write automatically', async () => {
    const view = mount()
    view.client.setQueryData(['short-link', 'overview'], { total: 2 })
    vi.mocked(batchShortLinks).mockRejectedValueOnce(new Error('private'))
    view.batch.toggle('one', true)
    await view.batch.submit('disable')
    expect(view.client.getQueryState(['short-link', 'overview'])?.isInvalidated).toBe(false)
    expect(view.batch.selected.value).toEqual(['one'])
    expect(batchShortLinks).toHaveBeenCalledOnce()
  })
  it('does not alter a new page selection when an unmounted page request settles', async () => {
    const first = mount()
    const request = createDeferred<{ affectedCount: number }>()
    vi.mocked(batchShortLinks).mockReturnValue(request.promise)
    first.batch.toggle('one', true)
    const writing = first.batch.submit('enable')
    first.unmount()
    const second = mount('admin', user(), first.client)
    expect(first.batch.pending.value).toBe(true)
    expect(second.batch.pending.value).toBe(false)
    second.batch.toggle('two', true)
    expect(batchShortLinks).toHaveBeenCalledOnce()
    request.resolve({ affectedCount: 1 }); await writing
    expect(second.batch.pending.value).toBe(false)
    expect(second.batch.selected.value).toEqual(['two'])
    expect(toast.success).not.toHaveBeenCalled()
  })
  it.each([false, true])('ignores a settled result when raw filters synchronously change A → B → A (failure %s)', async fail => {
    const view = mount()
    const request = createDeferred<{ affectedCount: number }>()
    vi.mocked(batchShortLinks).mockReturnValue(request.promise)
    view.batch.toggle('one', true)
    const writing = view.batch.submit('disable')
    if (fail) request.reject(new Error('private')); else request.resolve({ affectedCount: 1 })
    view.filter.value = 'B'; view.filter.value = ''
    await writing
    expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled()
    expect(view.batch.selected.value).toEqual([])
  })
  it.each([false, true])('waits for parent props before handling a result settled in the same tick (failure %s)', async fail => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    clients.push(client)
    client.setQueryData(['auth', 'me'], { user: user() })
    const filter = ref('A')
    const request = createDeferred<{ affectedCount: number }>()
    vi.mocked(batchShortLinks).mockReturnValue(request.promise)
    let batch!: ReturnType<typeof useShortLinkBatch>
    const child = defineComponent({ props: { filter: { type: String, required: true } }, setup(props) {
      batch = useShortLinkBatch({ context: 'own', access: useShortLinkAccess('own'), ids: ref(['one']), blocked: ref(false), filters: computed(() => props.filter) })
      return () => null
    } })
    render(defineComponent({ setup: () => () => h(child, { filter: filter.value }) }), { global: { plugins: [[VueQueryPlugin, { queryClient: client }], createI18n({ legacy: false, locale: 'test', messages: {}, missingWarn: false })] } })
    batch.toggle('one', true)
    const writing = batch.submit('enable')
    if (fail) request.reject(new Error('private')); else request.resolve({ affectedCount: 1 })
    filter.value = 'B'
    await writing
    expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled()
  })
  it.each(['own', 'admin'] as const)('submits only current selections and invalidates both lists and overview in %s', async context => {
    const { batch, client } = mount(context)
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    batch.toggle('one', true)
    await batch.submit('disable')
    expect(batchShortLinks).toHaveBeenCalledExactlyOnceWith({ ids: ['one'], action: 'disable' }, context)
    expect(batch.selected.value).toEqual([])
    expect(invalidate.mock.calls.map(call => call[0])).toEqual([{ queryKey: ['short-link'] }, { queryKey: ['admin-short-link'] }])
    expect(toast.success).toHaveBeenCalledWith('batch.success')
  })
  it('enforces distinct current IDs, select-all state, and the 100 selection cap', () => {
    const { batch, ids } = mount()
    batch.toggle('missing', true)
    expect(batch.selected.value).toEqual([])
    batch.toggle('one', true); batch.toggle('one', true)
    expect(batch.selected.value).toEqual(['one'])
    expect(batch.indeterminate.value).toBe(true)
    batch.toggleAll(true)
    expect(batch.allSelected.value).toBe(true)
    batch.toggleAll(false)
    expect(batch.selected.value).toEqual([])
    ids.value = Array.from({ length: 101 }, (_, i) => String(i))
    batch.toggleAll(true)
    expect(batch.selected.value).toHaveLength(100)
    batch.toggle('100', true)
    expect(batch.selected.value).toHaveLength(100)
    batch.toggle('0', false); batch.toggle('100', true)
    expect(batch.selected.value).toHaveLength(100)
  })
  it('prunes refreshed records and clears the frozen dialog on raw filter changes', () => {
    const { batch, ids, filter } = mount()
    batch.toggleAll(true); batch.openDelete()
    ids.value = ['two']
    expect(batch.selected.value).toEqual(['two'])
    expect(batch.deleteIds.value).toEqual(['one', 'two'])
    filter.value = 'new'
    expect(batch.selected.value).toEqual([])
    expect(batch.deleteIds.value).toBeNull()
  })
  it('pins delete targets at opening and preserves the current selection after failure for manual retry', async () => {
    const { batch } = mount()
    vi.mocked(batchShortLinks).mockRejectedValueOnce(new Error('private'))
    batch.toggle('one', true); batch.openDelete()
    batch.toggle('one', false); batch.toggle('two', true)
    await batch.confirmDelete()
    expect(batchShortLinks).toHaveBeenCalledExactlyOnceWith({ ids: ['one'], action: 'delete' }, 'own')
    expect(batch.selected.value).toEqual(['two'])
    expect(batch.deleteIds.value).toEqual(['one'])
    expect(toast.error).toHaveBeenCalledWith('batch.failed')
    await batch.confirmDelete()
    expect(batchShortLinks).toHaveBeenCalledTimes(2)
    expect(batch.deleteIds.value).toBeNull()
  })
  it('blocks writes and selection changes while unavailable or pending, without automatic retry', async () => {
    const { batch, blocked } = mount()
    await batch.submit('enable'); await batch.confirmDelete()
    expect(batchShortLinks).not.toHaveBeenCalled()
    batch.toggle('one', true)
    blocked.value = true
    batch.toggleAll(true); batch.toggle('two', true); batch.openDelete(); await batch.submit('disable')
    expect(batch.selected.value).toEqual(['one'])
    expect(batch.deleteIds.value).toBeNull()
    blocked.value = false
    const request = createDeferred<{ affectedCount: number }>()
    vi.mocked(batchShortLinks).mockReturnValue(request.promise)
    const writing = batch.submit('enable')
    batch.toggle('two', true); batch.openDelete(); await batch.submit('disable')
    expect(batch.pending.value).toBe(true)
    expect(batch.selected.value).toEqual(['one'])
    request.resolve({ affectedCount: 1 }); await writing
    expect(batchShortLinks).toHaveBeenCalledOnce()
    batch.closeDelete(); expect(batch.deleteIds.value).toBeNull()
  })
  it.each(['own', 'admin'] as const)('requires current read and action-specific permissions in %s', async context => {
    for (const grants of [[], ['short_link:read_own'], ['short_link:read_all', 'short_link:update_all'], ['admin:access', 'short_link:read_all'], ['admin:access', 'short_link:update_all']]) {
      const { batch, access, unmount } = mount(context, user(grants))
      batch.toggle('one', true); batch.openDelete(); await batch.submit('enable'); await batch.confirmDelete()
      expect(batchShortLinks).not.toHaveBeenCalled()
      expect(access.canUpdate.value).toBe(false)
      unmount()
    }
  })
  it.each(['own', 'admin'] as const)('allows independently granted update and delete in %s', async context => {
    const base = context === 'own' ? ['short_link:read_own'] : ['admin:access', 'short_link:read_all']
    for (const action of ['update', 'delete']) {
      const view = mount(context, user([...base, `short_link:${action}_${context === 'own' ? 'own' : 'all'}`]))
      view.batch.toggle('one', true)
      if (action === 'update') { view.batch.openDelete(); expect(view.batch.deleteIds.value).toBeNull(); await view.batch.submit('enable') }
      else { await view.batch.submit('enable'); view.batch.openDelete(); await view.batch.confirmDelete() }
      expect(batchShortLinks).toHaveBeenLastCalledWith({ ids: ['one'], action: action === 'update' ? 'enable' : 'delete' }, context)
      view.unmount()
    }
  })
  it.each(['filter', 'switch', 'logout', 'relogin', 'permission', 'unmount'])('suppresses late results after %s while keeping the single request locked', async transition => {
    for (const fail of [false, true]) {
      vi.clearAllMocks()
      const request = createDeferred<{ affectedCount: number }>()
      vi.mocked(batchShortLinks).mockReturnValue(request.promise)
      const view = mount()
      view.batch.toggle('one', true); view.batch.openDelete()
      const writing = view.batch.confirmDelete()
      if (transition === 'filter') view.filter.value = 'changed'
      if (transition === 'switch') view.client.setQueryData(['auth', 'me'], { user: user(permissions, 'B') })
      if (transition === 'logout' || transition === 'relogin') void revokeAccountIdentity(view.client)
      if (transition === 'relogin') view.client.setQueryData(['auth', 'me'], { user: user() })
      if (transition === 'permission') view.client.setQueryData(['auth', 'me'], { user: user([]) })
      if (transition === 'unmount') view.unmount()
      await nextTick()
      view.batch.toggle('two', true); await view.batch.submit('enable')
      expect(batchShortLinks).toHaveBeenCalledOnce()
      if (fail) request.reject(new Error('private')); else request.resolve({ affectedCount: 1 })
      await writing
      expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled()
      expect(view.batch.pending.value).toBe(false)
      cleanup()
    }
  })
  it('hides actions for guest aliases and unconfirmed auth', async () => {
    for (const account of [{ ...user(), group: 'guest' }, { ...user(), username: 'guest' }, user(permissions, '')]) {
      const view = mount('own', account)
      expect(view.access.canRead.value).toBe(false); expect(view.access.canSelect.value).toBe(false)
      view.unmount()
    }
    const request = createDeferred<Awaited<ReturnType<typeof me>>>()
    vi.mocked(me).mockReturnValue(request.promise)
    const view = mount('own', null)
    await waitFor(() => expect(view.access.canRead.value).toBe(false))
  })
})
