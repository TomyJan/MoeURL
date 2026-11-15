import { cleanup, render, waitFor } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { defineComponent } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'vue-sonner'
import { createDeferred } from '@/test/deferred'
import { useBulkCreate } from './useBulkCreate'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const actor = { id: '00000000-0000-0000-0000-000000007781', username: 'cap-user', nickname: '', group: 'user', permissions: ['short_link:create', 'domain:use_default', 'short_link:set_metadata', 'short_link:custom_slug', 'short_link:use_intermediate', 'short_link:use_confirmation', 'short_link:set_expiration', 'short_link:set_max_visits'] }
const clients: QueryClient[] = []
const without = (permission: string) => ({ ...actor, permissions: actor.permissions.filter(p => p !== permission) })
const response = (data: unknown, code = 0) => new Response(JSON.stringify({ code, message: '', data, meta: {} }))
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
function pendingFile(cap = '1', mode = 'intermediate', expiry = '', delay = mode === 'intermediate' ? '3' : '') {
  const text = 'target_url,title,tags,custom_slug,redirect_mode,expires_at,max_visits,intermediate_delay_seconds\nhttps://example.com/delay77, raw ,"["" tag ""]",Team77,' + mode + ',' + expiry + ',' + cap + ',' + delay
  const result = createDeferred<ArrayBuffer>(), file = new File([text], 'countdowns.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: () => result.promise })
  return { file, resolve: () => result.resolve(new TextEncoder().encode(text).buffer) }
}
async function imported(state: ReturnType<typeof useBulkCreate>, cap = '1', mode = 'intermediate', expiry = '') {
  state.begin(); const file = pendingFile(cap, mode, expiry), reading = state.importFile(file.file)
  file.resolve(); await reading; expect(state.importedMode.value).toBe('countdowns')
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks() })

