import { cleanup, render, waitFor } from '@testing-library/vue'
import { onlineManager, QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { defineComponent, h, nextTick, reactive } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { toast } from 'vue-sonner'
import { useListPreferenceEditor } from './useListPreferenceEditor'
import { createDeferred } from '@/test/deferred'

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const clients: QueryClient[] = []
const firstVersion = '2026-11-02T00:00:00.123456789Z'
const nextVersion = '2026-11-02T00:00:01.654321Z'
function response(size: number | null = 20, version = firstVersion, code = 0) {
  return new Response(JSON.stringify({ code, message: '', data: code ? null : { preference: { pageSize: size, updatedAt: version } } }))
}
function identity(client: QueryClient, id: string) { client.setQueryData(['auth', 'me'], { user: { id, username: id || 'guest', nickname: '', group: id ? 'user' : 'guest', permissions: [] } }) }
function mount(initial?: Promise<Response>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  clients.push(client); identity(client, 'A')
  const props = reactive({ userId: 'A', active: true })
  const state = { reads: 0, writes: [] as unknown[], nextRead: undefined as (() => Promise<Response>) | undefined, nextWrite: undefined as (() => Promise<Response>) | undefined }
  vi.stubGlobal('fetch', vi.fn((path: string, init: RequestInit) => {
    if (path.endsWith('/update')) {
      const input = JSON.parse(init.body as string)
      state.writes.push(input)
      return state.nextWrite ? state.nextWrite() : Promise.resolve(response(input.pageSize, nextVersion))
    }
    state.reads++
    return state.nextRead ? state.nextRead() : initial ?? Promise.resolve(response())
  }))
  let editor!: ReturnType<typeof useListPreferenceEditor>
  const component = defineComponent({ setup() {
    editor = useListPreferenceEditor(props, key => key)
    return () => h('output', editor.draft.value)
  } })
  const view = render(component, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } })
  return { ...view, client, props, state, editor: () => editor }
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); onlineManager.setOnline(true); vi.unstubAllGlobals(); vi.clearAllMocks() })
async function ready(view: ReturnType<typeof mount>) { await waitFor(() => expect(view.editor().original.value).toBeDefined()) }

// Reusing edit revision across generations must not prevent a new account's initial adoption.
it('adopts the next account default after retiring the old draft', async () => {
  const view = mount(); await ready(view)
  view.editor().edit('100')
  view.state.nextRead = async () => response(50)
  identity(view.client, 'B'); view.props.userId = 'B'
  await waitFor(() => expect(view.editor().draft.value).toBe('50'))
  expect(view.client.getQueriesData({ queryKey: ['user', 'list-preference', 'A'] })).toEqual([])
})

it('does not replace input edited during the first load', async () => {
  const pending = createDeferred<Response>()
  const view = mount(pending.promise)
  view.editor().edit('100')
  pending.resolve(response(50))
  await ready(view)
  expect(view.editor().draft.value).toBe('100')
  await view.editor().submit()
  expect(view.state.writes).toEqual([{ pageSize: 100, expectedUpdatedAt: firstVersion }])
})

it('preserves the draft after conflict until an explicit discard and reload', async () => {
  const view = mount(); await ready(view)
  view.editor().edit('100')
  view.state.nextWrite = async () => response(null, firstVersion, 300104)
  await view.editor().submit()
  expect(view.editor().conflict.value).toBe(true)
  expect(view.editor().draft.value).toBe('100')
  await view.editor().submit()
  expect(view.state.writes).toHaveLength(1)
  view.state.nextRead = async () => response(50, nextVersion)
  await view.editor().reload(true)
  expect(view.editor().draft.value).toBe('50')
  expect(view.editor().conflict.value).toBe(false)
})

it.each([firstVersion, nextVersion])('keeps input and the old CAS baseline on ordinary retry %s', async version => {
  const view = mount(); await ready(view)
  view.editor().edit('100')
  view.state.nextRead = async () => response(null, firstVersion, 900000)
  await view.client.refetchQueries({ queryKey: ['user', 'list-preference'] })
  await waitFor(() => expect(view.editor().readError.value).toBe(true))
  const pending = createDeferred<Response>()
  view.state.nextRead = () => pending.promise
  const loading = view.editor().reload(false)
  view.editor().edit('50')
  pending.resolve(response(100, version)); await loading
  expect(view.editor().draft.value).toBe('50')
  expect(view.editor().original.value?.updatedAt).toBe(firstVersion)
  expect(view.editor().conflict.value).toBe(version !== firstVersion)
})

