import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ShortLinkCreatePanel from '@/features/short-link-create/ShortLinkCreatePanel.vue'
import { componentStubs } from '@/test/component-stubs'
import { revokeAccountIdentity } from '@/shared/preferences/useAccountPreferences'
import { setImmediate } from 'node:timers/promises'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
const clients: QueryClient[] = []
const globalId = '11111111-1111-4111-8111-111111111111'
const assignedId = '22222222-2222-4222-8222-222222222222'
const target = 'https://target.example/preserved'
const user = { id: 'A', username: 'alice', nickname: '', group: 'user', permissions: ['short_link:create', 'domain:use_default', 'domain:use_assigned'] }
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}
function mount(cached = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity, refetchOnWindowFocus: false } } })
  clients.push(client)
  if (cached) client.setQueryData(['auth', 'me'], { user })
  const state = { failing: !cached, authReads: 0, writes: [] as unknown[], nextUser: user, authBarrier: null as Promise<void> | null }
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    let data: unknown
    if (url === '/api/v1/auth/me') {
      state.authReads++
      const nextUser = state.nextUser
      if (state.authBarrier) await state.authBarrier
      if (state.failing) throw new TypeError('PRIVATE_TRANSPORT_DETAIL')
      data = { user: nextUser }
    } else if (url === '/api/v1/domain/available') data = { items: [
      { id: globalId, host: 'global.example', displayName: 'Global', isDefault: true },
      { id: assignedId, host: 'assigned.example', displayName: 'Assigned', isDefault: false },
    ] }
    else if (url === '/api/v1/domain/group-default') data = { selection: { domainId: null, status: 'not_set' } }
    else if (url === '/api/v1/user/domain-preference') data = { preference: { domainId: null, updatedAt: null } }
    else if (url === '/api/v1/short-link/create') {
      state.writes.push(JSON.parse(String(init?.body)))
      data = { shortLink: { id: 'link', url: 'https://global.example/abc123', slug: 'abc123', targetUrl: target, title: '', tags: [], status: 'active', redirectMode: 'direct', intermediateDelaySeconds: 5, expiresAt: null, expired: false, passwordEnabled: false, maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false, createdAt: '2026-11-09T00:00:00Z' } }
    } else throw new Error(`Unexpected request ${url}`)
    return new Response(JSON.stringify({ code: 0, message: '', data, meta: {} }))
  }))
  render(ShortLinkCreatePanel, { global: { stubs: componentStubs, plugins: [[VueQueryPlugin, { queryClient: client }]] } })
  return { client, state }
}

afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals() })

