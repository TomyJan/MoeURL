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
const actor = { id: '00000000-0000-0000-0000-000000000001', username: 'batch-note-owner', nickname: '', group: 'admin' }
const version = '2026-11-05T06:00:00.123456Z'
const row = { id: '00000000-0000-0000-0000-000000000020', slug: 'batchnote', url: 'https://short.example/batchnote', targetUrl: 'https://example.com', title: '', tags: [], updatedAt: version, createdAt: '2026-11-05T00:00:00Z', status: 'active', redirectMode: 'direct', intermediateDelaySeconds: 5, expiresAt: null, expired: false, passwordEnabled: false, maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false }
const clients: QueryClient[] = []

/** Uses actual pages and controls so a missing product entry is a behavior failure. */
function mount(context: 'own' | 'admin', stubs: Record<string, Component> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client)
  const suffix = context === 'own' ? 'own' : 'all'
  const user = { ...actor, permissions: ['admin:access', `short_link:read_${suffix}`, `short_link:update_${suffix}`, `short_link:delete_${suffix}`, 'short_link:set_metadata'] }
  client.setQueryData(['auth', 'me'], { user })
  const fetcher = vi.fn<typeof fetch>(async input => {
    const path = String(input)
    const data = path.endsWith('/auth/me') ? { user } : path.endsWith('/batch-replace/preview')
      ? { items: [{ id: row.id, expectedUpdatedAt: version, expectedNoteUpdatedAt: version, willChange: true }], changedCount: 1, unchangedCount: 0 }
      : path.endsWith('/batch-replace') ? { changedCount: 1, unchangedCount: 0 }
      : { items: [context === 'admin' ? { ...row, owner: { id: actor.id, username: actor.username, nickname: actor.nickname } } : row] }
    return new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: { total: 1 } }))
  })
  vi.stubGlobal('fetch', fetcher)
  const view = render(context === 'own' ? MyLinksPage : AdminLinksPage, { global: {
    plugins: [[VueQueryPlugin, { queryClient: client }], createI18n({ legacy: false, locale: 'en', messages })],
    stubs: { ...componentStubs, BulkCreateDialog: true, ShortLinkListExportButton: true, PersonalTagBrowser: true, AdminTagBrowser: true, ...stubs },
  } })
  return { ...view, client, fetcher }
}

/** Delivers already queued child events, which disabled rendered controls alone cannot guard. */
async function queuedPage(context: 'own' | 'admin') {
  let rowEvent!: (event: string, payload: unknown) => void, toolbarEvent!: (event: string) => void
  let pageEvent!: (event: string, payload?: unknown) => void, exportEvent!: (pending: boolean) => void, createEvent!: (open: boolean) => void
  let canExport!: () => boolean, canCreate!: () => boolean, batch!: ReturnType<typeof useShortLinkBatch>
  const view = mount(context, {
    ConsoleLinkList: { emits: ['note', 'configure', 'qr', 'remove', 'toggle-status', 'transfer'], setup(_props: Record<string, unknown>, ctx: SetupContext) {
      rowEvent = (event, payload) => ctx.emit(event, payload); return {}
    }, template: '<div data-testid="queued-rows" />' },
    ShortLinkBatchToolbar: { props: ['state'], emits: ['replace-notes', 'clear-notes', 'tags', 'transfer'], setup(props: Record<string, unknown>, ctx: SetupContext) {
      batch = props.state as ReturnType<typeof useShortLinkBatch>; toolbarEvent = event => ctx.emit(event); return {}
    }, template: '<div />' },
    ShortLinkPagination: { emits: ['change', 'size', 'retry'], setup(_props: Record<string, unknown>, ctx: SetupContext) {
      pageEvent = (event, payload) => ctx.emit(event, payload); return {}
    }, template: '<div />' },
    ShortLinkListExportButton: { props: ['canStart'], emits: ['pending'], setup(props: Record<string, unknown>, ctx: SetupContext) {
      exportEvent = pending => ctx.emit('pending', pending); canExport = () => (props.canStart as () => boolean)(); return {}
    }, template: '<div />' },
    BulkCreateDialog: { props: ['canOpen'], emits: ['open'], setup(props: Record<string, unknown>, ctx: SetupContext) {
      createEvent = open => ctx.emit('open', open); canCreate = () => (props.canOpen as () => boolean)(); return {}
    }, template: '<div />' },
  })
  await screen.findByTestId('queued-rows'); await waitFor(() => expect(view.client.isFetching()).toBe(0))
  batch.toggle(row.id, true)
  return { ...view, rowEvent, toolbarEvent, pageEvent, exportEvent, createEvent, canExport, canCreate, batch }
}

afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals() })