it('keeps newer input while adopting the confirmed baseline of an explicit reload', async () => {
  const view = mount(); await ready(view)
  const pending = createDeferred<Response>()
  view.state.nextRead = () => pending.promise
  const loading = view.editor().reload(true)
  view.editor().edit('100')
  pending.resolve(response(50, nextVersion)); await loading
  expect(view.editor().draft.value).toBe('100')
  expect(view.editor().original.value?.updatedAt).toBe(nextVersion)
})

it.each(['success', 'error'] as const)('ignores an old save %s and finally while a new account saves', async outcome => {
  const view = mount(); await ready(view)
  const old = createDeferred<Response>()
  view.state.nextWrite = () => old.promise
  view.editor().edit('100'); const savingOld = view.editor().submit()
  await waitFor(() => expect(view.state.writes).toHaveLength(1))
  view.state.nextRead = async () => response(50)
  identity(view.client, 'B'); view.props.userId = 'B'
  await ready(view)
  const current = createDeferred<Response>()
  view.state.nextWrite = () => current.promise
  view.editor().edit('20'); const savingCurrent = view.editor().submit()
  await waitFor(() => expect(view.state.writes).toHaveLength(2))
  if (outcome === 'success') old.resolve(response(100, nextVersion))
  else old.reject(new Error('old failure'))
  await savingOld
  expect(view.editor().pending.value).toBe(true)
  expect(view.editor().draft.value).toBe('20')
  expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled()
  current.resolve(response(20, nextVersion)); await savingCurrent
  expect(view.editor().pending.value).toBe(false)
  expect(toast.success).toHaveBeenCalledWith('listPreference.saved')
})

it('expires an offline save before it can send after logout', async () => {
  const view = mount(); await ready(view)
  onlineManager.setOnline(false)
  view.editor().edit('50'); const saving = view.editor().submit()
  await nextTick()
  identity(view.client, ''); view.props.active = false
  onlineManager.setOnline(true); await saving
  expect(view.state.writes).toEqual([])
  expect(toast.error).not.toHaveBeenCalled()
})

it('publishes a saved value without letting an earlier read overwrite it', async () => {
  const view = mount(); await ready(view)
  const saving = createDeferred<Response>()
  view.state.nextWrite = () => saving.promise
  view.editor().edit('50'); const save = view.editor().submit()
  await waitFor(() => expect(view.state.writes).toHaveLength(1))
  const oldRead = createDeferred<Response>()
  view.state.nextRead = () => oldRead.promise
  const reading = view.client.refetchQueries({ queryKey: ['user', 'list-preference'] })
  saving.resolve(response(50, nextVersion)); await save
  oldRead.resolve(response(100)); await reading
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(view.editor().draft.value).toBe('50')
  expect(view.client.getQueriesData({ queryKey: ['user', 'list-preference'] })[0]?.[1]).toMatchObject({ preference: { pageSize: 50, updatedAt: nextVersion } })
})

it.each(['garbage', '020', '30'])('rejects unsupported or coerced input %s without writing', async input => {
  const view = mount(); await ready(view)
  view.editor().edit(input); await view.editor().submit()
  expect(view.editor().invalid.value).toBe(true)
  expect(view.state.writes).toEqual([])
})

// Losing the revision check would silently discard edits made while a save was in flight.
it('keeps newer input after saving the previous draft and advances its CAS baseline', async () => {
  const view = mount(); await ready(view)
  const pending = createDeferred<Response>()
  view.state.nextWrite = () => pending.promise
  view.editor().edit('50'); const saving = view.editor().submit()
  await waitFor(() => expect(view.state.writes).toHaveLength(1))
  view.editor().edit('100')
  pending.resolve(response(50, nextVersion)); await saving
  expect(view.editor().draft.value).toBe('100')
  expect(view.editor().original.value).toEqual({ pageSize: 50, updatedAt: nextVersion })
  view.state.nextWrite = undefined
  await view.editor().submit()
  expect(view.state.writes[1]).toEqual({ pageSize: 100, expectedUpdatedAt: nextVersion })
})

