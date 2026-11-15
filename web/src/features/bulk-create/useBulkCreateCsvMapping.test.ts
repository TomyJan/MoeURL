import { cleanup, render } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { defineComponent } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDeferred } from '@/test/deferred'
import { useBulkCreate } from './useBulkCreate'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const actor = { id: '00000000-0000-0000-0000-000000008301', username: 'mapping-user', nickname: '', group: 'user', permissions: ['short_link:create', 'domain:use_default', 'short_link:set_metadata'] }
const clients: QueryClient[] = []
const custom = 'notes,address,name\nsecret,https://example.com/mapped,Mapped title'
const standard = 'target_url,title\nhttps://example.com/standard,Original title'
const response = (data: unknown) => new Response(JSON.stringify({ code: 0, message: '', data, meta: {} }))
function mount(permissions = actor.permissions) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client)
  client.setQueryData(['auth', 'me'], { user: { ...actor, permissions } })
  const requests: { path: string; body: string }[] = []
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith('/auth/me')) return response({ user: { ...actor, permissions } })
    const body = init!.body as string
    const input = JSON.parse(body) as { requestId: string; items?: unknown[]; targetUrls?: string[] }
    requests.push({ path: String(url), body })
    return response({ requestId: input.requestId, createdCount: (input.items ?? input.targetUrls)!.length })
  })
  vi.stubGlobal('fetch', fetcher)
  let state!: ReturnType<typeof useBulkCreate>
  const view = render(defineComponent({ setup() { state = useBulkCreate(); return () => null } }), { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } })
  state.begin()
  return { state, client, requests, fetcher, view }
}
function pendingFile(text: string) {
  const result = createDeferred<ArrayBuffer>(), file = new File([text], 'local.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: () => result.promise })
  return { file, reject: result.reject, resolve: () => result.resolve(new TextEncoder().encode(text).buffer) }
}
async function read(state: ReturnType<typeof useBulkCreate>, text: string, mode: 'standard' | 'mapped' = 'mapped') {
  const file = pendingFile(text), reading = state.importFile(file.file, mode); file.resolve(); await reading
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks() })

