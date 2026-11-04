import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'
import { me, type CurrentUser, type UserResponse } from '@/entities/auth/api'
import { exportShortLinkList, type ShortLinkListExport } from '@/entities/short-link/list-export'
import { ApiClientError } from '@/shared/api/client'
import { downloadCsv } from '@/shared/download/csv'
import { revokeAccountIdentity } from '@/shared/preferences/useAccountPreferences'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import { messages } from '@/app/i18n'
import ShortLinkListExportButton from './ShortLinkListExportButton.vue'

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/entities/auth/api', () => ({ me: vi.fn() }))
vi.mock('@/entities/short-link/list-export', () => ({ exportShortLinkList: vi.fn() }))
vi.mock('@/shared/download/csv', () => ({ downloadCsv: vi.fn() }))
const clients: QueryClient[] = []
const ownPermissions = ['short_link:export', 'short_link:read_own']
const allPermissions = [...ownPermissions, 'admin:access', 'short_link:read_all']
const descriptor: ShortLinkListExport = { fileName: 'moeurl-links-own.csv', contentType: 'text/csv;charset=utf-8', content: '\uFEFFid,short_url\r\n' }
/** Creates a complete confirmed identity for the permission intersection under test. */
function user(permissions = ownPermissions, id = 'A'): CurrentUser {
  return { id, username: id, nickname: '', group: 'user', permissions }
}
/** Mounts the real export state machine with an isolated shared auth cache. */
function mount(options: { user?: CurrentUser | null; context?: 'own' | 'admin'; blocked?: boolean; locale?: string; canStart?: () => boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  clients.push(client)
  if (options.user !== null) client.setQueryData(['auth', 'me'], { user: options.user ?? user() })
  const locale = options.locale ?? 'test'
  const i18n = createI18n({ legacy: false, locale, messages: locale === 'test' ? {} : messages, missingWarn: false, fallbackWarn: false })
  const view = render(ShortLinkListExportButton, { props: { context: options.context ?? 'own', blocked: options.blocked ?? false, canStart: options.canStart, filters: { status: 'active', q: 'applied', tag: 'tag' } }, global: { plugins: [[VueQueryPlugin, { queryClient: client }], i18n], stubs: componentStubs } })
  return { ...view, client }
}
/** Dispatches the user-facing action, including repeat events while pending. */
async function click() { await fireEvent.click(screen.getByTestId('short-link-list-export')) }
beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(exportShortLinkList).mockReset().mockResolvedValue(descriptor)
  vi.mocked(me).mockReset().mockResolvedValue({ user: user() })
  vi.mocked(downloadCsv).mockReset()
})
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()) })

