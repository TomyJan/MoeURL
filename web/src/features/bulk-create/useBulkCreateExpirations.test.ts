import { render, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { defineComponent } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'vue-sonner'
import { createDeferred } from '@/test/deferred'
import { useBulkCreate } from './useBulkCreate'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const actor = { id: '00000000-0000-0000-0000-000000007581', username: 'expiration-user', nickname: '', group: 'user', permissions: ['short_link:read_own', 'short_link:create', 'domain:use_default', 'short_link:set_metadata', 'short_link:custom_slug', 'short_link:use_intermediate', 'short_link:use_confirmation', 'short_link:set_expiration'] }
const clients: QueryClient[] = []
const without = (permission: string) => ({ ...actor, permissions: actor.permissions.filter(p => p !== permission) })
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
function pendingFile(expiresAt = '2030-01-01T00:00:00Z', mode = 'intermediate', customSlug = 'Team75') {
  const text = 'target_url,title,tags,custom_slug,redirect_mode,expires_at\nhttps://example.com/expiry75, raw ,"["" tag ""]",' + customSlug + ',' + mode + ',' + expiresAt
  const result = createDeferred<ArrayBuffer>(), file = new File([text], 'expirations.csv', { type: 'text/csv' })
  const read = vi.fn(() => result.promise); Object.defineProperty(file, 'arrayBuffer', { value: read })
  return { file, read, resolve: () => result.resolve(new TextEncoder().encode(text).buffer) }
}
async function imported(state: ReturnType<typeof useBulkCreate>, expiresAt = '2030-01-01T00:00:00Z', mode = 'intermediate') {
  state.begin(); const file = pendingFile(expiresAt, mode), reading = state.importFile(file.file)
  file.resolve(); await reading; expect(state.importedMode.value).toBe('expirations')
}
afterEach(() => { clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks() })

describe('expiration batch current authority and recovery', () => {
  it.each(['preview', 'queued write'])('checks silent same-cache expiration loss again at %s', async stage => {
    const { state, client, fetcher } = mount(); await imported(state)
    if (stage === 'queued write') state.preview()
    client.getQueryData<{ user: typeof actor }>(['auth', 'me'])!.user = without('short_link:set_expiration')
    if (stage === 'preview') state.preview(); else await state.submit()
    expect(state.opened.value).toBe(false); expect(state.snapshot.value).toBeNull(); expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(['intermediate', 'confirmation'])('rejects delayed %s mode files across revoke and restore', async mode => {
    const { state, client } = mount(); state.begin(); state.draft.value = 'https://example.com/kept'
    const file = pendingFile('', mode), reading = state.importFile(file.file)
    client.setQueryData(['auth', 'me'], { user: without('short_link:use_' + mode) }); client.setQueryData(['auth', 'me'], { user: actor })
    file.resolve(); await reading
    expect(state.importedItems.value).toBeNull(); expect(state.draft.value).toBe('https://example.com/kept'); expect(state.errorKey.value).toBe('bulkCreate.redirectModeRequired')
  })
  it.each(['short_link:custom_slug', 'short_link:set_metadata'])('still requires %s with empty codes, direct mode and no deadline', async permission => {
    const { state, fetcher } = mount(without(permission)); state.begin()
    const file = pendingFile('', '', ''), reading = state.importFile(file.file); file.resolve(); await reading
    expect(state.importedItems.value).toBeNull(); expect(fetcher).not.toHaveBeenCalled()
    expect(state.errorKey.value).toBe(permission.endsWith('metadata') ? 'bulkCreate.metadataRequired' : 'bulkCreate.customSlugRequired')
  })
  it('retires an actual six-column snapshot when its custom-code grant is revoked', async () => {
    const { state, client, fetcher } = mount(); await imported(state); state.preview()
    client.setQueryData(['auth', 'me'], { user: without('short_link:custom_slug') })
    expect(state.opened.value).toBe(false); expect(state.snapshot.value).toBeNull(); await state.submit(); expect(fetcher).not.toHaveBeenCalled()
  })
  it('sends a deep-frozen raw sixth-protocol snapshot and expected account without browser future checks', async () => {
    const { state, fetcher } = mount()
    await imported(state, '0001-01-01T00:00:00Z'); state.preview()
    const input = state.snapshot.value!
    expect(input).toMatchObject({ items: [{ expiresAt: '0001-01-01T00:00:00Z', title: ' raw ', tags: [' tag '], customSlug: 'Team75', redirectMode: 'intermediate' }] })
    expect(Object.isFrozen(input)).toBe(true)
    if (!('items' in input)) throw new Error('Expected structured batch')
    expect(Object.isFrozen(input.items)).toBe(true); expect(Object.isFrozen(input.items[0])).toBe(true)
    expect(Object.isFrozen((input.items[0] as { tags: readonly string[] }).tags)).toBe(true)
    await state.submit()
    expect(fetcher.mock.calls).toHaveLength(1)
    expect(fetcher.mock.calls[0]).toEqual(['/api/v1/short-link/batch-create-with-expirations', expect.objectContaining({ body: JSON.stringify(input), headers: expect.objectContaining({ 'X-MoeURL-Expected-User-ID': actor.id }) })])
    expect(state.opened.value).toBe(false)
  })

  it('keeps unknown status after later expiration denial and retries the identical key, payload and endpoint', async () => {
    const { state, fetcher } = mount(); await imported(state); state.preview(); const input = state.snapshot.value
    fetcher.mockRejectedValueOnce(new Error('lost acknowledgement')); await state.submit()
    expect(state.unknown.value).toBe(true)
    fetcher.mockResolvedValueOnce(response(null, 200108)); await state.submit()
    expect(state.unknown.value).toBe(true); expect(state.errorKey.value).toBe('bulkCreate.unknown'); expect(state.snapshot.value).toBe(input)
    await state.submit()
    expect(fetcher.mock.calls).toHaveLength(3)
    for (const [url, init] of fetcher.mock.calls) { expect(url).toBe('/api/v1/short-link/batch-create-with-expirations'); expect(init!.body).toBe(JSON.stringify(input)) }
  })

  it('allows an explicit edit after a first definite expiration denial', async () => {
    const { state, fetcher } = mount(); await imported(state); state.preview(); const input = state.snapshot.value
    fetcher.mockResolvedValueOnce(response(null, 200108)); await state.submit()
    expect(state.unknown.value).toBe(false); expect(state.errorKey.value).toBe('bulkCreate.expirationDenied')
    expect(state.snapshot.value).toBe(input); state.edit(); expect(state.snapshot.value).toBeNull()
    expect(state.importedItems.value).not.toBeNull()
  })

  it('rejects a delayed nonempty-expiry file across revocation and restoration while preserving the manual draft', async () => {
    const { state, client } = mount(); state.begin(); state.draft.value = 'https://example.com/manual'
    const old = pendingFile(), reading = state.importFile(old.file)
    client.setQueryData(['auth', 'me'], { user: without('short_link:set_expiration') }); client.setQueryData(['auth', 'me'], { user: actor })
    old.resolve(); await reading
    expect(state.importedItems.value).toBeNull(); expect(state.draft.value).toBe('https://example.com/manual')
    expect(state.errorKey.value).toBe('bulkCreate.expirationRequired'); expect(state.reading.value).toBe(false)
    const fresh = pendingFile(), next = state.importFile(fresh.file); fresh.resolve(); await next
    expect(state.importedMode.value).toBe('expirations'); expect(state.errorKey.value).toBe('')
  })

  it.each(['', 'direct'])('keeps a blank-expiry file, preview and unknown retry without unused grants (%j)', async mode => {
    const { state, client, fetcher } = mount(); state.begin()
    const file = pendingFile('', mode), reading = state.importFile(file.file)
    const user = { ...actor, permissions: actor.permissions.filter(p => p !== 'short_link:set_expiration' && !p.startsWith('short_link:use_')) }
    client.setQueryData(['auth', 'me'], { user }); file.resolve(); await reading
    expect(state.importedMode.value).toBe('expirations'); state.preview(); const input = state.snapshot.value
    fetcher.mockRejectedValueOnce(new Error('unknown')); await state.submit()
    client.setQueryData(['auth', 'me'], { user: actor }); client.setQueryData(['auth', 'me'], { user })
    expect(state.snapshot.value).toBe(input); expect(state.opened.value).toBe(true)
    await state.submit(); expect(fetcher.mock.calls.every(([url]) => String(url).endsWith('/batch-create-with-expirations'))).toBe(true)
  })

  it.each(['short_link:set_metadata', 'short_link:custom_slug', 'short_link:set_expiration', 'short_link:use_intermediate', 'short_link:use_confirmation'])('requires the actually used %s without replacing a manual draft', async removed => {
    const { state, fetcher } = mount(without(removed)); state.begin(); state.draft.value = 'https://example.com/manual'
    const file = pendingFile('2030-01-01T00:00:00Z', removed === 'short_link:use_confirmation' ? 'confirmation' : 'intermediate'), reading = state.importFile(file.file)
    file.resolve(); await reading
    expect(state.importedItems.value).toBeNull(); expect(state.draft.value).toBe('https://example.com/manual')
    expect(state.errorKey.value).toBe(removed.endsWith('metadata') ? 'bulkCreate.metadataRequired' : removed.endsWith('custom_slug') ? 'bulkCreate.customSlugRequired' : removed.endsWith('expiration') ? 'bulkCreate.expirationRequired' : 'bulkCreate.redirectModeRequired')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(['imported', 'preview', 'unknown', 'queued', 'pending success', 'pending error', 'pending unknown'])('retires a real expiration %s and ignores every late side effect', async stage => {
    const { state, client, fetcher, invalidations } = mount(); await imported(state)
    if (stage !== 'imported') state.preview()
    const old = state.snapshot.value
    if (stage === 'unknown') { fetcher.mockRejectedValueOnce(new Error('lost')); await state.submit() }
    const outcome = createDeferred<Response>(); let request: Promise<void> | undefined
    if (stage.startsWith('pending')) { fetcher.mockReturnValueOnce(outcome.promise); request = state.submit(); await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1)) }
    else if (stage === 'queued') request = state.submit()
    client.setQueryData(['auth', 'me'], { user: without('short_link:set_expiration') })
    expect(state.opened.value).toBe(false); expect(state.snapshot.value).toBeNull(); expect(state.importedItems.value).toBeNull()
    client.setQueryData(['auth', 'me'], { user: actor }); state.begin(); state.draft.value = 'https://example.com/new'; state.preview(); const fresh = state.snapshot.value
    if (stage === 'pending unknown') outcome.reject(new Error('old unknown'))
    else outcome.resolve(response(stage === 'pending error' ? null : { requestId: old?.requestId, createdCount: 1 }, stage === 'pending error' ? 120001 : 0))
    if (request) await request
    expect(state.opened.value).toBe(true); expect(state.snapshot.value).toBe(fresh); expect(state.pending.value).toBe(false)
    expect(state.errorKey.value).toBe(''); expect(state.unknown.value).toBe(false)
    expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled(); expect(invalidations).not.toHaveBeenCalled()
    if (stage === 'queued') expect(fetcher).not.toHaveBeenCalled()
  })

  it('keeps blank-expiration and replacement drafts on unrelated revocation', async () => {
    const { state, client } = mount(); await imported(state); state.preview(); state.edit(); state.clearImport()
    state.draft.value = 'https://example.com/manual-after-clear'
    client.setQueryData(['auth', 'me'], { user: without('short_link:set_expiration') })
    expect(state.opened.value).toBe(true); expect(state.draft.value).toBe('https://example.com/manual-after-clear')
    client.setQueryData(['auth', 'me'], { user: actor }); await imported(state); state.preview(); state.edit()
    const replacement = pendingFile('', 'direct'), reading = state.importFile(replacement.file); replacement.resolve(); await reading
    client.setQueryData(['auth', 'me'], { user: without('short_link:set_expiration') })
    expect(state.opened.value).toBe(true); state.preview()
    expect(state.snapshot.value).toMatchObject({ items: [{ expiresAt: '' }] })
  })

  it.each(['success', 'error', 'unknown'])('keeps the new account pending while an old expiration %s arrives', async outcome => {
    const { state, client, fetcher, invalidations } = mount(); await imported(state); state.preview(); const oldInput = state.snapshot.value!, old = createDeferred<Response>()
    fetcher.mockReturnValueOnce(old.promise); const oldRequest = state.submit(); await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    const nextActor = { ...actor, id: '00000000-0000-0000-0000-000000007582' }; client.setQueryData(['auth', 'me'], { user: nextActor })
    await imported(state); state.preview(); const nextInput = state.snapshot.value!, next = createDeferred<Response>()
    fetcher.mockReturnValueOnce(next.promise); const nextRequest = state.submit(); await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    if (outcome === 'unknown') old.reject(new Error('old transport'))
    else old.resolve(response(outcome === 'error' ? null : { requestId: oldInput.requestId, createdCount: 1 }, outcome === 'error' ? 120001 : 0))
    await oldRequest
    expect(state.pending.value).toBe(true); expect(state.snapshot.value).toBe(nextInput); expect(state.errorKey.value).toBe(''); expect(state.unknown.value).toBe(false)
    expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled(); expect(invalidations).not.toHaveBeenCalled()
    expect(fetcher.mock.calls[1]![1]!.headers).toMatchObject({ 'X-MoeURL-Expected-User-ID': nextActor.id })
    next.resolve(response({ requestId: nextInput.requestId, createdCount: 1 })); await nextRequest
    expect(state.opened.value).toBe(false); expect(toast.success).toHaveBeenCalledTimes(1)
  })
})
