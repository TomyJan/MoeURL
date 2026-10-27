import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ShortLinkCreatePanel from './ShortLinkCreatePanel.vue'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import { revokeAccountIdentity } from '@/shared/preferences/useAccountPreferences'
import { toast } from 'vue-sonner'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
const globalId = '11111111-1111-4111-8111-111111111111'
const personalId = '22222222-2222-4222-8222-222222222222'
const clients: QueryClient[] = []

/** Mounts the real panel and query stack with HTTP as the only external boundary. */
function mount(options: { preference?: () => Promise<unknown>; single?: boolean; empty?: boolean; assignedOnly?: boolean; create?: () => Promise<Response> } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } })
  clients.push(client)
  const bodies: unknown[] = []
  const user = { id: 'A', username: 'alice', nickname: '', group: 'user', permissions: ['short_link:create', 'domain:use_default', 'domain:use_assigned'] }
  client.setQueryData(['auth', 'me'], { user })
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    let data: unknown
    if (url === '/api/v1/auth/me') data = { user }
    else if (url === '/api/v1/domain/available') data = { items: options.empty ? [] : [
      ...options.assignedOnly ? [] : [{ id: globalId, host: 'global.example', displayName: 'Global', isDefault: true }],
      ...options.single ? [] : [{ id: personalId, host: 'personal.example', displayName: 'Personal', isDefault: false }],
    ] }
    else if (url === '/api/v1/user/domain-preference') data = { preference: options.preference ? await options.preference() : { domainId: personalId, updatedAt: '2026-10-27T00:00:00.123456Z' } }
    else if (url === '/api/v1/short-link/create') { bodies.push(JSON.parse(init.body as string)); return options.create ? options.create() : new Response(JSON.stringify({ code: 200114, message: 'changed', data: null, meta: {} })) }
    else throw new Error(`Unexpected request ${url}`)
    return new Response(JSON.stringify({ code: 0, message: '', data, meta: {} }))
  }))
  render(ShortLinkCreatePanel, { global: { stubs: componentStubs, plugins: [[VueQueryPlugin, { queryClient: client }]] } })
  return { client, bodies, user, options }
}
afterEach(() => { cleanup(); clients.splice(0).forEach((client) => client.clear()); vi.unstubAllGlobals() })
describe('account domain selection through real queries', () => {
  it('uses the saved available domain in the selector and creation payload', async () => {
    const { bodies } = mount()
    await waitFor(() => expect((screen.getByLabelText('shortLinkCreate.domainLabel') as HTMLSelectElement).value).toBe(personalId))
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://target.example/docs')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    await waitFor(() => expect(bodies).toEqual([{ targetUrl: 'https://target.example/docs', domainId: personalId }]))
  })
  it('blocks unknown initial preference but allows an explicit global choice over its late response', async () => {
    const pending = createDeferred<unknown>()
    const { bodies } = mount({ preference: () => pending.promise })
    const select = await screen.findByLabelText('shortLinkCreate.domainLabel')
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://target.example/docs')
    expect((screen.getByText('shortLinkCreate.submit') as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.update(select, personalId)
    await fireEvent.update(select, '')
    pending.resolve({ domainId: personalId, updatedAt: '2026-10-27T00:00:00Z' })
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe(''))
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    await waitFor(() => expect(bodies).toEqual([{ targetUrl: 'https://target.example/docs' }]))
  })
  it('allows explicit system recovery after a failed preference even with one domain', async () => {
    const { bodies } = mount({ single: true, preference: async () => { throw new Error('offline') } })
    await screen.findByText('domainPreference.loadFailed')
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://target.example/docs')
    expect((screen.getByText('shortLinkCreate.submit') as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.click(screen.getByText('domainPreference.useSystem'))
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    await waitFor(() => expect(bodies).toEqual([{ targetUrl: 'https://target.example/docs' }]))
  })
  it('does not render a late successful creation after same-account relogin', async () => {
    const pending = createDeferred<Response>()
    const success = vi.spyOn(toast, 'success')
    const { client, bodies, user } = mount({ create: () => pending.promise })
    await waitFor(() => expect((screen.getByLabelText('shortLinkCreate.domainLabel') as HTMLSelectElement).value).toBe(personalId))
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://target.example/docs')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    await waitFor(() => expect(bodies).toHaveLength(1))
    revokeAccountIdentity(client)
    client.setQueryData(['auth', 'me'], { user })
    pending.resolve(new Response(JSON.stringify({ code: 0, message: '', meta: {}, data: { shortLink: {
      id: 'link1', url: 'https://personal.example/abc123', slug: 'abc123', targetUrl: 'https://target.example/docs', title: '', tags: [], status: 'active', redirectMode: 'direct', intermediateDelaySeconds: 5, expiresAt: null, expired: false, passwordEnabled: false, maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false, createdAt: '2026-10-27T00:00:00Z',
    } } })))
    await waitFor(() => expect((screen.getByText('shortLinkCreate.submit') as HTMLButtonElement).disabled).toBe(false))
    expect(screen.queryByTestId('short-link-create-result')).toBeNull()
    expect(success).not.toHaveBeenCalled()
    success.mockRestore()
  })
  it('omits an explicitly saved global UUID and safely warns about unavailable saved IDs', async () => {
    const { bodies, client } = mount({ preference: async () => ({ domainId: globalId, updatedAt: '2026-10-27T00:00:00Z' }) })
    await waitFor(() => expect((screen.getByText('shortLinkCreate.submit') as HTMLButtonElement).disabled).toBe(false))
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://target.example/docs')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    await waitFor(() => expect(bodies).toEqual([{ targetUrl: 'https://target.example/docs' }]))
    const key = client.getQueriesData({ queryKey: ['user', 'domain-preference'] })[0]![0]
    client.setQueryData(key, { domainId: '33333333-3333-4333-8333-333333333333', updatedAt: '2026-10-27T00:00:01Z' })
    await screen.findByText('domainPreference.fallback')
    expect((screen.getByLabelText('shortLinkCreate.domainLabel') as HTMLSelectElement).value).toBe('')
    expect(screen.queryByText('33333333-3333-4333-8333-333333333333')).toBeNull()
  })
  it('uses the existing first available domain when the saved and global choices are unavailable', async () => {
    const { bodies } = mount({ assignedOnly: true, preference: async () => ({ domainId: globalId, updatedAt: '2026-10-27T00:00:00Z' }) })
    await screen.findByText('domainPreference.fallback')
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://target.example/docs')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    await waitFor(() => expect(bodies).toEqual([{ targetUrl: 'https://target.example/docs', domainId: personalId }]))
  })
  it('keeps creation disabled for no available domains after preference success', async () => {
    mount({ empty: true })
    await screen.findByText('shortLinkCreate.noAvailableDomains')
    expect((screen.getByText('shortLinkCreate.submit') as HTMLButtonElement).disabled).toBe(true)
  })
  it('retries a failed preference and clears all prior epoch domain queries on A to B to A', async () => {
    const { options, client, user } = mount({ preference: async () => { throw new Error('offline') } })
    await screen.findByText('domainPreference.loadFailed')
    options.preference = async () => ({ domainId: personalId, updatedAt: '2026-10-27T00:00:00Z' })
    await fireEvent.click(screen.getByText('domainPreference.retry'))
    await waitFor(() => expect((screen.getByLabelText('shortLinkCreate.domainLabel') as HTMLSelectElement).value).toBe(personalId))
    const pending = createDeferred<unknown>()
    options.preference = () => pending.promise
    client.setQueryData(['auth', 'me'], { user: { ...user, id: 'B' } })
    await waitFor(() => expect(client.getQueryState(['user', 'domain-preference', 'B', 2])?.fetchStatus).toBe('fetching'))
    options.preference = async () => ({ domainId: null, updatedAt: null })
    client.setQueryData(['auth', 'me'], { user })
    await waitFor(() => expect((screen.getByText('shortLinkCreate.submit') as HTMLButtonElement).disabled).toBe(false))
    pending.resolve({ domainId: personalId, updatedAt: '2026-10-27T00:00:00Z' })
    await pending.promise
    expect(client.getQueriesData({ queryKey: ['user', 'domain-preference', 'B'] })).toEqual([])
    expect(client.getQueriesData({ queryKey: ['domain', 'available', 'B'] })).toEqual([])
    expect((screen.getByLabelText('shortLinkCreate.domainLabel') as HTMLSelectElement).value).toBe('')
  })
  it('adopts the latest preference after successful creation and explicit reset', async () => {
    const shortLink = { id: 'link', url: 'https://global.example/abc123', slug: 'abc123', targetUrl: 'https://target.example/docs', title: '', tags: [], status: 'active', redirectMode: 'direct', intermediateDelaySeconds: 5, expiresAt: null, expired: false, passwordEnabled: false, maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false, createdAt: '2026-10-27T00:00:00Z' }
    const { client, bodies } = mount({ create: async () => new Response(JSON.stringify({ code: 0, message: '', data: { shortLink }, meta: {} })) })
    const select = await screen.findByLabelText('shortLinkCreate.domainLabel')
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe(personalId))
    await fireEvent.update(select, '')
    const key = client.getQueriesData({ queryKey: ['user', 'domain-preference'] })[0]![0]
    client.setQueryData(key, { domainId: personalId, updatedAt: '2026-10-27T00:00:01Z' })
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://target.example/docs')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    await screen.findByTestId('short-link-create-result')
    expect(bodies).toEqual([{ targetUrl: 'https://target.example/docs' }])
    expect((select as HTMLSelectElement).value).toBe(personalId)
    await fireEvent.update(select, '')
    await fireEvent.click(screen.getByText('shortLinkCreate.reset'))
    expect((select as HTMLSelectElement).value).toBe(personalId)
  })
  it('keeps an empty-domain recovery action safe and creation disabled', async () => {
    mount({ empty: true, preference: async () => { throw new Error('offline') } })
    await screen.findByText('domainPreference.loadFailed')
    await fireEvent.click(screen.getByText('domainPreference.useSystem'))
    expect((screen.getByText('shortLinkCreate.submit') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('shortLinkCreate.noAvailableDomains')).toBeTruthy()
  })
  it('warns and falls back after a manually selected global domain disappears', async () => {
    const { client, bodies } = mount()
    const select = await screen.findByLabelText('shortLinkCreate.domainLabel')
    await waitFor(() => expect((select as HTMLSelectElement).value).toBe(personalId))
    await fireEvent.update(select, '')
    const key = client.getQueriesData({ queryKey: ['domain', 'available'] })[0]![0]
    client.setQueryData(key, { items: [{ id: personalId, host: 'personal.example', displayName: 'Personal', isDefault: false }] })
    await screen.findByText('domainPreference.fallback')
    await fireEvent.update(screen.getByLabelText('shortLinkCreate.targetLabel'), 'https://target.example/docs')
    await fireEvent.click(screen.getByText('shortLinkCreate.submit'))
    await waitFor(() => expect(bodies).toEqual([{ targetUrl: 'https://target.example/docs', domainId: personalId }]))
  })
})
