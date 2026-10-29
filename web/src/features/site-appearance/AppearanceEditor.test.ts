import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { adminAppearanceKey, publicAppearanceKey } from '@/entities/appearance/api'
import { componentStubs } from '@/test/component-stubs'
import { createDeferred } from '@/test/deferred'
import AppearanceEditor from './AppearanceEditor.vue'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
const initial = { accentPreset: 'ocean', updatedAt: '2026-10-30T01:02:03.123456789+08:00' }
const saved = { accentPreset: 'forest', updatedAt: '2026-10-30T01:02:04.987654321+08:00' }
const response = (data: unknown, code = 0) => new Response(JSON.stringify({ code, message: code ? 'Rejected' : 'OK', data, meta: {} }), { status: 200 })
let client: QueryClient
const reads = vi.fn<() => Promise<Response>>()
const writes = vi.fn<(body: unknown) => Promise<Response>>()
function auth(id = 'admin-a', permissions = ['admin:access', 'system:manage']) {
  client.setQueryData(['auth', 'me'], { user: { id, username: id || 'guest', group: id ? 'admin' : 'guest', permissions } })
}
function mount() {
  return render(AppearanceEditor, { global: { plugins: [[VueQueryPlugin, { queryClient: client }]], stubs: componentStubs } })
}
const select = () => screen.getByRole('combobox', { name: 'appearance.preset' }) as HTMLSelectElement
const save = () => screen.getByRole('button', { name: 'appearance.save' }) as HTMLButtonElement
const reload = () => screen.getByRole('button', { name: 'appearance.reload' }) as HTMLButtonElement
async function ready() { await waitFor(() => { expect(select().value).toBe(initial.accentPreset); expect(save().disabled).toBe(false) }) }

