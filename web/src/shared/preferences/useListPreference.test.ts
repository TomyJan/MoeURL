import { cleanup, render, waitFor } from '@testing-library/vue'
import { focusManager, QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { createDeferred } from '@/test/deferred'
import { useListPreference } from './useListPreference'
import { revokeAccountIdentity } from './useAccountPreferences'

const clients: QueryClient[] = []
const version = '2026-11-09T00:00:00.123456Z'
const response = (pageSize: number | null) => new Response(JSON.stringify({ code: 0, message: '', data: { preference: { pageSize, updatedAt: version } } }))
function identity(client: QueryClient, id: string) { client.setQueryData(['auth', 'me'], { user: { id, username: id || 'guest', nickname: '', group: id ? 'user' : 'guest', permissions: [] } }) }
function mount(id = 'A') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  clients.push(client); identity(client, id)
  const confirmed = ref(true)
  const state = { reads: 0, next: undefined as (() => Promise<Response>) | undefined }
  vi.stubGlobal('fetch', vi.fn(() => { state.reads++; return state.next ? state.next() : Promise.resolve(response(50)) }))
  let reader!: ReturnType<typeof useListPreference>
  render(defineComponent({ setup() { reader = useListPreference(confirmed); return () => h('output', String(reader.preference.value?.pageSize ?? 'unknown')) } }), {
    global: { plugins: [[VueQueryPlugin, { queryClient: client }]] },
  })
  return { client, confirmed, state, reader: () => reader }
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); focusManager.setFocused(undefined) })
async function ready(view: ReturnType<typeof mount>) { await waitFor(() => expect(view.reader().preference.value?.pageSize).toBe(50)) }

it('waits for a confirmed non-guest identity and never refetches on focus', async () => {
  const view = mount(''); await nextTick()
  expect(view.state.reads).toBe(0)
  view.confirmed.value = false; identity(view.client, 'A'); await nextTick()
  expect(view.state.reads).toBe(0)
  view.confirmed.value = true; await ready(view)
  focusManager.setFocused(false); focusManager.setFocused(true)
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(view.state.reads).toBe(1)
})

it('rejects captured query options before sending under a different account', async () => {
  const view = mount(); await ready(view)
  const old = view.client.getQueryCache().find({ queryKey: ['user', 'list-preference', 'A'], exact: false })!
  const captured = { ...old.options, queryKey: old.queryKey, staleTime: 0 }
  const owner = view.reader().scope.value
  identity(view.client, 'B'); await ready(view)
  await waitFor(() => expect(view.state.reads).toBe(2))
  await expect(view.client.fetchQuery(captured)).rejects.toThrow('List preference unavailable')
  view.reader().publish(owner, { pageSize: 100, updatedAt: version })
  expect(view.state.reads).toBe(2)
  expect(view.reader().preference.value?.pageSize).toBe(50)
  expect(view.client.getQueriesData({ queryKey: ['user', 'list-preference', 'A'] }).filter(([, data]) => data !== undefined)).toEqual([])
})

it.each(['success', 'error'] as const)('does not expose a late old-epoch %s after the same account logs in again', async outcome => {
  const view = mount(); await ready(view)
  const old = createDeferred<Response>()
  view.state.next = () => old.promise
  const reading = view.client.refetchQueries({ queryKey: ['user', 'list-preference'] })
  await waitFor(() => expect(view.state.reads).toBe(2))
  revokeAccountIdentity(view.client); view.state.next = undefined; identity(view.client, 'A')
  await ready(view)
  if (outcome === 'success') old.resolve(response(100))
  else old.reject(new Error('old failure'))
  await reading
  expect(view.reader().preference.value?.pageSize).toBe(50)
  expect(view.reader().readError.value).toBe(false)
})

it('keeps a confirmed save authoritative over a late read', async () => {
  const view = mount(); await ready(view)
  const old = createDeferred<Response>()
  view.state.next = () => old.promise
  const reading = view.client.refetchQueries({ queryKey: ['user', 'list-preference'] })
  await waitFor(() => expect(view.state.reads).toBe(2))
  view.reader().publish(view.reader().scope.value, { pageSize: 20, updatedAt: version })
  old.resolve(response(100)); await reading
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(view.reader().preference.value?.pageSize).toBe(20)
})
