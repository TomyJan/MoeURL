import { render, waitFor } from '@testing-library/vue'
import { onlineManager, QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { defineComponent, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'vue-sonner'
import { createDeferred } from '@/test/deferred'
import { useBulkCreate } from './useBulkCreate'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const actor = { id: '00000000-0000-0000-0000-000000003881', username: 'bulk-ui', nickname: '', group: 'user', permissions: ['short_link:read_own', 'short_link:create', 'domain:use_default'] }
const clients: QueryClient[] = []
/** Produces one new wire body for each actual response. */
function response(data: unknown, code = 0, status = 200) { return new Response(JSON.stringify({ code, message: 'private detail', data, meta: {} }), { status }) }
/** Mounts the real composition lifecycle, auth cache and API boundary. */
function mount(user: unknown = actor) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client); client.setQueryData(['auth', 'me'], { user })
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith('/auth/me')) return response({ user: actor })
    const body = JSON.parse(init!.body as string) as { requestId: string; targetUrls: string[] }
    return response({ requestId: body.requestId, createdCount: body.targetUrls.length })
  })
  vi.stubGlobal('fetch', fetcher)
  let state!: ReturnType<typeof useBulkCreate>
  const view = render(defineComponent({ setup() { state = useBulkCreate(); return () => null } }), { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } })
  return { ...view, state, client, fetcher, invalidations: vi.spyOn(client, 'invalidateQueries') }
}
/** Captures two real target strings under one new explicit preview. */
function preview(state: ReturnType<typeof useBulkCreate>) {
  state.begin(); state.draft.value = ' https://example.com/one \r\nhttps://example.org/two'; state.preview()
  return state.snapshot.value!
}
/** Holds the browser's external file-read boundary without mocking CSV parsing. */
function pendingFile(text = 'target_url\nhttps://example.com/imported') {
  const bytes = new TextEncoder().encode(text).buffer
  const result = createDeferred<ArrayBuffer>()
  const file = new File([text], 'targets.csv', { type: 'text/csv' })
  const read = vi.fn(() => result.promise)
  Object.defineProperty(file, 'arrayBuffer', { value: read })
  return { file, read, resolve: () => result.resolve(bytes), reject: () => result.reject(new Error('private file detail')), result }
}
afterEach(() => { onlineManager.setOnline(true); clients.splice(0).forEach(client => client.clear()); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks() })

