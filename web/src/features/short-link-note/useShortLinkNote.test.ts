import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { defineComponent, h, nextTick } from 'vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'vue-sonner'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import { useShortLinkAccess } from '@/features/short-link-batch/useShortLinkBatch'
import { useShortLinkNote } from './useShortLinkNote'
import ShortLinkNoteDialog from './ShortLinkNoteDialog.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const actorId = '00000000-0000-0000-0000-000000000001', otherId = '00000000-0000-0000-0000-000000000002'
const target = { id: '00000000-0000-0000-0000-000000000020', url: 'https://short.example/note' }
const another = { id: '00000000-0000-0000-0000-000000000021', url: 'https://short.example/next' }
const version = '2026-11-03T00:00:00.123456789Z', nextVersion = '2026-11-03T00:00:00.123457789Z'
const grants = ['short_link:read_own', 'short_link:update_own', 'short_link:set_metadata', 'admin:access', 'short_link:read_all', 'short_link:update_all']
const user = (permissions = grants, id = actorId) => ({ id, username: 'reader', nickname: '', group: 'user', permissions })
const note = (id = target.id, text = 'server note') => ({ id, note: text, updatedAt: version })
const response = (data: unknown, code = 0, status = 200) => new Response(JSON.stringify({ code, message: 'Result', data, meta: {} }), { status })
const clients: QueryClient[] = []

/** Exercises the real identity/cache/controller/dialog; only the network response is replaced. */
function mount(context: 'own' | 'admin' = 'own', permissions = grants) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } })
  clients.push(client)
  client.setQueryData(['auth', 'me'], { user: user(permissions) })
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    const path = new URL(String(url), 'http://localhost')
    if (path.pathname.endsWith('/auth/me')) return response({ user: user(permissions) })
    if (init?.method === 'POST') return response({ ...JSON.parse(init.body as string), updatedAt: nextVersion, expectedUpdatedAt: undefined })
    return response(note(path.searchParams.get('id')!))
  })
  vi.stubGlobal('fetch', fetcher)
  let state!: ReturnType<typeof useShortLinkNote>
  const view = render(defineComponent({ setup() {
    const access = useShortLinkAccess(context)
    state = useShortLinkNote(context, access)
    return () => h(ShortLinkNoteDialog, { state })
  } }), { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: componentStubs } })
  return { ...view, client, state, fetcher }
}
/** Waits for a real successful read rather than assuming a render tick means loaded. */
async function opened(view: ReturnType<typeof mount>) {
  view.state.open(target)
  await waitFor(() => expect(view.state.data.value).toEqual(note()))
}
beforeEach(() => vi.clearAllMocks())
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals() })