describe('ShortLinkListExportButton', () => {
  it('rechecks live parent locks at both the queued click and download boundary', async () => {
    const allowed = ref(true)
    const view = mount({ canStart: () => allowed.value })
    allowed.value = false
    await click(); expect(exportShortLinkList).not.toHaveBeenCalled()
    allowed.value = true; await view.rerender({ blocked: true }); await view.rerender({ blocked: false })
    const request = createDeferred<ShortLinkListExport>(); vi.mocked(exportShortLinkList).mockReturnValueOnce(request.promise)
    await click(); allowed.value = false
    request.resolve(descriptor); await request.promise; await nextTick(); await nextTick()
    expect(downloadCsv).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled()
    allowed.value = true; await nextTick(); await click()
    await waitFor(() => expect(exportShortLinkList).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledOnce())
  })
  // Retiring a private term must release the old request without allowing its finally to unlock a newer download.
  it.each([false, true])('retiresAllDownloadCallbacks with late failure=%s', async failed => {
    const old = createDeferred<ShortLinkListExport>(), current = createDeferred<ShortLinkListExport>()
    vi.mocked(exportShortLinkList).mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    const view = mount()
    await view.rerender({ filters: { status: 'active', q: '', tag: '', noteQuery: 'A' } })
    await click()
    await view.rerender({ filters: { status: 'active', q: '', tag: '', noteQuery: 'B' } })
    expect((screen.getByTestId('short-link-list-export') as HTMLButtonElement).disabled).toBe(false)
    await click()
    if (failed) old.reject(new Error('private'))
    else old.resolve(descriptor)
    await old.promise.catch(() => undefined); await nextTick(); await nextTick()
    expect(downloadCsv).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect((screen.getByTestId('short-link-list-export') as HTMLButtonElement).disabled).toBe(true)
    current.resolve(descriptor)
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledExactlyOnceWith(descriptor))
    expect((screen.getByTestId('short-link-list-export') as HTMLButtonElement).disabled).toBe(false)
  })
  it.each([
    [user([]), 'own'], [user(['short_link:read_own', 'short_link:export_statistics']), 'own'],
    [user(['short_link:export']), 'own'], [user(ownPermissions), 'admin'],
    [user(['short_link:export', 'short_link:read_all']), 'admin'], [user(['short_link:export', 'admin:access']), 'admin'],
    [{ ...user(allPermissions), group: 'guest' }, 'own'], [{ ...user(allPermissions), username: 'guest' }, 'own'],
    [user(allPermissions, ''), 'own'],
  ] as const)('hides export without the complete permission intersection %#', (identity, context) => {
    mount({ user: identity, context })
    expect(screen.queryByTestId('short-link-list-export')).toBeNull()
  })
  it('waits for confirmed auth without starting a preferences request', async () => {
    const auth = createDeferred<UserResponse>()
    vi.mocked(me).mockReturnValue(auth.promise)
    const view = mount({ user: null })
    expect(screen.queryByTestId('short-link-list-export')).toBeNull()
    auth.resolve({ user: user() })
    await screen.findByTestId('short-link-list-export')
    expect(view.client.getQueriesData({ queryKey: ['user', 'preferences'] })).toEqual([])
  })
  it('blocks loading, failed, pending-filter or writing lists via the parent gate', async () => {
    mount({ blocked: true })
    expect((screen.getByTestId('short-link-list-export') as HTMLButtonElement).disabled).toBe(true)
    await click()
    expect(exportShortLinkList).not.toHaveBeenCalled()
  })
  it.each(['own', 'admin'] as const)('pins applied filters once in %s and reports save initiation', async (context) => {
    const exporting = createDeferred<ShortLinkListExport>()
    vi.mocked(exportShortLinkList).mockReturnValue(exporting.promise)
    mount({ user: user(allPermissions), context })
    await click()
    await click()
    expect(exportShortLinkList).toHaveBeenCalledExactlyOnceWith({ status: 'active', q: 'applied', tag: 'tag' }, context)
    expect((screen.getByTestId('short-link-list-export') as HTMLButtonElement).disabled).toBe(true)
    exporting.resolve(descriptor)
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledExactlyOnceWith(descriptor))
    expect(toast.success).toHaveBeenCalledWith('listExport.started')
    expect((screen.getByTestId('short-link-list-export') as HTMLButtonElement).disabled).toBe(false)
  })
  it.each(['request', 'browser', 'limit'])('shows a friendly %s failure and permits manual retry', async (stage) => {
    if (stage === 'browser') vi.mocked(downloadCsv).mockImplementationOnce(() => { throw new Error('private') })
    else vi.mocked(exportShortLinkList).mockRejectedValueOnce(stage === 'limit' ? new ApiClientError(200118, 'private') : new Error('private'))
    mount()
    await click()
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(stage === 'limit' ? 'listExport.limitExceeded' : 'listExport.failed'))
    expect(toast.success).not.toHaveBeenCalled()
    expect(exportShortLinkList).toHaveBeenCalledOnce()
    await click()
    await waitFor(() => expect(toast.success).toHaveBeenCalledOnce())
    expect(exportShortLinkList).toHaveBeenCalledTimes(2)
  })
  it.each(['context', 'status', 'q', 'tag', 'noteStatus', 'blocked', 'logout', 'switch', 'relogin', 'permission', 'permission-roundtrip', 'unmount'])('isolates late success and failure after %s', async (transition) => {
    for (const failed of [false, true]) {
      const exporting = createDeferred<ShortLinkListExport>()
      vi.mocked(exportShortLinkList).mockReturnValue(exporting.promise)
      const view = mount({ user: user(allPermissions) })
      await click()
      if (transition === 'context') { await view.rerender({ context: 'admin' }); await view.rerender({ context: 'own' }) }
      if (['status', 'q', 'tag'].includes(transition)) {
        await view.rerender({ filters: { status: 'active', q: 'applied', tag: 'tag', [transition]: transition === 'status' ? 'disabled' : 'changed' } })
        await view.rerender({ filters: { status: 'active', q: 'applied', tag: 'tag' } })
      }
      if (transition === 'noteStatus') {
        await view.rerender({ filters: { status: 'active', q: 'applied', tag: 'tag', noteStatus: 'present' } })
        await view.rerender({ filters: { status: 'active', q: 'applied', tag: 'tag', noteStatus: '' } })
      }
      if (transition === 'blocked') { await view.rerender({ blocked: true }); await view.rerender({ blocked: false }) }
      if (transition === 'logout' || transition === 'relogin') void revokeAccountIdentity(view.client)
      if (transition === 'switch') view.client.setQueryData(['auth', 'me'], { user: user(allPermissions, 'B') })
      if (transition === 'relogin') view.client.setQueryData(['auth', 'me'], { user: user(allPermissions) })
      if (transition === 'permission' || transition === 'permission-roundtrip') {
        view.client.setQueryData(['auth', 'me'], { user: user([]) })
        if (transition === 'permission-roundtrip') view.client.setQueryData(['auth', 'me'], { user: user(allPermissions) })
      }
      if (transition === 'unmount') view.unmount()
      if (failed) exporting.reject(new Error('private'))
      else exporting.resolve(descriptor)
      await exporting.promise.catch(() => undefined)
      await nextTick()
      expect(downloadCsv).not.toHaveBeenCalled()
      expect(toast.success).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
      cleanup()
    }
  })
  it('checks current cache permissions before observers render a revocation', async () => {
    const exporting = createDeferred<ShortLinkListExport>()
    vi.mocked(exportShortLinkList).mockReturnValue(exporting.promise)
    const view = mount()
    await click()
    view.client.setQueryData(['auth', 'me'], undefined)
    void revokeAccountIdentity(view.client)
    exporting.resolve(descriptor)
    await exporting.promise
    await nextTick()
    expect(downloadCsv).not.toHaveBeenCalled()
  })
  it.each([
    ['zh-CN', '导出 CSV', '导出筛选结果，最多 1000 条。', '已发起 CSV 下载，请在浏览器中确认保存。'],
    ['en', 'Export CSV', 'Export filtered results, up to 1000 links.', 'CSV download started. Confirm saving in your browser.'],
  ])('localizes scope, limit and save feedback in %s', async (locale, label, description, success) => {
    mount({ locale })
    expect(screen.getByText(description)).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: label }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(success))
  })
})
