import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { nextTick, type Component, type SetupContext } from 'vue'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import MyLinksPage from './MyLinksPage.vue'
import AdminLinksPage from './AdminLinksPage.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const actor = { id: '00000000-0000-0000-0000-000000000001', username: 'note-reader', nickname: '', group: 'admin' }
const link = { id: '00000000-0000-0000-0000-000000000020', slug: 'note', url: 'https://short.example/note', targetUrl: 'https://example.com', title: '', tags: [], owner: { id: actor.id, username: actor.username, nickname: '' }, updatedAt: '2026-11-03T00:00:00.123456Z', createdAt: '2026-11-03T00:00:00Z', status: 'active', redirectMode: 'direct', intermediateDelaySeconds: 5, expiresAt: null, expired: false, passwordEnabled: false, maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false }
const version = '2026-11-03T01:00:00.123456789Z'
const clients: QueryClient[] = []
/** Keeps the real page, menu, note entity and controller; only the HTTP boundary is controlled. */
function mount(context: 'own' | 'admin', write = true, listStub?: Component) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client)
  const suffix = context === 'own' ? 'own' : 'all'
  const permissions = ['admin:access', `short_link:read_${suffix}`, ...(write ? [`short_link:update_${suffix}`, 'short_link:set_metadata'] : [])]
  client.setQueryData(['auth', 'me'], { user: { ...actor, permissions } })
  const fetcher = vi.fn<typeof fetch>(async input => {
    const path = new URL(String(input), 'http://localhost').pathname
    const row = context === 'admin' ? link : Object.fromEntries(Object.entries(link).filter(([key]) => key !== 'owner'))
    const data = path.endsWith('/auth/me') ? { user: { ...actor, permissions } }
      : path.endsWith('/user/list-preference') ? { preference: { pageSize: null, updatedAt: null } }
      : path.endsWith('/note') ? { id: link.id, note: 'Internal handoff\nKeep this private', updatedAt: version } : { items: [row] }
    return new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: { total: 1 } }))
  })
  vi.stubGlobal('fetch', fetcher)
  return { ...render(context === 'own' ? MyLinksPage : AdminLinksPage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: { ...componentStubs, BulkCreateDialog: true, ShortLinkListExportButton: true, PersonalTagBrowser: true, AdminTagBrowser: true, ...(listStub ? { ConsoleLinkList: listStub } : {}) } } }), client, fetcher }
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals() })

describe('internal note page entry', () => {
  it.each(['own', 'admin'] as const)('opens an internal note from the current row (%s)', async context => {
    const view = mount(context)
    await screen.findByTestId('console-link-list')
    expect(view.fetcher.mock.calls.some(([url]) => String(url).includes('/note'))).toBe(false)
    await fireEvent.click(screen.getByRole('button', { name: 'links.actions.more' }))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'linkNote.action' }))
    const field = await screen.findByLabelText('linkNote.text')
    await waitFor(() => expect((field as HTMLTextAreaElement).value).toBe('Internal handoff\nKeep this private'))
    expect(screen.getByRole('dialog').textContent).toContain('linkNote.transferWarning')
    const [url, init] = view.fetcher.mock.calls.find(([url]) => String(url).includes('/note'))!
    expect(String(url)).toBe(`/api/v1/${context === 'admin' ? 'admin/' : ''}short-link/note?id=${link.id}`)
    expect(new Headers(init?.headers).get('X-MoeURL-Expected-User-ID')).toBe(actor.id)
  })
  it.each(['own', 'admin'] as const)('allows readonly notes while blocking all competing row operations (%s)', async context => {
    const view = mount(context, false)
    await screen.findByTestId('console-link-list')
    await fireEvent.click(screen.getByRole('button', { name: 'links.actions.more' }))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'linkNote.action' }))
    await waitFor(() => expect((screen.getByLabelText('linkNote.text') as HTMLTextAreaElement).value).toContain('Internal handoff'))
    expect(screen.queryByRole('button', { name: 'linkNote.save' })).toBeNull()
    for (const name of ['links.actions.configure', 'links.actions.disable', 'links.actions.delete', 'links.actions.qrCode']) {
      await fireEvent.click(screen.getByRole('button', { name: 'links.actions.more' }))
      await fireEvent.click(screen.getByRole('menuitem', { name }))
    }
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(screen.queryByTestId('short-link-qr-dialog-stub')).toBeNull()
    expect(view.fetcher.mock.calls.map(([url]) => new URL(String(url), 'http://localhost').pathname)).toEqual([
      '/api/v1/user/list-preference', `/api/v1/${context === 'admin' ? 'admin/' : ''}short-link/list`,
      `/api/v1/${context === 'admin' ? 'admin/' : ''}short-link/note`,
    ])
    await fireEvent.click(screen.getByRole('button', { name: 'linkNote.close' }))
    await fireEvent.click(screen.getByRole('button', { name: 'links.actions.more' }))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'links.actions.qrCode' }))
    expect(screen.getByTestId('short-link-qr-dialog-stub')).toBeTruthy()
  })
  it.each(['own', 'admin'] as const)('retires a note immediately when its list filters change (%s)', async context => {
    mount(context)
    await screen.findByTestId('console-link-list')
    await fireEvent.click(screen.getByRole('button', { name: 'links.actions.more' }))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'linkNote.action' }))
    await screen.findByRole('dialog')
    await fireEvent.update(screen.getByLabelText('filter.status'), 'disabled')
    expect(screen.queryByTestId('note-dialog')).toBeNull()
  })
  it.each(['own', 'admin'] as const)('rejects queued note clicks during a list refresh, settings or QR dialog and for absent rows (%s)', async context => {
    let emit!: (event: 'note' | 'configure' | 'qr', row: typeof link) => void
    const stub = { emits: ['note', 'configure', 'qr'], setup(_props: Record<string, unknown>, ctx: SetupContext) {
      emit = (event, row) => ctx.emit(event, row)
      return {}
    }, template: '<div data-testid="queued-note-list" />' }
    const view = mount(context, true, stub)
    await screen.findByTestId('queued-note-list')
    emit('note', { ...link, id: 'absent' }); await nextTick()
    expect(screen.queryByRole('dialog')).toBeNull()
    emit('configure', link); await nextTick()
    emit('note', link); await nextTick()
    expect(view.fetcher.mock.calls.some(([url]) => String(url).includes('/note'))).toBe(false)
    // Closing the actual settings dialog restores the row action boundary.
    await fireEvent.click(screen.getByRole('button', { name: 'shortLinkSettings.cancel' }))
    emit('qr', link); await nextTick(); emit('note', link); await nextTick()
    expect(view.fetcher.mock.calls.some(([url]) => String(url).includes('/note'))).toBe(false)
    await fireEvent.click(screen.getByRole('button', { name: 'short-link-qr-close' }))
    const pending = createDeferred<Response>()
    view.fetcher.mockReturnValueOnce(pending.promise)
    const refreshing = view.client.invalidateQueries({ queryKey: [context === 'own' ? 'short-link' : 'admin-short-link'] })
    emit('note', link); await nextTick()
    expect(view.fetcher.mock.calls.some(([url]) => String(url).includes('/note'))).toBe(false)
    const row = context === 'admin' ? link : Object.fromEntries(Object.entries(link).filter(([key]) => key !== 'owner'))
    pending.resolve(new Response(JSON.stringify({ code: 0, message: 'OK', data: { items: [row] }, meta: { total: 1 } })))
    await refreshing
    emit('note', link)
    await screen.findByLabelText('linkNote.text')
  })
})