describe('creation identity recovery through the visible UI', () => {
  it('offers an explicit retry after the first failed identity read, then creates only on user submission', async () => {
    const { state } = mount()
    await screen.findByText('shortLinkCreate.authLoadFailed')
    expect(screen.getByLabelText('shortLinkCreate.targetLabel')).toHaveProperty('disabled', true)
    expect(screen.queryByText('PRIVATE_TRANSPORT_DETAIL')).toBeNull()
    state.failing = false
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkCreate.retryAuth' }))
    const submit = screen.getByRole('button', { name: 'shortLinkCreate.submit' })
    await waitFor(() => expect(submit).toHaveProperty('disabled', false))
    expect(state.authReads).toBe(2)
    expect(state.writes).toEqual([])
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), target)
    await fireEvent.click(submit)
    await waitFor(() => expect(state.writes).toEqual([{ targetUrl: target }]))
  })

  it('preserves the address and manually selected domain across failed background reads and retry', async () => {
    const { client, state } = mount(true)
    const submit = screen.getByRole('button', { name: 'shortLinkCreate.submit' })
    await waitFor(() => expect(submit).toHaveProperty('disabled', false))
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), target)
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.domainLabel'), assignedId)
    state.failing = true
    await client.refetchQueries({ queryKey: ['auth', 'me'], exact: true })
    await screen.findByText('shortLinkCreate.authLoadFailed')
    expect(submit).toHaveProperty('disabled', true)
    state.failing = false
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkCreate.retryAuth' }))
    await waitFor(() => expect(submit).toHaveProperty('disabled', false))
    expect(screen.getByLabelText('shortLinkCreate.targetLabel')).toHaveProperty('value', target)
    expect(screen.getByLabelText('shortLinkCreate.domainLabel')).toHaveProperty('value', assignedId)
    expect(state.writes).toEqual([])
    await fireEvent.click(submit)
    await waitFor(() => expect(state.writes).toEqual([{ targetUrl: target, domainId: assignedId }]))
  })

  it('keeps a failed retry actionable and never exposes raw transport details', async () => {
    const { state } = mount()
    await screen.findByText('shortLinkCreate.authLoadFailed')
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkCreate.retryAuth' }))
    await waitFor(() => expect(state.authReads).toBe(2))
    await screen.findByText('shortLinkCreate.authLoadFailed')
    expect(screen.getByRole('button', { name: 'shortLinkCreate.retryAuth' })).toHaveProperty('disabled', false)
    expect(screen.queryByText('PRIVATE_TRANSPORT_DETAIL')).toBeNull()
    expect(state.writes).toEqual([])
  })

  it('uses the freshly returned permissions and keeps creation disabled after permission revocation', async () => {
    const { state } = mount()
    await screen.findByText('shortLinkCreate.authLoadFailed')
    state.failing = false
    state.nextUser = { ...user, permissions: ['domain:use_default'] }
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkCreate.retryAuth' }))
    await screen.findByText('shortLinkCreate.permissionRequired')
    expect(screen.getByLabelText('shortLinkCreate.targetLabel')).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'shortLinkCreate.submit' })).toHaveProperty('disabled', true)
    expect(state.writes).toEqual([])
  })

  it('disables the visible background-error retry while its identity request is pending', async () => {
    const { client, state } = mount(true)
    const submit = screen.getByRole('button', { name: 'shortLinkCreate.submit' })
    await waitFor(() => expect(submit).toHaveProperty('disabled', false))
    state.failing = true
    await client.refetchQueries({ queryKey: ['auth', 'me'], exact: true })
    await screen.findByText('shortLinkCreate.authLoadFailed')
    const barrier = deferred()
    state.authBarrier = barrier.promise
    state.failing = false
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkCreate.retryAuth' }))
    await waitFor(() => expect(state.authReads).toBe(2))
    expect(screen.getByRole('button', { name: 'shortLinkCreate.retryAuth' })).toHaveProperty('disabled', true)
    expect(submit).toHaveProperty('disabled', true)
    expect(state.writes).toEqual([])
    barrier.resolve()
    await waitFor(() => expect(submit).toHaveProperty('disabled', false))
    expect(state.writes).toEqual([])
  })

  it('keeps an initial identity retry disabled until its guest response is resolved', async () => {
    const { state } = mount()
    await screen.findByText('shortLinkCreate.authLoadFailed')
    const barrier = deferred()
    state.authBarrier = barrier.promise
    state.failing = false
    state.nextUser = { id: '', username: 'guest', nickname: '', group: 'guest', permissions: [] }
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkCreate.retryAuth' }))
    await waitFor(() => expect(state.authReads).toBe(2))
    expect(screen.getByLabelText('shortLinkCreate.targetLabel')).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: 'shortLinkCreate.submit' })).toHaveProperty('disabled', true)
    barrier.resolve()
    await screen.findByText('shortLinkCreate.permissionRequired')
    expect(screen.getByRole('button', { name: 'shortLinkCreate.submit' })).toHaveProperty('disabled', true)
    expect(state.writes).toEqual([])
  })

  it('ignores a late successful retry after the real logout identity revocation', async () => {
    const { client, state } = mount(true)
    const submit = screen.getByRole('button', { name: 'shortLinkCreate.submit' })
    await waitFor(() => expect(submit).toHaveProperty('disabled', false))
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), target)
    state.failing = true
    await client.refetchQueries({ queryKey: ['auth', 'me'], exact: true })
    await screen.findByText('shortLinkCreate.authLoadFailed')
    const barrier = deferred()
    state.authBarrier = barrier.promise
    state.failing = false
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkCreate.retryAuth' }))
    await waitFor(() => expect(state.authReads).toBe(2))
    await revokeAccountIdentity(client)
    await screen.findByText('shortLinkCreate.permissionRequired')
    barrier.resolve()
    await setImmediate()
    expect(client.getQueryData(['auth', 'me'])).toEqual({ user: { id: '', username: 'guest', nickname: '', group: 'guest', permissions: [] } })
    expect(screen.getByLabelText('shortLinkCreate.targetLabel')).toHaveProperty('disabled', true)
    expect(submit).toHaveProperty('disabled', true)
    expect(state.writes).toEqual([])
  })
})
