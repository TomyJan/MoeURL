import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { defineComponent, nextTick, type Component, type PropType, type SetupContext } from 'vue'
import { componentStubs } from '@/test/component-stubs'
import AdminLinksPage from './AdminLinksPage.vue'
import { createDeferred } from '@/test/deferred'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const actor = { id: '00000000-0000-0000-0000-000000000001', username: 'manager', nickname: '', group: 'admin', permissions: ['admin:access', 'short_link:read_all', 'short_link:update_all', 'short_link:delete_all'] }
const link = { id: '00000000-0000-0000-0000-000000000020', slug: 'handoff', url: 'https://short.example/handoff', targetUrl: 'https://example.com', title: '', tags: [], owner: { id: 'old', username: 'original', nickname: '' }, updatedAt: '2026-10-23T00:00:00.123456Z', createdAt: '2026-10-23T00:00:00Z', status: 'active', redirectMode: 'direct', intermediateDelaySeconds: 5, expiresAt: null, expired: false, passwordEnabled: false, maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false }
const clients: QueryClient[] = []
/** Serves actual list and transfer API contracts while retaining Vue Query and page behavior. */
function mount(permissions = actor.permissions, pending?: Promise<Response>, listStub?: Component) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client)
  client.setQueryData(['auth', 'me'], { user: { ...actor, permissions } })
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    if (String(url).endsWith('/transfer') && pending) return pending
    return new Response(JSON.stringify({ code: 0, message: 'OK', data: { items: [link] }, meta: { total: 1 } }))
  })
  vi.stubGlobal('fetch', fetcher)
  return { ...render(AdminLinksPage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: { ...componentStubs, ...(listStub ? { ConsoleLinkList: listStub } : {}) } } }), client, fetcher }
}
/** Opens the real row menu after the administrative list loads. */
async function menu() { await screen.findByTestId('console-link-list'); await fireEvent.click(screen.getByRole('button', { name: 'links.actions.more' })) }
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals() })
describe('administrative ownership entry', () => {
  it('opens a fixed snapshot, blocks batch and row writes, and restores controls after cancel', async () => {
    mount(); await menu()
    await fireEvent.click(screen.getByRole('menuitem', { name: 'transfer.action' }))
    expect(screen.getByRole('dialog').textContent).toContain(link.url)
    expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).disabled).toBe(true)
    await fireEvent.click(screen.getByRole('button', { name: 'links.actions.more' }))
    for (const action of ['links.actions.configure', 'links.actions.disable', 'links.actions.delete', 'transfer.action']) {
      const item = screen.getByRole('menuitem', { name: action })
      expect(item.getAttribute('aria-disabled')).toBe('true')
      await fireEvent.click(item)
      if (action !== 'transfer.action') await fireEvent.click(screen.getByRole('button', { name: 'links.actions.more' }))
    }
    expect(screen.queryByText('shortLinkSettings.title')).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: 'transfer.cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).disabled).toBe(false)
  })
  it('hides transfer without full update permission', async () => {
    mount(['admin:access', 'short_link:read_all']); await menu()
    expect(screen.queryByRole('menuitem', { name: 'transfer.action' })).toBeNull()
  })
  it('waits for the conflict refresh before offering a new ownership snapshot', async () => {
    mount(); await menu()
    const refreshed = createDeferred<Response>()
    vi.mocked(fetch).mockImplementation(async url => String(url).endsWith('/transfer')
      ? new Response(JSON.stringify({ code: 200116, message: 'Changed', data: null, meta: {} }))
      : refreshed.promise)
    await fireEvent.click(screen.getByRole('menuitem', { name: 'transfer.action' }))
    await fireEvent.update(screen.getByLabelText('transfer.recipient'), 'recipient')
    await fireEvent.click(screen.getByLabelText('transfer.confirm'))
    await fireEvent.click(screen.getByRole('button', { name: 'transfer.save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await fireEvent.click(screen.getByRole('button', { name: 'links.actions.more' }))
    expect(screen.queryByRole('menuitem', { name: 'transfer.action' })).toBeNull()
    refreshed.resolve(new Response(JSON.stringify({ code: 0, message: 'OK', data: { items: [{ ...link, owner: { ...link.owner, username: 'latest-owner' }, updatedAt: '2026-10-23T00:00:00.123457Z' }] }, meta: { total: 1 } })))
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'transfer.action' }))
    await fireEvent.update(screen.getByLabelText('transfer.recipient'), 'recipient')
    await fireEvent.click(screen.getByLabelText('transfer.confirm'))
    vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: { id: link.id, ownerId: actor.id, updatedAt: '2026-10-23T00:00:00.123458Z' }, meta: {} })))
    await fireEvent.click(screen.getByRole('button', { name: 'transfer.save' }))
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/transfer'))).toHaveLength(2))
    const requests = vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith('/transfer'))
    expect(JSON.parse(requests[1]![1]!.body as string).expectedUpdatedAt).toBe('2026-10-23T00:00:00.123457Z')
  })
  it('ignores a queued transfer while its list is refreshing', async () => {
    let delayedTransfer!: () => void
    const stub = { emits: ['transfer'], setup(_props: Record<string, unknown>, { emit }: SetupContext) {
      delayedTransfer = () => emit('transfer', link)
      return {}
    }, template: '<div data-testid="queued-list" />' }
    const view = mount(actor.permissions, undefined, stub)
    await screen.findByTestId('queued-list')
    const refreshed = createDeferred<Response>()
    vi.mocked(fetch).mockImplementation(() => refreshed.promise)
    const refreshing = view.client.invalidateQueries({ queryKey: ['admin-short-link'] })
    await nextTick()
    delayedTransfer()
    await Promise.resolve()
    expect(screen.queryByRole('dialog')).toBeNull()
    refreshed.resolve(new Response(JSON.stringify({ code: 0, message: 'OK', data: { items: [link] }, meta: { total: 1 } })))
    await refreshing
  })
  it('does not overlap an existing settings editor', async () => {
    mount(); await menu()
    await fireEvent.click(screen.getByRole('menuitem', { name: 'links.actions.configure' }))
    await fireEvent.click(screen.getByRole('button', { name: 'links.actions.more' }))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'transfer.action' }))
    expect(screen.queryByText('transfer.title')).toBeNull()
    expect(screen.getByText('shortLinkSettings.title')).toBeTruthy()
  })
  it('ignores a queued row activation after the row disappeared on refetch', async () => {
    let delayedTransfer!: () => void
    const stub = defineComponent({ props: { links: { type: Array as PropType<typeof link[]>, required: true } }, emits: ['transfer'], setup(_props, { emit }) {
      delayedTransfer = () => emit('transfer', link)
      return {}
    }, template: '<div data-testid="queued-list">{{ links[0]?.id }}</div>' })
    const view = mount(actor.permissions, undefined, stub)
    await screen.findByTestId('queued-list')
    const key = view.client.getQueryCache().findAll({ queryKey: ['admin-short-link'] })[0]!.queryKey
    view.client.setQueryData(key, { items: [{ ...link, id: '00000000-0000-0000-0000-000000000021' }], meta: { total: 1 } })
    // Keep the list mounted while dropping only the queued row, as during a filtered refetch.
    await screen.findByText('00000000-0000-0000-0000-000000000021')
    delayedTransfer()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
