import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/vue'
import { defineComponent, nextTick, type Component } from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'vue-sonner'
import { me, type CurrentUser } from '@/entities/auth/api'
import { batchShortLinks } from '@/entities/short-link/batch'
import { listShortLinks, listAdminShortLinks, updateShortLink, updateAdminShortLink } from '@/entities/short-link/api'
import type { ShortLink } from '@/entities/short-link/model'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import { messages } from '@/app/i18n'
import MyLinksPage from './MyLinksPage.vue'
import AdminLinksPage from './AdminLinksPage.vue'

vi.mock('@/entities/auth/api', () => ({ me: vi.fn() }))
vi.mock('@/entities/short-link/batch', () => ({ batchShortLinks: vi.fn() }))
vi.mock('@/entities/short-link/api', () => ({ listShortLinks: vi.fn(), listAdminShortLinks: vi.fn(), updateShortLink: vi.fn(), updateAdminShortLink: vi.fn(), deleteShortLink: vi.fn(), deleteAdminShortLink: vi.fn() }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const clients: QueryClient[] = []
const grants = ['short_link:read_own', 'short_link:update_own', 'short_link:delete_own', 'admin:access', 'short_link:read_all', 'short_link:update_all', 'short_link:delete_all']
const links = ['one', 'two'].map(id => ({ id, slug: id, url: `https://go.example/${id}`, targetUrl: 'https://example.com', title: '', tags: [], status: 'active', redirectMode: 'direct', intermediateDelaySeconds: 5, expiresAt: null, expired: false, passwordEnabled: false, maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false, createdAt: '2026-10-16T00:00:00Z' })) as ShortLink[]
/** Supplies an explicit account boundary for each page test. */
function user(permissions = grants, id = 'A'): CurrentUser { return { id, username: id, nickname: '', group: 'user', permissions } }
/** Mounts the real private list page with isolated server state. */
function mount(context: 'own' | 'admin' = 'own', account: CurrentUser | null = user(), locale = 'test', settingsStub?: Component) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } } })
  clients.push(client)
  if (account) client.setQueryData(['auth', 'me'], { user: account })
  const view = render(context === 'own' ? MyLinksPage : AdminLinksPage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }], createI18n({ legacy: false, locale, messages: locale === 'test' ? {} : messages, missingWarn: false, fallbackWarn: false })], stubs: { ...componentStubs, ...(settingsStub ? { ShortLinkSettingsDialog: settingsStub } : {}) } } })
  return { ...view, client }
}
/** Waits for the first list result before choosing one current record. */
async function selectOne() {
  await screen.findByTestId('console-link-list')
  await waitFor(() => expect((screen.getAllByRole('checkbox')[1] as HTMLInputElement).disabled).toBe(false))
  await fireEvent.click(screen.getAllByRole('checkbox')[1]!)
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(me).mockResolvedValue({ user: user() })
  vi.mocked(listShortLinks).mockReset().mockResolvedValue({ items: links, meta: { page: 1, pageSize: 20, total: 2 } })
  vi.mocked(listAdminShortLinks).mockReset().mockResolvedValue({ items: links.map(link => ({ ...link, updatedAt: '2026-10-23T00:00:00.123456Z', owner: { id: 'A', username: 'A', nickname: '' } })), meta: { page: 1, pageSize: 20, total: 2 } })
  vi.mocked(batchShortLinks).mockReset().mockResolvedValue({ affectedCount: 1 })
})
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()) })
describe('private list batch controls', () => {
  it('selects and deselects only the current list through its header checkbox', async () => {
    mount()
    await screen.findByTestId('console-link-list')
    await fireEvent.click(screen.getAllByRole('checkbox')[0]!)
    expect(screen.getAllByRole('checkbox').every(box => (box as HTMLInputElement).checked)).toBe(true)
    await fireEvent.click(screen.getAllByRole('checkbox')[0]!)
    expect(screen.getAllByRole('checkbox').every(box => !(box as HTMLInputElement).checked)).toBe(true)
  })
  it.each(['own', 'admin'] as const)('rejects a delayed save event from an already closed row editor during a batch in %s', async context => {
    let delayedSave!: () => void
    const stub = defineComponent({ emits: ['save', 'update:open'], setup(_props, { emit }) {
      delayedSave = () => emit('save', { id: 'one', targetUrl: 'https://changed.example' })
      return { close: () => emit('update:open', false) }
    }, template: '<button data-testid="close-editor" @click="close">Close</button>' })
    mount(context, user(), 'test', stub)
    await selectOne()
    await fireEvent.click(screen.getAllByRole('button', { name: 'links.actions.more' })[0]!)
    await fireEvent.click(screen.getByRole('menuitem', { name: 'links.actions.configure' }))
    expect((screen.getByTestId('batch-enable') as HTMLButtonElement).disabled).toBe(true)
    await fireEvent.click(screen.getByTestId('close-editor'))
    const request = createDeferred<{ affectedCount: number }>()
    vi.mocked(batchShortLinks).mockReturnValue(request.promise)
    await fireEvent.click(screen.getByTestId('batch-disable'))
    delayedSave()
    expect(updateShortLink).not.toHaveBeenCalled(); expect(updateAdminShortLink).not.toHaveBeenCalled()
    request.resolve({ affectedCount: 1 })
  })
  it.each(['own', 'admin'] as const)('shows current-list selection, indeterminate state and atomic enable/disable in %s', async context => {
    const { client } = mount(context)
    await selectOne()
    expect(screen.getByTestId('batch-toolbar')).toBeTruthy()
    const all = screen.getAllByRole('checkbox')[0] as HTMLInputElement
    expect(all.indeterminate).toBe(true)
    await fireEvent.click(screen.getByTestId('batch-enable'))
    await waitFor(() => expect(batchShortLinks).toHaveBeenCalledWith({ ids: ['one'], action: 'enable' }, context))
    await waitFor(() => expect((screen.getAllByRole('checkbox')[1] as HTMLInputElement).checked).toBe(false))
    await selectOne(); await fireEvent.click(screen.getByTestId('batch-disable'))
    expect(screen.getByTestId('batch-toolbar').getAttribute('aria-busy')).toBe('true')
    expect(screen.getByRole('progressbar', { name: 'batch.processing' })).toBeTruthy()
    await waitFor(() => expect(batchShortLinks).toHaveBeenLastCalledWith({ ids: ['one'], action: 'disable' }, context))
    expect(client.getQueriesData({ queryKey: [context === 'own' ? 'short-link' : 'admin-short-link'] })[0]?.[0].slice(-2)).toEqual(['A', 1])
  })
  it.each(['own', 'admin'] as const)('freezes delete targets, supports cancellation and manual failed-write retry in %s', async context => {
    mount(context)
    await selectOne(); await fireEvent.click(screen.getByTestId('batch-delete'))
    await fireEvent.click(screen.getAllByRole('checkbox')[1]!); await fireEvent.click(screen.getAllByRole('checkbox')[2]!)
    vi.mocked(batchShortLinks).mockRejectedValueOnce(new Error('private'))
    await fireEvent.click(screen.getByTestId('batch-confirm-delete'))
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('batch.failed'))
    expect(batchShortLinks).toHaveBeenCalledExactlyOnceWith({ ids: ['one'], action: 'delete' }, context)
    expect((screen.getAllByRole('checkbox')[2] as HTMLInputElement).checked).toBe(true)
    await fireEvent.click(screen.getByTestId('batch-confirm-delete'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await selectOne(); await fireEvent.click(screen.getByTestId('batch-delete'))
    await fireEvent.click(screen.getByTestId('batch-cancel-delete'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
  it.each(['own', 'admin'] as const)('clears selection and confirmation immediately for each raw filter in %s', async context => {
    mount(context)
    for (const label of ['filter.keyword', 'filter.tag', 'filter.status']) {
      await selectOne(); await fireEvent.click(screen.getByTestId('batch-delete'))
      await fireEvent.update(screen.getByLabelText(label), label === 'filter.status' ? 'disabled' : 'raw')
      expect(screen.queryByRole('dialog')).toBeNull()
      expect((screen.getByTestId('batch-enable') as HTMLButtonElement).disabled).toBe(true)
      await fireEvent.update(screen.getByLabelText(label), '')
    }
  })
  it.each(['own', 'admin'] as const)('blocks batch controls during refetch, cached errors and a row write in %s', async context => {
    const view = mount(context)
    await selectOne()
    const prefix = context === 'own' ? 'short-link' : 'admin-short-link'
    const fetcher = context === 'own' ? listShortLinks : listAdminShortLinks
    const loading = createDeferred<Awaited<ReturnType<typeof listAdminShortLinks>>>()
    vi.mocked(fetcher).mockReturnValueOnce(loading.promise)
    void view.client.invalidateQueries({ queryKey: [prefix] })
    await waitFor(() => expect((screen.getByTestId('batch-enable') as HTMLButtonElement).disabled).toBe(true))
    loading.reject(new Error('private'))
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy())
    expect(screen.queryByTestId('console-link-list')).toBeNull()
    expect(screen.queryByRole('progressbar')).toBeNull()
    expect((screen.getByTestId('batch-enable') as HTMLButtonElement).disabled).toBe(true)
    await view.client.invalidateQueries({ queryKey: [prefix] })
    await waitFor(() => expect((screen.getByTestId('batch-enable') as HTMLButtonElement).disabled).toBe(false))
    const writing = createDeferred<Awaited<ReturnType<typeof updateShortLink>>>()
    vi.mocked(context === 'own' ? updateShortLink : updateAdminShortLink).mockReturnValueOnce(writing.promise)
    await fireEvent.click(screen.getAllByRole('button', { name: 'links.actions.more' })[0]!)
    await fireEvent.click(screen.getByRole('menuitem', { name: 'links.actions.disable' }))
    await waitFor(() => expect((screen.getByTestId('batch-enable') as HTMLButtonElement).disabled).toBe(true))
    writing.reject(new Error('private'))
  })
  it.each(['own', 'admin'] as const)('disables row configuration and writes throughout a batch in %s', async context => {
    mount(context)
    const request = createDeferred<{ affectedCount: number }>()
    vi.mocked(batchShortLinks).mockReturnValue(request.promise)
    await selectOne(); await fireEvent.click(screen.getByTestId('batch-disable'))
    await fireEvent.click(screen.getAllByRole('button', { name: 'links.actions.more' })[0]!)
    for (const name of ['links.actions.configure', 'links.actions.disable', 'links.actions.delete']) {
      const item = screen.getByRole('menuitem', { name })
      expect(item.getAttribute('aria-disabled')).toBe('true')
      await fireEvent.click(item)
      await fireEvent.click(screen.getAllByRole('button', { name: 'links.actions.more' })[0]!)
    }
    expect(updateShortLink).not.toHaveBeenCalled(); expect(updateAdminShortLink).not.toHaveBeenCalled()
    request.resolve({ affectedCount: 1 })
  })
  it.each(['own', 'admin'] as const)('hides private cached records and prevents reads without current read permission in %s', async context => {
    const view = mount(context, user([]))
    expect(screen.queryByTestId('batch-toolbar')).toBeNull()
    expect(screen.queryByTestId('console-link-list')).toBeNull()
    expect(listShortLinks).not.toHaveBeenCalled(); expect(listAdminShortLinks).not.toHaveBeenCalled()
    expect(screen.getByRole('alert').textContent).toBe(context === 'own' ? 'links.loadFailed' : 'adminLinks.loadFailed')
    expect(screen.queryByRole('progressbar')).toBeNull()
    view.client.setQueryData(['auth', 'me'], { user: user() })
    await selectOne()
    view.client.setQueryData(['auth', 'me'], { user: user([], 'B') })
    await nextTick()
    expect(screen.queryByTestId('console-link-list')).toBeNull()
    expect(screen.queryByTestId('batch-toolbar')).toBeNull()
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(screen.queryByRole('progressbar')).toBeNull()
  })
  it.each(['own', 'admin'] as const)('waits for confirmed auth and reports auth read failure in %s', async context => {
    const request = createDeferred<Awaited<ReturnType<typeof me>>>()
    vi.mocked(me).mockReturnValueOnce(request.promise)
    mount(context, null)
    expect(screen.getByRole('progressbar')).toBeTruthy()
    expect(screen.queryByTestId('console-link-list')).toBeNull()
    request.reject(new Error('private'))
    await screen.findByRole('alert')
    expect(screen.queryByRole('progressbar')).toBeNull()
  })
  it.each([
    ['zh-CN', 1, '选择当前列表', '选择短链 one', '批量启用', '即将删除 1 条短链，删除后公开地址将不可访问。此操作无法撤销。', '已处理 1 条短链。'],
    ['en', 1, 'Select current list', 'Select short link one', 'Enable selected', 'Delete 1 link? Its public address will become unavailable. This action cannot be undone.', 'Processed 1 link.'],
    ['en', 2, 'Select current list', 'Select short link one', 'Enable selected', 'Delete 2 links? Their public addresses will become unavailable. This action cannot be undone.', 'Processed 2 links.'],
  ] as const)('provides translated accessible controls and irreversible delete confirmation in %s (%i selected)', async (locale, count, all, one, enable, confirmation, success) => {
    mount('own', user(), locale)
    await screen.findByRole('checkbox', { name: one })
    expect(screen.getByRole('checkbox', { name: all })).toBeTruthy()
    expect(within(screen.getByTestId('batch-toolbar')).getByRole('button', { name: enable })).toBeTruthy()
    await fireEvent.click(screen.getByRole('checkbox', { name: count === 1 ? one : all }))
    await fireEvent.click(screen.getByTestId('batch-delete'))
    expect(within(screen.getByRole('dialog')).getByText(confirmation)).toBeTruthy()
    vi.mocked(batchShortLinks).mockResolvedValueOnce({ affectedCount: count })
    await fireEvent.click(screen.getByTestId('batch-confirm-delete'))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(success))
  })
})