it.each([120001, 900000, 'network'] as const)('retains a failed save for an explicit retry after %s', async failure => {
  const view = mount(); await ready(view)
  view.editor().edit('100')
  view.state.nextWrite = async () => {
    if (failure === 'network') throw new Error('offline')
    return response(null, firstVersion, failure)
  }
  await view.editor().submit()
  expect(view.editor().pending.value).toBe(false)
  expect(view.editor().conflict.value).toBe(false)
  expect(view.editor().draft.value).toBe('100')
  expect(view.editor().original.value?.updatedAt).toBe(firstVersion)
  expect(toast.error).toHaveBeenCalledWith(failure === 120001 ? 'listPreference.unavailable' : 'listPreference.saveFailed')
  expect(view.state.writes).toHaveLength(1)
  view.state.nextWrite = undefined
  await view.editor().submit()
  expect(view.state.writes[1]).toEqual({ pageSize: 100, expectedUpdatedAt: firstVersion })
})

it('recovers an initial read failure without losing input typed during retry', async () => {
  const view = mount(Promise.resolve(response(null, firstVersion, 900000)))
  await waitFor(() => expect(view.editor().readError.value).toBe(true))
  const pending = createDeferred<Response>()
  view.state.nextRead = () => pending.promise
  const reading = view.editor().reload(false)
  view.editor().edit('100')
  pending.resolve(response(50, nextVersion)); await reading
  expect(view.editor().draft.value).toBe('100')
  expect(view.editor().original.value?.updatedAt).toBe(nextVersion)
  await view.editor().submit()
  expect(view.state.writes).toEqual([{ pageSize: 100, expectedUpdatedAt: nextVersion }])
})

it('detects an externally published revision without replacing the local draft', async () => {
  const view = mount(); await ready(view)
  view.editor().edit('100')
  const [key, owned] = view.client.getQueriesData<{ userId: string; epoch: number }>({ queryKey: ['user', 'list-preference'] })[0]!
  view.client.setQueryData(key, { ...owned, preference: { pageSize: 50, updatedAt: nextVersion } })
  await nextTick()
  expect(view.editor().conflict.value).toBe(true)
  expect(view.editor().draft.value).toBe('100')
  await view.editor().submit()
  expect(view.state.writes).toEqual([])
})

it('ignores reload outcomes after the panel loses its identity', async () => {
  const view = mount(); await ready(view)
  const pending = createDeferred<Response>()
  view.state.nextRead = () => pending.promise
  const reading = view.editor().reload(true)
  identity(view.client, '')
  view.props.active = false
  pending.resolve(response(100, nextVersion)); await reading
  expect(view.editor().eligible.value).toBe(false)
  expect(view.editor().draft.value).toBe('')
  expect(view.editor().original.value).toBeUndefined()
  await view.editor().reload(true)
  expect(view.state.reads).toBe(2)
  expect(toast.success).not.toHaveBeenCalled()
})

it('does not start a duplicate reload while a reload is pending and exposes its failure', async () => {
  const view = mount(); await ready(view)
  view.editor().edit('100')
  const pending = createDeferred<Response>()
  view.state.nextRead = () => pending.promise
  const reading = view.editor().reload(true)
  await view.editor().reload(true)
  expect(view.state.reads).toBe(2)
  pending.reject(new Error('offline')); await reading
  expect(view.editor().readError.value).toBe(true)
  expect(view.editor().busy.value).toBe(false)
  expect(view.editor().draft.value).toBe('100')
})

it('retires a scheduled reactivation read before it can run for an inactive panel', async () => {
  const view = mount(); await ready(view)
  view.props.active = false
  view.props.active = true
  view.props.active = false
  await nextTick()
  expect(view.editor().eligible.value).toBe(false)
  expect(view.editor().busy.value).toBe(false)
  expect(view.state.reads).toBe(1)
})

it('does not publish or toast after an unmounted save finishes', async () => {
  const view = mount(); await ready(view)
  const pending = createDeferred<Response>()
  view.state.nextWrite = () => pending.promise
  view.editor().edit('50'); const saving = view.editor().submit()
  await waitFor(() => expect(view.state.writes).toHaveLength(1))
  view.unmount()
  pending.resolve(response(50, nextVersion)); await saving
  expect(toast.success).not.toHaveBeenCalled()
  expect(view.client.getQueriesData({ queryKey: ['user', 'list-preference'] })[0]?.[1]).toMatchObject({ preference: { pageSize: 20, updatedAt: firstVersion } })
})
