import { fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { nextTick, type Component, type SetupContext } from 'vue'
import { toast } from 'vue-sonner'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import MyLinksPage from './MyLinksPage.vue'
import AdminLinksPage from './AdminLinksPage.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const permissions = ['admin:access', 'short_link:read_all', 'short_link:update_all', 'short_link:delete_all', 'short_link:read_own', 'short_link:update_own', 'short_link:delete_own', 'short_link:set_metadata', 'short_link:export']
const actor = { id: '00000000-0000-0000-0000-000000000001', username: 'manager', nickname: '', group: 'admin', permissions }
const links = [20, 21].map(number => ({ id: `00000000-0000-0000-0000-0000000000${number}`, slug: `link${number}`, url: `https://go.example/link${number}`, targetUrl: 'https://example.com', title: 'Preserved', tags: ['Original'], owner: { id: actor.id, username: 'manager', nickname: '' }, updatedAt: '2026-10-26T00:00:00.123456789Z', createdAt: '2026-10-26T00:00:00Z', status: 'active', redirectMode: 'direct', intermediateDelaySeconds: 5, expiresAt: null, expired: false, passwordEnabled: false, maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false }))
const clients: QueryClient[] = []
/** Keeps wire responses and Vue Query real while controlling the external HTTP boundary. */
function response(data: unknown = { items: links }, code = 0, status = 200) { return new Response(JSON.stringify({ code, message: 'private diagnostic', data, meta: { total: 2 } }), { status }) }
/** Mirrors the personal wire shape, which has no administrative owner projection. */
function ownLink(link: typeof links[number]) { const result: Partial<typeof link> = { ...link }; delete result.owner; return result }
/** Mounts both real page flows, including row actions, export, toolbar and confirmation. */
function mount(context: 'own' | 'admin', grants = permissions, toolbarStub?: Component) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client); client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: grants } })
  const fetcher = vi.fn<typeof fetch>(async url => {
    const items = context === 'own' ? links.map(ownLink) : links
    return String(url).endsWith('/batch-tags') ? response({ changedCount: 1, unchangedCount: 1 }) : response({ items })
  })
  vi.stubGlobal('fetch', fetcher)
  return { ...render(context === 'own' ? MyLinksPage : AdminLinksPage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: { ...componentStubs, ...(toolbarStub ? { ShortLinkBatchToolbar: toolbarStub } : {}) } } }), client, fetcher, key: context === 'own' ? 'short-link' : 'admin-short-link' }
}
/** Selects the visible list using its actual select-all control. */
async function select() { await screen.findByTestId('console-link-list'); await fireEvent.click(screen.getAllByRole('checkbox')[0]!) }
/** Opens a frozen confirmation from the real batch toolbar. */
async function open() { await select(); await fireEvent.click(screen.getByTestId('batch-tags')) }
/** Enters newline-delimited labels and explicitly acknowledges their scope. */
async function confirm(operation = 'add', tags = ' 项目 A \nComma, stays whole') {
  await fireEvent.update(screen.getByLabelText('batchTags.operation'), operation)
  await fireEvent.update(screen.getByLabelText('batchTags.tags'), tags)
  await fireEvent.click(screen.getByLabelText('batchTags.confirm'))
}
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.clearAllMocks() })