describe('private note editor', () => {
  it.each(['own', 'admin'] as const)('loads on demand, saves a normalized independent version and clears only the draft (%s)', async context => {
    const view = mount(context)
    expect(view.fetcher).not.toHaveBeenCalled()
    await opened(view)
    await fireEvent.update(screen.getByLabelText('linkNote.text'), ' new\r\n😀 ')
    expect(view.state.canSave.value).toBe(true)
    await view.state.save()
    expect(view.state.data.value).toEqual({ id: target.id, note: 'new\n😀', updatedAt: nextVersion })
    const writes = view.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')
    expect(writes).toHaveLength(1)
    expect(JSON.parse(writes[0]![1]!.body as string)).toEqual({ id: target.id, note: 'new\n😀', expectedUpdatedAt: version })
    expect(view.state.canSave.value).toBe(false)
    view.state.clear()
    expect(view.state.draft.value).toBe('')
    expect(view.state.data.value!.note).toBe('new\n😀')
    expect(view.fetcher.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    await view.state.save()
    expect(view.state.data.value!.note).toBe('')
    await fireEvent.click(screen.getByRole('button', { name: 'linkNote.close' }))
    expect(view.state.target.value).toBeNull()
    expect(view.client.getQueriesData({ queryKey: ['short-link-note'] })).toEqual([])
  })
  it('keeps readonly viewing separate from writing and does not normalize an invalid draft into permission', async () => {
    const view = mount('own', ['short_link:read_own'])
    await opened(view)
    expect(screen.getByText('linkNote.readonly')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'linkNote.save' })).toBeNull()
    view.state.edit('unauthorized edit'); view.state.clear(); await view.state.save()
    expect(view.state.draft.value).toBe('server note')
    expect(view.fetcher).toHaveBeenCalledTimes(1)
  })
  it('displays validation errors and blocks requests for invalid text', async () => {
    const view = mount(); await opened(view)
    await fireEvent.update(screen.getByLabelText('linkNote.text'), '😀'.repeat(1001))
    expect(screen.getByText('linkNote.invalid')).toBeTruthy()
    await view.state.save()
    expect(view.fetcher).toHaveBeenCalledTimes(1)
  })
  it('preserves a dirty draft when its read cache changes; only explicit reload replaces it', async () => {
    const view = mount(); await opened(view)
    view.state.draft.value = 'my draft'
    const key = view.client.getQueryCache().find({ queryKey: ['short-link-note'], exact: false })!.queryKey
    view.client.setQueryData(key, note(target.id, 'background'))
    await view.client.invalidateQueries({ queryKey: key })
    expect(view.state.draft.value).toBe('my draft')
    expect(view.fetcher).toHaveBeenCalledTimes(1)
    await fireEvent.click(screen.getByRole('button', { name: 'linkNote.reload' }))
    await waitFor(() => expect(view.state.draft.value).toBe('server note'))
  })
  it('preserves conflict drafts and keeps saving frozen even when the recovery read fails', async () => {
    const view = mount(); await opened(view)
    view.state.draft.value = 'local work'
    view.fetcher.mockResolvedValueOnce(response(null, 200116))
    await view.state.save()
    expect(view.state.blocked.value).toBe('conflict')
    expect(screen.getByText('linkNote.conflict')).toBeTruthy()
    expect(view.state.draft.value).toBe('local work')
    view.state.clear(); await view.state.save()
    expect(view.state.draft.value).toBe('local work')
    view.fetcher.mockRejectedValueOnce(new TypeError('offline'))
    await view.state.reload()
    expect(view.state.error.value).toBe('loadFailed')
    expect(view.state.canSave.value).toBe(false)
    view.fetcher.mockResolvedValueOnce(response({ ...note(target.id, 'other work'), updatedAt: nextVersion }))
    await view.state.reload()
    expect(view.state.blocked.value).toBe('')
    expect(view.state.draft.value).toBe('other work')
    view.state.draft.value = 'merged work'
    await view.state.save()
    expect(JSON.parse(view.fetcher.mock.calls.at(-1)![1]!.body as string).expectedUpdatedAt).toBe(nextVersion)
  })
  it.each(['transport', 'http500', 'badEnvelope', 'badResult', 'infrastructureCode'] as const)('freezes an unconfirmed %s save without replaying it', async failure => {
    const view = mount(); await opened(view); view.state.draft.value = 'uncertain draft'
    if (failure === 'transport') view.fetcher.mockRejectedValueOnce(new TypeError('network'))
    else view.fetcher.mockResolvedValueOnce(failure === 'http500' ? response(null, 900000, 500)
      : failure === 'badEnvelope' ? new Response('broken') : failure === 'badResult' ? response({ id: target.id }) : response(null, 900000))
    await view.state.save()
    expect(view.state.blocked.value).toBe('unknown')
    expect(view.state.draft.value).toBe('uncertain draft')
    expect(screen.getByText('linkNote.unknown')).toBeTruthy()
    await view.state.save()
    expect(view.fetcher).toHaveBeenCalledTimes(2)
    await view.state.reload()
    expect(view.state.blocked.value).toBe('')
    expect(view.state.draft.value).toBe('server note')
  })
  it('allows an explicit corrected attempt after a known validation failure, without automatic retry', async () => {
    const view = mount(); await opened(view); view.state.draft.value = 'first'
    view.fetcher.mockResolvedValueOnce(response(null, 100001))
    await view.state.save()
    expect(view.state.error.value).toBe('saveFailed')
    expect(view.state.canSave.value).toBe(true)
    view.state.draft.value = 'corrected'; await view.state.save()
    expect(view.state.draft.value).toBe('corrected')
    expect(view.fetcher).toHaveBeenCalledTimes(3)
  })
  it('offers an explicit retry after an initial read error', async () => {
    const view = mount(); view.fetcher.mockRejectedValueOnce(new TypeError('offline'))
    view.state.open(target)
    await waitFor(() => expect(view.state.error.value).toBe('loadFailed'))
    expect(view.state.canSave.value).toBe(false)
    await view.state.reload()
    expect(view.state.data.value).toEqual(note())
  })
  it.each([120001, 200104, 401, 403])('retires private data after denied read %s', async code => {
    const view = mount(); view.fetcher.mockResolvedValueOnce(response(null, code, code < 500 && code >= 400 ? code : 200))
    view.state.open(target)
    await waitFor(() => expect(view.state.target.value).toBeNull())
    expect(view.state.draft.value).toBe('')
    expect(view.state.data.value).toBeNull()
  })
  it.each([120001, 200104, 401, 403])('retires private data after denied save %s', async code => {
    const view = mount(); await opened(view); view.state.draft.value = 'secret'
    view.fetcher.mockResolvedValueOnce(response(null, code, code < 500 && code >= 400 ? code : 200))
    await view.state.save()
    expect(view.state.target.value).toBeNull()
    expect(view.state.draft.value).toBe('')
    expect(view.state.saving.value).toBe(false)
  })
  it('invalidates the administrative list after its resource disappears without touching the personal list', async () => {
    const view = mount('admin')
    view.client.setQueryData(['admin-short-link', 'list'], { items: [target] })
    view.client.setQueryData(['short-link', 'list'], { items: [target] })
    view.fetcher.mockResolvedValueOnce(response(null, 200104))
    view.state.open(target)
    await waitFor(() => expect(view.state.target.value).toBeNull())
    expect(view.client.getQueryState(['admin-short-link', 'list'])?.isInvalidated).toBe(true)
    expect(view.client.getQueryState(['short-link', 'list'])?.isInvalidated).toBe(false)
  })
  it('drops a successful read when a synchronous cache listener changes account before the UI applies it', async () => {
    const view = mount()
    const stop = view.client.getQueryCache().subscribe(event => {
      if (event.type === 'updated' && event.action.type === 'success' && event.query.queryKey[0] === 'short-link-note') {
        stop()
        view.client.setQueryData(['auth', 'me'], { user: user(grants, otherId) })
      }
    })
    view.state.open(target)
    await waitFor(() => expect(view.state.target.value).toBeNull())
    await nextTick(); await Promise.resolve()
    expect(view.state.data.value).toBeNull()
    expect(view.state.draft.value).toBe('')
    expect(view.state.error.value).toBe('')
    expect(view.state.loading.value).toBe(false)
  })
  it('does not close, reopen, clear, reload or issue a second write while saving', async () => {
    const view = mount(); await opened(view)
    view.state.draft.value = 'work'
    const pending = createDeferred<Response>(); view.fetcher.mockReturnValueOnce(pending.promise)
    const saving = view.state.save()
    view.state.close(); view.state.open(another); view.state.edit('late edit'); view.state.clear(); await view.state.reload(); await view.state.save()
    expect(view.state.target.value).toEqual(target)
    expect(view.state.draft.value).toBe('work')
    expect(view.fetcher).toHaveBeenCalledTimes(2)
    pending.resolve(response({ ...note(target.id, 'work'), updatedAt: nextVersion })); await saving
    expect(view.state.saving.value).toBe(false)
  })
  it('rejects invalid openings without reading and suppresses duplicate loads', async () => {
    const view = mount()
    view.state.open({ ...target, id: 'bad' })
    expect(view.fetcher).not.toHaveBeenCalled()
    view.client.setQueryData(['auth', 'me'], { user: user([], actorId) })
    view.state.open(target); expect(view.fetcher).not.toHaveBeenCalled()
    view.client.setQueryData(['auth', 'me'], { user: user(grants, 'invalid-actor') })
    view.state.open(target); expect(view.fetcher).not.toHaveBeenCalled()
    view.client.setQueryData(['auth', 'me'], { user: user() })
    const pending = createDeferred<Response>(); view.fetcher.mockReturnValueOnce(pending.promise)
    view.state.open(target); await view.state.reload(); view.state.edit('before loading'); view.state.clear()
    expect(view.fetcher).toHaveBeenCalledTimes(1)
    pending.resolve(response(note()))
    await waitFor(() => expect(view.state.loading.value).toBe(false))
  })
})

