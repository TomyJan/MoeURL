import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import { downloadCsv } from '@/shared/download/csv'
import { defineComponent, h, nextTick } from 'vue'
import { toast } from 'vue-sonner'
import MyLinksPage from './MyLinksPage.vue'
import AdminLinksPage from './AdminLinksPage.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/shared/download/csv', () => ({ downloadCsv: vi.fn() }))
const clients: QueryClient[] = []
const actor = { id: '00000000-0000-0000-0000-000000000001', username: 'reader', nickname: '', group: 'admin' }
const csv = '\uFEFFid,short_url,slug,target_url,title,tags,status,redirect_mode,intermediate_delay_seconds,expires_at,password_enabled,max_visits,visits_used,created_at,updated_at,owner_id,owner_username\r\n'
const row = {
  id: '00000000-0000-0000-0000-000000000100', slug: 'notequery', url: 'https://short.example/notequery', targetUrl: 'https://example.com',
  title: 'metadata row', tags: [], status: 'active', updatedAt: '2026-11-03T00:00:00.123456Z', createdAt: '2026-11-03T00:00:00Z', redirectMode: 'direct',
  intermediateDelaySeconds: 5, expiresAt: null, expired: false, passwordEnabled: false, maxVisits: null, visitsUsed: 0, visitsRemaining: null, exhausted: false,
}

/** Keeps actual pages, entity parsing, identity and queries; replaces only the external HTTP server. */
function mount(context: 'own' | 'admin', write = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client)
  const user = { ...actor, permissions: ['admin:access', 'short_link:export', `short_link:read_${context === 'own' ? 'own' : 'all'}`, ...(write ? [`short_link:update_${context === 'own' ? 'own' : 'all'}`, 'short_link:set_metadata'] : [])] }
  client.setQueryData(['auth', 'me'], { user })
  let stored = 'private handoff', membership = false
  const envelope = (title: string, page = 1, visible = true) => new Response(JSON.stringify({ code: 0, message: 'OK', data: { items: visible ? [{ ...row, title, ...(context === 'admin' ? { owner: { id: actor.id, username: actor.username, nickname: actor.nickname } } : {}) }] : [] }, meta: { page, pageSize: 20, total: visible ? 21 : 0 } }))
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input), 'http://localhost')
    if (url.pathname.endsWith('/auth/me')) return new Response(JSON.stringify({ code: 0, message: 'OK', data: { user }, meta: {} }))
    if (url.pathname.endsWith('/note') || url.pathname.endsWith('/note/update')) {
      if (init?.method === 'POST') stored = JSON.parse(init.body as string).note
      return new Response(JSON.stringify({ code: 0, message: 'OK', data: { id: row.id, note: stored, updatedAt: '2026-11-03T00:00:00.123456789Z' }, meta: {} }))
    }
    if (url.pathname.endsWith('/export')) return new Response(JSON.stringify({ code: 0, message: 'OK', data: { fileName: context === 'own' ? 'moeurl-links-own.csv' : 'moeurl-links-all.csv', contentType: 'text/csv;charset=utf-8', content: csv }, meta: {} }))
    const page = init?.method === 'POST' ? JSON.parse(init.body as string).page : Number(url.searchParams.get('page') ?? 1)
    return envelope(init?.method === 'POST' ? 'matched private query' : 'metadata row', page, !membership || init?.method !== 'POST' || stored.includes(JSON.parse(init.body as string).noteQuery))
  })
  vi.stubGlobal('fetch', fetcher)
  let queued!: (value: unknown) => void
  const field = defineComponent({ props: { label: { type: String, default: '' }, modelValue: { type: String, default: '' }, errorMessages: { type: String, default: '' }, disabled: Boolean }, emits: ['update:modelValue'], setup(props, { emit }) {
    if (props.label === 'filter.noteQuery') queued = value => emit('update:modelValue', value)
    return () => h(componentStubs.VTextField!, { ...props, 'onUpdate:modelValue': (value: unknown) => emit('update:modelValue', value) })
  } })
  const remount = () => render(context === 'own' ? MyLinksPage : AdminLinksPage, { global: {
    plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: { ...componentStubs, VTextField: field, BulkCreateDialog: true, PersonalTagBrowser: true, AdminTagBrowser: true },
  } })
  return { ...remount(), remount, client, fetcher, user, envelope, queued: (value: unknown) => queued(value), trackMembership: () => { membership = true }, setStored: (value: string) => { stored = value } }
}

