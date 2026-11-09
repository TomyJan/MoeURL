import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, type Component, type SetupContext } from 'vue'
import type { useShortLinkBatch } from '@/features/short-link-batch/useShortLinkBatch'
import { createDeferred } from '@/test/deferred'
import { componentStubs } from '@/test/component-stubs'
import { messages } from '@/app/i18n'
import MyLinksPage from './MyLinksPage.vue'
import AdminLinksPage from './AdminLinksPage.vue'

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const actor = { id: '00000000-0000-0000-0000-000000000001', username: 'append-owner', nickname: '', group: 'admin' }
const version = '2026-11-09T00:00:00.123456789Z'
const row = { id: '00000000-0000-0000-0000-000000000020', slug: 'appendnote', url: 'https://short.example/appendnote', targetUrl: 'https://example.com', title: '', tags: [], updatedAt: version, createdAt: '2026-11-09T00:00:00Z', status: 'active', redirectMode: 'direct', intermediateDelaySeconds: 5, expiresAt: null, expired: false, passwordEnabled: false, maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false }
const clients: QueryClient[] = []
/** A missing toolbar action must fail through the actual authorized list page. */
function mount(context: 'own' | 'admin', stubs: Record<string, Component> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client)
  const suffix = context === 'own' ? 'own' : 'all'
  const user = { ...actor, permissions: ['admin:access', 'short_link:read_' + suffix, 'short_link:update_' + suffix, 'short_link:delete_' + suffix, 'short_link:set_metadata'] }
  client.setQueryData(['auth', 'me'], { user })
  const fetcher = vi.fn<typeof fetch>(async (input, init) => new Response(JSON.stringify({ code: 0, message: 'OK', data: String(input).endsWith('/auth/me') ? { user }
    : String(input).endsWith('/batch-append/preview') ? { items: [{ id: row.id, expectedUpdatedAt: version, expectedNoteUpdatedAt: version }], appendableCount: 1, overflowCount: 0 }
    : String(input).endsWith('/batch-append') ? { requestId: JSON.parse(init!.body as string).requestId, appendedCount: 1 }
    : { items: [context === 'admin' ? { ...row, owner: { id: actor.id, username: actor.username, nickname: '' } } : row] }, meta: { total: 1 } })))
  vi.stubGlobal('fetch', fetcher)
  const view = render(context === 'own' ? MyLinksPage : AdminLinksPage, { global: {
    plugins: [[VueQueryPlugin, { queryClient: client }], createI18n({ legacy: false, locale: 'en', messages })],
    stubs: { ...componentStubs, BulkCreateDialog: true, ShortLinkListExportButton: true, PersonalTagBrowser: true, AdminTagBrowser: true, ...stubs },
  } })
  return { ...view, client, fetcher }
}
/** Delivers queued child events while keeping the actual parent/controller guards in place. */
async function queuedPage(context: 'own' | 'admin') {
  let rowEvent!: (event: string, payload: unknown) => void, toolbarEvent!: (event: string) => void
  let pageEvent!: (event: string, payload?: unknown) => void, exportEvent!: (pending: boolean) => void, createEvent!: (open: boolean) => void
  let canExport!: () => boolean, canCreate!: () => boolean, batch!: ReturnType<typeof useShortLinkBatch>
  const view = mount(context, {
    ConsoleLinkList: { emits: ['note', 'configure', 'qr', 'remove', 'toggle-status', 'transfer'], setup(_props: Record<string, unknown>, ctx: SetupContext) { rowEvent = (event, payload) => ctx.emit(event, payload); return {} }, template: '<div data-testid="queued-append-rows" />' },
    ShortLinkBatchToolbar: { props: ['state'], emits: ['append-notes', 'replace-notes', 'clear-notes', 'tags', 'rename-tag', 'transfer'], setup(props: Record<string, unknown>, ctx: SetupContext) { batch = props.state as ReturnType<typeof useShortLinkBatch>; toolbarEvent = event => ctx.emit(event); return {} }, template: '<div />' },
    ShortLinkPagination: { emits: ['change', 'size', 'retry'], setup(_props: Record<string, unknown>, ctx: SetupContext) { pageEvent = (event, payload) => ctx.emit(event, payload); return {} }, template: '<div />' },
    ShortLinkListExportButton: { props: ['canStart'], emits: ['pending'], setup(props: Record<string, unknown>, ctx: SetupContext) { exportEvent = pending => ctx.emit('pending', pending); canExport = () => (props.canStart as () => boolean)(); return {} }, template: '<div />' },
    BulkCreateDialog: { props: ['canOpen'], emits: ['open'], setup(props: Record<string, unknown>, ctx: SetupContext) { createEvent = open => ctx.emit('open', open); canCreate = () => (props.canOpen as () => boolean)(); return {} }, template: '<div />' },
  })
  await screen.findByTestId('queued-append-rows'); await waitFor(() => expect(view.client.isFetching()).toBe(0))
  batch.toggle(row.id, true)
  return { ...view, rowEvent, toolbarEvent, pageEvent, exportEvent, createEvent, canExport, canCreate, batch }
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals() })
describe('batch note append page entry', () => {
  it.each(['own', 'admin'] as const)('preserves active filters/page size and clears only selection after a successful append (%s)', async context => {
    const view = await queuedPage(context)
    await fireEvent.update(screen.getByLabelText('Status'), 'active'); view.pageEvent('size', 50)
    await waitFor(() => expect(view.client.isFetching()).toBe(0)); await nextTick()
    view.batch.toggle(row.id, true); view.toolbarEvent('append-notes'); await nextTick()
    await fireEvent.update(screen.getByRole('textbox', { name: 'Text to append' }), 'new private note')
    await fireEvent.click(screen.getByTestId('batch-note-append-preview')); await screen.findByTestId('batch-note-append-summary')
    const before = view.fetcher.mock.calls.filter(([url]) => String(url).includes('/list?')).length
    await fireEvent.click(screen.getByTestId('batch-note-append-confirm'))
    await waitFor(() => expect(view.batch.selected.value).toEqual([]))
    await waitFor(() => expect(view.fetcher.mock.calls.filter(([url]) => String(url).includes('/list?'))).toHaveLength(before + 1))
    expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.getByLabelText('Status')).toHaveProperty('value', 'active')
    expect(String(view.fetcher.mock.calls.filter(([url]) => String(url).includes('/list?')).at(-1)![0])).toContain('pageSize=50')
    const posts = view.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(posts).toHaveLength(2); expect(JSON.parse(posts[1]![1]!.body as string)).toEqual({ requestId: expect.any(String), items: [{ id: row.id, expectedUpdatedAt: version, expectedNoteUpdatedAt: version }], note: 'new private note' })
  })
  it.each(['own', 'admin'] as const)('holds all competing queued operations, selection, filters and pagination while append is open (%s)', async context => {
    const view = await queuedPage(context); view.toolbarEvent('append-notes'); await nextTick()
    expect(view.canExport()).toBe(false); if (context === 'own') expect(view.canCreate()).toBe(false)
    for (const event of ['configure', 'note', 'qr', 'toggle-status', 'transfer']) view.rowEvent(event, row)
    view.rowEvent('remove', row.id)
    for (const event of ['clear-notes', 'replace-notes', 'append-notes', 'tags', 'rename-tag', 'transfer']) view.toolbarEvent(event)
    view.batch.openDelete(); await view.batch.submit('disable'); view.batch.toggle(row.id, false)
    view.pageEvent('change', 2); view.pageEvent('size', 100); view.pageEvent('retry')
    for (const [label, value] of [['Status', 'disabled'], ['Keyword', 'changed'], ['Tag', 'changed'], ['Note status', 'absent'], ['Note keyword', 'changed']]) {
      expect(screen.getByLabelText(label!)).toHaveProperty('disabled', true); await fireEvent.update(screen.getByLabelText(label!), value!)
    }
    await nextTick()
    expect(screen.getAllByRole('dialog')).toHaveLength(1); expect(view.batch.selected.value).toEqual([row.id])
    expect(view.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
    expect(view.fetcher.mock.calls.filter(([url]) => String(url).includes('/list?'))).toHaveLength(1)
  })
  for (const context of ['own', 'admin'] as const) {
    it.each(['clear', 'replace', 'rename', 'settings', 'note', 'qr', 'tags', 'delete', 'batch', 'export', ...(context === 'own' ? ['create'] : ['transfer', 'batch-transfer'])])('rejects queued append while ' + context + ' operation owns the page: %s', async operation => {
      const view = await queuedPage(context), request = createDeferred<Response>(); let running: Promise<void> | undefined
      if (operation === 'clear') view.toolbarEvent('clear-notes')
      else if (operation === 'replace') view.toolbarEvent('replace-notes')
      else if (operation === 'rename') view.toolbarEvent('rename-tag')
      else if (operation === 'settings') view.rowEvent('configure', row)
      else if (operation === 'note') view.rowEvent('note', row)
      else if (operation === 'qr') view.rowEvent('qr', row)
      else if (operation === 'tags') view.toolbarEvent('tags')
      else if (operation === 'delete') view.batch.openDelete()
      else if (operation === 'batch') { view.fetcher.mockReturnValueOnce(request.promise); running = view.batch.submit('disable') }
      else if (operation === 'export') view.exportEvent(true)
      else if (operation === 'create') view.createEvent(true)
      else if (operation === 'transfer') view.rowEvent('transfer', row)
      else view.toolbarEvent('transfer')
      view.toolbarEvent('append-notes'); await nextTick(); expect(screen.queryByTestId('batch-note-append-dialog')).toBeNull()
      request.resolve(new Response(JSON.stringify({ code: 0, message: 'OK', data: { affectedCount: 1 }, meta: {} }))); await running
    })
    it('requires valid live versions and synchronously erases private text when authority changes (' + context + ')', async () => {
      const view = await queuedPage(context)
      const key = view.client.getQueryCache().find({ queryKey: [context === 'own' ? 'short-link' : 'admin-short-link'], exact: false })!.queryKey
      await view.client.invalidateQueries({ queryKey: key, refetchType: 'none' }); view.toolbarEvent('append-notes'); expect(screen.queryByTestId('batch-note-append-dialog')).toBeNull()
      const data = view.client.getQueryData<{ items: (typeof row)[]; meta: unknown }>(key)!
      view.client.setQueryData(key, { ...data, items: data.items.map(item => ({ ...item, updatedAt: 'bad' })) }); view.toolbarEvent('append-notes'); expect(screen.queryByTestId('batch-note-append-dialog')).toBeNull()
      view.client.setQueryData(key, data); view.toolbarEvent('append-notes'); await nextTick()
      await fireEvent.update(screen.getByRole('textbox', { name: 'Text to append' }), 'private-canary')
      view.client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: ['short_link:read_own'] } }); await nextTick()
      expect(screen.queryByTestId('batch-note-append-dialog')).toBeNull(); expect(document.body.textContent).not.toContain('private-canary')
    })
  }
  it('shows the fixed operation ID and requires a warning before abandoning an unknown result', async () => {
    const view = await queuedPage('own'); view.toolbarEvent('append-notes'); await nextTick()
    await fireEvent.update(screen.getByRole('textbox', { name: 'Text to append' }), 'new')
    await fireEvent.click(screen.getByTestId('batch-note-append-preview')); await screen.findByTestId('batch-note-append-summary')
    view.fetcher.mockRejectedValueOnce(new Error('response lost'))
    await fireEvent.click(screen.getByTestId('batch-note-append-confirm')); await screen.findByTestId('batch-note-append-unknown')
    const payload = view.fetcher.mock.calls.at(-1)![1]!.body as string
    expect(screen.getByTestId('batch-note-append-unknown').textContent).toContain(JSON.parse(payload).requestId)
    expect(screen.queryByTestId('batch-note-append-preview')).toBeNull()
    await fireEvent.click(screen.getByTestId('batch-note-append-cancel')); expect(screen.getByTestId('batch-note-append-discard-warning')).toBeTruthy()
    await fireEvent.click(screen.getByTestId('batch-note-append-keep')); await fireEvent.click(screen.getByTestId('batch-note-append-retry'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(view.fetcher.mock.calls.filter(([path]) => String(path).endsWith('/batch-append')).map(([, init]) => init!.body)).toEqual([payload, payload])
  })
  it.each(['own', 'admin'] as const)('opens an empty private append draft without dispatching a write (%s)', async context => {
    const view = mount(context)
    await screen.findByTestId('console-link-list')
    await waitFor(() => expect(view.client.isFetching()).toBe(0))
    await waitFor(() => expect((screen.getAllByRole('checkbox')[1] as HTMLInputElement).disabled).toBe(false))
    await fireEvent.click(screen.getAllByRole('checkbox')[1]!)
    await fireEvent.click(screen.getByRole('button', { name: 'Append notes' }))
    expect(screen.getByRole('dialog', { name: 'Append to selected internal notes' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Text to append' })).toHaveProperty('value', '')
    expect(view.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
  })
})