describe('explicit mapped CSV staging', () => {
  // A general table refusal has no structural issue; it must still preserve the exact prior draft.
  it('refuses a header-only mapped file without a fabricated issue or any draft replacement', async () => {
    const { state, requests } = mount(); await read(state, standard, 'standard')
    const original = state.importedItems.value
    await read(state, 'Address')
    expect(state.errorKey.value).toBe('bulkCreate.csvMappingFileInvalid')
    expect(state.csvIssue.value).toBeNull(); expect(state.mappingHeaders.value).toBeNull()
    expect(state.importedItems.value).toBe(original); expect(state.importedMode.value).toBe('titles')
    state.preview(); await state.submit()
    expect(requests.map(request => ({ path: request.path, body: JSON.parse(request.body) }))).toEqual([{ path: '/api/v1/short-link/batch-create-with-titles', body: { requestId: expect.any(String), items: [{ targetUrl: 'https://example.com/standard', title: 'Original title' }] } }])
  })

  // Parsing directly into the draft or rejecting arbitrary headers breaks the explicit staging contract.
  it('stages custom columns while preserving a manual draft and blocking premature preview', async () => {
    const { state, requests } = mount(); state.draft.value = 'https://example.com/manual'
    await read(state, custom)
    expect(state.errorKey.value).toBe('')
    expect(state.mappingHeaders?.value).toEqual(['notes', 'address', 'name'])
    expect(state.draft.value).toBe('https://example.com/manual')
    state.preview(); expect(state.snapshot.value).toBeNull(); expect(requests).toEqual([])
  })

  it('stages even a standard-looking file without immediately replacing the manual draft', async () => {
    const { state } = mount(); state.draft.value = 'https://example.com/manual'
    await read(state, standard)
    expect(state.draft.value).toBe('https://example.com/manual')
    expect(state.importedItems.value).toBeNull()
    expect(state.mappingHeaders?.value).toEqual(['target_url', 'title'])
  })

  it('preserves the exact structured draft while a different local mapping is staged', async () => {
    const { state } = mount(); await read(state, standard, 'standard')
    const original = state.importedItems.value
    await read(state, custom)
    expect(state.errorKey.value).toBe('')
    expect(state.importedItems.value).toBe(original)
    expect(state.importedMode.value).toBe('titles')
    expect(state.mappingHeaders?.value).toEqual(['notes', 'address', 'name'])
  })

  it('applies selected titles once and sends the existing exact protocol without ignored cells', async () => {
    const { state, requests } = mount(); await read(state, custom)
    state.mappingTarget.value = 1; state.mappingTitle.value = 2; state.applyMapping()
    expect(state.importedItems.value).toEqual([{ targetUrl: 'https://example.com/mapped', title: 'Mapped title' }])
    expect(state.mappingHeaders.value).toBeNull(); expect(state.mappingTarget.value).toBeNull(); expect(state.mappingTitle.value).toBeNull()
    state.preview(); const frozen = state.snapshot.value
    expect(Object.isFrozen(frozen)).toBe(true); expect(Object.isFrozen(state.importedItems.value)).toBe(true)
    await state.submit()
    expect(requests).toEqual([{ path: '/api/v1/short-link/batch-create-with-titles', body: JSON.stringify(frozen) }])
    expect(requests[0]!.body).not.toMatch(/secret|notes|address|name/)
    expect(state.opened.value).toBe(false)
  })

  it('permits URL-only mapping without metadata but refuses a selected title', async () => {
    const { state, requests } = mount(['short_link:create', 'domain:use_default'])
    state.draft.value = 'https://example.com/manual'; await read(state, custom)
    expect(state.mappingTitleAllowed.value).toBe(false)
    state.mappingTarget.value = 1; state.mappingTitle.value = 2; state.applyMapping()
    expect(state.errorKey.value).toBe('bulkCreate.metadataRequired'); expect(state.draft.value).toBe('https://example.com/manual')
    state.mappingTitle.value = null; state.applyMapping()
    expect(state.importedItems.value).toBeNull(); expect(state.draft.value).toBe('https://example.com/mapped')
    state.preview(); const frozen = state.snapshot.value; await state.submit()
    expect(requests).toEqual([{ path: '/api/v1/short-link/batch-create', body: JSON.stringify(frozen) }])
  })

  it.each(['manual', 'structured'])('cancels mapping without changing the previous %s draft', async mode => {
    const { state, requests } = mount()
    if (mode === 'manual') state.draft.value = 'https://example.com/manual'; else await read(state, standard, 'standard')
    const previous = { draft: state.draft.value, items: state.importedItems.value, mode: state.importedMode.value }
    await read(state, custom); state.applyMapping()
    expect(state.errorKey.value).toBe('bulkCreate.csvMappingInvalid')
    state.mappingTarget.value = 1; state.mappingTitle.value = 1; state.applyMapping()
    expect(state.errorKey.value).toBe('bulkCreate.csvMappingInvalid')
    state.cancelMapping()
    expect(state.draft.value).toBe(previous.draft); expect(state.importedItems.value).toBe(previous.items); expect(state.importedMode.value).toBe(previous.mode)
    expect(state.mappingHeaders.value).toBeNull(); expect(state.errorKey.value).toBe(''); expect(requests).toEqual([])
  })

  // A mapped-targets budget failure must not erase either kind of previously accepted draft.
  it.each(['manual', 'structured'])('keeps the exact %s draft and makes no request when mapped targets exceed the full wire budget', async mode => {
    const { state, requests } = mount()
    if (mode === 'manual') state.draft.value = 'https://example.com/manual'; else await read(state, standard, 'standard')
    const previous = { draft: state.draft.value, items: state.importedItems.value, mode: state.importedMode.value }
    const targets = [...Array.from({ length: 19 }, (_, index) => 'https://example.com/' + '"'.repeat(1604) + index), 'https://example.com/end' + '"'.repeat(2013) + 'a']
    const csv = 'address\n' + targets.map(value => '"' + value.replaceAll('"', '""') + '"').join('\n')
    expect(new TextEncoder().encode(csv).byteLength).toBe(65477)
    expect(new TextEncoder().encode(JSON.stringify({ requestId: '11111111-1111-4111-8111-111111111111', targetUrls: targets })).byteLength).toBe(65537)
    await read(state, csv); state.mappingTarget.value = 0; state.applyMapping()
    expect(state.errorKey.value).toBe('bulkCreate.csvMappingInvalid')
    expect(state.draft.value).toBe(previous.draft); expect(state.importedItems.value).toBe(previous.items); expect(state.importedMode.value).toBe(previous.mode)
    expect(state.mappingHeaders.value).toEqual(['address']); expect(state.snapshot.value).toBeNull(); expect(requests).toEqual([])
    state.cancelMapping(); state.preview(); await state.submit()
    const requestId = expect.any(String)
    expect(requests.map(request => ({ path: request.path, body: JSON.parse(request.body) }))).toEqual(mode === 'manual'
      ? [{ path: '/api/v1/short-link/batch-create', body: { requestId, targetUrls: ['https://example.com/manual'] } }]
      : [{ path: '/api/v1/short-link/batch-create-with-titles', body: { requestId, items: [{ targetUrl: 'https://example.com/standard', title: 'Original title' }] } }])
  })

  it('preserves the draft when chosen cells fail and resets choices for a new file', async () => {
    const { state } = mount(); state.draft.value = 'https://example.com/manual'
    await read(state, custom); state.mappingTarget.value = 0; state.applyMapping()
    expect(state.errorKey.value).toBe('bulkCreate.csvMappingInvalid'); expect(state.draft.value).toBe('https://example.com/manual')
    await read(state, 'new\nhttps://example.com/new')
    expect(state.mappingHeaders.value).toEqual(['new']); expect(state.mappingTarget.value).toBeNull(); expect(state.mappingTitle.value).toBeNull()
    state.mappingTarget.value = 0; state.applyMapping(); expect(state.draft.value).toBe('https://example.com/new')
  })

  it('does not fall back between standard and mapped files or retain stale column choices', async () => {
    const { state } = mount(); state.draft.value = 'https://example.com/manual'
    await read(state, custom); state.mappingTarget.value = 1
    await read(state, custom, 'standard')
    expect(state.mappingHeaders.value).toBeNull(); expect(state.errorKey.value).toBe('bulkCreate.csvInvalid')
    expect(state.draft.value).toBe('https://example.com/manual')
    await read(state, 'a,b\none')
    expect(state.errorKey.value).toBe('bulkCreate.csvMappingFileInvalid'); expect(state.csvIssue.value).toEqual({ kind: 'width', record: 2 })
    await read(state, 'a,b,c,d,e,f,g,h,i\none')
    expect(state.errorKey.value).toBe('bulkCreate.csvMappingFileInvalid'); expect(state.csvIssue.value).toBeNull()
    await read(state, standard, 'standard'); expect(state.importedItems.value).toEqual([{ targetUrl: 'https://example.com/standard', title: 'Original title' }])
  })

  it('does not revive title authority after revocation and restoration during a file read', async () => {
    const { state, client } = mount(); state.draft.value = 'https://example.com/manual'
    const file = pendingFile(custom), first = state.importFile(file.file, 'mapped')
    client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: ['short_link:create', 'domain:use_default'] } })
    client.setQueryData(['auth', 'me'], { user: actor }); file.resolve(); await first
    state.mappingTarget.value = 1; state.mappingTitle.value = 2; state.applyMapping()
    expect(state.mappingTitleAllowed.value).toBe(true); expect(state.errorKey.value).toBe('bulkCreate.metadataRequired')
    expect(state.draft.value).toBe('https://example.com/manual'); expect(state.importedItems.value).toBeNull()
    state.mappingTitle.value = null; state.applyMapping(); expect(state.draft.value).toBe('https://example.com/mapped')
  })

  it('retires a staged title selection immediately when metadata permission is revoked', async () => {
    const { state, client } = mount(); await read(state, custom); state.mappingTarget.value = 1; state.mappingTitle.value = 2
    client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: ['short_link:create', 'domain:use_default'] } })
    expect(state.mappingHeaders.value).toBeNull(); expect(state.opened.value).toBe(false); expect(state.mappingTitleAllowed.value).toBe(false)
    client.setQueryData(['auth', 'me'], { user: actor }); state.begin(); state.applyMapping()
    expect(state.importedItems.value).toBeNull(); expect(state.draft.value).toBe('')
  })

  it.each(['resolve', 'reject'] as const)('prevents an older mapped %s from changing or unlocking a newer pending read', async finish => {
    const { state } = mount(), old = pendingFile(custom), fresh = pendingFile('new\nhttps://example.com/new')
    const first = state.importFile(old.file, 'mapped'), second = state.importFile(fresh.file, 'mapped')
    if (finish === 'resolve') old.resolve(); else old.reject(new Error('private'))
    await first
    expect(state.reading.value).toBe(true); expect(state.mappingHeaders.value).toBeNull(); expect(state.errorKey.value).toBe('')
    fresh.resolve(); await second; expect(state.reading.value).toBe(false); expect(state.mappingHeaders.value).toEqual(['new'])
  })

  it('cancels an unfinished local read and ignores a late completion after draft editing', async () => {
    const { state } = mount(); state.draft.value = 'https://example.com/manual'
    const old = pendingFile(custom), first = state.importFile(old.file, 'mapped')
    state.cancelMapping(); old.resolve(); await first
    expect(state.mappingHeaders.value).toBeNull(); expect(state.draft.value).toBe('https://example.com/manual')
    const next = pendingFile(custom), second = state.importFile(next.file, 'mapped')
    state.draft.value = 'https://example.com/new-manual'; next.resolve(); await second
    expect(state.mappingHeaders.value).toBeNull(); expect(state.draft.value).toBe('https://example.com/new-manual')
    await read(state, custom); state.draft.value = 'https://example.com/explicit-edit'; expect(state.mappingHeaders.value).toBeNull()
  })

  it.each(['close', 'base-permission', 'account', 'unmount'])('retires private staged input on %s', async retirement => {
    const { state, client, view } = mount(); await read(state, custom)
    const old = pendingFile(custom), first = state.importFile(old.file, 'mapped')
    if (retirement === 'close') state.close()
    else if (retirement === 'unmount') view.unmount()
    else client.setQueryData(['auth', 'me'], { user: retirement === 'base-permission' ? { ...actor, permissions: ['domain:use_default'] } : { ...actor, id: '00000000-0000-0000-0000-000000008302', username: 'next-mapping-user' } })
    old.resolve(); await first
    expect(state.mappingHeaders.value).toBeNull(); expect(state.importedItems.value).toBeNull()
    state.applyMapping(); state.cancelMapping(); expect(state.mappingHeaders.value).toBeNull()
  })

  it('refuses file, column and draft changes during an unknown result and retries the exact payload', async () => {
    const { state, fetcher, requests } = mount(); await read(state, custom)
    state.mappingTarget.value = 1; state.mappingTitle.value = 2; state.applyMapping(); state.preview()
    const frozen = state.snapshot.value
    fetcher.mockImplementationOnce(async (url, init) => { requests.push({ path: String(url), body: init!.body as string }); throw new Error('lost response') })
    await state.submit(); expect(state.unknown.value).toBe(true)
    await read(state, 'other\nhttps://example.com/other'); state.applyMapping(); state.cancelMapping(); state.clearImport(); state.edit()
    expect(state.snapshot.value).toBe(frozen); expect(state.mappingHeaders.value).toBeNull()
    await state.submit()
    expect(requests).toEqual([
      { path: '/api/v1/short-link/batch-create-with-titles', body: JSON.stringify(frozen) },
      { path: '/api/v1/short-link/batch-create-with-titles', body: JSON.stringify(frozen) },
    ])
  })
})