async function ready() {
  await screen.findByTestId('console-link-list')
  await waitFor(() => expect((screen.getByTestId('short-link-list-export') as HTMLButtonElement).disabled).toBe(false))
}
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()); vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('private note keyword search', () => {
  // Sending private terms through old q/GET or omitting the independent input exposes the wrong search boundary.
  it.each(['own', 'admin'] as const)('searchesNotesWithoutURLLeak in %s', async context => {
    const view = mount(context); await ready()
    await fireEvent.update(screen.getByLabelText('filter.keyword'), 'metadata'); await ready()
    await fireEvent.update(screen.getByLabelText('filter.noteQuery'), ' \u2003private%_\\词\u2003 ')
    await screen.findByText('matched private query'); await ready()
    const [url, init] = view.fetcher.mock.calls.at(-1)!
    expect(url).toBe(`/api/v1/${context === 'admin' ? 'admin/' : ''}short-link/note/search`)
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({ 'X-MoeURL-Expected-User-ID': actor.id })
    expect(JSON.parse(init?.body as string)).toEqual({ page: 1, pageSize: 20, status: '', q: 'metadata', tag: '', noteStatus: '', noteQuery: 'private%_\\词' })
    expect(window.location.href).not.toContain('private')
    expect(localStorage.length).toBe(0)
  })

  // Invalid or unapplied private drafts must not silently export or navigate the previous collection.
  it.each(['own', 'admin'] as const)('rejectsInvalidOrUnappliedNoteQuery in %s', async context => {
    const view = mount(context); await ready()
    const count = view.fetcher.mock.calls.length
    for (const value of ['a'.repeat(101), '\tterm', '\u0085term', '\uD800']) {
      await fireEvent.update(screen.getByLabelText('filter.noteQuery'), value)
      expect(screen.getByText('linkMetadata.noteQueryInvalid')).toBeTruthy()
      expect(screen.queryByTestId('short-link-pagination-summary')).toBeNull()
      expect((screen.getByTestId('short-link-list-export') as HTMLButtonElement).disabled).toBe(true)
      expect((screen.getByRole('button', { name: 'pagination.next' }) as HTMLButtonElement).disabled).toBe(true)
      expect(view.fetcher.mock.calls).toHaveLength(count)
    }
    await fireEvent.update(screen.getByLabelText('filter.noteQuery'), '😀'.repeat(100))
    expect(screen.queryByTestId('short-link-pagination-summary')).toBeNull()
    expect(view.fetcher.mock.calls).toHaveLength(count)
    await ready()
    expect(JSON.parse(view.fetcher.mock.calls.at(-1)![1]!.body as string).noteQuery).toBe('😀'.repeat(100))
    await fireEvent.update(screen.getByLabelText('filter.noteQuery'), '')
    await screen.findByText('metadata row'); await ready()
    expect(view.fetcher.mock.calls.at(-1)![1]?.method).toBe('GET')
  })

  // A→B→A and a new observer must not revive a retired private result or retain its query key.
  it.each(['own', 'admin'] as const)('retiresNoteSearchAcrossABAAndRemount in %s', async context => {
    const view = mount(context); await ready()
    await fireEvent.update(screen.getByLabelText('filter.noteQuery'), 'A'); await ready()
    const old = createDeferred<Response>(), current = createDeferred<Response>()
    view.fetcher.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    await fireEvent.update(screen.getByLabelText('filter.noteQuery'), 'B')
    await waitFor(() => expect(JSON.parse(view.fetcher.mock.calls.at(-1)![1]!.body as string).noteQuery).toBe('B'))
    await fireEvent.update(screen.getByLabelText('filter.noteQuery'), 'A')
    await waitFor(() => expect(JSON.parse(view.fetcher.mock.calls.at(-1)![1]!.body as string).noteQuery).toBe('A'))
    old.resolve(view.envelope('retired B')); await nextTick(); await nextTick()
    expect(screen.queryByText('retired B')).toBeNull()
    current.resolve(view.envelope('fresh A')); await ready()
    expect(screen.getByText('fresh A')).toBeTruthy()
    view.unmount()
    await waitFor(() => expect(view.client.getQueryCache().getAll().filter(q => q.queryKey[9])).toHaveLength(0))
    view.remount(); await ready()
    expect(screen.getByText('metadata row')).toBeTruthy()
    expect(screen.queryByText('fresh A')).toBeNull()
  })

  // Page two is a view of a complete collection; its export must contain no page fields or private URL term.
  it.each(['own', 'admin'] as const)('exportsAllMatchesFromSecondPage in %s', async context => {
    const view = mount(context); await ready()
    await fireEvent.update(screen.getByLabelText('filter.noteQuery'), 'private'); await ready()
    await fireEvent.click(screen.getByRole('button', { name: 'pagination.next' })); await ready()
    expect(JSON.parse(view.fetcher.mock.calls.at(-1)![1]!.body as string).page).toBe(2)
    await fireEvent.click(screen.getByTestId('short-link-list-export'))
    await waitFor(() => expect(downloadCsv).toHaveBeenCalledOnce())
    const [url, init] = view.fetcher.mock.calls.at(-1)!
    expect(url).toBe(`/api/v1/${context === 'admin' ? 'admin/' : ''}short-link/note/search/export`)
    expect(init?.method).toBe('POST')
    expect(init?.headers).toMatchObject({ 'X-MoeURL-Expected-User-ID': actor.id })
    expect(JSON.parse(init?.body as string)).toEqual({ status: '', q: '', tag: '', noteStatus: '', noteQuery: 'private' })
  })

  // Late results from a different account or a revoked permission epoch must not become the current collection.
  it.each(['own', 'admin'] as const)('pinsIdentityAndRetiresRevokedResults in %s', async context => {
    const view = mount(context); await ready()
    view.queued(123); await nextTick()
    expect((screen.getByLabelText('filter.noteQuery') as HTMLInputElement).value).toBe('')
    const old = createDeferred<Response>(), current = createDeferred<Response>()
    view.fetcher.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    await fireEvent.update(screen.getByLabelText('filter.noteQuery'), 'private')
    await waitFor(() => expect(view.fetcher.mock.calls.at(-1)![1]?.method).toBe('POST'))
    const nextActor = '00000000-0000-0000-0000-000000000002'
    view.client.setQueryData(['auth', 'me'], { user: { ...view.user, id: nextActor } })
    await waitFor(() => expect(view.fetcher.mock.calls.at(-1)![1]?.headers).toMatchObject({ 'X-MoeURL-Expected-User-ID': nextActor }))
    old.resolve(view.envelope('retired identity')); await nextTick(); await nextTick()
    expect(screen.queryByText('retired identity')).toBeNull()
    current.resolve(view.envelope('current identity')); await ready()
    view.client.setQueryData(['auth', 'me'], { user: { ...view.user, permissions: [] } })
    view.queued('denied')
    view.client.setQueryData(['auth', 'me'], { user: view.user }); await ready()
    expect((screen.getByLabelText('filter.noteQuery') as HTMLInputElement).value).toBe('private')
    expect(screen.queryByText('current identity')).toBeNull()
  })

  // A queued draft edit must not close an editor or retire a save; confirmed writes re-evaluate membership.
  it.each(['own', 'admin'] as const)('refreshesMembershipAfterNoteWrite in %s', async context => {
    const view = mount(context, true); view.trackMembership(); await ready()
    await fireEvent.update(screen.getByLabelText('filter.noteQuery'), 'private'); await ready()
    await fireEvent.click(screen.getByRole('button', { name: 'links.actions.more' }))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'linkNote.action' }))
    await waitFor(() => expect((screen.getByLabelText('linkNote.text') as HTMLTextAreaElement).value).toBe('private handoff'))
    view.queued('other'); await nextTick()
    expect((screen.getByLabelText('filter.noteQuery') as HTMLInputElement).value).toBe('private')
    await fireEvent.click(screen.getByRole('button', { name: 'linkNote.clear' }))
    await fireEvent.click(screen.getByRole('button', { name: 'linkNote.save' }))
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('linkNote.saved'))
    await fireEvent.click(screen.getByRole('button', { name: 'linkNote.close' }))
    await screen.findByText('links.emptyTitle')
    expect(screen.queryByTestId('console-link-list')).toBeNull()
  })

  it.each(['own', 'admin'] as const)('requiresExplicitReadbackAfterUnknownWrite in %s', async context => {
    const view = mount(context, true); view.trackMembership(); await ready()
    await fireEvent.update(screen.getByLabelText('filter.noteQuery'), 'private'); await ready()
    await fireEvent.click(screen.getByRole('button', { name: 'links.actions.more' }))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'linkNote.action' }))
    await waitFor(() => expect((screen.getByLabelText('linkNote.text') as HTMLTextAreaElement).value).toBe('private handoff'))
    await fireEvent.click(screen.getByRole('button', { name: 'linkNote.clear' }))
    view.fetcher.mockRejectedValueOnce(new Error('connection lost'))
    await fireEvent.click(screen.getByRole('button', { name: 'linkNote.save' }))
    await screen.findByText('linkNote.unknown')
    view.setStored('')
    const searches = () => view.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/note/search')).length
    const before = searches()
    await fireEvent.click(screen.getByRole('button', { name: 'linkNote.reload' }))
    await waitFor(() => expect(searches()).toBe(before + 1))
    expect(view.fetcher.mock.calls.filter(([url]) => String(url).endsWith('/note/update'))).toHaveLength(1)
    await fireEvent.click(screen.getByRole('button', { name: 'linkNote.close' }))
    await screen.findByText('links.emptyTitle')
  })
})