describe('batch lifecycle and retry safety', () => {
  // A fourth-protocol hint must never reclassify an older protocol's refusal.
  it.each([
    ['targets', 200101], ['targets', 200102],
    ['titles', 200101], ['titles', 200102],
    ['metadata', 200101], ['metadata', 200102],
  ] as const)('preserves the old %s refusal %i without a false custom-code diagnosis', async (mode, code) => {
    const { state, fetcher } = mount({ ...actor, permissions: [...actor.permissions, 'short_link:set_metadata', 'short_link:custom_slug'] })
    if (mode === 'targets') preview(state)
    else {
      state.begin()
      const file = pendingFile(mode === 'titles' ? 'target_url,title\nhttps://example.com/legacy,title' : 'target_url,title,tags\nhttps://example.com/legacy,title,[]')
      const reading = state.importFile(file.file); file.resolve(); await reading; state.preview()
    }
    const input = state.snapshot.value
    fetcher.mockResolvedValueOnce(response(null, code))
    await state.submit()
    expect(state.errorKey.value).toBe('bulkCreate.failed')
    expect(state.unknown.value).toBe(false)
    expect(state.snapshot.value).toBe(input)
    expect(state.snapshotMode.value).toBe(mode)
  })
  it.each(['preview', 'queued write'])('checks current custom grants again before %s when a cache consumer skips notifications', async stage => {
    const authorized = { ...actor, permissions: [...actor.permissions, 'short_link:set_metadata', 'short_link:custom_slug'] }
    const { state, client, fetcher, invalidations } = mount(authorized)
    state.begin()
    const file = pendingFile('target_url,title,tags,custom_slug\nhttps://example.com/custom56,,[],Team56')
    const read = state.importFile(file.file); file.resolve(); await read
    if (stage === 'queued write') state.preview()
    const request = stage === 'queued write' ? state.submit() : undefined
    client.getQueryData<{ user: typeof actor }>(['auth', 'me'])!.user.permissions = [...actor.permissions, 'short_link:set_metadata']
    if (stage === 'preview') state.preview()
    await request
    expect(fetcher).not.toHaveBeenCalled()
    expect(invalidations).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled()
    expect(state.pending.value).toBe(false)
    if (stage === 'preview') {
      expect(state.opened.value).toBe(false)
      expect(state.snapshot.value).toBeNull()
      expect(state.importedItems.value).toBeNull()
    }
  })
  // Fourth-protocol retries must never fall through the old title endpoint or mutate the raw slug.
  it('retries the identical deep-frozen custom-slug snapshot through its own endpoint and account', async () => {
    const user = { ...actor, permissions: [...actor.permissions, 'short_link:set_metadata', 'short_link:custom_slug'] }
    const { state, fetcher } = mount(user)
    state.begin()
    const file = pendingFile('target_url,title,tags,custom_slug\nhttps://example.org/custom56, raw ,"["" tag ""]",TeamDocs56')
    const read = state.importFile(file.file); file.resolve(); await read
    expect(state.errorKey.value).toBe('')
    state.preview()
    const captured = state.snapshot.value!
    expect(captured).toMatchObject({ items: [{ targetUrl: 'https://example.org/custom56', title: ' raw ', tags: [' tag '], customSlug: 'TeamDocs56' }] })
    expect(Object.isFrozen(captured)).toBe(true)
    expect(Object.isFrozen(state.importedItems.value![0])).toBe(true)
    expect(Object.isFrozen((state.importedItems.value![0] as { tags: readonly string[] }).tags)).toBe(true)
    fetcher.mockRejectedValueOnce(new Error('acknowledgement lost'))
    await state.submit()
    expect(state.unknown.value).toBe(true)
    state.edit(); state.clearImport(); state.preview()
    expect(state.snapshot.value).toBe(captured)
    fetcher.mockResolvedValueOnce(response({ requestId: captured.requestId, createdCount: 1 }))
    await state.submit()
    expect(fetcher.mock.calls).toHaveLength(2)
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toBe('/api/v1/short-link/batch-create-with-custom-slugs')
      expect(init!.body).toBe(JSON.stringify(captured))
      expect(new Headers(init!.headers).get('X-MoeURL-Expected-User-ID')).toBe(actor.id)
    }
    expect(state.opened.value).toBe(false)
  })

  it('refuses even an all-random four-column import without custom permission and preserves the draft', async () => {
    const { state } = mount({ ...actor, permissions: [...actor.permissions, 'short_link:set_metadata'] })
    state.begin(); state.draft.value = 'https://example.com/manual'
    const file = pendingFile('target_url,title,tags,custom_slug\nhttps://example.org/random,,[],')
    const read = state.importFile(file.file); file.resolve(); await read
    expect(state.errorKey.value).toBe('bulkCreate.customSlugRequired')
    expect(state.draft.value).toBe('https://example.com/manual')
    expect(state.importedItems.value).toBeNull()
  })

  it.each(['draft', 'preview', 'unknown', 'queued', 'pending success', 'pending error'])('retires custom-slug %s immediately on custom grant loss', async stage => {
    const user = { ...actor, permissions: [...actor.permissions, 'short_link:set_metadata', 'short_link:custom_slug'] }
    const { state, client, fetcher } = mount(user)
    state.begin()
    const file = pendingFile('target_url,title,tags,custom_slug\nhttps://example.org/custom56,,[],TeamDocs56')
    const read = state.importFile(file.file); file.resolve(); await read
    if (stage !== 'draft') state.preview()
    const input = state.snapshot.value
    const pending = createDeferred<Response>()
    let operation: Promise<void> | undefined
    if (stage === 'unknown') { fetcher.mockRejectedValueOnce(new Error('lost')); await state.submit() }
    if (stage.startsWith('pending')) { fetcher.mockImplementationOnce(() => pending.promise); operation = state.submit(); await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1)) }
    else if (stage === 'queued') operation = state.submit()
    client.setQueryData(['auth', 'me'], { user: { ...user, permissions: user.permissions.filter(p => p !== 'short_link:custom_slug') } })
    expect(state.opened.value).toBe(false)
    expect(state.snapshot.value).toBeNull()
    expect(state.importedItems.value).toBeNull()
    if (stage === 'pending success') pending.resolve(response({ requestId: input!.requestId, createdCount: 1 }))
    if (stage === 'pending error') pending.reject(new Error('offline'))
    await operation
    expect(state.pending.value).toBe(false)
    expect(toast.success).not.toHaveBeenCalled()
    if (stage === 'queued') expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects a late custom-slug file after grant loss and restoration without losing a newer draft', async () => {
    const user = { ...actor, permissions: [...actor.permissions, 'short_link:set_metadata', 'short_link:custom_slug'] }
    const { state, client } = mount(user); state.begin(); state.draft.value = 'https://example.com/manual'
    const file = pendingFile('target_url,title,tags,custom_slug\nhttps://example.org/custom56,,[],TeamDocs56')
    const read = state.importFile(file.file)
    client.setQueryData(['auth', 'me'], { user: { ...user, permissions: user.permissions.filter(p => p !== 'short_link:custom_slug') } })
    client.setQueryData(['auth', 'me'], { user })
    file.resolve(); await read
    expect(state.errorKey.value).toBe('bulkCreate.customSlugRequired')
    expect(state.draft.value).toBe('https://example.com/manual')
    expect(state.importedItems.value).toBeNull()
    expect(state.reading.value).toBe(false)
  })

  it('keeps raw tag arrays immutable and retries an unknown metadata write through the same protocol and UUID', async () => {
    const { state, fetcher } = mount({ ...actor, permissions: [...actor.permissions, 'short_link:set_metadata'] })
    const items = [{ targetUrl: 'https://example.org/tags', title: ' raw ', tags: ['　工具　', 'a,b'] }]
    const csv = 'target_url,title,tags\nhttps://example.org/tags, raw ,"[""　工具　"",""a,b""]"'
    state.begin()
    const file = pendingFile(csv), read = state.importFile(file.file); file.resolve(); await read
    expect(state.errorKey.value).toBe('')
    expect(state.importedItems.value).toEqual(items)
    state.preview()
    const captured = state.snapshot.value!
    expect(captured).toMatchObject({ items })
    expect(Object.isFrozen(captured)).toBe(true)
    expect(Object.isFrozen(state.importedItems.value)).toBe(true)
    expect(Object.isFrozen(state.importedItems.value![0])).toBe(true)
    expect(Object.isFrozen((state.importedItems.value![0] as typeof items[0]).tags)).toBe(true)
    fetcher.mockRejectedValueOnce(new Error('lost acknowledgement'))
    await state.submit()
    expect(state.unknown.value).toBe(true)
    state.edit(); state.clearImport(); state.preview()
    expect(state.snapshot.value).toBe(captured)
    fetcher.mockImplementationOnce(async () => response({ requestId: captured.requestId, createdCount: 1 }))
    await state.submit()
    expect(fetcher.mock.calls).toHaveLength(2)
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toBe('/api/v1/short-link/batch-create-with-metadata')
      expect(JSON.parse(init!.body as string)).toEqual(captured)
      expect(init!.headers).toMatchObject({ 'X-MoeURL-Expected-User-ID': actor.id })
    }
    expect(state.opened.value).toBe(false)
  })
  it('keeps empty-tag CSV on the metadata protocol and clears it immediately on metadata revocation', async () => {
    const { state, client, fetcher } = mount({ ...actor, permissions: [...actor.permissions, 'short_link:set_metadata'] })
    state.begin()
    const file = pendingFile('target_url,title,tags\nhttps://example.org/tags,,[]')
    const read = state.importFile(file.file); file.resolve(); await read
    expect(state.importedItems.value).toEqual([{ targetUrl: 'https://example.org/tags', title: '', tags: [] }])
    state.preview()
    client.setQueryData(['auth', 'me'], { user: actor })
    expect(state.opened.value).toBe(false)
    expect(state.snapshot.value).toBeNull()
    expect(state.importedItems.value).toBeNull()
    await state.submit(); expect(fetcher).not.toHaveBeenCalled()
  })
  it('rejects a late metadata file after revoke and restore without losing the manual draft', async () => {
    const authorized = { ...actor, permissions: [...actor.permissions, 'short_link:set_metadata'] }
    const { state, client, fetcher } = mount(authorized)
    state.begin(); state.draft.value = 'https://example.org/keep'
    const file = pendingFile('target_url,title,tags\nhttps://example.org/tags,,[]')
    const read = state.importFile(file.file)
    client.setQueryData(['auth', 'me'], { user: actor })
    client.setQueryData(['auth', 'me'], { user: authorized })
    file.resolve(); await read
    expect(state.errorKey.value).toBe('bulkCreate.metadataRequired')
    expect(state.draft.value).toBe('https://example.org/keep')
    expect(state.importedItems.value).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(['manual', 'titles'])('preserves the prior %s draft when an allowed-size CSV would exceed the complete JSON request limit', async mode => {
    const { state, fetcher } = mount({ ...actor, permissions: [...actor.permissions, 'short_link:set_metadata'] })
    state.begin(); state.draft.value = 'https://example.org/keep'
    if (mode === 'titles') {
      const previous = pendingFile('target_url,title\nhttps://example.org/keep,original title')
      const reading = state.importFile(previous.file); previous.resolve(); await reading
    }
    const previousItems = state.importedItems.value, previousDraft = state.draft.value
    const file = pendingFile('target_url,title\nhttps://example.com,' + ' '.repeat(65499))
    const reading = state.importFile(file.file); file.resolve(); await reading
    expect(state.errorKey.value).toBe('bulkCreate.csvInvalid')
    expect(state.importedItems.value).toBe(previousItems)
    expect(state.draft.value).toBe(previousDraft)
    expect(state.reading.value).toBe(false); expect(state.snapshot.value).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
    state.preview()
    expect(state.snapshot.value).toMatchObject(mode === 'titles' ? { items: [{ targetUrl: 'https://example.org/keep', title: 'original title' }] } : { targetUrls: ['https://example.org/keep'] })
  })
  // A metadata-only revocation must not discard a legacy URL-only batch or change its endpoint.
  it('keeps a URL-only preview usable after metadata permission is withdrawn', async () => {
    const { state, client, fetcher } = mount({ ...actor, permissions: [...actor.permissions, 'short_link:set_metadata'] })
    expect(state.previewItems.value).toEqual([])
    const input = preview(state)
    client.setQueryData(['auth', 'me'], { user: actor })
    expect(state.snapshot.value).toBe(input)
    expect(state.previewItems.value).toEqual([{ targetUrl: 'https://example.com/one', title: '' }, { targetUrl: 'https://example.org/two', title: '' }])
    await state.submit()
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/short-link/batch-create')
    expect(state.opened.value).toBe(false)
    expect(state.previewItems.value).toEqual([])
  })
  // Preview must read current grants even if another cache consumer mutates data without an event.
  it('refuses a titled preview when cached grants change without notifying observers', async () => {
    const { state, client, fetcher } = mount({ ...actor, permissions: [...actor.permissions, 'short_link:set_metadata'] })
    state.begin()
    const file = pendingFile('target_url,title\nhttps://example.com/a,title')
    const read = state.importFile(file.file); file.resolve(); await read
    client.getQueryData<{ user: typeof actor }>(['auth', 'me'])!.user.permissions = [...actor.permissions]
    state.preview()
    expect(state.opened.value).toBe(false); expect(state.snapshot.value).toBeNull(); expect(state.importedItems.value).toBeNull()
    await state.submit(); expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(['titles', 'targets'])('blocks late %s import appropriately after metadata revocation and restoration', async mode => {
    const withMetadata = { ...actor, permissions: [...actor.permissions, 'short_link:set_metadata'] }
    const { state, client } = mount(withMetadata); state.begin(); state.draft.value = 'https://example.com/manual'
    const file = pendingFile(mode === 'titles' ? 'target_url,title\nhttps://example.com/imported,title' : undefined)
    const request = state.importFile(file.file)
    client.setQueryData(['auth', 'me'], { user: actor })
    client.setQueryData(['auth', 'me'], { user: withMetadata })
    file.resolve(); await request
    expect(state.importedItems.value).toBeNull()
    expect(state.draft.value).toBe(mode === 'titles' ? 'https://example.com/manual' : 'https://example.com/imported')
    expect(state.errorKey.value).toBe(mode === 'titles' ? 'bulkCreate.metadataRequired' : '')
    expect(state.reading.value).toBe(false)
  })

  it.each(['draft', 'preview', 'queued', 'unknown', 'pending success', 'pending error'])('retires titled %s on same-tick metadata revocation', async stage => {
    const withMetadata = { ...actor, permissions: [...actor.permissions, 'short_link:set_metadata'] }
    const { state, client, fetcher, invalidations } = mount(withMetadata); state.begin()
    const file = pendingFile('target_url,title\nhttps://example.com/a,title')
    const read = state.importFile(file.file); file.resolve(); await read
    expect(Object.isFrozen(state.importedItems.value)).toBe(true)
    expect(Object.isFrozen(state.importedItems.value![0])).toBe(true)
    if (stage !== 'draft') state.preview()
    const pending = createDeferred<Response>()
    let request: Promise<void> | undefined
    if (stage === 'unknown') { fetcher.mockRejectedValueOnce(new Error('lost')); await state.submit() }
    if (stage.startsWith('pending')) {
      fetcher.mockReturnValueOnce(pending.promise); request = state.submit()
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    } else if (stage === 'queued') request = state.submit()
    client.setQueryData(['auth', 'me'], { user: actor })
    client.setQueryData(['auth', 'me'], { user: withMetadata })
    expect(state.opened.value).toBe(false); expect(state.importedItems.value).toBeNull(); expect(state.snapshot.value).toBeNull()
    if (stage === 'pending success') pending.resolve(response({ requestId: '00000000-0000-0000-0000-000000003891', createdCount: 1 }))
    if (stage === 'pending error') pending.reject(new Error('offline'))
    await request
    expect(invalidations).not.toHaveBeenCalled(); expect(toast.success).not.toHaveBeenCalled()
    expect(state.errorKey.value).toBe(''); expect(state.pending.value).toBe(false)
    if (stage === 'queued') expect(fetcher).not.toHaveBeenCalled()
  })

  it('preserves structured drafts across bad files and explicit edit, but clear-all cancels a late replacement', async () => {
    const { state } = mount({ ...actor, permissions: [...actor.permissions, 'short_link:set_metadata'] }); state.begin()
    const initial = pendingFile('target_url,title\nhttps://example.com/a,原始标题')
    const read = state.importFile(initial.file); initial.resolve(); await read
    const original = state.importedItems.value
    const bad = pendingFile('target_url,title\nhttps://example.com/b,' + 'x'.repeat(121))
    const failed = state.importFile(bad.file); bad.resolve(); await failed
    expect(state.importedItems.value).toBe(original)
    state.preview(); expect(state.previewItems.value).toEqual([{ targetUrl: 'https://example.com/a', title: '原始标题' }])
    state.clearImport(); expect(state.importedItems.value).toBe(original)
    state.edit(); expect(state.importedItems.value).toBe(original)
    const late = pendingFile('target_url,title\nhttps://example.com/b,new')
    const replacement = state.importFile(late.file); state.clearImport(); late.resolve(); await replacement
    expect(state.importedItems.value).toBeNull(); expect(state.reading.value).toBe(false); expect(state.draft.value).toBe('')
    state.draft.value = 'https://example.com/manual'; state.preview()
    expect(state.previewItems.value).toEqual([{ targetUrl: 'https://example.com/manual', title: '' }])
  })
  // Dropping CSV titles or routing retries to the legacy endpoint loses the reviewed batch.
  it('imports raw titles and explicitly retries the exact titled payload after a lost acknowledgement', async () => {
    const { state, fetcher } = mount({ ...actor, permissions: [...actor.permissions, 'short_link:set_metadata'] })
    state.begin()
    const file = pendingFile('target_url,title\nhttps://example.com/one,"  中文,标题  "\nhttps://example.org/two,')
    const reading = state.importFile(file.file); file.resolve(); await reading
    expect(state.errorKey.value).toBe('')
    state.preview()
    expect(state.snapshot.value).toMatchObject({ items: [{ targetUrl: 'https://example.com/one', title: '  中文,标题  ' }, { targetUrl: 'https://example.org/two', title: '' }] })
    const input = state.snapshot.value!
    fetcher.mockRejectedValueOnce(new Error('acknowledgement lost'))
    await state.submit()
    expect(state.unknown.value).toBe(true)
    state.edit(); state.draft.value = 'https://example.com/not-the-batch'; state.preview()
    expect(state.snapshot.value).toBe(input)
    fetcher.mockResolvedValueOnce(response({ requestId: input.requestId, createdCount: 2 }))
    await state.submit()
    expect(fetcher.mock.calls).toHaveLength(2)
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toBe('/api/v1/short-link/batch-create-with-titles')
      expect(init!.body).toBe(JSON.stringify(input))
      expect(new Headers(init!.headers).get('X-MoeURL-Expected-User-ID')).toBe(actor.id)
    }
    expect(state.opened.value).toBe(false)
  })

  it('rejects an empty-title two-column import without metadata permission while preserving manual input', async () => {
    const { state } = mount(); state.begin(); state.draft.value = 'https://example.com/manual'
    const file = pendingFile('target_url,title\nhttps://example.com/one,')
    const reading = state.importFile(file.file); file.resolve(); await reading
    expect(state.errorKey.value).toBe('bulkCreate.metadataRequired')
    expect(state.draft.value).toBe('https://example.com/manual')
    expect(state.reading.value).toBe(false)
  })
  // Removing the captured-owner header would write an old tab's CSV under the new Cookie owner.
  it.each(['initial', 'unknown retry'])('rejects a stale CSV %s after a different tab changes the Cookie owner', async kind => {
    const { state, fetcher, client } = mount()
    state.begin()
    const file = pendingFile(), read = state.importFile(file.file)
    file.resolve(); await read; state.preview()
    const input = state.snapshot.value!
    if (kind === 'unknown retry') {
      fetcher.mockRejectedValueOnce(new Error('acknowledgement lost'))
      await state.submit()
      expect(state.unknown.value).toBe(true)
    }
    let writesUnderOtherAccount = 0
    fetcher.mockImplementation(async (url, init) => {
      if (String(url).endsWith('/auth/me')) return response({ user: { ...actor, id: '00000000-0000-0000-0000-000000003882' } })
      // The boundary mirrors the real HTTP ownership precondition, tested against PostgreSQL separately.
      const expected = new Headers(init?.headers).get('X-MoeURL-Expected-User-ID')
      if (expected === actor.id) return response(null, 120001)
      writesUnderOtherAccount++
      return response({ requestId: input.requestId, createdCount: 1 })
    })
    const revalidate = vi.spyOn(client, 'resetQueries')
    await state.submit()
    expect(writesUnderOtherAccount).toBe(0)
    expect(toast.success).not.toHaveBeenCalled()
    expect(toast.error).toHaveBeenCalledWith('bulkCreate.accessChanged')
    expect(state.snapshot.value).toBeNull(); expect(state.draft.value).toBe('')
    expect(revalidate).toHaveBeenCalledWith({ queryKey: ['auth', 'me'], exact: true })
    const batches = fetcher.mock.calls.filter(([url]) => String(url).endsWith('/batch-create'))
    for (const [, init] of batches) {
      expect(init!.body).toBe(JSON.stringify(input))
      expect(new Headers(init!.headers).get('X-MoeURL-Expected-User-ID')).toBe(actor.id)
    }
  })
  // Default online queuing would leave this attempt pending, then send it on reconnect.
  it.each(['initial', 'retry'])('finishes an offline %s attempt without queuing a write for reconnect', async kind => {
    const { state, fetcher } = mount(); const input = preview(state)
    fetcher.mockRejectedValue(new Error('offline transport'))
    if (kind === 'retry') await state.submit()
    const previous = fetcher.mock.calls.length
    onlineManager.setOnline(false)
    const request = state.submit()
    try {
      await waitFor(() => expect(state.pending.value).toBe(false))
      expect(state.unknown.value).toBe(true); expect(state.snapshot.value).toBe(input)
      expect(fetcher).toHaveBeenCalledTimes(previous + 1)
    } finally { onlineManager.setOnline(true); await request }
    await nextTick()
    expect(fetcher).toHaveBeenCalledTimes(previous + 1)
    fetcher.mockResolvedValueOnce(response({ requestId: input.requestId, createdCount: 2 }))
    await state.submit()
    expect(fetcher).toHaveBeenCalledTimes(previous + 2)
    expect(fetcher.mock.calls.at(-1)![1]!.body).toBe(JSON.stringify(input))
    expect(state.opened.value).toBe(false)
  })
  // A check only before mutateAsync misses the microtask before mutationFn sends.
  it.each(['account', 'revoke and restore', 'auth error and restore', 'unmount'])('does not send after same-tick %s retires the attempt', async transition => {
    const { state, client, fetcher, invalidations, unmount } = mount(); preview(state)
    const request = state.submit()
    if (transition === 'unmount') unmount()
    else if (transition === 'account') client.setQueryData(['auth', 'me'], { user: { ...actor, id: '00000000-0000-0000-0000-000000003882' } })
    else {
      if (transition === 'revoke and restore') client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: [] } })
      else client.getQueryCache().find({ queryKey: ['auth', 'me'], exact: true })!.setState({ status: 'error' })
      client.setQueryData(['auth', 'me'], { user: actor })
    }
    await request
    expect(fetcher).not.toHaveBeenCalled(); expect(invalidations).not.toHaveBeenCalled()
    expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled()
  })
  // A fetch without a deadline would never release this real controller's pending state.
  it('recovers a stalled attempt as unknown and retries the unchanged key only on explicit submission', async () => {
    vi.useFakeTimers()
    const { state, fetcher } = mount(); const input = preview(state), stalled = createDeferred<Response>()
    fetcher.mockImplementationOnce((_url, init) => {
      init?.signal?.addEventListener('abort', () => stalled.reject(new DOMException('aborted', 'AbortError')), { once: true })
      return stalled.promise
    })
    const request = state.submit()
    try {
      await vi.advanceTimersByTimeAsync(20_000)
      expect(state.pending.value).toBe(false); expect(state.unknown.value).toBe(true)
      expect(state.errorKey.value).toBe('bulkCreate.unknown'); expect(state.snapshot.value).toBe(input)
    } finally { stalled.resolve(response({ requestId: input.requestId, createdCount: 2 })); await request; vi.useRealTimers() }
    expect(fetcher).toHaveBeenCalledTimes(1)
    await state.submit()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[0]![1]!.body).toBe(fetcher.mock.calls[1]![1]!.body)
    expect(state.opened.value).toBe(false)
  })
  it('keeps immutable previews separate from edits and refreshes only after an acknowledged commit', async () => {
    const { state, fetcher, invalidations } = mount()
    state.preview(); await state.submit(); state.close(); state.discard()
    expect(state.snapshot.value).toBeNull(); expect(fetcher).not.toHaveBeenCalled()
    state.begin(); state.draft.value = 'bad'; state.preview()
    expect(state.errorKey.value).toBe('bulkCreate.invalid')
    state.edit(); expect(state.errorKey.value).toBe('')
    const input = preview(state)
    expect(Object.isFrozen(input)).toBe(true); expect(Object.isFrozen('targetUrls' in input && input.targetUrls)).toBe(true)
    state.draft.value = 'https://example.com/changed'
    expect('targetUrls' in input && input.targetUrls).toEqual(['https://example.com/one', 'https://example.org/two'])
    state.edit(); state.preview()
    expect(state.snapshot.value!.requestId).not.toBe(input.requestId)
    await state.submit()
    expect(state.opened.value).toBe(false); expect(state.pending.value).toBe(false)
    expect(state.draft.value).toBe(''); expect(state.snapshot.value).toBeNull()
    expect(invalidations).toHaveBeenNthCalledWith(1, { queryKey: ['short-link'] })
    expect(invalidations).toHaveBeenNthCalledWith(2, { queryKey: ['short-link-overview'] })
    expect(toast.success).toHaveBeenCalledWith('bulkCreate.success')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it.each(['network', '500', 'bad-response'])('retries %s only by explicit action, retaining the exact payload and key', async kind => {
    const { state, fetcher } = mount(); const input = preview(state)
    fetcher.mockImplementationOnce(async () => {
      if (kind === 'network') throw new Error('lost response')
      return kind === '500' ? response(null, 0, 500) : response({ requestId: input.requestId, createdCount: 99 })
    })
    await state.submit(); await nextTick()
    expect(state.unknown.value).toBe(true); expect(state.errorKey.value).toBe('bulkCreate.unknown')
    expect(fetcher).toHaveBeenCalledTimes(1); expect(state.pending.value).toBe(false)
    state.edit(); state.preview()
    expect(state.snapshot.value).toBe(input)
    await state.submit()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[0]![1]!.body).toBe(fetcher.mock.calls[1]![1]!.body)
    expect(state.opened.value).toBe(false)
  })
  it('keeps an earlier unknown result even when a later attempt is definitely rejected', async () => {
    const { state, fetcher } = mount(); const input = preview(state)
    fetcher.mockRejectedValueOnce(new Error('lost'))
    await state.submit()
    fetcher.mockResolvedValueOnce(response(null, 200114))
    await state.submit()
    expect(state.unknown.value).toBe(true); expect(state.snapshot.value).toBe(input)
    state.close(); expect(state.opened.value).toBe(true); expect(state.closing.value).toBe(true)
    await state.submit(); expect(fetcher).toHaveBeenCalledTimes(2)
    state.cancelClose(); expect(state.closing.value).toBe(false)
    state.close(); state.discard()
    expect(state.opened.value).toBe(false); expect(state.snapshot.value).toBeNull(); expect(state.draft.value).toBe('')
  })
  it.each([200103, 200120])('preserves editable input after a definite initial refusal %i', async code => {
    const { state, fetcher } = mount(); const input = preview(state)
    fetcher.mockResolvedValueOnce(response(null, code))
    await state.submit()
    expect(state.unknown.value).toBe(false); expect(state.snapshot.value).toBe(input)
    expect(state.errorKey.value).toBe(code === 200120 ? 'bulkCreate.conflict' : 'bulkCreate.failed')
    state.edit(); expect(state.snapshot.value).toBeNull(); expect(state.draft.value).toContain('https://example.com/one')
    state.close(); expect(state.opened.value).toBe(false)
  })
  it.each([120001, 401, 403])('retires a server-denied batch %i and revalidates current authority', async code => {
    const { state, fetcher, client } = mount(); preview(state)
    const reset = vi.spyOn(client, 'resetQueries')
    fetcher.mockResolvedValueOnce(response(null, code === 120001 ? code : 0, code === 120001 ? 200 : code))
    await state.submit()
    expect(state.opened.value).toBe(false); expect(state.draft.value).toBe(''); expect(state.snapshot.value).toBeNull()
    expect(toast.error).toHaveBeenCalledWith('bulkCreate.accessChanged')
    expect(reset).toHaveBeenCalledWith({ queryKey: ['auth', 'me'], exact: true })
  })
  it('blocks duplicate writes, changes and dismissal while pending, and warns on native reload', async () => {
    const { state, fetcher } = mount()
    const idle = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(idle); expect(idle.defaultPrevented).toBe(false)
    const input = preview(state), pending = createDeferred<Response>()
    fetcher.mockReturnValueOnce(pending.promise)
    const request = state.submit()
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    state.begin(); state.edit(); state.preview(); state.close(); state.discard(); await state.submit()
    expect(state.pending.value).toBe(true); expect(state.snapshot.value).toBe(input); expect(fetcher).toHaveBeenCalledTimes(1)
    const unloading = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unloading); expect(unloading.defaultPrevented).toBe(true)
    pending.reject(new Error('unknown')); await request
    const unknown = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unknown); expect(unknown.defaultPrevented).toBe(true)
    state.close(); state.discard()
    const closed = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(closed); expect(closed.defaultPrevented).toBe(false)
  })
  it.each([null, { ...actor, id: '' }, { ...actor, group: 'guest' }, { ...actor, username: 'guest' }, { ...actor, permissions: ['domain:use_default'] }, { ...actor, permissions: ['short_link:create'] }])('rejects unconfirmed or insufficient authority %j', async user => {
    const { state, fetcher } = mount(user)
    expect(state.allowed.value).toBe(false)
    state.begin(); state.preview(); await state.submit()
    expect(state.opened.value).toBe(false); expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('local CSV ownership and explicit write boundary', () => {
  it.each(['success', 'error'])('lets the newest file win while ignoring an older %s and finally', async outcome => {
    const { state, fetcher } = mount(); state.begin(); state.draft.value = 'https://example.com/original'
    const old = pendingFile('target_url\nhttps://example.com/old'), latest = pendingFile('target_url\nhttps://example.com/new')
    const oldRequest = state.importFile(old.file), latestRequest = state.importFile(latest.file)
    expect(state.reading.value).toBe(true); state.preview(); expect(state.snapshot.value).toBeNull()
    if (outcome === 'success') old.resolve(); else old.reject()
    await oldRequest
    expect(state.reading.value).toBe(true); expect(state.errorKey.value).toBe('')
    expect(state.draft.value).toBe('https://example.com/original')
    latest.resolve(); await latestRequest
    expect(state.draft.value).toBe('https://example.com/new'); expect(state.reading.value).toBe(false)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(['success', 'error'])('preserves manual editing over a late file %s and releases preview immediately', async outcome => {
    const { state, fetcher } = mount(); state.begin()
    const file = pendingFile(), request = state.importFile(file.file)
    state.draft.value = 'https://example.com/manual'
    expect(state.reading.value).toBe(false); state.preview()
    const input = state.snapshot.value!
    expect('targetUrls' in input && input.targetUrls).toEqual(['https://example.com/manual'])
    if (outcome === 'success') file.resolve(); else file.reject()
    await request
    expect(state.snapshot.value).toBe(input); expect(state.draft.value).toBe('https://example.com/manual')
    expect(state.errorKey.value).toBe(''); expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(['oversize metadata', 'oversize bytes', 'invalid UTF-8', 'double BOM', 'invalid CSV', 'read failure'])('keeps the draft after %s without sending a request', async kind => {
    const { state, fetcher } = mount(); state.begin(); state.draft.value = 'https://example.com/keep'
    const file = pendingFile(kind === 'double BOM' ? '\uFEFF\uFEFFtarget_url\nhttps://example.com' : kind === 'invalid CSV' ? 'target_url,slug\nhttps://example.com,a' : undefined)
    if (kind === 'oversize metadata') Object.defineProperty(file.file, 'size', { value: 65537 })
    const request = state.importFile(file.file)
    if (kind === 'oversize metadata') expect(file.read).not.toHaveBeenCalled()
    else if (kind === 'oversize bytes') file.result.resolve(new ArrayBuffer(65537))
    else if (kind === 'invalid UTF-8') file.result.resolve(new Uint8Array([0xc3, 0x28]).buffer)
    else if (kind === 'read failure') file.reject()
    else file.resolve()
    await request
    expect(state.errorKey.value).toBe(kind.startsWith('oversize') ? 'bulkCreate.csvTooLarge' : ['invalid UTF-8', 'read failure'].includes(kind) ? 'bulkCreate.csvReadFailed' : 'bulkCreate.csvInvalid')
    expect(state.draft.value).toBe('https://example.com/keep'); expect(state.reading.value).toBe(false)
    expect(state.snapshot.value).toBeNull(); expect(fetcher).not.toHaveBeenCalled()
  })
  it('can read the same unchanged draft again and keeps the original payload after an unknown write', async () => {
    const { state, fetcher } = mount(); state.begin()
    const file = pendingFile(), first = state.importFile(file.file); file.resolve(); await first
    await state.importFile(file.file)
    expect(file.read).toHaveBeenCalledTimes(2); expect(state.reading.value).toBe(false)
    expect(fetcher).not.toHaveBeenCalled(); state.preview()
    const input = state.snapshot.value!, blocked = pendingFile('target_url\nhttps://example.com/changed')
    await state.importFile(blocked.file); expect(blocked.read).not.toHaveBeenCalled()
    const pending = createDeferred<Response>(); fetcher.mockReturnValueOnce(pending.promise)
    const request = state.submit(); await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    await state.importFile(blocked.file); expect(blocked.read).not.toHaveBeenCalled()
    pending.reject(new Error('unknown commit')); await request
    await state.importFile(blocked.file)
    expect(blocked.read).not.toHaveBeenCalled(); expect(state.snapshot.value).toBe(input)
    await state.submit()
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[0]![1]!.body).toBe(fetcher.mock.calls[1]![1]!.body)
    expect(JSON.parse(fetcher.mock.calls[1]![1]!.body as string).targetUrls).toEqual(['https://example.com/imported'])
  })
  it('does nothing when the picker is cancelled or the dialog is closed or no longer authorized', async () => {
    const { state, client, fetcher } = mount(); const file = pendingFile()
    await state.importFile(file.file); expect(file.read).not.toHaveBeenCalled()
    state.begin(); state.draft.value = 'https://example.com/keep'
    await state.importFile(undefined)
    expect(state.draft.value).toBe('https://example.com/keep'); expect(state.reading.value).toBe(false)
    client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: [] } })
    await state.importFile(file.file)
    expect(file.read).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled()
  })
})

describe.each(['success', 'error'] as const)('late file %s isolation', outcome => {
  it.each(['close and reopen', 'other account', 'guest and same account', 'permission and restore', 'auth pending', 'auth error', 'unmount'])('does not touch a newer read after %s', async transition => {
    const { state, client, fetcher, unmount } = mount(); state.begin()
    const old = pendingFile(), request = state.importFile(old.file)
    if (transition === 'unmount') unmount()
    else {
      if (transition === 'close and reopen') state.close()
      else if (transition === 'other account') client.setQueryData(['auth', 'me'], { user: { ...actor, id: '00000000-0000-0000-0000-000000003882' } })
      else if (transition === 'guest and same account') {
        client.setQueryData(['auth', 'me'], { user: { ...actor, group: 'guest' } }); client.setQueryData(['auth', 'me'], { user: actor })
      } else if (transition === 'permission and restore') {
        client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: [] } }); client.setQueryData(['auth', 'me'], { user: actor })
      } else {
        client.getQueryCache().find({ queryKey: ['auth', 'me'], exact: true })!.setState({ status: transition === 'auth pending' ? 'pending' : 'error', ...(transition === 'auth pending' ? { data: undefined } : {}) })
        client.setQueryData(['auth', 'me'], { user: actor })
      }
      expect(state.opened.value).toBe(false); expect(state.draft.value).toBe(''); expect(state.reading.value).toBe(false)
      state.begin(); state.draft.value = 'https://example.com/current'
    }
    const current = pendingFile('target_url\nhttps://example.com/new'), currentRequest = transition === 'unmount' ? undefined : state.importFile(current.file)
    if (outcome === 'success') old.resolve(); else old.reject()
    await request
    expect(state.reading.value).toBe(true); expect(state.errorKey.value).toBe(''); expect(fetcher).not.toHaveBeenCalled()
    if (transition !== 'unmount') {
      expect(state.draft.value).toBe('https://example.com/current')
      current.resolve(); await currentRequest
      expect(state.draft.value).toBe('https://example.com/new'); expect(state.reading.value).toBe(false)
    }
  })
})

