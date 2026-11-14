import { render, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { defineComponent } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'vue-sonner'
import { createDeferred } from '@/test/deferred'
import { useBulkCreate } from './useBulkCreate'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const actor = { id: '00000000-0000-0000-0000-000000007481', username: 'mode-user', nickname: '', group: 'user', permissions: ['short_link:read_own', 'short_link:create', 'domain:use_default', 'short_link:set_metadata', 'short_link:custom_slug', 'short_link:use_intermediate', 'short_link:use_confirmation'] }
const clients: QueryClient[] = []
function response(data: unknown, code = 0) { return new Response(JSON.stringify({ code, message: '', data, meta: {} })) }
function mount(user = actor) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client); client.setQueryData(['auth', 'me'], { user })
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith('/auth/me')) return response({ user })
    const input = JSON.parse(init!.body as string) as { requestId: string; items?: unknown[]; targetUrls?: string[] }
    return response({ requestId: input.requestId, createdCount: input.items?.length ?? input.targetUrls!.length })
  })
  vi.stubGlobal('fetch', fetcher)
  let state!: ReturnType<typeof useBulkCreate>
  const view = render(defineComponent({ setup() { state = useBulkCreate(); return () => null } }), { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } })
  return { ...view, state, client, fetcher, invalidations: vi.spyOn(client, 'invalidateQueries') }
}
function pendingFile(mode = 'intermediate', customSlug = 'Team74') {
  const text = 'target_url,title,tags,custom_slug,redirect_mode\nhttps://example.com/mode74, raw ,"["" tag ""]",' + customSlug + ',' + mode
  const result = createDeferred<ArrayBuffer>()
  const file = new File([text], 'modes.csv', { type: 'text/csv' })
  const read = vi.fn(() => result.promise)
  Object.defineProperty(file, 'arrayBuffer', { value: read })
  return { file, read, resolve: () => result.resolve(new TextEncoder().encode(text).buffer) }
}
async function imported(state: ReturnType<typeof useBulkCreate>, mode = 'intermediate') {
  state.begin()
  const file = pendingFile(mode), reading = state.importFile(file.file)
  file.resolve(); await reading
  expect(state.importedMode.value).toBe('redirect-modes')
}
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks() })