describe.each(['own', 'admin'] as const)('%s batch tag confirmation', context => {
  it.each(['add', 'remove', 'replace'])('pins snapshot and dirty %s draft across refresh and submits only after explicit approval', async operation => {
    const view = mount(context); await open()
    expect(screen.getByRole('dialog').textContent).toContain('Original')
    expect((screen.getByTestId('batch-tags-save') as HTMLButtonElement).disabled).toBe(true)
    await confirm(operation)
    const key = view.client.getQueryCache().findAll({ queryKey: [view.key] })[0]!.queryKey
    const items = links.map(({ owner, ...link }) => ({ ...link, ...(context === 'admin' ? { owner } : {}), tags: ['New server label'], updatedAt: '2026-10-26T01:00:00.999999Z' }))
    view.client.setQueryData(key, { items, meta: { total: 2 } }); await nextTick()
    expect(screen.getByRole('dialog').textContent).not.toContain('New server label')
    expect((screen.getByLabelText('batchTags.tags') as HTMLTextAreaElement).value).toBe(' 项目 A \nComma, stays whole')
    await fireEvent.click(screen.getByTestId('batch-tags-save'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const writes = view.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/batch-tags'))
    expect(writes).toHaveLength(1)
    expect(writes[0]![0]).toBe(`/api/v1/${context === 'admin' ? 'admin/' : ''}short-link/batch-tags`)
    expect(JSON.parse(writes[0]![1]!.body as string)).toEqual({ items: links.map(link => ({ id: link.id, expectedUpdatedAt: '2026-10-26T00:00:00.123456789Z' })), operation, tags: ['项目 A', 'Comma, stays whole'] })
    expect(screen.getAllByRole('checkbox').every(box => !(box as HTMLInputElement).checked)).toBe(true)
    expect(toast.success).toHaveBeenCalledWith('batchTags.changed batchTags.unchanged')
  })
  it.each([200119, 900000, 'network'] as const)('keeps the draft, acknowledgment and selection on ordinary failure %s', async code => {
    const view = mount(context); await open(); await confirm('remove')
    if (code === 'network') view.fetcher.mockRejectedValue(new Error('offline'))
    else view.fetcher.mockResolvedValue(response(null, code))
    await fireEvent.click(screen.getByTestId('batch-tags-save'))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(code === 200119 ? 'batchTags.limitExceeded' : 'batchTags.failed'))
    expect((screen.getByLabelText('batchTags.operation') as HTMLSelectElement).value).toBe('remove')
    expect((screen.getByLabelText('batchTags.tags') as HTMLTextAreaElement).value).toBe(' 项目 A \nComma, stays whole')
    expect((screen.getByLabelText('batchTags.confirm') as HTMLInputElement).checked).toBe(true)
    expect((screen.getAllByRole('checkbox')[1] as HTMLInputElement).checked).toBe(true)
    await fireEvent.click(screen.getByTestId('batch-tags-cancel'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it.each([120001, 401, 403])('retires server-denied confirmation %i until current authority is read again', async code => {
    const view = mount(context); await open(); await confirm()
    const readAuthority = createDeferred<Response>()
    const originalFetcher = view.fetcher.getMockImplementation()!
    view.fetcher.mockImplementation((url, init) => String(url).endsWith('/batch-tags')
      ? Promise.resolve(response(null, code, code === 120001 ? 200 : code))
      : String(url).endsWith('/auth/me') ? readAuthority.promise : originalFetcher(url, init))
    await fireEvent.click(screen.getByTestId('batch-tags-save'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(toast.error).toHaveBeenCalledWith('batchTags.accessChanged')
    await waitFor(() => expect(view.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/auth/me'))).toHaveLength(1))
    expect(view.client.getQueryData(['auth', 'me'])).toBeUndefined()
    expect(screen.queryByTestId('batch-tags')).toBeNull()
    readAuthority.resolve(response({ user: actor }))
    await screen.findByTestId('console-link-list')
    expect(screen.getAllByRole('checkbox').every(box => !(box as HTMLInputElement).checked)).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
    await open()
    expect((screen.getByLabelText('batchTags.confirm') as HTMLInputElement).checked).toBe(false)
    expect((screen.getByLabelText('batchTags.tags') as HTMLTextAreaElement).value).toBe('')
    expect((screen.getByTestId('batch-tags-save') as HTMLButtonElement).disabled).toBe(true)
    expect(view.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/batch-tags'))).toHaveLength(1)
  })
  it('keeps stale authority unusable when revalidation fails after a server denial', async () => {
    const view = mount(context); await open(); await confirm()
    view.fetcher.mockImplementation(async url => String(url).endsWith('/batch-tags')
      ? response(null, 120001) : response(null, 900000, 500))
    await fireEvent.click(screen.getByTestId('batch-tags-save'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(view.client.getQueryState(['auth', 'me'])?.status).toBe('error'))
    expect(view.client.getQueryData(['auth', 'me'])).toBeUndefined()
    expect(screen.queryByTestId('batch-tags')).toBeNull()
    expect(toast.error).toHaveBeenCalledWith('batchTags.accessChanged')
    expect(view.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/batch-tags'))).toHaveLength(1)
  })
  it('locks stale snapshots through conflict, failed refresh, and successful recovery', async () => {
    const view = mount(context); await open(); await confirm()
    const refresh = createDeferred<Response>()
    view.fetcher.mockImplementation(url => String(url).endsWith('/batch-tags') ? Promise.resolve(response(null, 200116)) : refresh.promise)
    await fireEvent.click(screen.getByTestId('batch-tags-save'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect((screen.getByTestId('batch-tags') as HTMLButtonElement).disabled).toBe(true)
    refresh.reject(new Error('offline')); await screen.findByRole('alert')
    expect((screen.getByTestId('batch-tags') as HTMLButtonElement).disabled).toBe(true)
    const items = links.map(({ owner, ...link }) => ({ ...link, ...(context === 'admin' ? { owner } : {}), updatedAt: '2026-10-26T00:00:00.123457Z' }))
    view.fetcher.mockResolvedValue(response({ items }))
    await view.client.invalidateQueries({ queryKey: [view.key] })
    await waitFor(() => expect((screen.getByTestId('batch-tags') as HTMLButtonElement).disabled).toBe(false))
    await fireEvent.click(screen.getByTestId('batch-tags')); await confirm()
    view.fetcher.mockImplementation(url => Promise.resolve(String(url).endsWith('/batch-tags') ? response({ changedCount: 2, unchangedCount: 0 }) : response({ items })))
    await fireEvent.click(screen.getByTestId('batch-tags-save'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const writes = view.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/batch-tags'))
    expect(JSON.parse(writes[1]![1]!.body as string).items[0].expectedUpdatedAt).toBe('2026-10-26T00:00:00.123457Z')
  })
  it.each(['short_link:set_metadata', `short_link:read_${context === 'own' ? 'own' : 'all'}`, `short_link:update_${context === 'own' ? 'own' : 'all'}`, ...(context === 'admin' ? ['admin:access'] : [])])('requires the original permission intersection including %s', async permission => {
    const view = mount(context, permissions.filter(value => value !== permission))
    await waitFor(() => expect(view.client.isFetching()).toBe(0))
    expect(screen.queryByTestId('batch-tags')).toBeNull()
  })
  it('rejects same-tick revoke/restore and unapplied filter entry', async () => {
    const view = mount(context); await open(); await confirm()
    view.client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: permissions.filter(value => value !== 'short_link:set_metadata') } })
    view.client.setQueryData(['auth', 'me'], { user: actor })
    await fireEvent.click(screen.getByTestId('batch-tags-save'))
    expect(view.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/batch-tags'))).toHaveLength(0)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await fireEvent.update(screen.getByLabelText('filter.keyword'), 'pending')
    expect((screen.getByTestId('batch-tags') as HTMLButtonElement).disabled).toBe(true)
  })
  it.each([['identity', 0], ['epoch', 0], ['permission', 0], ['unmount', 0], ['identity', 200116], ['permission', 200119], ['unmount', 900000], ['identity', 120001], ['identity', 401], ['identity', 403]] as const)('isolates late %s results (%i) while successful writes invalidate all five views', async (reason, code) => {
    const view = mount(context); await open(); await confirm()
    const keys = ['short-link', 'admin-short-link', 'short-link-overview', 'short-link-statistics', 'insights'].map(key => [key, 'previous-user'])
    keys.forEach(key => view.client.setQueryData(key, { total: 9 }))
    const pending = createDeferred<Response>()
    view.fetcher.mockImplementation(url => String(url).endsWith('/batch-tags') ? pending.promise : Promise.resolve(response({ items: context === 'admin' ? links : links.map(ownLink) })))
    await fireEvent.click(screen.getByTestId('batch-tags-save')); await waitFor(() => expect(view.client.isMutating()).toBe(1))
    if (reason === 'unmount') view.unmount()
    else {
      const user = reason === 'identity' ? { ...actor, id: 'new-user' } : reason === 'epoch' ? { ...actor, id: '', username: 'guest', group: 'guest', permissions: [] } : { ...actor, permissions: permissions.filter(value => value !== 'short_link:set_metadata') }
      view.client.setQueryData(['auth', 'me'], { user })
      if (reason === 'epoch') view.client.setQueryData(['auth', 'me'], { user: actor })
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      if (reason === 'identity' || reason === 'epoch') { await screen.findByTestId('console-link-list'); await fireEvent.click(screen.getAllByRole('checkbox')[1]!) }
    }
    pending.resolve(response(code === 0 ? { changedCount: 2, unchangedCount: 0 } : null, code))
    await waitFor(() => expect(view.client.isMutating()).toBe(0))
    expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled()
    for (const key of keys) expect(view.client.getQueryState(key)?.isInvalidated).toBe(code === 0)
    if (reason === 'identity' || reason === 'epoch') expect((screen.getAllByRole('checkbox')[1] as HTMLInputElement).checked).toBe(true)
  })
  it('blocks all outgoing writes and selection while pending, then releases cancellation', async () => {
    const view = mount(context); await open(); await confirm()
    for (const id of ['batch-enable', 'batch-disable', 'batch-delete', 'short-link-list-export', ...(context === 'admin' ? ['batch-transfer'] : [])]) expect((screen.getByTestId(id) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).disabled).toBe(true)
    await fireEvent.click(screen.getAllByRole('button', { name: 'links.actions.more' })[0]!)
    for (const action of ['links.actions.configure', 'links.actions.disable', 'links.actions.delete', ...(context === 'admin' ? ['transfer.action'] : [])]) {
      const item = screen.getByRole('menuitem', { name: action })
      expect(item.getAttribute('aria-disabled')).toBe('true'); await fireEvent.click(item)
      await fireEvent.click(screen.getAllByRole('button', { name: 'links.actions.more' })[0]!)
    }
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    const pending = createDeferred<Response>(); view.fetcher.mockImplementation(url => String(url).endsWith('/batch-tags') ? pending.promise : Promise.resolve(response()))
    await fireEvent.click(screen.getByTestId('batch-tags-save')); await waitFor(() => expect(view.client.isMutating()).toBe(1))
    await fireEvent.click(screen.getByTestId('batch-tags-cancel')); await fireEvent.click(screen.getByTestId('batch-tags-save'))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(view.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/batch-tags'))).toHaveLength(1)
    pending.resolve(response(null, 900000)); await waitFor(() => expect(view.client.isMutating()).toBe(0))
    await fireEvent.click(screen.getByTestId('batch-tags-cancel')); expect(screen.queryByRole('dialog')).toBeNull()
  })
  it.each(['settings', 'status', 'delete', 'batch', 'batch-delete', 'export', ...(context === 'admin' ? ['transfer', 'batch-transfer'] : [])])('blocks incoming tag editing during %s', async action => {
    const view = mount(context); await select()
    const pending = createDeferred<Response>(); view.fetcher.mockReturnValue(pending.promise)
    if (['settings', 'status', 'delete', 'transfer'].includes(action)) {
      await fireEvent.click(screen.getAllByRole('button', { name: 'links.actions.more' })[0]!)
      await fireEvent.click(screen.getByRole('menuitem', { name: action === 'settings' ? 'links.actions.configure' : action === 'status' ? 'links.actions.disable' : action === 'delete' ? 'links.actions.delete' : 'transfer.action' }))
    } else await fireEvent.click(screen.getByTestId(action === 'export' ? 'short-link-list-export' : action === 'batch' ? 'batch-enable' : action))
    expect((screen.getByTestId('batch-tags') as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.click(screen.getByTestId('batch-tags'))
    expect(screen.queryByTestId('batch-tags-save')).toBeNull()
    pending.resolve(response(null, 900000)); await waitFor(() => expect(view.client.isMutating()).toBe(0))
  })
  it('rejects queued entry without selection, stale cache, and missing list versions', async () => {
    let activate!: () => void
    const stub = { emits: ['tags'], setup(_props: Record<string, unknown>, { emit }: SetupContext) { activate = () => emit('tags'); return {} }, template: '<div />' }
    const view = mount(context, permissions, stub); await screen.findByTestId('console-link-list')
    activate(); await nextTick(); expect(screen.queryByRole('dialog')).toBeNull()
    await fireEvent.click(screen.getAllByRole('checkbox')[1]!)
    const refresh = createDeferred<Response>(); view.fetcher.mockReturnValue(refresh.promise)
    const refreshing = view.client.invalidateQueries({ queryKey: [view.key] }); activate(); await nextTick()
    expect(screen.queryByRole('dialog')).toBeNull()
    refresh.resolve(response({ items: context === 'admin' ? links : links.map(ownLink) })); await refreshing
    await waitFor(() => expect((screen.getAllByRole('checkbox')[1] as HTMLInputElement).disabled).toBe(false))
    const key = view.client.getQueryCache().findAll({ queryKey: [view.key] })[0]!.queryKey
    view.client.setQueryData(key, { items: links.map(link => ({ ...link, updatedAt: undefined })), meta: { total: 2 } }); await nextTick()
    activate(); await nextTick(); expect(screen.queryByRole('dialog')).toBeNull()
  })
  it('rejects queued entry after same-tick metadata revocation, non-fetching invalidation, or cache removal', async () => {
    let activate!: () => void
    const stub = { emits: ['tags'], setup(_props: Record<string, unknown>, { emit }: SetupContext) { activate = () => emit('tags'); return {} }, template: '<div />' }
    const view = mount(context, permissions, stub); await select()
    view.client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: permissions.filter(value => value !== 'short_link:set_metadata') } })
    activate(); await nextTick(); expect(screen.queryByRole('dialog')).toBeNull()
    view.client.setQueryData(['auth', 'me'], { user: actor }); await nextTick()
    await view.client.invalidateQueries({ queryKey: [view.key], refetchType: 'none' })
    activate(); await nextTick(); expect(screen.queryByRole('dialog')).toBeNull()
    await view.client.refetchQueries({ queryKey: [view.key] })
    await waitFor(() => expect((screen.getAllByRole('checkbox')[1] as HTMLInputElement).disabled).toBe(false))
    view.client.removeQueries({ queryKey: [view.key] })
    activate(); await nextTick(); expect(screen.queryByRole('dialog')).toBeNull()
    expect(view.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/batch-tags'))).toHaveLength(0)
  })
})
