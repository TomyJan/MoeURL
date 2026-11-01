import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { createDeferred } from '@/test/deferred'
import { useRedirectPreference } from './useRedirectPreference'
import { revokeAccountIdentity } from './useAccountPreferences'

const clients: QueryClient[] = []
const version = '2026-11-02T00:00:00.123456Z'
const response = (redirectMode: string | null) => new Response(JSON.stringify({ code: 0, message: '', data: { preference: { redirectMode, updatedAt: version } }, meta: {} }))
function identity(client: QueryClient, id: string) { client.setQueryData(['auth', 'me'], { user: { id, username: id || 'guest', nickname: '', group: id ? 'user' : 'guest', permissions: [] } }) }
function mount(id = 'A') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  clients.push(client)
  identity(client, id)
  const confirmed = ref(true)
  const state = { reads: 0, next: undefined as (() => Promise<Response>) | undefined }
  vi.stubGlobal('fetch', vi.fn(() => { state.reads++; return state.next ? state.next() : Promise.resolve(response('direct')) }))
  const component = defineComponent({ setup() {
    const resource = useRedirectPreference(confirmed)
    const originalOwner = resource.scope.value
    return () => h('section', [h('output', resource.readError.value ? 'read-error' : resource.preference.value?.redirectMode ?? 'unknown'),
      h('button', { onClick: () => resource.publish(resource.scope.value, { redirectMode: 'confirmation', updatedAt: version }) }, 'Publish'),
      h('button', { onClick: () => resource.publish(originalOwner, { redirectMode: 'intermediate', updatedAt: version }) }, 'Publish old'),
      h('button', { onClick: () => { void resource.query.refetch({ throwOnError: true }).catch(() => undefined) } }, 'Refresh'),
    ])
  } })
  const view = render(component, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } })
  return { ...view, client, confirmed, state }
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals() })

it('does not read for guest or disabled capability, then reads only the confirmed account', async () => {
  const view = mount('')
  await nextTick()
  expect(view.state.reads).toBe(0)
  view.confirmed.value = false
  identity(view.client, 'A')
  await nextTick()
  expect(view.state.reads).toBe(0)
  view.confirmed.value = true
  await screen.findByText('direct')
  expect(view.state.reads).toBe(1)
})
it('cannot resurrect a removed account cache by publishing its old owner', async () => {
  const view = mount()
  await screen.findByText('direct')
  identity(view.client, 'B')
  await waitFor(() => expect(view.state.reads).toBe(2))
  await screen.findByText('direct')
  await fireEvent.click(screen.getByText('Publish old'))
  expect(screen.getByText('direct')).toBeTruthy()
  expect(view.client.getQueriesData({ queryKey: ['user', 'redirect-preference', 'A'] })).toEqual([])
})
it('rejects a same-tick old observer refresh before it can send an extra request for the new account', async () => {
  const view = mount()
  await screen.findByText('direct')
  identity(view.client, 'B')
  await fireEvent.click(screen.getByText('Refresh'))
  await waitFor(() => expect(view.client.isFetching()).toBe(0))
  expect(view.state.reads).toBe(2)
  expect(screen.getByText('direct')).toBeTruthy()
})
it('cannot replay captured old-owner query options after identity changes', async () => {
  const view = mount()
  await screen.findByText('direct')
  const old = view.client.getQueryCache().find({ queryKey: ['user', 'redirect-preference', 'A'], exact: false })!
  const captured = { ...old.options, queryKey: old.queryKey, staleTime: 0 }
  identity(view.client, 'B')
  await waitFor(() => expect(view.state.reads).toBe(2))
  await expect(view.client.fetchQuery(captured)).rejects.toThrow('Redirect preference unavailable')
  expect(view.state.reads).toBe(2)
  expect(screen.getByText('direct')).toBeTruthy()
})
it('a successful save cancels an older read so its late result cannot overwrite the saved cache', async () => {
  const view = mount()
  await screen.findByText('direct')
  const pending = createDeferred<Response>()
  view.state.next = () => pending.promise
  const refresh = view.client.refetchQueries({ queryKey: ['user', 'redirect-preference'] })
  await waitFor(() => expect(view.state.reads).toBe(2))
  await fireEvent.click(screen.getByText('Publish'))
  await screen.findByText('confirmation')
  pending.resolve(response('intermediate'))
  await refresh
  await new Promise<void>(resolve => setImmediate(resolve))
  expect(screen.getByText('confirmation')).toBeTruthy()
})
it('does not expose a failed old epoch while same-account login reads its own preference', async () => {
  const view = mount()
  await screen.findByText('direct')
  const pending = createDeferred<Response>()
  view.state.next = () => pending.promise
  const refresh = view.client.refetchQueries({ queryKey: ['user', 'redirect-preference'] })
  await waitFor(() => expect(view.state.reads).toBe(2))
  revokeAccountIdentity(view.client)
  view.state.next = undefined
  identity(view.client, 'A')
  await screen.findByText('direct')
  pending.reject(new Error('old network failure'))
  await refresh
  expect(screen.queryByText('read-error')).toBeNull()
})