describe.each(['success', 'error'] as const)('late %s identity isolation', outcome => {
  it.each(['other account', 'guest and same account', 'permission and restore', 'auth pending', 'auth error'])('cannot change a newer batch after %s', async transition => {
    const { state, client, fetcher, invalidations } = mount()
    const oldInput = preview(state), oldResponse = createDeferred<Response>()
    fetcher.mockReturnValueOnce(oldResponse.promise)
    const oldRequest = state.submit()
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1))
    if (transition === 'other account') client.setQueryData(['auth', 'me'], { user: { ...actor, id: '00000000-0000-0000-0000-000000003882' } })
    else if (transition === 'guest and same account') {
      client.setQueryData(['auth', 'me'], { user: { ...actor, group: 'guest' } }); client.setQueryData(['auth', 'me'], { user: actor })
    } else if (transition === 'permission and restore') {
      client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: [] } }); client.setQueryData(['auth', 'me'], { user: actor })
    } else {
      client.getQueryCache().find({ queryKey: ['auth', 'me'], exact: true })!.setState({ status: transition === 'auth pending' ? 'pending' : 'error', ...(transition === 'auth pending' ? { data: undefined } : {}) })
      client.setQueryData(['auth', 'me'], { user: actor })
    }
    expect(state.opened.value).toBe(false); expect(state.draft.value).toBe(''); expect(state.snapshot.value).toBeNull()
    const currentInput = preview(state), currentResponse = createDeferred<Response>()
    fetcher.mockReturnValueOnce(currentResponse.promise)
    const currentRequest = state.submit()
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2))
    if (outcome === 'success') oldResponse.resolve(response({ requestId: oldInput.requestId, createdCount: 2 }))
    else oldResponse.reject(new Error('late private failure'))
    await oldRequest
    expect(state.pending.value).toBe(true); expect(state.snapshot.value).toBe(currentInput); expect(state.errorKey.value).toBe('')
    expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled(); expect(invalidations).not.toHaveBeenCalled()
    currentResponse.resolve(response({ requestId: currentInput.requestId, createdCount: 2 })); await currentRequest
    expect(state.opened.value).toBe(false); expect(state.pending.value).toBe(false); expect(toast.success).toHaveBeenCalledTimes(1)
  })
  it('has no feedback, invalidation or late finally mutation after unmount', async () => {
    const { state, fetcher, invalidations, unmount } = mount()
    const input = preview(state), pending = createDeferred<Response>()
    fetcher.mockReturnValueOnce(pending.promise)
    const request = state.submit(); await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1)); unmount()
    if (outcome === 'success') pending.resolve(response({ requestId: input.requestId, createdCount: 2 }))
    else pending.reject(new Error('late private failure'))
    await request
    expect(state.pending.value).toBe(true); expect(toast.success).not.toHaveBeenCalled(); expect(toast.error).not.toHaveBeenCalled(); expect(invalidations).not.toHaveBeenCalled()
    const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); expect(event.defaultPrevented).toBe(false)
  })
})
