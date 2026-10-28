import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { defineComponent, h, ref } from 'vue'
import { afterEach, expect, it, vi } from 'vitest'
import { setImmediate as eventLoop } from 'node:timers/promises'
import type { RedirectMode } from '@/entities/short-link/model'
import { useAccountIdentity, revokeAccountIdentity } from '@/shared/preferences/useAccountPreferences'
import { useDomainRedirectDefaults } from '@/shared/preferences/useDomainRedirectDefaults'
import { createDeferred } from '@/test/deferred'
import { useDomainRedirectDraft } from './useDomainRedirectDraft'

const clients: QueryClient[] = []
/** Supplies one eligible domain via the real HTTP decoder. */
function response(mode: string) { return new Response(JSON.stringify({ code: 0, message: '', data: { items: [{ domainId: '11111111-1111-4111-8111-111111111111', redirectMode: mode }] }, meta: {} })) }
/** A minimal real consumer makes queued public commands observable, not private implementation fields. */
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  clients.push(client)
  client.setQueryData(['auth', 'me'], { user: { id: 'A', username: 'alice', group: 'user', nickname: '', permissions: [] } })
  const state = { mode: ref<RedirectMode>('direct'), delay: ref(5), pending: ref(false), confirmation: ref(true), requests: 0, next: null as (() => Promise<Response>) | null }
  vi.stubGlobal('fetch', vi.fn(async () => { state.requests++; return state.next ? state.next() : response('intermediate') }))
  const component = defineComponent({ setup() {
    const identity = useAccountIdentity()
    const draft = useDomainRedirectDraft({ domainId: ref('11111111-1111-4111-8111-111111111111'), scope: identity.scope, canIntermediate: ref(true), canConfirmation: state.confirmation, pending: state.pending, mode: state.mode, delay: state.delay, query: useDomainRedirectDefaults() })
    return () => h('section', [h('output', `${state.mode.value}/${state.delay.value}`), h('button', { onClick: () => draft.choose('direct') }, 'Direct'), h('button', { onClick: () => draft.choose('confirmation') }, 'Confirmation'), h('button', { onClick: draft.reload }, 'Reload')])
  } })
  const view = render(component, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } })
  return { ...view, state, client }
}
afterEach(() => { cleanup(); for (const client of clients.splice(0)) { revokeAccountIdentity(client); client.clear() }; vi.unstubAllGlobals() })

it('ignores queued choices and reloads while mutation pending, and rejects a revoked choice', async () => {
  const view = mount()
  await screen.findByText('intermediate/5')
  await fireEvent.click(screen.getByRole('button', { name: 'Direct' }))
  view.state.pending.value = true
  await fireEvent.click(screen.getByRole('button', { name: 'Confirmation' }))
  await fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
  expect(screen.getByText('direct/5')).toBeTruthy()
  expect(view.state.requests).toBe(1)
  view.state.pending.value = false
  view.state.confirmation.value = false
  await fireEvent.click(screen.getByRole('button', { name: 'Confirmation' }))
  expect(screen.getByText('direct/5')).toBeTruthy()
})

it('does not change a surviving parent mode binding after its consumer unmounts during reload', async () => {
  const pending = createDeferred<Response>()
  const view = mount()
  await screen.findByText('intermediate/5')
  await fireEvent.click(screen.getByRole('button', { name: 'Direct' }))
  view.state.next = () => pending.promise
  await fireEvent.click(screen.getByRole('button', { name: 'Reload' }))
  await waitFor(() => expect(view.state.requests).toBe(2))
  view.unmount()
  pending.resolve(response('confirmation'))
  await eventLoop()
  expect(view.state.mode.value).toBe('direct')
})