describe('batch note replacement page entry', () => {
  it.each(['own', 'admin'] as const)('keeps filters and size, clears selection and refreshes only after an explicit successful replacement (%s)', async context => {
    const view = await queuedPage(context)
    await fireEvent.update(screen.getByLabelText('Status'), 'active'); view.pageEvent('size', 50)
    await waitFor(() => expect(view.client.isFetching()).toBe(0)); await nextTick()
    view.batch.toggle(row.id, true); view.toolbarEvent('replace-notes'); await nextTick()
    await fireEvent.update(screen.getByRole('textbox', { name: 'Replacement note' }), 'new private note')
    await fireEvent.click(screen.getByTestId('batch-note-replace-preview')); await screen.findByTestId('batch-note-replace-summary')
    const before = view.fetcher.mock.calls.filter(([url]) => String(url).includes('/list?')).length
    await fireEvent.click(screen.getByTestId('batch-note-replace-confirm'))
    await waitFor(() => expect(view.batch.selected.value).toEqual([]))
    await waitFor(() => expect(view.fetcher.mock.calls.filter(([url]) => String(url).includes('/list?'))).toHaveLength(before + 1))
    expect(screen.queryByRole('dialog')).toBeNull(); expect(screen.getByLabelText('Status')).toHaveProperty('value', 'active')
    const last = view.fetcher.mock.calls.filter(([url]) => String(url).includes('/list?')).at(-1)![0]
    expect(String(last)).toContain('pageSize=50')
    const posts = view.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(posts).toHaveLength(2)
    expect(JSON.parse(posts[1]![1]!.body as string)).toEqual({ items: [{ id: row.id, expectedUpdatedAt: version, expectedNoteUpdatedAt: version }], note: 'new private note' })
  })
  it.each(['own', 'admin'] as const)('blocks queued competing actions, including clear, while replacement is open (%s)', async context => {
    const view = await queuedPage(context); view.toolbarEvent('replace-notes'); await nextTick()
    expect(view.canExport()).toBe(false); if (context === 'own') expect(view.canCreate()).toBe(false)
    for (const label of ['Status', 'Keyword', 'Tag', 'Note status', 'Note keyword']) expect(screen.getByLabelText(label)).toHaveProperty('disabled', true)
    for (const event of ['configure', 'note', 'qr', 'toggle-status', 'transfer']) view.rowEvent(event, row)
    view.rowEvent('remove', row.id)
    for (const event of ['clear-notes', 'replace-notes', 'tags', 'transfer']) view.toolbarEvent(event)
    view.batch.openDelete(); await view.batch.submit('disable'); view.batch.toggle(row.id, false)
    view.pageEvent('change', 2); view.pageEvent('size', 100); view.pageEvent('retry')
    for (const [label, value] of [['Status', 'disabled'], ['Keyword', 'changed'], ['Tag', 'changed'], ['Note status', 'absent'], ['Note keyword', 'changed']]) await fireEvent.update(screen.getByLabelText(label!), value!)
    await nextTick()
    expect(screen.getAllByRole('dialog')).toHaveLength(1); expect(view.batch.selected.value).toEqual([row.id])
    expect(view.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
    expect(view.fetcher.mock.calls.filter(([url]) => String(url).includes('/list?'))).toHaveLength(1)
    const key = view.client.getQueryCache().find({ queryKey: [context === 'own' ? 'short-link' : 'admin-short-link'], exact: false })!.queryKey
    expect(key[1]).toBe(''); expect(key[2]).toBe(''); expect(key[3]).toBe('')
  })
  for (const context of ['own', 'admin'] as const) {
    it.each(['clear', 'settings', 'note', 'qr', 'tags', 'delete', 'batch', 'export', ...(context === 'own' ? ['create'] : ['transfer', 'batch-transfer'])])(`rejects queued replacement while another ${context} operation owns the page: %s`, async operation => {
      const view = await queuedPage(context), request = createDeferred<Response>(); let running: Promise<void> | undefined
      if (operation === 'clear') view.toolbarEvent('clear-notes')
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
      view.toolbarEvent('replace-notes'); await nextTick()
      expect(screen.queryByTestId('batch-note-replace-dialog')).toBeNull()
      request.resolve(new Response(JSON.stringify({ code: 0, message: 'OK', data: { affectedCount: 1 }, meta: {} }))); await running
    })
    it(`rejects stale lists, invalid versions and transient revoked permissions (${context})`, async () => {
      const view = await queuedPage(context)
      const key = view.client.getQueryCache().find({ queryKey: [context === 'own' ? 'short-link' : 'admin-short-link'], exact: false })!.queryKey
      await view.client.invalidateQueries({ queryKey: key, refetchType: 'none' }); view.toolbarEvent('replace-notes')
      expect(screen.queryByTestId('batch-note-replace-dialog')).toBeNull()
      const data = view.client.getQueryData<{ items: (typeof row)[]; meta: unknown }>(key)!
      view.client.setQueryData(key, { ...data, items: data.items.map(item => ({ ...item, updatedAt: 'bad' })) }); view.toolbarEvent('replace-notes')
      expect(screen.queryByTestId('batch-note-replace-dialog')).toBeNull()
      view.client.setQueryData(key, data); view.toolbarEvent('replace-notes'); await nextTick()
      expect(screen.getByTestId('batch-note-replace-dialog')).toBeTruthy()
      await fireEvent.update(screen.getByRole('textbox', { name: 'Replacement note' }), 'private-canary')
      view.client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: ['short_link:read_own'] } }); await nextTick()
      expect(screen.queryByTestId('batch-note-replace-dialog')).toBeNull(); expect(document.body.textContent).not.toContain('private-canary')
    })
  }
  it.each(['own', 'admin'] as const)('opens an editable replacement without sending an automatic write (%s)', async context => {
    const view = mount(context)
    await screen.findByTestId('console-link-list')
    await waitFor(() => expect((screen.getAllByRole('checkbox')[1] as HTMLInputElement).disabled).toBe(false))
    await fireEvent.click(screen.getAllByRole('checkbox')[1]!)
    await fireEvent.click(screen.getByRole('button', { name: 'Replace notes' }))
    expect(screen.getByRole('dialog', { name: 'Replace selected internal notes' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: 'Replacement note' })).toBeTruthy()
    expect(view.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(0)
  })
})
