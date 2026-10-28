import { cleanup, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin, focusManager, useQuery } from '@tanstack/vue-query'
import { defineComponent, h, ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { setImmediate as eventLoop } from 'node:timers/promises'
import { createDeferred } from '@/test/deferred'
import { useDomainRedirectDefaults } from './useDomainRedirectDefaults'
import { revokeAccountIdentity } from './useAccountPreferences'

const id = '11111111-1111-4111-8111-111111111111'
const clients: QueryClient[] = []

/** Drives the same auth/me cache transition used by login and logout. */
function identity(client: QueryClient, userId: string) { client.setQueryData(['auth', 'me'], { user: { id: userId, username: userId || 'guest', nickname: '', group: userId ? 'user' : 'guest', permissions: [] } }) }
/** Serializes effective defaults from the controlled HTTP boundary. */
function result(mode: string) { return new Response(JSON.stringify({ code: 0, message: '', data: { items: [{ domainId: id, redirectMode: mode }] }, meta: {} })) }
/** Renders actual observer data; no query hook or identity method is mocked. */
function mount(userId = 'A') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity, refetchOnWindowFocus: false } } })
  identity(client, userId)
  const enabled = ref(true)
  const state = { mode: 'direct', requests: 0, unrelatedReads: 0, next: null as (() => Promise<Response>) | null }
  vi.stubGlobal('fetch', vi.fn(async () => { state.requests++; return state.next ? state.next() : result(state.mode) }))
  const component = defineComponent({ setup() {
    const query = useDomainRedirectDefaults(enabled)
    useQuery({ queryKey: ['unrelated'], queryFn: async () => { state.unrelatedReads++; return 'public' } })
    return () => h('output', query.data.value?.items[0]?.redirectMode ?? 'none')
  } })
  const view = render(component, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } })
  const value = { ...view, client, state, enabled }
  clients.push(client)
  return value
}
afterEach(() => { cleanup(); for (const client of clients.splice(0)) { revokeAccountIdentity(client); client.clear() }; focusManager.setFocused(undefined); vi.unstubAllGlobals() })

it('does not read private defaults for a guest or a disabled capability', async () => {
  const view = mount('')
  await waitFor(() => expect(view.client.isFetching()).toBe(0))
  expect(view.state.requests).toBe(0)
  view.enabled.value = false
  identity(view.client, 'A')
  await eventLoop()
  expect(view.state.requests).toBe(0)
  view.enabled.value = true
  await screen.findByText('direct')
  expect(view.state.requests).toBe(1)
})

it('partitions accounts and never displays the previous account default', async () => {
  const view = mount()
  await screen.findByText('direct')
  view.state.mode = 'confirmation'
  identity(view.client, 'B')
  await screen.findByText('confirmation')
  expect(view.state.requests).toBe(2)
})

it('ignores an earlier same-account login epoch response', async () => {
  const pending = createDeferred<Response>()
  const view = mount()
  // Refetch after the initial successful read so the pending response belongs to A.
  await screen.findByText('direct')
  view.state.next = () => pending.promise
  const refresh = view.client.invalidateQueries({ queryKey: ['domain-redirect-defaults'] })
  await waitFor(() => expect(view.state.requests).toBe(2))
  revokeAccountIdentity(view.client)
  view.state.next = null
  view.state.mode = 'confirmation'
  identity(view.client, 'A')
  await screen.findByText('confirmation')
  pending.resolve(result('intermediate'))
  await refresh
  await eventLoop()
  expect(screen.getByText('confirmation')).toBeTruthy()
  expect(view.client.getQueriesData({ queryKey: ['domain-redirect-defaults', 'A'] })).toHaveLength(1)
})

it('refreshes on focus locally without changing unrelated observer behavior', async () => {
  const view = mount()
  await screen.findByText('direct')
  view.state.mode = 'confirmation'
  focusManager.setFocused(false)
  focusManager.setFocused(true)
  await screen.findByText('confirmation')
  expect(view.state.unrelatedReads).toBe(1)
})
