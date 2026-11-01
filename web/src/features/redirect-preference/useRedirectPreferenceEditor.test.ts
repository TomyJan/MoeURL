import { cleanup, render, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { defineComponent, h, nextTick, reactive } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { useRedirectPreferenceEditor } from './useRedirectPreferenceEditor'
import { createDeferred } from '@/test/deferred'

const clients: QueryClient[] = []
const firstVersion = '2026-11-02T00:00:00.123456Z'
const nextVersion = '2026-11-02T00:00:01.654321Z'
function response(version = firstVersion, code = 0) { return new Response(JSON.stringify({ code, message: '', data: code ? null : { preference: { redirectMode: 'direct', updatedAt: version } }, meta: {} })) }
/** Exercises public controller commands that may already be queued when UI controls disable. */
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  clients.push(client)
  client.setQueryData(['auth', 'me'], { user: { id: 'A', username: 'alice', nickname: '', group: 'user', permissions: ['short_link:use_intermediate'] } })
  const props = reactive({ userId: 'A', active: true, permissions: ['short_link:use_intermediate'] })
  const state = { reads: 0, next: undefined as (() => Promise<Response>) | undefined }
  vi.stubGlobal('fetch', vi.fn(() => { state.reads++; return state.next ? state.next() : Promise.resolve(response()) }))
  let editor: ReturnType<typeof useRedirectPreferenceEditor>
  const component = defineComponent({ setup() {
    editor = useRedirectPreferenceEditor(props, key => key)
    return () => h('output', editor.draft.value)
  } })
  const view = render(component, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } })
  return { ...view, client, props, state, editor: () => editor }
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals() })
async function ready(view: ReturnType<typeof mount>) { await waitFor(() => expect(view.editor().original.value).toBeDefined()) }

it('ignores queued reload commands while inactive or while another reload is pending', async () => {
  const view = mount()
  await ready(view)
  view.props.active = false
  await view.editor().reload(true)
  expect(view.state.reads).toBe(1)
  view.props.active = true
  await nextTick()
  await waitFor(() => expect(view.client.isFetching()).toBe(0))
  const before = view.state.reads
  const pending = createDeferred<Response>()
  view.state.next = () => pending.promise
  const loading = view.editor().reload(true)
  await view.editor().reload(true)
  expect(view.state.reads).toBe(before + 1)
  pending.resolve(response())
  await loading
})
it('does not start a scheduled authentication recovery read after unmount', async () => {
  const view = mount()
  await ready(view)
  view.props.active = false
  view.props.active = true
  view.unmount()
  await nextTick()
  expect(view.state.reads).toBe(1)
})
it.each([firstVersion, nextVersion])('keeps an existing draft on read retry and identifies any changed revision %s', async version => {
  const view = mount()
  await ready(view)
  view.editor().edit('intermediate')
  view.state.next = async () => response(firstVersion, 900000)
  await view.client.refetchQueries({ queryKey: ['user', 'redirect-preference'] })
  await waitFor(() => expect(view.editor().readError.value).toBe(true))
  view.state.next = async () => response(version)
  await view.editor().reload(false)
  expect(view.editor().draft.value).toBe('intermediate')
  expect(view.editor().conflict.value).toBe(version !== firstVersion)
  expect(view.editor().original.value?.updatedAt).toBe(firstVersion)
})

it.each([firstVersion, nextVersion])('preserves the original CAS baseline when editing during a normal read retry %s', async version => {
  const view = mount()
  await ready(view)
  view.editor().edit('intermediate')
  view.state.next = async () => response(firstVersion, 900000)
  await view.client.refetchQueries({ queryKey: ['user', 'redirect-preference'] })
  await waitFor(() => expect(view.editor().readError.value).toBe(true))
  const pending = createDeferred<Response>()
  view.state.next = () => pending.promise
  const loading = view.editor().reload(false)
  view.editor().edit('direct')
  pending.resolve(response(version))
  await loading
  expect(view.getByText('direct')).toBeTruthy()
  expect(view.editor().original.value?.updatedAt).toBe(firstVersion)
  expect(view.editor().conflict.value).toBe(version !== firstVersion)
  expect(view.editor().locked.value).toBe(version !== firstVersion)
})