describe('countdown batch current authority', () => {
  it('sends an immutable eighth-protocol payload with the expected current account', async () => {
    const { state, fetcher } = mount(); await imported(state); state.preview(); const input = state.snapshot.value!
    expect(input).toMatchObject({ items: [{ maxVisits: '1', title: ' raw ', tags: [' tag '], customSlug: 'Team77', redirectMode: 'intermediate', expiresAt: '', intermediateDelaySeconds: '3' }] })
    expect(Object.isFrozen(input)).toBe(true)
    if (!('items' in input)) throw new Error('Expected structured batch')
    expect(Object.isFrozen(input.items)).toBe(true); expect(Object.isFrozen(input.items[0])).toBe(true)
    expect(Object.isFrozen((input.items[0] as { tags: readonly string[] }).tags)).toBe(true)
    await state.submit()
    expect(fetcher.mock.calls).toEqual([['/api/v1/short-link/batch-create-with-countdowns', expect.objectContaining({ body: JSON.stringify(input), headers: expect.objectContaining({ 'X-MoeURL-Expected-User-ID': actor.id }) })]])
    expect(state.opened.value).toBe(false)
  })
  it('rejects a capped file without replacing a manual draft when cap permission is absent', async () => {
    const { state, fetcher } = mount(without('short_link:set_max_visits')); state.begin(); state.draft.value = 'https://example.com/kept'
    const file = pendingFile(), reading = state.importFile(file.file); file.resolve(); await reading
    expect(state.importedItems.value).toBeNull(); expect(state.draft.value).toBe('https://example.com/kept')
    expect(state.errorKey.value).toBe('bulkCreate.visitLimitRequired'); expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(['short_link:set_metadata', 'short_link:custom_slug', 'short_link:set_expiration', 'short_link:set_max_visits', 'short_link:use_intermediate', 'short_link:use_confirmation'].flatMap(permission => ['preview', 'queued write'].map(stage => [permission, stage] as const)))('checks silent same-cache %s revocation again at %s', async (permission, stage) => {
    const { state, client, fetcher } = mount(); await imported(state, '1', permission.endsWith('confirmation') ? 'confirmation' : 'intermediate', '2099-01-01T00:00:00Z')
    if (stage === 'queued write') state.preview()
    client.getQueryData<{ user: typeof actor }>(['auth', 'me'])!.user = without(permission)
    if (stage === 'preview') state.preview(); else await state.submit()
    expect(state.opened.value).toBe(false); expect(state.snapshot.value).toBeNull(); expect(fetcher).not.toHaveBeenCalled()
  })

  it('retires a queued eight-column batch when metadata permission silently disappears', async () => {
    const { state, client, fetcher } = mount(); await imported(state); state.preview()
    client.getQueryData<{ user: typeof actor }>(['auth', 'me'])!.user = without('short_link:set_metadata')
    await state.submit()
    expect(fetcher).not.toHaveBeenCalled(); expect(state.opened.value).toBe(false); expect(state.snapshot.value).toBeNull()
    expect(state.errorKey.value).toBe(''); expect(state.unknown.value).toBe(false)
  })

  it('rejects a capped delayed file across revoke and restore, preserving manual input until a fresh read', async () => {
    const { state, client } = mount(); state.begin(); state.draft.value = 'https://example.com/manual'
    const old = pendingFile(), reading = state.importFile(old.file)
    client.setQueryData(['auth', 'me'], { user: without('short_link:set_max_visits') }); client.setQueryData(['auth', 'me'], { user: actor })
    old.resolve(); await reading
    expect(state.importedItems.value).toBeNull(); expect(state.draft.value).toBe('https://example.com/manual')
    expect(state.errorKey.value).toBe('bulkCreate.visitLimitRequired'); expect(state.reading.value).toBe(false)
    const fresh = pendingFile(), next = state.importFile(fresh.file); fresh.resolve(); await next
    expect(state.importedMode.value).toBe('countdowns'); expect(state.errorKey.value).toBe('')
  })

  it.each(['', 'direct'])('keeps an unlimited file, preview and unknown retry without unused grants (%j)', async mode => {
    const { state, client, fetcher } = mount(); state.begin()
    const file = pendingFile('', mode), reading = state.importFile(file.file)
    const user = { ...actor, permissions: actor.permissions.filter(p => p !== 'short_link:set_max_visits' && p !== 'short_link:set_expiration' && !p.startsWith('short_link:use_')) }
    client.setQueryData(['auth', 'me'], { user }); file.resolve(); await reading
    expect(state.importedMode.value).toBe('countdowns'); state.preview(); const input = state.snapshot.value
    fetcher.mockRejectedValueOnce(new Error('unknown')); await state.submit()
    client.setQueryData(['auth', 'me'], { user: actor }); client.setQueryData(['auth', 'me'], { user })
    expect(state.snapshot.value).toBe(input); expect(state.opened.value).toBe(true); expect(state.unknown.value).toBe(true)
    await state.submit(); expect(fetcher.mock.calls).toHaveLength(2)
    for (const [url, init] of fetcher.mock.calls) { expect(url).toBe('/api/v1/short-link/batch-create-with-countdowns'); expect(init!.body).toBe(JSON.stringify(input)) }
  })

  it.each(['short_link:set_metadata', 'short_link:custom_slug', 'short_link:set_expiration', 'short_link:use_intermediate', 'short_link:use_confirmation'])('requires the actually used %s while preserving manual input', async permission => {
    const { state, fetcher } = mount(without(permission)); state.begin(); state.draft.value = 'https://example.com/manual'
    const file = pendingFile('1', permission.endsWith('confirmation') ? 'confirmation' : 'intermediate', '2030-01-01T00:00:00Z'), reading = state.importFile(file.file)
    file.resolve(); await reading
    expect(state.importedItems.value).toBeNull(); expect(state.draft.value).toBe('https://example.com/manual'); expect(fetcher).not.toHaveBeenCalled()
    expect(state.errorKey.value).toBe(permission.endsWith('metadata') ? 'bulkCreate.metadataRequired' : permission.endsWith('custom_slug') ? 'bulkCreate.customSlugRequired' : permission.endsWith('expiration') ? 'bulkCreate.expirationRequired' : permission.endsWith('max_visits') ? 'bulkCreate.visitLimitRequired' : 'bulkCreate.redirectModeRequired')
  })

  it.each(['short_link:set_metadata', 'short_link:custom_slug', 'short_link:set_expiration', 'short_link:use_intermediate', 'short_link:use_confirmation', 'short_link:set_max_visits'])('rejects an eight-column read crossing a %s revoke/restore epoch', async permission => {
    const { state, client } = mount(); state.begin(); state.draft.value = 'https://example.com/manual'
    const file = pendingFile('1', permission.endsWith('confirmation') ? 'confirmation' : 'intermediate', '2030-01-01T00:00:00Z'), reading = state.importFile(file.file)
    client.setQueryData(['auth', 'me'], { user: without(permission) }); client.setQueryData(['auth', 'me'], { user: actor })
    file.resolve(); await reading
    expect(state.importedItems.value).toBeNull(); expect(state.draft.value).toBe('https://example.com/manual')
    expect(state.errorKey.value).toBe(permission.endsWith('metadata') ? 'bulkCreate.metadataRequired' : permission.endsWith('custom_slug') ? 'bulkCreate.customSlugRequired' : permission.endsWith('expiration') ? 'bulkCreate.expirationRequired' : permission.endsWith('max_visits') ? 'bulkCreate.visitLimitRequired' : 'bulkCreate.redirectModeRequired')
  })

  it.each(['short_link:create', 'domain:use_default'])('retires the eighth protocol on loss of base grant %s', async permission => {
    const { state, client, fetcher } = mount(); await imported(state); state.preview()
    client.setQueryData(['auth', 'me'], { user: without(permission) })
    expect(state.opened.value).toBe(false); expect(state.snapshot.value).toBeNull(); await state.submit(); expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(['short_link:set_metadata', 'short_link:custom_slug'])('still requires %s for empty limits and direct mode', async permission => {
    const { state } = mount(without(permission)); state.begin()
    const file = pendingFile('', ''), reading = state.importFile(file.file); file.resolve(); await reading
    expect(state.importedItems.value).toBeNull()
    expect(state.errorKey.value).toBe(permission.endsWith('metadata') ? 'bulkCreate.metadataRequired' : 'bulkCreate.customSlugRequired')
  })

  it.each(['imported', 'preview', 'unknown', 'queued', 'pending success', 'pending error', 'pending unknown'])('retires capped %s and ignores late effects after restoration', async stage => {
    const { state, client, fetcher, invalidations } = mount(); await imported(state)
    if (stage !== 'imported') state.preview()
    const old = state.snapshot.value
    if (stage === 'unknown') { fetcher.mockRejectedValueOnce(new Error('lost')); await state.submit() }
    const outcome = createDeferred<Response>(); let request: Promise<void> | undefined
    if (stage.startsWith('pending')) { fetcher.mockReturnValueOnce(outcome.promise); request = state.submit(); await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1)) }
    else if (stage === 'queued') request = state.submit()
    client.setQueryData(['auth', 'me'], { user: without('short_link:set_max_visits') })
    expect(state.opened.value).toBe(false); expect(state.snapshot.value).toBeNull(); expect(state.importedItems.value).toBeNull()
    client.setQueryData(['auth', 'me'], { user: actor }); state.begin(); state.draft.value = 'https://example.com/fresh'; state.preview(); const fresh = state.snapshot.value
    if (stage === 'pending unknown') outcome.reject(new Error('old transport'))
    else outcome.resolve(response(stage === 'pending error' ? null : { requestId: old?.requestId, createdCount: 1 }, stage === 'pending error' ? 120001 : 0))
    if (request) await request
    expect(state.opened.value).toBe(true); expect(state.snapshot.value).toBe(fresh); expect(state.pending.value).toBe(false)
    expect(state.errorKey.value).toBe(''); expect(state.unknown.value).toBe(false)
    expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled(); expect(invalidations).not.toHaveBeenCalled()
    if (stage === 'queued') expect(fetcher).not.toHaveBeenCalled()
  })

  it('preserves manual and unlimited replacements when an old cap grant disappears', async () => {
    const { state, client } = mount(); await imported(state); state.preview(); state.edit(); state.clearImport()
    state.draft.value = 'https://example.com/manual-after-clear'
    client.setQueryData(['auth', 'me'], { user: without('short_link:set_max_visits') })
    expect(state.opened.value).toBe(true); expect(state.draft.value).toBe('https://example.com/manual-after-clear')
    client.setQueryData(['auth', 'me'], { user: actor }); await imported(state); state.preview(); state.edit()
    const replacement = pendingFile(''), reading = state.importFile(replacement.file); replacement.resolve(); await reading
    client.setQueryData(['auth', 'me'], { user: without('short_link:set_max_visits') })
    expect(state.opened.value).toBe(true); state.preview(); expect(state.snapshot.value).toMatchObject({ items: [{ maxVisits: '' }] })
  })

  it.each([200108, 200101, 200102, 200120, 200121, 200122, 200103])('keeps unknown after later definite %s and retries the original frozen request', async code => {
    const { state, fetcher } = mount(); await imported(state); state.preview(); const input = state.snapshot.value
    fetcher.mockRejectedValueOnce(new Error('lost acknowledgement')); await state.submit()
    fetcher.mockResolvedValueOnce(response(null, code)); await state.submit()
    expect(state.unknown.value).toBe(true); expect(state.errorKey.value).toBe('bulkCreate.unknown'); state.edit(); expect(state.snapshot.value).toBe(input)
    await state.submit(); expect(fetcher.mock.calls).toHaveLength(3)
    for (const [url, init] of fetcher.mock.calls) { expect(url).toBe('/api/v1/short-link/batch-create-with-countdowns'); expect(init!.body).toBe(JSON.stringify(input)) }
  })

  it.each([[200108, 'bulkCreate.expirationDenied'], [200101, 'bulkCreate.customSlugTaken'], [200102, 'bulkCreate.customSlugReserved'], [200120, 'bulkCreate.conflict'], [200121, 'targetPolicy.bulkDenied'], [200122, 'dailyCreateQuota.bulkDenied'], [200103, 'bulkCreate.failed']] as const)('allows explicit editing after a first definite %s', async (code, key) => {
    const { state, fetcher } = mount(); await imported(state); state.preview(); const input = state.snapshot.value
    fetcher.mockResolvedValueOnce(response(null, code)); await state.submit()
    expect(state.unknown.value).toBe(false); expect(state.errorKey.value).toBe(key); expect(state.snapshot.value).toBe(input)
    state.edit(); expect(state.snapshot.value).toBeNull(); expect(state.importedItems.value).not.toBeNull()
  })

  it.each(['success', 'error', 'unknown'])('keeps the new account pending when an old capped %s arrives', async outcome => {
    const { state, client, fetcher, invalidations } = mount(); await imported(state); state.preview(); const oldInput = state.snapshot.value!, old = createDeferred<Response>()
    fetcher.mockReturnValueOnce(old.promise); const oldRequest = state.submit(); await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    const nextActor = { ...actor, id: '00000000-0000-0000-0000-000000007782' }; client.setQueryData(['auth', 'me'], { user: nextActor })
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
