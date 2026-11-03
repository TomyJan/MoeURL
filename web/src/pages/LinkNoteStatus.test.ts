import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { defineComponent, h, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'vue-sonner'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import { downloadCsv } from '@/shared/download/csv'
import MyLinksPage from './MyLinksPage.vue'
import AdminLinksPage from './AdminLinksPage.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/shared/download/csv', () => ({ downloadCsv: vi.fn() }))
const actor = { id: '00000000-0000-0000-0000-000000000001', username: 'reader', nickname: '', group: 'admin' }
const row = { id: '00000000-0000-0000-0000-000000000020', slug: 'note-status-row', url: 'https://short.example/note-status-row', targetUrl: 'https://example.com', title: '', tags: [], updatedAt: '2026-11-03T00:00:00.123456Z', createdAt: '2026-11-03T00:00:00Z', status: 'active', redirectMode: 'direct', intermediateDelaySeconds: 5, expiresAt: null, expired: false, passwordEnabled: false, maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false }
const version = '2026-11-03T01:00:00.123456789Z'
const csv = '\uFEFFid,short_url,slug,target_url,title,tags,status,redirect_mode,intermediate_delay_seconds,expires_at,password_enabled,max_visits,visits_used,created_at,updated_at,owner_id,owner_username\r\n'
const clients: QueryClient[] = []
/** Uses real pages, HTTP parsers and QueryClient; the server boundary owns the fixture state. */
function mount(context: 'own' | 'admin', write = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client)
  const suffix = context === 'own' ? 'own' : 'all'
  const permissions = ['admin:access', 'short_link:export', `short_link:read_${suffix}`, ...(write ? [`short_link:update_${suffix}`, 'short_link:set_metadata'] : [])]
  const user = { ...actor, permissions }
  client.setQueryData(['auth', 'me'], { user })
  let stored = 'Private handoff'
  const link = context === 'own' ? row : { ...row, owner: { id: actor.id, username: actor.username, nickname: actor.nickname } }
  const envelope = (items = [link]) => response({ items }, 0, items.length)
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname.endsWith('/auth/me')) return response({ user })
    if (url.pathname.endsWith('/note') || url.pathname.endsWith('/note/update')) {
      if (init?.method === 'POST') stored = (JSON.parse(init.body as string) as { note: string }).note
      return response({ id: row.id, note: stored, updatedAt: version })
    }
    if (url.pathname.endsWith('/export')) return response({ fileName: context === 'own' ? 'moeurl-links-own.csv' : 'moeurl-links-all.csv', contentType: 'text/csv;charset=utf-8', content: csv })
    const status = url.searchParams.get('noteStatus')
    return envelope(status === 'present' && !stored || status === 'absent' && !!stored ? [] : [link])
  })
  vi.stubGlobal('fetch', fetcher)
  let queued!: (value: unknown) => void
  const select = defineComponent({ props: { label: { type: String, default: '' }, items: { type: Array, default: () => [] }, modelValue: { type: [String, Number], default: '' }, disabled: Boolean }, emits: ['update:modelValue'], setup(props, { emit }) {
    if (props.label === 'filter.noteStatus') queued = value => emit('update:modelValue', value)
    return () => h(componentStubs.VSelect!, { ...props, 'onUpdate:modelValue': (value: unknown) => emit('update:modelValue', value) })
  } })
  const remount = () => render(context === 'own' ? MyLinksPage : AdminLinksPage, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: { ...componentStubs, VSelect: select, BulkCreateDialog: true, PersonalTagBrowser: true, AdminTagBrowser: true } } })
  const view = remount()
  return { ...view, remount, client, fetcher, envelope, user, queued: (value: unknown) => queued(value), setStored: (value: string) => { stored = value }, prefix: context === 'own' ? 'short-link' : 'admin-short-link' }
}
/** Builds complete envelopes so malformed fixture responses cannot masquerade as a product failure. */
function response(data: unknown, code = 0, total = 1) { return new Response(JSON.stringify({ code, message: 'Result', data, meta: { page: 1, pageSize: 20, total } })) }
/** Waits for the actual applied list instead of assuming that a render tick completed its network read. */
async function ready() { await screen.findByTestId('console-link-list'); await waitFor(() => expect((screen.getByTestId('short-link-list-export') as HTMLButtonElement).disabled).toBe(false)) }
async function openNote() { await fireEvent.click(screen.getByRole('button', { name: 'links.actions.more' })); await fireEvent.click(screen.getByRole('menuitem', { name: 'linkNote.action' })); await waitFor(() => expect((screen.getByLabelText('linkNote.text') as HTMLTextAreaElement).value).toBe('Private handoff')) }
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('note presence page filtering', () => {
  // Removing the selector or omitting its request parameter must leave the wrong visible collection.
  it.each(['own', 'admin'] as const)('applies three states, clears selection and exports the same %s filter', async context => {
    const view = mount(context)
    await ready()
    expect(String(view.fetcher.mock.calls[0]![0])).not.toContain('noteStatus')
    await fireEvent.click(screen.getAllByRole('checkbox')[1]!)
    await fireEvent.update(screen.getByLabelText('filter.noteStatus'), 'present')
    await ready()
    expect((screen.getAllByRole('checkbox')[1] as HTMLInputElement).checked).toBe(false)
    expect(String(view.fetcher.mock.calls.at(-1)![0])).toBe(`/api/v1/${context === 'admin' ? 'admin/' : ''}short-link/list?page=1&pageSize=20&noteStatus=present`)
    await fireEvent.click(screen.getByTestId('short-link-list-export'))
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledOnce())
    expect(String(view.fetcher.mock.calls.at(-1)![0])).toBe(`/api/v1/${context === 'admin' ? 'admin/' : ''}short-link/export?noteStatus=present`)
    await fireEvent.update(screen.getByLabelText('filter.noteStatus'), 'absent')
    await waitFor(() => expect(screen.queryByTestId('console-link-list')).toBeNull())
    await fireEvent.update(screen.getByLabelText('filter.noteStatus'), '')
    await ready()
    expect(String(view.fetcher.mock.calls.at(-1)![0])).not.toContain('noteStatus')
  })
  it.each(['own', 'admin'] as const)('lets a readonly %s account filter without offering a write', async context => {
    mount(context, false); await ready()
    expect((screen.getByLabelText('filter.noteStatus') as HTMLSelectElement).disabled).toBe(false)
    await fireEvent.update(screen.getByLabelText('filter.noteStatus'), 'present'); await ready(); await openNote()
    expect(screen.queryByRole('button', { name: 'linkNote.save' })).toBeNull()
    await fireEvent.update(screen.getByLabelText('filter.noteStatus'), 'absent')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(screen.queryByTestId('console-link-list')).toBeNull())
  })
  // Reusing a filter key must not expose its previous cache or accept a retired network completion.
  it.each(['own', 'admin'] as const)('retires late lists across A→B→A and permission reuse in %s', async context => {
    const view = mount(context); await ready()
    const old = createDeferred<Response>(), middle = createDeferred<Response>(), current = createDeferred<Response>()
    view.fetcher.mockReturnValueOnce(old.promise)
    await fireEvent.update(screen.getByLabelText('filter.noteStatus'), 'present')
    view.fetcher.mockReturnValueOnce(middle.promise)
    await fireEvent.update(screen.getByLabelText('filter.noteStatus'), 'absent')
    view.fetcher.mockReturnValueOnce(current.promise)
    await fireEvent.update(screen.getByLabelText('filter.noteStatus'), 'present')
    expect(screen.queryByTestId('console-link-list')).toBeNull()
    old.resolve(view.envelope()); middle.resolve(view.envelope())
    await nextTick(); await nextTick()
    expect(screen.queryByTestId('console-link-list')).toBeNull()
    current.resolve(view.envelope([]))
    await waitFor(() => expect(view.client.isFetching({ queryKey: [view.prefix] })).toBe(0))
    expect(screen.queryByTestId('console-link-list')).toBeNull()
    view.fetcher.mockResolvedValueOnce(view.envelope())
    view.client.setQueryData(['auth', 'me'], { user: { ...view.user, permissions: [] } })
    view.client.setQueryData(['auth', 'me'], { user: view.user })
    await ready()
  })
  // A queued component event must not retire an in-flight save, even before disabled props render.
  it.each(['own', 'admin'] as const)('rejects queued filter changes during save and refreshes after clearing in %s', async context => {
    const view = mount(context); await ready()
    await fireEvent.update(screen.getByLabelText('filter.noteStatus'), 'present'); await ready(); await openNote()
    await fireEvent.click(screen.getByRole('button', { name: 'linkNote.clear' }))
    const saved = createDeferred<Response>()
    view.fetcher.mockReturnValueOnce(saved.promise)
    const click = fireEvent.click(screen.getByRole('button', { name: 'linkNote.save' }))
    view.queued('absent'); await click
    expect((screen.getByLabelText('filter.noteStatus') as HTMLSelectElement).value).toBe('present')
    expect(screen.getByRole('dialog')).toBeTruthy()
    view.setStored(''); saved.resolve(response({ id: row.id, note: '', updatedAt: version }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('linkNote.saved'))
    await fireEvent.click(screen.getByRole('button', { name: 'linkNote.close' }))
    await waitFor(() => expect(screen.queryByTestId('console-link-list')).toBeNull())
    await fireEvent.update(screen.getByLabelText('filter.noteStatus'), 'absent'); await ready()
  })
  // Unknown transport outcomes require explicit readback; neither a replay nor an initial read refreshes.
  it.each(['own', 'admin'] as const)('refreshes only after an uncertain write is explicitly read back in %s', async context => {
    const view = mount(context); await ready()
    await fireEvent.update(screen.getByLabelText('filter.noteStatus'), 'present'); await ready(); await openNote()
    const listReads = () => view.fetcher.mock.calls.filter(([url]) => String(url).includes('/list?')).length
    const before = listReads()
    await fireEvent.click(screen.getByRole('button', { name: 'linkNote.clear' }))
    view.fetcher.mockRejectedValueOnce(new Error('connection lost'))
    await fireEvent.click(screen.getByRole('button', { name: 'linkNote.save' }))
    await screen.findByText('linkNote.unknown')
    expect(listReads()).toBe(before)
    view.setStored('')
    await fireEvent.click(screen.getByRole('button', { name: 'linkNote.reload' }))
    await waitFor(() => expect(listReads()).toBe(before + 1))
    expect(view.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    await fireEvent.click(screen.getByRole('button', { name: 'linkNote.close' }))
    await waitFor(() => expect(screen.queryByTestId('console-link-list')).toBeNull())
  })
  it.each(['own', 'admin'] as const)('refreshes an absent collection after a confirmed save in %s', async context => {
    const view = mount(context); await ready(); view.setStored('')
    await fireEvent.update(screen.getByLabelText('filter.noteStatus'), 'absent'); await ready()
    await fireEvent.click(screen.getByRole('button', { name: 'links.actions.more' }))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'linkNote.action' }))
    await waitFor(() => expect((screen.getByLabelText('linkNote.text') as HTMLTextAreaElement).disabled).toBe(false))
    await fireEvent.update(screen.getByLabelText('linkNote.text'), 'new handoff')
    await fireEvent.click(screen.getByRole('button', { name: 'linkNote.save' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('linkNote.saved'))
    await fireEvent.click(screen.getByRole('button', { name: 'linkNote.close' }))
    await waitFor(() => expect(screen.queryByTestId('console-link-list')).toBeNull())
    await fireEvent.update(screen.getByLabelText('filter.noteStatus'), 'present'); await ready()
  })
  it.each(['own', 'admin'] as const)('does not display a previous successful filter cache when returning in %s', async context => {
    const view = mount(context); await ready()
    await fireEvent.update(screen.getByLabelText('filter.noteStatus'), 'present'); await ready()
    const middle = createDeferred<Response>(), fresh = createDeferred<Response>()
    view.fetcher.mockReturnValueOnce(middle.promise)
    await fireEvent.update(screen.getByLabelText('filter.noteStatus'), 'absent')
    view.fetcher.mockReturnValueOnce(fresh.promise)
    await fireEvent.update(screen.getByLabelText('filter.noteStatus'), 'present')
    expect(screen.queryByTestId('console-link-list')).toBeNull()
    middle.resolve(view.envelope()); fresh.resolve(view.envelope([]))
    await waitFor(() => expect(view.client.isFetching({ queryKey: [view.prefix] })).toBe(0))
    expect(screen.queryByTestId('console-link-list')).toBeNull()
  })
  // Ordinary route navigation preserves the app's QueryClient and login epoch; a new page must not reuse its previous instance's list snapshots.
  it.each(['own', 'admin'] as const)('does not restore a successful note-filter snapshot after remount in %s', async context => {
    const view = mount(context); await ready()
    await fireEvent.update(screen.getByLabelText('filter.noteStatus'), 'present'); await ready()
    view.unmount()
    const current = createDeferred<Response>(), defaults = createDeferred<Response>()
    view.fetcher.mockImplementation(async input => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname.endsWith('/auth/me')) return response({ user: view.user })
      return url.searchParams.get('noteStatus') === 'present' ? current.promise : defaults.promise
    })
    view.remount()
    await fireEvent.update(screen.getByLabelText('filter.noteStatus'), 'present')
    const staleVisible = screen.queryByTestId('console-link-list') !== null
    defaults.resolve(view.envelope([])); current.resolve(view.envelope([]))
    await waitFor(() => expect(view.client.isFetching({ queryKey: [view.prefix] })).toBe(0))
    expect(staleVisible).toBe(false)
    expect(screen.queryByTestId('console-link-list')).toBeNull()
  })
  it.each(['own', 'admin'] as const)('retires a pending note-filter request across remount in %s', async context => {
    const view = mount(context); await ready()
    const old = createDeferred<Response>(), current = createDeferred<Response>(), defaults = createDeferred<Response>()
    view.fetcher.mockReturnValueOnce(old.promise)
    await fireEvent.update(screen.getByLabelText('filter.noteStatus'), 'present')
    const oldQuery = view.client.getQueryCache().findAll({ queryKey: [view.prefix] }).find(query => query.queryKey[7] === 'present')!
    expect(oldQuery).toBeDefined()
    view.unmount()
    view.fetcher.mockImplementation(async input => {
      const url = new URL(String(input), 'http://localhost')
      if (url.pathname.endsWith('/auth/me')) return response({ user: view.user })
      return url.searchParams.get('noteStatus') === 'present' ? current.promise : defaults.promise
    })
    view.remount()
    await fireEvent.update(screen.getByLabelText('filter.noteStatus'), 'present')
    old.resolve(view.envelope()); defaults.resolve(view.envelope([]))
    await waitFor(() => expect(oldQuery.state.status).toBe('success'))
    await nextTick()
    const staleVisible = screen.queryByTestId('console-link-list') !== null
    current.resolve(view.envelope([]))
    await waitFor(() => expect(view.client.isFetching({ queryKey: [view.prefix] })).toBe(0))
    expect(staleVisible).toBe(false)
    expect(screen.queryByTestId('console-link-list')).toBeNull()
  })
  it.each(['own', 'admin'] as const)('retires a late download and its errors across note-filter reuse in %s', async context => {
    for (const failed of [false, true]) {
      const view = mount(context); await ready()
      const exporting = createDeferred<Response>()
      view.fetcher.mockReturnValueOnce(exporting.promise)
      await fireEvent.click(screen.getByTestId('short-link-list-export'))
      await fireEvent.update(screen.getByLabelText('filter.noteStatus'), 'present')
      await fireEvent.update(screen.getByLabelText('filter.noteStatus'), '')
      if (failed) exporting.reject(new Error('private download failure'))
      else exporting.resolve(response({ fileName: context === 'own' ? 'moeurl-links-own.csv' : 'moeurl-links-all.csv', contentType: 'text/csv;charset=utf-8', content: csv }))
      await ready()
      expect(downloadCsv).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
      view.unmount(); view.client.clear()
    }
  })
  it.each(['own', 'admin'] as const)('rejects invalid or denied queued events and settings overlap in %s', async context => {
    const view = mount(context); await ready()
    for (const value of [null, undefined, 'Present', 'present ']) view.queued(value)
    await nextTick()
    expect((screen.getByLabelText('filter.noteStatus') as HTMLSelectElement).value).toBe('')
    view.client.setQueryData(['auth', 'me'], { user: { ...view.user, permissions: [] } })
    view.queued('present'); await nextTick()
    expect((screen.getByLabelText('filter.noteStatus') as HTMLSelectElement).value).toBe('')
    view.client.setQueryData(['auth', 'me'], { user: view.user }); await ready()
    await fireEvent.click(screen.getByRole('button', { name: 'links.actions.more' }))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'links.actions.configure' }))
    view.queued('present'); await nextTick()
    expect((screen.getByLabelText('filter.noteStatus') as HTMLSelectElement).disabled).toBe(true)
    expect((screen.getByLabelText('filter.noteStatus') as HTMLSelectElement).value).toBe('')
  })
})