/** Supplies literal CSV bytes through the same native file boundary as user imports. */
function readyFile(text: string) {
  const file = new File([text], 'draft-transition.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(text).buffer })
  return file
}
const structuredImports = [
  { protocol: 'custom-slugs', csv: 'target_url,title,tags,custom_slug\nhttps://example.com/old741,,[],Old741' },
  { protocol: 'redirect-modes', csv: 'target_url,title,tags,custom_slug,redirect_mode\nhttps://example.com/old741,,[],Old741,intermediate' },
] as const

describe('redirect-mode batch authority and immutable retries', () => {
  // Removing the real-snapshot guard must erase the user's unrelated manual draft again.
  it.each(structuredImports)('preserves manual input after clearing a previewed structured import ($protocol)', async ({ csv }) => {
    const { state, client, fetcher } = mount()
    state.begin(); await state.importFile(readyFile(csv)); state.preview()
    expect(state.snapshot.value).not.toBeNull()
    state.edit(); state.clearImport()
    const targetUrl = 'https://example.com/manual-after-clear741'
    state.draft.value = targetUrl
    client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: actor.permissions.filter(p => p !== 'short_link:custom_slug') } })
    expect(state.opened.value).toBe(true)
    expect(state.draft.value).toBe(targetUrl)
    expect(state.snapshot.value).toBeNull()
    state.preview(); const input = state.snapshot.value!
    expect(input).toEqual({ requestId: expect.any(String), targetUrls: [targetUrl] })
    await state.submit()
    expect(fetcher.mock.calls.map(([url, init]) => ({ url, input: JSON.parse(init!.body as string) }))).toEqual([
      { url: '/api/v1/short-link/batch-create', input },
    ])
    expect(state.opened.value).toBe(false)
  })

  // An old custom-code protocol must not erase a replacement that only needs lower grants.
  it.each(structuredImports.flatMap(old => [
    { ...old, replacement: 'targets', csvNext: 'target_url\nhttps://example.com/replacement741', endpoint: 'batch-create' },
    { ...old, replacement: 'titles', csvNext: 'target_url,title\nhttps://example.com/replacement741,New title', endpoint: 'batch-create-with-titles' },
    { ...old, replacement: 'metadata', csvNext: 'target_url,title,tags\nhttps://example.com/replacement741,New title,[]', endpoint: 'batch-create-with-metadata' },
  ]))('keeps lower-permission replacement imports after dropping an old snapshot ($protocol to $replacement)', async ({ csv, csvNext, replacement, endpoint }) => {
    const { state, client, fetcher } = mount()
    state.begin(); await state.importFile(readyFile(csv)); state.preview(); state.edit()
    await state.importFile(readyFile(csvNext))
    client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: actor.permissions.filter(p => p !== 'short_link:custom_slug') } })
    expect(state.opened.value).toBe(true)
    state.preview(); const input = state.snapshot.value!
    expect(input).not.toBeNull()
    if (replacement === 'targets') expect(input).toEqual({ requestId: expect.any(String), targetUrls: ['https://example.com/replacement741'] })
    else expect(input).toEqual({ requestId: expect.any(String), items: [{ targetUrl: 'https://example.com/replacement741', title: 'New title', ...(replacement === 'metadata' ? { tags: [] } : {}) }] })
    await state.submit()
    expect(fetcher.mock.calls.map(([url, init]) => ({ url, input: JSON.parse(init!.body as string) }))).toEqual([
      { url: '/api/v1/short-link/' + endpoint, input },
    ])
    expect(state.opened.value).toBe(false)
  })

  // A broad removal of revocation cleanup would leave these actual privileged drafts alive.
  it.each(structuredImports.flatMap(old => ['imported', 'preview', 'unknown'].map(stage => ({ ...old, stage }))))('still retires an active $protocol $stage when its custom-code grant is lost', async ({ csv, stage }) => {
    const { state, client, fetcher } = mount()
    state.begin(); await state.importFile(readyFile(csv))
    if (stage !== 'imported') state.preview()
    if (stage === 'unknown') { fetcher.mockRejectedValueOnce(new Error('lost acknowledgement')); await state.submit(); expect(state.unknown.value).toBe(true) }
    const attempts = fetcher.mock.calls.length
    client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: actor.permissions.filter(p => p !== 'short_link:custom_slug') } })
    expect(state.opened.value).toBe(false)
    expect(state.importedItems.value).toBeNull()
    expect(state.snapshot.value).toBeNull()
    await state.submit()
    expect(fetcher.mock.calls).toHaveLength(attempts)
  })

  it('retries the same deep-frozen raw fifth-protocol snapshot and account after unknown outcomes', async () => {
    const { state, fetcher } = mount()
    await imported(state); state.preview()
    const captured = state.snapshot.value!
    expect(captured).toMatchObject({ items: [{ targetUrl: 'https://example.com/mode74', title: ' raw ', tags: [' tag '], customSlug: 'Team74', redirectMode: 'intermediate' }] })
    expect(Object.isFrozen(captured)).toBe(true)
    if (!('items' in captured)) throw new Error('Expected structured batch')
    expect(Object.isFrozen(captured.items)).toBe(true); expect(Object.isFrozen(captured.items[0])).toBe(true)
    expect(Object.isFrozen((captured.items[0] as { tags: readonly string[] }).tags)).toBe(true)
    fetcher.mockRejectedValueOnce(new Error('lost acknowledgement'))
    await state.submit()
    expect(state.unknown.value).toBe(true)
    const blocked = pendingFile('confirmation'); await state.importFile(blocked.file)
    expect(blocked.read).not.toHaveBeenCalled()
    fetcher.mockResolvedValueOnce(response(null, 200121)); await state.submit()
    expect(state.unknown.value).toBe(true); expect(state.snapshot.value).toBe(captured)
    await state.submit()
    expect(fetcher.mock.calls).toHaveLength(3)
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toBe('/api/v1/short-link/batch-create-with-redirect-modes')
      expect(init!.body).toBe(JSON.stringify(captured))
      expect(init!.headers).toMatchObject({ 'X-MoeURL-Expected-User-ID': actor.id })
    }
    expect(state.opened.value).toBe(false)
  })

  it.each(['short_link:set_metadata', 'short_link:custom_slug'])('requires %s even for direct-only rows with an empty requested code', async removed => {
    const user = { ...actor, permissions: actor.permissions.filter(p => p !== removed) }
    const { state, fetcher } = mount(user)
    state.begin(); state.draft.value = 'https://example.com/manual'
    const file = pendingFile('direct', ''), reading = state.importFile(file.file)
    file.resolve(); await reading
    expect(state.errorKey.value).toBe(removed === 'short_link:set_metadata' ? 'bulkCreate.metadataRequired' : 'bulkCreate.customSlugRequired')
    expect(state.draft.value).toBe('https://example.com/manual')
    expect(state.importedItems.value).toBeNull(); expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(['intermediate', 'confirmation'] as const)('rejects a currently unavailable %s mode while preserving the manual draft', async mode => {
    const { state, fetcher } = mount({ ...actor, permissions: actor.permissions.filter(p => p !== 'short_link:use_' + mode) })
    state.begin(); state.draft.value = 'https://example.com/manual'
    const file = pendingFile(mode), reading = state.importFile(file.file)
    file.resolve(); await reading
    expect(state.errorKey.value).toBe('bulkCreate.redirectModeRequired')
    expect(state.importedItems.value).toBeNull(); expect(state.draft.value).toBe('https://example.com/manual')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(['intermediate', 'confirmation'] as const)('rejects a delayed %s file across mode revocation and restoration without erasing manual text', async mode => {
    const { state, client } = mount()
    state.begin(); state.draft.value = 'https://example.com/manual'
    const file = pendingFile(mode), reading = state.importFile(file.file)
    client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: actor.permissions.filter(p => p !== 'short_link:use_' + mode) } })
    client.setQueryData(['auth', 'me'], { user: actor })
    file.resolve(); await reading
    expect(state.importedItems.value).toBeNull(); expect(state.draft.value).toBe('https://example.com/manual')
    expect(state.errorKey.value).toBe('bulkCreate.redirectModeRequired'); expect(state.reading.value).toBe(false)
    const fresh = pendingFile(mode), next = state.importFile(fresh.file); fresh.resolve(); await next
    expect(state.importedMode.value).toBe('redirect-modes'); expect(state.errorKey.value).toBe('')
  })

  it.each(['', 'direct'])('keeps an unused-mode file read, draft and unknown retry after unrelated grant loss for %j', async mode => {
    const { state, client, fetcher } = mount()
    state.begin()
    const file = pendingFile(mode), reading = state.importFile(file.file)
    const base = { ...actor, permissions: actor.permissions.filter(p => !p.startsWith('short_link:use_')) }
    client.setQueryData(['auth', 'me'], { user: base })
    file.resolve(); await reading
    expect(state.importedMode.value).toBe('redirect-modes')
    state.preview(); const snapshot = state.snapshot.value!
    fetcher.mockRejectedValueOnce(new Error('unknown')); await state.submit()
    expect(state.unknown.value).toBe(true)
    client.setQueryData(['auth', 'me'], { user: actor })
    client.setQueryData(['auth', 'me'], { user: base })
    expect(state.snapshot.value).toBe(snapshot); expect(state.opened.value).toBe(true)
    await state.submit(); expect(state.opened.value).toBe(false)
    expect(fetcher.mock.calls.every(([url]) => String(url).endsWith('/batch-create-with-redirect-modes'))).toBe(true)
  })

  it.each((['intermediate', 'confirmation'] as const).flatMap(mode => ['draft', 'preview', 'unknown', 'queued', 'pending success', 'pending error', 'pending unknown'].map(stage => ({ mode, stage }))))('retires $mode $stage and prevents all late outcomes from touching a new batch', async ({ mode, stage }) => {
    const { state, client, fetcher } = mount()
    await imported(state, mode)
    if (stage !== 'draft') state.preview()
    const old = state.snapshot.value
    if (stage === 'unknown') { fetcher.mockRejectedValueOnce(new Error('lost')); await state.submit() }
    const outcome = createDeferred<Response>()
    let request: Promise<void> | undefined
    if (stage.startsWith('pending')) {
      fetcher.mockImplementationOnce(() => outcome.promise)
      request = state.submit(); await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    } else if (stage === 'queued') request = state.submit()
    client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: actor.permissions.filter(p => p !== 'short_link:use_' + mode) } })
    expect(state.opened.value).toBe(false); expect(state.importedItems.value).toBeNull(); expect(state.snapshot.value).toBeNull()
    client.setQueryData(['auth', 'me'], { user: actor })
    state.begin(); state.draft.value = 'https://example.com/new'; state.preview()
    const fresh = state.snapshot.value
    if (stage === 'pending unknown') outcome.reject(new Error('late unknown'))
    else outcome.resolve(response(stage === 'pending error' ? null : { requestId: old?.requestId, createdCount: 1 }, stage === 'pending error' ? 120001 : 0))
    if (request) await request
    expect(state.opened.value).toBe(true); expect(state.snapshot.value).toBe(fresh)
    expect(state.draft.value).toBe('https://example.com/new'); expect(state.errorKey.value).toBe('')
    expect(state.pending.value).toBe(false); expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled()
    if (stage === 'queued') expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(['success', 'error', 'unknown'])('keeps a new account pending while a retired fifth-protocol %s arrives', async outcome => {
    const { state, client, fetcher, invalidations } = mount()
    await imported(state); state.preview()
    const oldInput = state.snapshot.value!, oldResponse = createDeferred<Response>()
    fetcher.mockReturnValueOnce(oldResponse.promise)
    const oldRequest = state.submit()
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    const nextActor = { ...actor, id: '00000000-0000-0000-0000-000000007483' }
    client.setQueryData(['auth', 'me'], { user: nextActor })
    expect(state.opened.value).toBe(false); expect(state.snapshot.value).toBeNull()
    await imported(state, 'confirmation'); state.preview()
    const nextInput = state.snapshot.value!, nextResponse = createDeferred<Response>()
    fetcher.mockReturnValueOnce(nextResponse.promise)
    const nextRequest = state.submit()
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    if (outcome === 'unknown') oldResponse.reject(new Error('retired network outcome'))
    else oldResponse.resolve(response(outcome === 'error' ? null : { requestId: oldInput.requestId, createdCount: 1 }, outcome === 'error' ? 120001 : 0))
    await oldRequest
    expect(state.pending.value).toBe(true); expect(state.snapshot.value).toBe(nextInput)
    expect(state.errorKey.value).toBe(''); expect(state.unknown.value).toBe(false)
    expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled(); expect(invalidations).not.toHaveBeenCalled()
    expect(fetcher.mock.calls[1]![1]!.headers).toMatchObject({ 'X-MoeURL-Expected-User-ID': nextActor.id })
    nextResponse.resolve(response({ requestId: nextInput.requestId, createdCount: 1 })); await nextRequest
    expect(state.opened.value).toBe(false); expect(toast.success).toHaveBeenCalledTimes(1)
  })

  it.each(['other account', 'guest and restore'])('rejects an old mode file after %s without unlocking the newer read', async transition => {
    const { state, client, fetcher } = mount()
    state.begin()
    const old = pendingFile(), oldRead = state.importFile(old.file)
    if (transition === 'other account') client.setQueryData(['auth', 'me'], { user: { ...actor, id: '00000000-0000-0000-0000-000000007484' } })
    else { client.setQueryData(['auth', 'me'], { user: { ...actor, group: 'guest' } }); client.setQueryData(['auth', 'me'], { user: actor }) }
    expect(state.opened.value).toBe(false)
    state.begin(); state.draft.value = 'https://example.com/new-account'
    const fresh = pendingFile('confirmation'), freshRead = state.importFile(fresh.file)
    old.resolve(); await oldRead
    expect(state.reading.value).toBe(true); expect(state.importedItems.value).toBeNull()
    expect(state.draft.value).toBe('https://example.com/new-account'); expect(state.errorKey.value).toBe('')
    fresh.resolve(); await freshRead
    expect(state.importedItems.value?.[0]).toMatchObject({ redirectMode: 'confirmation' })
    expect(state.reading.value).toBe(false); expect(fetcher).not.toHaveBeenCalled()
  })

  it('does not send a fifth-protocol write queued under a retired account', async () => {
    const { state, client, fetcher } = mount()
    await imported(state); state.preview()
    const request = state.submit()
    client.setQueryData(['auth', 'me'], { user: { ...actor, id: '00000000-0000-0000-0000-000000007485' } })
    await request
    expect(state.opened.value).toBe(false); expect(state.snapshot.value).toBeNull(); expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(['success', 'unknown'])('ignores a fifth-protocol %s and finally after unmount', async outcome => {
    const { state, fetcher, unmount, invalidations } = mount()
    await imported(state); state.preview()
    const input = state.snapshot.value!, result = createDeferred<Response>()
    fetcher.mockReturnValueOnce(result.promise)
    const request = state.submit(); await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1)); unmount()
    if (outcome === 'unknown') result.reject(new Error('retired request'))
    else result.resolve(response({ requestId: input.requestId, createdCount: 1 }))
    await request
    expect(state.pending.value).toBe(true); expect(invalidations).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled()
  })

  it.each(['preview', 'queued write'])('checks silent same-cache mode loss again at %s', async stage => {
    const { state, client, fetcher } = mount()
    await imported(state)
    if (stage === 'queued write') state.preview()
    client.getQueryData<{ user: typeof actor }>(['auth', 'me'])!.user = { ...actor, permissions: actor.permissions.filter(p => p !== 'short_link:use_intermediate') }
    if (stage === 'preview') state.preview()
    else await state.submit()
    expect(state.opened.value).toBe(false); expect(state.snapshot.value).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })
})
