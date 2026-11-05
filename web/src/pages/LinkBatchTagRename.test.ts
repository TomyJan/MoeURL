import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { componentStubs } from '@/test/component-stubs'
import { messages } from '@/app/i18n'
import MyLinksPage from './MyLinksPage.vue'
import AdminLinksPage from './AdminLinksPage.vue'
import { nextTick, watch, type Component, type SetupContext } from 'vue'
import type { useBatchTagRename } from '@/features/short-link-tags/useBatchTagRename'
import type { useShortLinkBatch } from '@/features/short-link-batch/useShortLinkBatch'
import { createDeferred } from '@/test/deferred'
import PersonalTagBrowser from '@/features/short-link-tags/PersonalTagBrowser.vue'
import AdminTagBrowser from '@/features/short-link-tags/AdminTagBrowser.vue'

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const actor = { id: '00000000-0000-0000-0000-000000000001', username: 'rename-owner', nickname: '', group: 'admin' }
const version = '2026-11-05T06:00:00.123456789Z'
const row = { id: '00000000-0000-0000-0000-000000000020', slug: 'rename', url: 'https://short.example/rename', targetUrl: 'https://example.com', title: '', tags: ['old', 'other'], updatedAt: version, createdAt: '2026-11-05T00:00:00Z', status: 'active', redirectMode: 'direct', intermediateDelaySeconds: 5, expiresAt: null, expired: false, passwordEnabled: false, maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false }
const clients: QueryClient[] = []

/** Keeps pages, authority, selection and confirmation real; only the HTTP boundary is controlled. */
function mount(context: 'own' | 'admin', stubs: Record<string, Component> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client)
  const suffix = context === 'own' ? 'own' : 'all'
  const user = { ...actor, permissions: ['admin:access', `short_link:read_${suffix}`, `short_link:update_${suffix}`, `short_link:delete_${suffix}`, 'short_link:set_metadata'] }
  client.setQueryData(['auth', 'me'], { user })
  const fetcher = vi.fn<typeof fetch>(async input => new Response(JSON.stringify({ code: 0, message: 'OK', data: String(input).endsWith('/auth/me') ? { user } : String(input).endsWith('/batch-tag-rename') ? { changedCount: 1, unchangedCount: 0 } : { items: [context === 'admin' ? { ...row, owner: { id: actor.id, username: actor.username, nickname: actor.nickname } } : row] }, meta: { total: 1 } })))
  vi.stubGlobal('fetch', fetcher)
  const view = render(context === 'own' ? MyLinksPage : AdminLinksPage, { global: {
    plugins: [[VueQueryPlugin, { queryClient: client }], createI18n({ legacy: false, locale: 'en', messages })],
    stubs: { ...componentStubs, BulkCreateDialog: true, ShortLinkListExportButton: true, PersonalTagBrowser: true, AdminTagBrowser: true, ...stubs },
  } })
  return { ...view, client, fetcher }
}
/** Delivers queued events before disabled child props can rerender. */
async function queuedPage(context: 'own' | 'admin', stubs: Record<string, Component> = {}) {
  let rowEvent!: (event: string, payload: unknown) => void, toolbarEvent!: (event: string) => void
  let pageEvent!: (event: string, payload?: unknown) => void, exportEvent!: (pending: boolean) => void, createEvent!: (open: boolean) => void
  let canExport!: () => boolean, canCreate!: () => boolean, batch!: ReturnType<typeof useShortLinkBatch>
  const view = mount(context, {
    ConsoleLinkList: { emits: ['note', 'configure', 'qr', 'remove', 'toggle-status', 'transfer'], setup(_props: Record<string, unknown>, ctx: SetupContext) {
      rowEvent = (event, payload) => ctx.emit(event, payload); return {}
    }, template: '<div data-testid="queued-rows" />' },
    ShortLinkBatchToolbar: { props: ['state'], emits: ['replace-notes', 'clear-notes', 'tags', 'transfer', 'rename-tag'], setup(props: Record<string, unknown>, ctx: SetupContext) {
      batch = props.state as ReturnType<typeof useShortLinkBatch>; toolbarEvent = event => ctx.emit(event); return {}
    }, template: '<div />' },
    ShortLinkPagination: { emits: ['change', 'size', 'retry'], setup(_props: Record<string, unknown>, ctx: SetupContext) { pageEvent = (event, payload) => ctx.emit(event, payload); return {} }, template: '<div />' },
    ShortLinkListExportButton: { props: ['canStart'], emits: ['pending'], setup(props: Record<string, unknown>, ctx: SetupContext) { exportEvent = pending => ctx.emit('pending', pending); canExport = () => (props.canStart as () => boolean)(); return {} }, template: '<div />' },
    BulkCreateDialog: { props: ['canOpen'], emits: ['open'], setup(props: Record<string, unknown>, ctx: SetupContext) { createEvent = open => ctx.emit('open', open); canCreate = () => (props.canOpen as () => boolean)(); return {} }, template: '<div />' },
    ...stubs,
  })
  await screen.findByTestId('queued-rows'); await waitFor(() => expect(view.client.isFetching()).toBe(0)); batch.toggle(row.id, true)
  return { ...view, rowEvent, toolbarEvent, pageEvent, exportEvent, createEvent, canExport, canCreate, batch }
}
async function approve() {
  await fireEvent.update(screen.getByRole('textbox', { name: 'Current tag' }), 'old')
  await fireEvent.update(screen.getByRole('textbox', { name: 'New tag' }), 'new')
  await fireEvent.click(screen.getByTestId('batch-tag-rename-approve'))
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals() })

