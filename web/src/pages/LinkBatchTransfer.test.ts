import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { nextTick, type Component, type SetupContext } from 'vue'
import { toast } from 'vue-sonner'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import AdminLinksPage from './AdminLinksPage.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string, values?: { username?: string }) => values?.username ? `${key}: ${values.username}` : key }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const actor = { id: '00000000-0000-0000-0000-000000000001', username: 'manager', nickname: '', group: 'admin', permissions: ['admin:access', 'short_link:read_all', 'short_link:update_all', 'short_link:delete_all'] }
const links = [20, 21].map(number => ({ id: `00000000-0000-0000-0000-0000000000${number}`, slug: `link${number}`, url: `https://go.example/link${number}`, targetUrl: 'https://example.com', title: '', tags: [], owner: { id: 'old', username: 'original', nickname: '' }, updatedAt: '2026-10-25T00:00:00.123456Z', createdAt: '2026-10-25T00:00:00Z', status: 'active', redirectMode: 'direct', intermediateDelaySeconds: 5, expiresAt: null, expired: false, passwordEnabled: false, maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false }))
const clients: QueryClient[] = []
/** Returns the real wire envelope used by the list and batch boundaries. */
function response(data: unknown = { items: links }, code = 0) { return new Response(JSON.stringify({ code, message: 'private diagnostic', data, meta: { total: 2 } })) }
/** Mounts the real page, batch toolbar, dialog and HTTP client. */
function mount(toolbarStub?: Component) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client); client.setQueryData(['auth', 'me'], { user: actor })
  const fetcher = vi.fn<typeof fetch>(async () => response())
  vi.stubGlobal('fetch', fetcher)
  return { ...render(AdminLinksPage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: { ...componentStubs, ...(toolbarStub ? { ShortLinkBatchToolbar: toolbarStub } : {}) } } }), client, fetcher }
}
/** Chooses both current rows and opens a frozen batch confirmation. */
async function open() {
  await screen.findByTestId('console-link-list')
  await fireEvent.click(screen.getAllByRole('checkbox')[0]!)
  await fireEvent.click(screen.getByTestId('batch-transfer'))
}
/** Acknowledges consequences and enters the exact recipient. */
async function confirm() {
  await fireEvent.update(screen.getByLabelText('transfer.recipient'), ' Recipient ')
  await fireEvent.click(screen.getByLabelText('transfer.confirm'))
}
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.clearAllMocks() })
describe('administrative batch ownership confirmation', () => {
  it('requires confirmation, pins versions and owners, excludes overlapping actions and clears only successful selection', async () => {
    const view = mount(); await open()
    expect(screen.getByRole('dialog').textContent).toContain('original')
    expect((screen.getByRole('button', { name: 'transfer.save' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('batch-disable') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).disabled).toBe(true)
    await fireEvent.click(screen.getAllByRole('button', { name: 'links.actions.more' })[0]!)
    for (const action of ['links.actions.configure', 'links.actions.disable', 'links.actions.delete', 'transfer.action']) expect(screen.getByRole('menuitem', { name: action }).getAttribute('aria-disabled')).toBe('true')
    const key = view.client.getQueryCache().findAll({ queryKey: ['admin-short-link'] })[0]!.queryKey
    view.client.setQueryData(key, { items: links.map(link => ({ ...link, updatedAt: '2026-10-25T00:00:00.999999Z', owner: { ...link.owner, username: 'changed-owner' } })), meta: { total: 2 } })
    await nextTick()
    expect(screen.getByRole('dialog').textContent).not.toContain('changed-owner')
    const pending = createDeferred<Response>()
    view.fetcher.mockImplementation(url => String(url).endsWith('/batch-transfer') ? pending.promise : Promise.resolve(response()))
    await confirm(); await fireEvent.click(screen.getByRole('button', { name: 'transfer.save' }))
    await waitFor(() => expect(view.client.isMutating()).toBe(1))
    await fireEvent.click(screen.getByRole('button', { name: 'transfer.cancel' }))
    await fireEvent.click(screen.getByRole('button', { name: 'transfer.save' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    const writes = view.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/batch-transfer'))
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0]![1]!.body as string)).toEqual({ items: links.map(link => ({ id: link.id, expectedUpdatedAt: link.updatedAt })), newOwnerUsername: ' Recipient ' })
    pending.resolve(response({ transferredCount: 1, unchangedCount: 1 }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getAllByRole('checkbox').every(box => !(box as HTMLInputElement).checked)).toBe(true)
    expect(toast.success).toHaveBeenCalledWith('batchTransfer.transferred batchTransfer.unchanged')
  })
  it.each([200117, 900000])('keeps username, acknowledgment and valid selection after ordinary failure %i', async code => {
    const view = mount(); await open(); await confirm()
    view.fetcher.mockResolvedValue(response(null, code))
    await fireEvent.click(screen.getByRole('button', { name: 'transfer.save' }))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(code === 200117 ? 'transfer.recipientUnavailable' : 'transfer.failed'))
    expect((screen.getByLabelText('transfer.recipient') as HTMLInputElement).value).toBe(' Recipient ')
    expect((screen.getByLabelText('transfer.confirm') as HTMLInputElement).checked).toBe(true)
    expect((screen.getAllByRole('checkbox')[1] as HTMLInputElement).checked).toBe(true)
    await fireEvent.click(screen.getByRole('button', { name: 'transfer.cancel' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('closes stale versions on conflict, keeps cached errors blocked and captures new versions only after successful refresh', async () => {
    const view = mount(); await open(); await confirm()
    const refresh = createDeferred<Response>()
    view.fetcher.mockImplementation(url => String(url).endsWith('/batch-transfer') ? Promise.resolve(response(null, 200116)) : refresh.promise)
    await fireEvent.click(screen.getByRole('button', { name: 'transfer.save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect((screen.getByTestId('batch-transfer') as HTMLButtonElement).disabled).toBe(true)
    refresh.reject(new Error('offline'))
    await screen.findByRole('alert')
    expect((screen.getByTestId('batch-transfer') as HTMLButtonElement).disabled).toBe(true)
    view.fetcher.mockResolvedValue(response({ items: links.map(link => ({ ...link, updatedAt: '2026-10-25T00:00:00.999999Z' })) }))
    await view.client.invalidateQueries({ queryKey: ['admin-short-link'] })
    await fireEvent.click(screen.getByTestId('batch-transfer')); await confirm()
    view.fetcher.mockResolvedValue(response({ transferredCount: 2, unchangedCount: 0 }))
    await fireEvent.click(screen.getByRole('button', { name: 'transfer.save' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const writes = view.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/batch-transfer'))
    expect(JSON.parse(writes[1]![1]!.body as string).items[0].expectedUpdatedAt).toBe('2026-10-25T00:00:00.999999Z')
  })
  it.each([['identity', 0], ['permission', 0], ['unmount', 0], ['identity', 200116], ['permission', 200117], ['unmount', 900000]] as const)('isolates late response after %s change (%i)', async (reason, code) => {
    const view = mount(); await open(); await confirm()
    const ownershipKeys = ['admin-short-link', 'short-link', 'short-link-overview', 'short-link-statistics', 'insights'].map(key => [key, 'previous-owner'])
    ownershipKeys.forEach(key => view.client.setQueryData(key, { total: 5 }))
    const pending = createDeferred<Response>()
    view.fetcher.mockImplementation(url => String(url).endsWith('/batch-transfer') ? pending.promise : Promise.resolve(response()))
    await fireEvent.click(screen.getByRole('button', { name: 'transfer.save' }))
    await waitFor(() => expect(view.client.isMutating()).toBe(1))
    if (reason === 'unmount') view.unmount()
    else {
      view.client.setQueryData(['auth', 'me'], { user: reason === 'identity' ? { ...actor, id: 'other' } : { ...actor, permissions: ['admin:access', 'short_link:read_all', 'short_link:delete_all'] } })
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      if (reason === 'identity') { await screen.findByTestId('console-link-list'); await fireEvent.click(screen.getAllByRole('checkbox')[1]!) }
    }
    pending.resolve(response(code === 0 ? { transferredCount: 2, unchangedCount: 0 } : null, code))
    await waitFor(() => expect(view.client.isMutating()).toBe(0))
    expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled()
    for (const key of ownershipKeys) expect(view.client.getQueryState(key)?.isInvalidated).toBe(code === 0)
    if (reason === 'identity') expect((screen.getAllByRole('checkbox')[1] as HTMLInputElement).checked).toBe(true)
  })
  it('rejects same-tick revocation and unapplied filter entry', async () => {
    const view = mount(); await open(); await confirm()
    view.client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: ['admin:access', 'short_link:read_all'] } })
    await fireEvent.click(screen.getByRole('button', { name: 'transfer.save' }))
    expect(view.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/batch-transfer'))).toHaveLength(0)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    view.client.setQueryData(['auth', 'me'], { user: actor }); await nextTick()
    await fireEvent.update(screen.getByLabelText('filter.keyword'), 'pending')
    expect((screen.getByTestId('batch-transfer') as HTMLButtonElement).disabled).toBe(true)
  })
  it('blocks batch entry while an export is outstanding and export while a batch dialog exists', async () => {
    const view = mount()
    view.client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: [...actor.permissions, 'short_link:export'] } })
    await screen.findByTestId('console-link-list')
    await fireEvent.click(screen.getAllByRole('checkbox')[0]!)
    const pending = createDeferred<Response>()
    view.fetcher.mockImplementation(url => String(url).includes('/export') ? pending.promise : Promise.resolve(response()))
    await fireEvent.click(screen.getByTestId('short-link-list-export'))
    expect((screen.getByTestId('batch-transfer') as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.click(screen.getByTestId('batch-transfer'))
    expect(screen.queryByRole('dialog')).toBeNull()
    pending.resolve(response(null, 900000))
    await waitFor(() => expect((screen.getByTestId('batch-transfer') as HTMLButtonElement).disabled).toBe(false))
    await fireEvent.click(screen.getByTestId('batch-transfer'))
    expect((screen.getByTestId('short-link-list-export') as HTMLButtonElement).disabled).toBe(true)
  })
  it('revokes the snapshot and selection for a permission loss restored within one tick', async () => {
    const view = mount(); await open(); await confirm()
    const pending = createDeferred<Response>()
    view.fetcher.mockImplementation(url => String(url).endsWith('/batch-transfer') ? pending.promise : Promise.resolve(response()))
    await fireEvent.click(screen.getByRole('button', { name: 'transfer.save' }))
    await waitFor(() => expect(view.client.isMutating()).toBe(1))
    view.client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: ['admin:access', 'short_link:read_all', 'short_link:delete_all'] } })
    view.client.setQueryData(['auth', 'me'], { user: actor })
    await nextTick()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect((screen.getAllByRole('checkbox')[1] as HTMLInputElement).checked).toBe(false)
    pending.resolve(response({ transferredCount: 2, unchangedCount: 0 }))
    await waitFor(() => expect(view.client.isMutating()).toBe(0))
    expect(toast.success).not.toHaveBeenCalled()
  })
  it('rejects queued toolbar events without selection or during a same-tick list refresh', async () => {
    let activate!: () => void
    const stub = { emits: ['transfer'], setup(_props: Record<string, unknown>, { emit }: SetupContext) { activate = () => emit('transfer'); return {} }, template: '<div />' }
    const view = mount(stub)
    await screen.findByTestId('console-link-list')
    activate(); await nextTick()
    expect(screen.queryByRole('dialog')).toBeNull()
    await fireEvent.click(screen.getAllByRole('checkbox')[1]!)
    const refresh = createDeferred<Response>()
    view.fetcher.mockReturnValue(refresh.promise)
    const refreshing = view.client.invalidateQueries({ queryKey: ['admin-short-link'] })
    activate(); await nextTick()
    expect(screen.queryByRole('dialog')).toBeNull()
    refresh.resolve(response()); await refreshing
    await waitFor(() => expect((screen.getAllByRole('checkbox')[1] as HTMLInputElement).disabled).toBe(false))
    activate(); await nextTick()
    expect(screen.getByRole('dialog').textContent).toContain(links[0]!.url)
    expect(screen.getByRole('dialog').textContent).not.toContain(links[1]!.url)
  })
})