describe('late note results belong only to their opening', () => {
  for (const phase of ['load', 'save'] as const) for (const outcome of ['success', 'error'] as const) {
    it.each(['close/reopen', 'A/B/A', 'read revoke/restore', 'write revoke/restore', 'resource', 'unmount'])(`${phase} ${outcome} cannot alter the next context after %s`, async transition => {
      const view = mount()
      if (phase === 'save') { await opened(view); view.state.draft.value = 'old private work' }
      const pending = createDeferred<Response>(); view.fetcher.mockReturnValueOnce(pending.promise)
      let writing: Promise<void> | undefined
      if (phase === 'load') view.state.open(target)
      else writing = view.state.save()
      if (transition === 'A/B/A') {
        view.client.setQueryData(['auth', 'me'], { user: user(grants, otherId) })
        view.client.setQueryData(['auth', 'me'], { user: user() })
      } else if (transition.includes('revoke')) {
        view.client.setQueryData(['auth', 'me'], { user: user(transition.startsWith('read') ? [] : ['short_link:read_own']) })
        view.client.setQueryData(['auth', 'me'], { user: user() })
      } else if (transition === 'unmount') view.unmount()
      else if (phase === 'load' && transition === 'close/reopen') view.state.close()
      else view.state.reset()
      expect(view.state.target.value).toBeNull()
      if (transition !== 'unmount') {
        view.state.open(another)
        await waitFor(() => expect(view.state.data.value?.id).toBe(another.id))
        view.state.draft.value = 'new private draft'
      }
      if (outcome === 'success') pending.resolve(response(note(target.id, 'OLD SECRET')))
      else pending.reject(new TypeError('old failure'))
      await writing; await nextTick(); await Promise.resolve()
      expect(view.state.draft.value).toBe(transition === 'unmount' ? '' : 'new private draft')
      expect(view.state.error.value).toBe('')
      expect(view.state.blocked.value).toBe('')
      expect(view.state.saving.value).toBe(false)
      expect(view.state.loading.value).toBe(false)
      expect(toast.success).not.toHaveBeenCalled()
      expect(toast.error).not.toHaveBeenCalled()
      expect(view.client.getQueriesData({ queryKey: ['short-link-note'] }).some(([, value]) => JSON.stringify(value).includes('OLD SECRET'))).toBe(false)
    })
  }
})