describe('batch tag rename page entry', () => {
  it.each(['own', 'admin'] as const)('blocks all queued competing operations while rename owns the page (%s)', async context => {
    const view = await queuedPage(context); view.toolbarEvent('rename-tag'); await nextTick()
    expect(view.canExport()).toBe(false); if (context === 'own') expect(view.canCreate()).toBe(false)
    for (const label of ['Status', 'Keyword', 'Tag', 'Note status', 'Note keyword']) expect(screen.getByLabelText(label)).toHaveProperty('disabled', true)
    for (const event of ['configure', 'note', 'qr', 'toggle-status', 'transfer']) view.rowEvent(event, row)
    view.rowEvent('remove', row.id)
    for (const event of ['clear-notes', 'replace-notes', 'tags', 'transfer', 'rename-tag']) view.toolbarEvent(event)
    view.batch.openDelete(); await view.batch.submit('disable'); view.batch.toggle(row.id, false)
    view.pageEvent('change', 2); view.pageEvent('size', 100); view.pageEvent('retry')
    for (const [label, value] of [['Status', 'disabled'], ['Keyword', 'changed'], ['Tag', 'changed'], ['Note status', 'absent'], ['Note keyword', 'changed']]) await fireEvent.update(screen.getByLabelText(label!), value!)
    await nextTick()
    expect(screen.getAllByRole('dialog')).toHaveLength(1); expect(view.batch.selected.value).toEqual([row.id])
    expect(view.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
    expect(view.fetcher.mock.calls.filter(([url]) => String(url).includes('/list?'))).toHaveLength(1)
  })
  for (const context of ['own', 'admin'] as const) {
    it(`refreshes the already open tag directory after committed lost-response readback (${context})`, async () => {
      const view = await queuedPage(context, { PersonalTagBrowser, AdminTagBrowser })
      let committed = false
      view.fetcher.mockImplementation(async (input, init) => {
        const url = String(input)
        if (url.endsWith('/batch-tag-rename') && init?.method === 'POST') { committed = true; throw new Error('reply lost after commit') }
        const data = url.includes('/tags?')
          ? { items: [{ tag: committed ? 'new' : 'old', linkCount: 1 }], hasMore: false }
          : url.endsWith('/auth/me') ? view.client.getQueryData(['auth', 'me'])
            : { items: [{ ...row, tags: committed ? ['new', 'other'] : row.tags, ...(context === 'admin' ? { owner: { id: actor.id, username: actor.username, nickname: actor.nickname } } : {}) }] }
        return new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: { total: 1 } }))
      })
      await fireEvent.click(screen.getByRole('button', { name: context === 'own' ? 'My tags' : 'All-site tags' }))
      await screen.findByRole('button', { name: 'old · 1' })
      view.toolbarEvent('rename-tag'); await nextTick(); await approve()
      await fireEvent.click(screen.getByTestId('batch-tag-rename-confirm'))
      await screen.findByText(/The save result is unknown/)
      await fireEvent.click(screen.getByTestId('batch-tag-rename-reload'))
      await waitFor(() => expect(view.client.isFetching()).toBe(0))
      for (const query of view.client.getQueryCache().findAll({ queryKey: [context === 'own' ? 'short-link' : 'admin-short-link'] })) {
        if (query.state.error) throw query.state.error
      }
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      await screen.findByRole('button', { name: 'new · 1' })
      expect(screen.queryByRole('button', { name: 'old · 1' })).toBeNull()
      expect(view.batch.selected.value).toEqual([])
      expect(view.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    })
    it.each(['start', 'cancel', 'response'] as const)(`retires list recovery after identity changes during %s (${context})`, async phase => {
      let state!: ReturnType<typeof useBatchTagRename>
      const view = await queuedPage(context, { BatchTagRenameDialog: { props: ['state'], setup(props: Record<string, unknown>) { state = props.state as ReturnType<typeof useBatchTagRename>; return {} }, template: '<div />' } })
      view.toolbarEvent('rename-tag'); state.setFromTag('old'); state.setToTag('new'); state.approve()
      view.fetcher.mockRejectedValueOnce(new Error('lost')); await state.confirm(); expect(state.unknown.value).toBe(true)
      const revoke = () => view.client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: [] } })
      let stop = () => {}
      if (phase === 'start') stop = watch(state.loading, value => { if (value) revoke() }, { flush: 'sync' })
      else if (phase === 'cancel') vi.spyOn(view.client, 'cancelQueries').mockImplementationOnce(async () => { revoke() })
      else stop = view.client.getQueryCache().subscribe(event => { if (event.type === 'updated' && event.action.type === 'success' && event.query.queryKey[0] === (context === 'own' ? 'short-link' : 'admin-short-link')) revoke() })
      await state.reload(); stop(); expect(state.targets.value).toBeNull(); expect(state.loading.value).toBe(false)
      expect(view.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    })
    it.each(['clear', 'replace', 'settings', 'note', 'qr', 'tags', 'delete', 'batch', 'export', ...(context === 'own' ? ['create'] : ['transfer', 'batch-transfer'])])(`rejects queued rename during a competing ${context} operation: %s`, async operation => {
      const view = await queuedPage(context), pending = createDeferred<Response>(); let running: Promise<void> | undefined
      if (operation === 'clear') view.toolbarEvent('clear-notes')
      else if (operation === 'replace') view.toolbarEvent('replace-notes')
      else if (operation === 'settings') view.rowEvent('configure', row)
      else if (operation === 'note') view.rowEvent('note', row)
      else if (operation === 'qr') view.rowEvent('qr', row)
      else if (operation === 'tags') view.toolbarEvent('tags')
      else if (operation === 'delete') view.batch.openDelete()
      else if (operation === 'batch') { view.fetcher.mockReturnValueOnce(pending.promise); running = view.batch.submit('disable') }
      else if (operation === 'export') view.exportEvent(true)
      else if (operation === 'create') view.createEvent(true)
      else if (operation === 'transfer') view.rowEvent('transfer', row)
      else view.toolbarEvent('transfer')
      view.toolbarEvent('rename-tag'); await nextTick(); expect(screen.queryByTestId('batch-tag-rename-dialog')).toBeNull()
      pending.resolve(new Response(JSON.stringify({ code: 0, message: 'OK', data: { affectedCount: 1 }, meta: {} }))); await running
    })
    it(`preserves filters and size on success and clears only after an explicit write (${context})`, async () => {
      const view = await queuedPage(context); await fireEvent.update(screen.getByLabelText('Status'), 'active'); view.pageEvent('size', 50)
      await waitFor(() => expect(view.client.isFetching()).toBe(0)); await nextTick(); view.batch.toggle(row.id, true)
      view.toolbarEvent('rename-tag'); await nextTick(); await approve()
      await fireEvent.click(screen.getByTestId('batch-tag-rename-confirm'))
      await waitFor(() => expect(view.batch.selected.value).toEqual([])); await waitFor(() => expect(view.client.isFetching()).toBe(0))
      const posts = view.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST'); expect(posts).toHaveLength(1)
      expect(JSON.parse(posts[0]![1]!.body as string)).toEqual({ items: [{ id: row.id, expectedUpdatedAt: version }], fromTag: 'old', toTag: 'new' })
      expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.getByLabelText('Status')).toHaveProperty('value', 'active')
      expect(String(view.fetcher.mock.calls.filter(([url]) => String(url).includes('/list?')).at(-1)![0])).toContain('pageSize=50')
    })
    it(`keeps uncertain writes locked through failed readback and closes only after a new successful idle list (${context})`, async () => {
      const view = await queuedPage(context); view.toolbarEvent('rename-tag'); await nextTick(); await approve()
      view.fetcher.mockRejectedValueOnce(new Error('lost reply')); await fireEvent.click(screen.getByTestId('batch-tag-rename-confirm'))
      await screen.findByText(/The save result is unknown/)
      view.fetcher.mockRejectedValueOnce(new Error('read failed')); await fireEvent.click(screen.getByTestId('batch-tag-rename-reload'))
      await screen.findByText(/Could not reload the list/); expect(view.batch.selected.value).toEqual([row.id])
      const pending = createDeferred<Response>(); view.fetcher.mockReturnValueOnce(pending.promise)
      await fireEvent.click(screen.getByTestId('batch-tag-rename-reload')); await waitFor(() => expect(view.client.isFetching()).toBe(1))
      expect(screen.getByRole('dialog')).toBeTruthy(); view.toolbarEvent('rename-tag'); expect(view.batch.selected.value).toEqual([row.id])
      pending.resolve(new Response(JSON.stringify({ code: 0, message: 'OK', data: { items: [] }, meta: { total: 0 } })))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull()); expect(view.batch.selected.value).toEqual([])
      expect(view.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    })
    it(`rejects stale cache and bad versions, and erases preview immediately on permission loss (${context})`, async () => {
      const view = await queuedPage(context), key = view.client.getQueryCache().find({ queryKey: [context === 'own' ? 'short-link' : 'admin-short-link'], exact: false })!.queryKey
      await view.client.invalidateQueries({ queryKey: key, refetchType: 'none' }); view.toolbarEvent('rename-tag'); expect(screen.queryByRole('dialog')).toBeNull()
      const data = view.client.getQueryData<{ items: (typeof row)[]; meta: unknown }>(key)!
      view.client.setQueryData(key, { ...data, items: data.items.map(item => ({ ...item, updatedAt: 'bad' })) }); view.toolbarEvent('rename-tag'); expect(screen.queryByRole('dialog')).toBeNull()
      view.client.setQueryData(key, data); view.toolbarEvent('rename-tag'); await nextTick(); await approve()
      view.client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: [] } }); await nextTick()
      expect(screen.queryByRole('dialog')).toBeNull(); view.toolbarEvent('rename-tag'); expect(screen.queryByRole('dialog')).toBeNull()
    })
  }
  it.each(['own', 'admin'] as const)('opens a fixed editable rename without an automatic request (%s)', async context => {
    const view = mount(context)
    await screen.findByTestId('console-link-list')
    await waitFor(() => expect((screen.getAllByRole('checkbox')[1] as HTMLInputElement).disabled).toBe(false))
    await fireEvent.click(screen.getAllByRole('checkbox')[1]!)
    await fireEvent.click(screen.getByRole('button', { name: 'Rename tag' }))
    expect(screen.getByRole('dialog', { name: 'Rename tag on selected links' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Current tag' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'New tag' })).toBeTruthy()
    expect(view.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
  })
})
