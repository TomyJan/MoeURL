import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createI18n } from 'vue-i18n'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick, type Component, type SetupContext } from 'vue'
import type { useShortLinkBatch } from '@/features/short-link-batch/useShortLinkBatch'
import { componentStubs } from '@/test/component-stubs'
import { messages } from '@/app/i18n'
import { createDeferred } from '@/test/deferred'
import MyLinksPage from './MyLinksPage.vue'
import AdminLinksPage from './AdminLinksPage.vue'

vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const actor = { id: '00000000-0000-0000-0000-000000000001', username: 'batch-note-owner', nickname: '', group: 'admin' }
const version = '2026-11-04T06:00:00.123456Z', noteVersion = '2026-11-04T07:00:00.123456789Z'
const row = { id: '00000000-0000-0000-0000-000000000020', slug: 'batchnote', url: 'https://short.example/batchnote', targetUrl: 'https://example.com', title: '', tags: [], updatedAt: version, createdAt: '2026-11-04T00:00:00Z', status: 'active', redirectMode: 'direct', intermediateDelaySeconds: 5, expiresAt: null, expired: false, passwordEnabled: false, maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false }
const clients: QueryClient[] = []
/** Keeps the real page, list, toolbar and dialog; replaces only HTTP with fresh responses. */
function mount(context: 'own' | 'admin', stubs: Record<string, Component> = {}, locale = 'en') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client)
  const suffix = context === 'own' ? 'own' : 'all'
  const user = { ...actor, permissions: ['admin:access', `short_link:read_${suffix}`, `short_link:update_${suffix}`, `short_link:delete_${suffix}`, 'short_link:set_metadata'] }
  client.setQueryData(['auth', 'me'], { user })
  const fetcher = vi.fn<typeof fetch>(async input => {
    const path = String(input)
    const data = path.endsWith('/auth/me') ? { user } : path.endsWith('/batch-clear/preview')
      ? { items: [{ id: row.id, expectedUpdatedAt: version, expectedNoteUpdatedAt: noteVersion, hasNote: true }], nonemptyCount: 1, emptyCount: 0 }
      : { items: [context === 'admin' ? { ...row, owner: { id: actor.id, username: actor.username, nickname: actor.nickname } } : row] }
    return new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: { total: 1 } }))
  })
  vi.stubGlobal('fetch', fetcher)
  const view = render(context === 'own' ? MyLinksPage : AdminLinksPage, { global: {
    plugins: [[VueQueryPlugin, { queryClient: client }], createI18n({ legacy: false, locale, messages })],
    stubs: { ...componentStubs, BulkCreateDialog: true, ShortLinkListExportButton: true, PersonalTagBrowser: true, AdminTagBrowser: true, ...stubs },
  } })
  return { ...view, client, fetcher }
}
/** Captures component events so tests can deliver old queued actions despite disabled controls. */
async function queuedPage(context: 'own' | 'admin') {
  let rowEvent!: (event: string, payload: unknown) => void
  let toolbarEvent!: (event: string) => void
  let pageEvent!: (event: string, payload?: unknown) => void
  let exportEvent!: (pending: boolean) => void
  let createEvent!: (open: boolean) => void
  let canExport!: () => boolean, canCreate!: () => boolean
  let batch!: ReturnType<typeof useShortLinkBatch>
  const view = mount(context, {
    ConsoleLinkList: { emits: ['note', 'configure', 'qr', 'remove', 'toggle-status', 'transfer'], setup(_props: Record<string, unknown>, ctx: SetupContext) {
      rowEvent = (event, payload) => ctx.emit(event, payload)
      return {}
    }, template: '<div data-testid="queued-rows" />' },
    ShortLinkBatchToolbar: { props: ['state'], emits: ['clear-notes', 'tags', 'transfer'], setup(props: Record<string, unknown>, ctx: SetupContext) {
      batch = props.state as ReturnType<typeof useShortLinkBatch>; toolbarEvent = event => ctx.emit(event)
      return {}
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
  await screen.findByTestId('queued-rows')
  await waitFor(() => expect(view.client.isFetching()).toBe(0))
  batch.toggle(row.id, true)
  return { ...view, rowEvent, toolbarEvent, pageEvent, exportEvent, createEvent, canExport, canCreate, batch }
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals() })

describe('batch note clear page entry', () => {
  it.each(['own', 'admin'] as const)('clears the current selection only after confirmed success (%s)', async context => {
    const view = await queuedPage(context)
    view.toolbarEvent('clear-notes')
    await screen.findByTestId('batch-note-clear-summary')
    view.fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, message: 'OK', data: { changedCount: 1, unchangedCount: 0 }, meta: {} })))
    await fireEvent.click(screen.getByTestId('batch-note-clear-confirm'))
    await waitFor(() => expect(view.batch.selected.value).toEqual([]))
    expect(screen.queryByRole('dialog')).toBeNull()
    const posts = view.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(posts).toHaveLength(2)
    expect(JSON.parse(posts[1]![1]!.body as string)).toEqual({ items: [{ id: row.id, expectedUpdatedAt: version, expectedNoteUpdatedAt: noteVersion }] })
    await waitFor(() => expect(view.fetcher.mock.calls.filter(([url]) => String(url).includes('/list?'))).toHaveLength(2))
  })
  it.each(['own', 'admin'] as const)('previews a pinned current-page selection without clearing it (%s)', async context => {
    const view = mount(context)
    await screen.findByTestId('console-link-list')
    await waitFor(() => expect((screen.getAllByRole('checkbox')[1] as HTMLInputElement).disabled).toBe(false))
    await fireEvent.click(screen.getAllByRole('checkbox')[1]!)
    await fireEvent.click(screen.getByRole('button', { name: 'Clear notes' }))
    await screen.findByTestId('batch-note-clear-summary')
    expect(screen.getByRole('dialog').textContent).toContain('cannot be undone')
    const posts = view.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(String(posts[0]![0])).toBe(`/api/v1/${context === 'admin' ? 'admin/' : ''}short-link/note/batch-clear/preview`)
    expect(JSON.parse(posts[0]![1]!.body as string)).toEqual({ items: [{ id: row.id, expectedUpdatedAt: version }] })
    expect(new Headers(posts[0]![1]!.headers).get('X-MoeURL-Expected-User-ID')).toBe(actor.id)
  })
  it.each(['own', 'admin'] as const)('rejects queued row, batch, filter, paging, export and creation events while open (%s)', async context => {
    const view = await queuedPage(context)
    view.toolbarEvent('clear-notes')
    expect(view.canExport()).toBe(false)
    if (context === 'own') expect(view.canCreate()).toBe(false)
    await screen.findByTestId('batch-note-clear-summary')
    for (const event of ['configure', 'note', 'qr', 'toggle-status', 'transfer']) view.rowEvent(event, row)
    view.rowEvent('remove', row.id); view.toolbarEvent('tags'); view.toolbarEvent('transfer')
    view.batch.openDelete(); await view.batch.submit('disable'); view.batch.toggle(row.id, false)
    view.pageEvent('change', 2); view.pageEvent('size', 100); view.pageEvent('retry')
    await fireEvent.update(screen.getByLabelText('Status'), 'disabled')
    await fireEvent.update(screen.getByLabelText('Keyword'), 'different')
    await fireEvent.update(screen.getByLabelText('Tag'), 'different')
    await fireEvent.update(screen.getByLabelText('Note status'), 'absent')
    await fireEvent.update(screen.getByLabelText('Note keyword'), 'different')
    await nextTick()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    const key = view.client.getQueryCache().find({ queryKey: [context === 'own' ? 'short-link' : 'admin-short-link'], exact: false })!.queryKey
    expect(key[1]).toBe(''); expect(key[2]).toBe(''); expect(key[3]).toBe('')
    expect(view.batch.selected.value).toEqual([row.id])
    expect(view.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    expect(view.fetcher.mock.calls.filter(([url]) => String(url).includes('/list?'))).toHaveLength(1)
  })
  for (const context of ['own', 'admin'] as const) {
    it.each(['settings', 'note', 'qr', 'tags', 'delete', 'batch', 'export', ...(context === 'own' ? ['create'] : ['transfer', 'batch-transfer'])])(`rejects clear while another ${context} operation owns the page: %s`, async operation => {
      const view = await queuedPage(context)
      const request = createDeferred<Response>(); let running: Promise<void> | undefined
      if (operation === 'settings') view.rowEvent('configure', row)
      else if (operation === 'note') view.rowEvent('note', row)
      else if (operation === 'qr') view.rowEvent('qr', row)
      else if (operation === 'tags') view.toolbarEvent('tags')
      else if (operation === 'delete') view.batch.openDelete()
      else if (operation === 'batch') { view.fetcher.mockReturnValueOnce(request.promise); running = view.batch.submit('disable') }
      else if (operation === 'export') view.exportEvent(true)
      else if (operation === 'create') view.createEvent(true)
      else if (operation === 'transfer') view.rowEvent('transfer', row)
      else view.toolbarEvent('transfer')
      view.toolbarEvent('clear-notes'); await nextTick()
      expect(view.fetcher.mock.calls.some(([url]) => String(url).endsWith('/batch-clear/preview'))).toBe(false)
      expect(screen.queryByTestId('batch-note-clear-dialog')).toBeNull()
      request.resolve(new Response(JSON.stringify({ code: 0, message: 'OK', data: { affectedCount: 1 }, meta: {} }))); await running
    })
    it(`requires live grants, current successful idle list and complete real versions (${context})`, async () => {
      const view = await queuedPage(context)
      const key = view.client.getQueryCache().find({ queryKey: [context === 'own' ? 'short-link' : 'admin-short-link'], exact: false })!.queryKey
      view.client.invalidateQueries({ queryKey: key, refetchType: 'none' })
      view.toolbarEvent('clear-notes'); expect(view.fetcher.mock.calls.some(([url]) => String(url).endsWith('/preview'))).toBe(false)
      const data = view.client.getQueryData<{ items: (typeof row)[]; meta: unknown }>(key)!
      view.client.setQueryData(key, { ...data, items: data.items.map(item => ({ ...item, updatedAt: 'bad' })) })
      view.toolbarEvent('clear-notes'); expect(view.fetcher.mock.calls.some(([url]) => String(url).endsWith('/preview'))).toBe(false)
      view.client.setQueryData(key, data)
      view.client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: ['short_link:read_own'] } })
      view.toolbarEvent('clear-notes'); await nextTick()
      expect(screen.queryByTestId('batch-note-clear-dialog')).toBeNull()
    })
  }
  it('allows batch creation without list read access when no competing operation is active', async () => {
    const view = await queuedPage('own')
    view.client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: ['short_link:create'] } })
    await nextTick()
    expect(view.canCreate()).toBe(true)
  })
})