describe('AppearanceEditor independent draft', () => {
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    client.setQueryDefaults(['auth', 'me'], { gcTime: Infinity })
    client.setQueryDefaults(publicAppearanceKey, { gcTime: Infinity })
    reads.mockReset().mockImplementation(async () => response(initial))
    writes.mockReset().mockImplementation(async () => response(saved))
    vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit) => {
      if (url === '/api/v1/admin/system/appearance' && init.method === 'GET') return reads()
      if (url === '/api/v1/admin/system/appearance/update' && init.method === 'POST') return writes(JSON.parse(init.body as string))
      throw new Error('Unexpected transport: ' + url)
    }))
    auth()
    client.setQueryData(publicAppearanceKey, { accentPreset: 'iris' })
  })
  afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals() })
  it('does not apply unsaved accent and commits only the returned public preset with the complete revision', async () => {
    client.setQueryData(['admin', 'system', 'settings'], { original: true })
    client.setQueryData(['user', 'preferences', 'admin-a'], { theme: 'dark', language: 'en' })
    mount(); await ready()
    await fireEvent.update(select(), 'forest')
    expect(client.getQueryData(publicAppearanceKey)).toEqual({ accentPreset: 'iris' })
    expect(writes).not.toHaveBeenCalled()
    await fireEvent.click(save())
    await waitFor(() => expect(screen.getByText('appearance.saved')).toBeTruthy())
    expect(writes).toHaveBeenCalledExactlyOnceWith({ accentPreset: 'forest', expectedUpdatedAt: initial.updatedAt })
    expect(client.getQueryData(publicAppearanceKey)).toEqual({ accentPreset: 'forest' })
    expect(client.getQueryData(['admin', 'system', 'settings'])).toEqual({ original: true })
    expect(client.getQueryData(['user', 'preferences', 'admin-a'])).toEqual({ theme: 'dark', language: 'en' })
    expect(client.getQueriesData({ queryKey: adminAppearanceKey }).some(([, value]) => (value as typeof saved)?.updatedAt === saved.updatedAt)).toBe(true)
  })
  it('keeps draft on stale no-op conflict and requires an explicit reload without replaying writes', async () => {
    writes.mockImplementation(async () => response(null, 900207))
    mount(); await ready(); await fireEvent.click(save())
    await waitFor(() => expect(screen.getByText('appearance.conflict')).toBeTruthy())
    expect(select().value).toBe('ocean')
    await fireEvent.update(select(), 'forest')
    expect(screen.getByText('appearance.conflict')).toBeTruthy()
    expect(reads).toHaveBeenCalledTimes(1); expect(writes).toHaveBeenCalledTimes(1)
    reads.mockImplementation(async () => response(saved))
    await fireEvent.click(reload())
    await waitFor(() => {
      expect(select().value).toBe('forest')
      expect(reload().disabled).toBe(false)
      expect(screen.queryByText('appearance.conflict')).toBeNull()
    })
    writes.mockImplementation(async () => response(saved))
    await fireEvent.click(save())
    await waitFor(() => expect(writes).toHaveBeenLastCalledWith({ accentPreset: 'forest', expectedUpdatedAt: saved.updatedAt }))
  })
  it('clears saved feedback on edit without changing the public value or saved version', async () => {
    mount(); await ready(); await fireEvent.click(save())
    await waitFor(() => expect(screen.getByText('appearance.saved')).toBeTruthy())
    await fireEvent.update(select(), 'iris')
    expect(screen.queryByText('appearance.saved')).toBeNull()
    expect(client.getQueryData(publicAppearanceKey)).toEqual({ accentPreset: 'forest' })
    await fireEvent.click(save())
    await waitFor(() => expect(writes).toHaveBeenLastCalledWith({ accentPreset: 'iris', expectedUpdatedAt: saved.updatedAt }))
  })
  it('keeps newer edits during reload with the prior revision for a later explicit save', async () => {
    mount(); await ready()
    const pending = createDeferred<Response>()
    reads.mockReturnValueOnce(pending.promise)
    await fireEvent.click(reload()); await fireEvent.update(select(), 'iris')
    await fireEvent.submit(save().closest('form')!)
    expect(writes).not.toHaveBeenCalled()
    pending.resolve(response(saved))
    await waitFor(() => expect(reload().disabled).toBe(false))
    expect(select().value).toBe('iris')
    await fireEvent.click(save())
    await waitFor(() => expect(writes).toHaveBeenCalledWith({ accentPreset: 'iris', expectedUpdatedAt: initial.updatedAt }))
  })
  it('keeps load failure retryable and never writes without a confirmed revision', async () => {
    reads.mockRejectedValueOnce(new Error('offline'))
    mount()
    await waitFor(() => expect(screen.getByText('appearance.loadFailed')).toBeTruthy())
    await fireEvent.submit(save().closest('form')!)
    expect(writes).not.toHaveBeenCalled(); expect(save().disabled).toBe(true)
    await fireEvent.click(reload()); await ready()
  })
  it('blocks duplicate writes and reloads, retains a failed draft and permits a deliberate retry', async () => {
    const pending = createDeferred<Response>()
    writes.mockReturnValueOnce(pending.promise)
    mount(); await ready(); await fireEvent.update(select(), 'forest'); await fireEvent.click(save())
    expect(save().disabled).toBe(true); expect(reload().disabled).toBe(true); expect(select().disabled).toBe(true)
    await fireEvent.submit(save().closest('form')!); await fireEvent.click(reload())
    expect(writes).toHaveBeenCalledTimes(1); expect(reads).toHaveBeenCalledTimes(1)
    pending.reject(new Error('offline'))
    await waitFor(() => expect(screen.getByText('appearance.saveFailed')).toBeTruthy())
    expect(select().value).toBe('forest'); expect(save().disabled).toBe(false)
    await fireEvent.click(save()); await waitFor(() => expect(screen.getByText('appearance.saved')).toBeTruthy())
  })
  it('rejects a malformed draft before transport', async () => {
    mount(); await ready(); await fireEvent.update(select(), 'unknown'); await fireEvent.click(save())
    expect(screen.getByText('appearance.invalid')).toBeTruthy(); expect(writes).not.toHaveBeenCalled()
  })
  it('preserves a rejected draft without classifying a permission error as a conflict', async () => {
    writes.mockImplementation(async () => response(null, 120001))
    mount(); await ready(); await fireEvent.update(select(), 'forest'); await fireEvent.click(save())
    await waitFor(() => expect(screen.getByText('appearance.saveFailed')).toBeTruthy())
    expect(screen.queryByText('appearance.conflict')).toBeNull()
    expect(select().value).toBe('forest')
    expect(client.getQueryData(publicAppearanceKey)).toEqual({ accentPreset: 'iris' })
  })
  it('ignores a private read if identity changes inside its successful cache notification', async () => {
    const current = createDeferred<Response>()
    reads.mockImplementationOnce(async () => response(saved)).mockReturnValueOnce(current.promise)
    let switched = false
    const unsubscribe = client.getQueryCache().subscribe(event => {
      if (!switched && event.query.queryKey.slice(0, 3).join('/') === 'admin/system/appearance' && event.query.state.data) {
        switched = true
        auth('admin-b')
      }
    })
    mount()
    await waitFor(() => expect(reads).toHaveBeenCalledTimes(2))
    expect(select().disabled).toBe(true); expect(select().value).toBe('iris')
    expect(client.getQueriesData({ queryKey: adminAppearanceKey }).some(([, value]) => (value as typeof saved)?.updatedAt === saved.updatedAt)).toBe(false)
    current.resolve(response(initial)); await ready(); unsubscribe()
  })
  it.each([{ permissions: [] }, { permissions: ['admin:access'] }, { permissions: ['system:manage'] }])('requires both permissions before showing or loading the editor %#', async ({ permissions }) => {
    auth('admin-a', permissions)
    mount(); await nextTick()
    expect(screen.queryByRole('combobox')).toBeNull(); expect(reads).not.toHaveBeenCalled()
    auth(); await ready()
  })
  it('waits for a confirmed identity', async () => {
    client.removeQueries({ queryKey: ['auth', 'me'] }); mount(); await nextTick()
    expect(screen.queryByRole('combobox')).toBeNull(); expect(reads).not.toHaveBeenCalled()
    auth(); await ready()
  })
  it.each(['resolve', 'reject'] as const)('ignores previous identity load %s and finally while a new identity is loading', async (outcome) => {
    const old = createDeferred<Response>(), current = createDeferred<Response>()
    reads.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    mount(); auth('admin-b'); await nextTick()
    if (outcome === 'resolve') old.resolve(response(saved)); else old.reject(new Error('old load'))
    await old.promise.catch(() => undefined); await nextTick()
    expect(select().disabled).toBe(true); expect(reload().disabled).toBe(true)
    expect(screen.queryByText('appearance.loadFailed')).toBeNull()
    current.resolve(response(initial)); await ready()
    expect(client.getQueriesData({ queryKey: adminAppearanceKey }).some(([, value]) => (value as typeof saved)?.updatedAt === saved.updatedAt)).toBe(false)
  })
  it.each(['resolve', 'reject', 'conflict'] as const)('ignores previous identity save %s and finally after the same account logs in again', async (outcome) => {
    const old = createDeferred<Response>(), current = createDeferred<Response>()
    writes.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    mount(); await ready(); await fireEvent.click(save())
    auth('', []); auth(); await ready()
    await fireEvent.update(select(), 'iris'); await fireEvent.click(save())
    if (outcome === 'resolve') old.resolve(response(saved))
    else if (outcome === 'conflict') old.resolve(response(null, 900207))
    else old.reject(new Error('old save'))
    await old.promise.catch(() => undefined); await nextTick()
    expect(save().disabled).toBe(true); expect(select().value).toBe('iris')
    for (const feedback of ['saved', 'conflict', 'saveFailed']) expect(screen.queryByText('appearance.' + feedback)).toBeNull()
    expect(client.getQueryData(publicAppearanceKey)).toEqual({ accentPreset: 'iris' })
    current.resolve(response(saved))
    await waitFor(() => expect(client.getQueryData(publicAppearanceKey)).toEqual({ accentPreset: 'forest' }))
  })
  it.each(['load', 'save'] as const)('clears private state on permission revocation and rejects old %s after restoration', async (operation) => {
    const old = createDeferred<Response>(), current = createDeferred<Response>()
    if (operation === 'load') reads.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise)
    else writes.mockReturnValueOnce(old.promise)
    mount()
    if (operation === 'save') { await ready(); await fireEvent.click(save()); reads.mockReturnValueOnce(current.promise) }
    auth('admin-a', ['admin:access']); await nextTick(); expect(screen.queryByRole('combobox')).toBeNull()
    auth(); await nextTick(); old.resolve(response(saved)); await old.promise; await nextTick()
    expect(select().disabled).toBe(true)
    expect(client.getQueryData(publicAppearanceKey)).toEqual({ accentPreset: 'iris' })
    current.resolve(response(initial)); await ready()
    expect(screen.queryByText('appearance.saved')).toBeNull()
  })
  it.each(['load', 'save'] as const)('does not publish after unmount with a pending %s', async (operation) => {
    const pending = createDeferred<Response>()
    if (operation === 'load') reads.mockReturnValueOnce(pending.promise); else writes.mockReturnValueOnce(pending.promise)
    const view = mount()
    if (operation === 'save') { await ready(); await fireEvent.click(save()) }
    view.unmount(); pending.resolve(response(saved)); await pending.promise; await nextTick()
    expect(client.getQueryData(publicAppearanceKey)).toEqual({ accentPreset: 'iris' })
    expect(client.getQueriesData({ queryKey: adminAppearanceKey })).toEqual([])
  })
})
