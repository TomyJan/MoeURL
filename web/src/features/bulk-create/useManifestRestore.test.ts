import { cleanup, render } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { defineComponent } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '@/shared/api/client'
import { createDeferred } from '@/test/deferred'
import { manifestRestoreShortLinks } from '@/entities/short-link/manifest-restore-api'
import { useManifestRestore } from './useManifestRestore'

vi.mock('@/entities/short-link/manifest-restore-api', () => ({ manifestRestoreShortLinks: vi.fn() }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const actor = {
  id: '00000000-0000-0000-0000-000000009001', username: 'restore-user', nickname: '', group: 'user',
  permissions: ['short_link:read_own', 'short_link:create', 'short_link:custom_slug', 'short_link:set_metadata', 'domain:use_default'],
}
const csvHeader = 'id,short_url,slug,target_url,title,tags,status,redirect_mode,intermediate_delay_seconds,expires_at,password_enabled,max_visits,visits_used,created_at,updated_at,owner_id,owner_username'
function csv(slug = 'res001', passwordEnabled = 'false') {
  return `${csvHeader}\r\na1111111-1111-4111-8111-111111119001,https://go.example/${slug},${slug},https://target.example/path,Title,"[""docs""]",active,direct,5,,${passwordEnabled},,3,2026-10-01T00:00:00Z,2026-10-02T00:00:00Z,a1111111-1111-4111-8111-111111119002,old-owner`
}

const clients: QueryClient[] = []
function mount(user: unknown = actor) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  clients.push(client)
  client.setQueryData(['auth', 'me'], { user })
  let state!: ReturnType<typeof useManifestRestore>
  const view = render(defineComponent({ setup() { state = useManifestRestore(); return () => null } }), {
    global: { plugins: [[VueQueryPlugin, { queryClient: client }]] },
  })
  state.begin()
  return { ...view, client, state }
}

function pendingFile(text: string, name = 'backup.csv') {
  const result = createDeferred<ArrayBuffer>()
  const file = new File([text], name, { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: () => result.promise })
  return { file, resolve: () => result.resolve(new TextEncoder().encode(text).buffer), reject: () => result.reject(new Error('private file read failure')) }
}

async function select(state: ReturnType<typeof useManifestRestore>, text: string, name?: string) {
  const file = pendingFile(text, name)
  const reading = state.selectFile(file.file)
  file.resolve()
  await reading
  return file
}

afterEach(() => {
  cleanup()
  clients.splice(0).forEach(client => client.clear())
  vi.mocked(manifestRestoreShortLinks).mockReset()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('manifest restore asynchronous identity and draft guards', () => {
  it('requires current create, custom-code and metadata grants before exposing restore', () => {
    const { state } = mount({ ...actor, permissions: ['short_link:create', 'short_link:custom_slug', 'domain:use_default'] })
    expect(state.allowed.value).toBe(false)
    state.begin()
    expect(state.opened.value).toBe(false)
  })

  it('keeps the restore draft when an unrelated query changes', async () => {
    const { state, client } = mount()
    await select(state, csv())
    const draft = state.parsed.value

    client.setQueryData(['short-link', 'unrelated'], { value: true })

    expect(state.opened.value).toBe(true)
    expect(state.parsed.value).toBe(draft)
  })

  it('does not read files reported larger than the local size limit', async () => {
    const { state } = mount()
    const file = new File(['x'], 'large.csv')
    Object.defineProperty(file, 'size', { value: 8 * 1024 * 1024 + 1 })
    const read = vi.spyOn(file, 'arrayBuffer')
    await state.selectFile(file)
    expect(read).not.toHaveBeenCalled()
    expect(state.errorKey.value).toBe('manifestRestore.fileTooLarge')
    expect(state.reading.value).toBe(false)
  })

  it('ignores absent or byte-oversized selections without creating a draft', async () => {
    const { state } = mount()
    expect(state.origins.value).toEqual([])
    await state.selectFile(undefined)
    const file = new File(['x'], 'small.csv')
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new Uint8Array(8 * 1024 * 1024 + 1).buffer })
    await state.selectFile(file)
    expect(state.errorKey.value).toBe('manifestRestore.fileTooLarge')
    expect(state.parsed.value).toBeNull()
  })

  it.each([
    ['disabled', 'disabled,direct,5,,false,,3', 'short_link:update_own'],
    ['intermediate', 'active,intermediate,5,,false,,3', 'short_link:use_intermediate'],
    ['confirmation', 'active,confirmation,5,,false,,3', 'short_link:use_confirmation'],
    ['expiration', 'active,direct,5,2026-10-03T00:00:00Z,false,,3', 'short_link:set_expiration'],
    ['max-visits', 'active,direct,5,,false,5,3', 'short_link:set_max_visits'],
  ] as const)('rejects %s rows when their field permission is absent', async (_label, fields, permission) => {
    const { state } = mount()
    const baseline = csv().split(',')
    const start = baseline.indexOf('active')
    baseline.splice(start, 7, ...fields.split(','))
    await select(state, baseline.join(','))
    expect(state.parsed.value).toBeNull()
    expect(state.errorKey.value).toBe('manifestRestore.permissionChanged')
    expect(manifestRestoreShortLinks).not.toHaveBeenCalled()
    expect(actor.permissions).not.toContain(permission)
  })

  it('keeps bad UTF-8 and rejected file reads local', async () => {
    const { state } = mount()
    const malformed = new File(['x'], 'invalid.csv')
    Object.defineProperty(malformed, 'arrayBuffer', { value: async () => new Uint8Array([0xc3, 0x28]).buffer })
    await state.selectFile(malformed)
    expect(state.errorKey.value).toBe('manifestRestore.fileReadFailed')
    const unreadable = new File(['x'], 'unreadable.csv')
    Object.defineProperty(unreadable, 'arrayBuffer', { value: async () => { throw new Error('private read failure') } })
    await state.selectFile(unreadable)
    expect(state.errorKey.value).toBe('manifestRestore.fileReadFailed')
    expect(state.parsed.value).toBeNull()
  })

  it('shows a safe generic issue when a readable file has no manifest records', async () => {
    const { state } = mount()
    await select(state, csvHeader, 'header-only.csv')

    expect(state.errorKey.value).toBe('manifestRestore.fileInvalid')
    expect(state.errorIssue.value).toBeNull()
    expect(manifestRestoreShortLinks).not.toHaveBeenCalled()
  })

  it('retires the draft after a late current-actor refusal', async () => {
    const { state } = mount()
    await select(state, csv())
    vi.mocked(manifestRestoreShortLinks).mockRejectedValueOnce(new ApiClientError(120001, 'actor changed'))
    await state.confirm()
    expect(state.opened.value).toBe(false)
    expect(state.parsed.value).toBeNull()
    expect(state.pending.value).toBe(false)
  })

  it('discards an uncertain snapshot only after an explicit user action', async () => {
    const { state } = mount()
    await select(state, csv())
    vi.mocked(manifestRestoreShortLinks).mockRejectedValueOnce(new Error('response lost'))
    await state.confirm()
    expect(state.unknown.value).toBe(true)
    state.discard()
    expect(state.opened.value).toBe(false)
    expect(state.unknown.value).toBe(false)
    expect(state.snapshot.value).toBeNull()
  })

  it.each([
    [200120, 'manifestRestore.conflict'],
    [200121, 'targetPolicy.bulkDenied'],
    [200122, 'dailyCreateQuota.bulkDenied'],
    [200101, 'bulkCreate.customSlugTaken'],
    [200102, 'bulkCreate.customSlugReserved'],
    [200103, 'manifestRestore.failed'],
  ] as const)('keeps definite refusal %i actionable', async (code, key) => {
    const { state } = mount()
    await select(state, csv())
    vi.mocked(manifestRestoreShortLinks).mockRejectedValueOnce(new ApiClientError(code, 'safe refusal'))
    await state.confirm()
    expect(state.errorKey.value).toBe(key)
    expect(state.parsed.value).not.toBeNull()
    expect(state.unknown.value).toBe(false)
  })

  it('resets an ordinary draft when closed without a pending write', async () => {
    const { state } = mount()
    await select(state, csv())
    state.close()
    expect(state.opened.value).toBe(false)
    expect(state.parsed.value).toBeNull()
    expect(state.unknown.value).toBe(false)
    state.close()
    state.discard()
    await state.retry()
  })

  it('keeps malformed or password-protected files local and exposes no source row', async () => {
    const { state } = mount()
    await select(state, csv('res001', 'true'))
    expect(state.parsed.value).toBeNull()
    expect(state.errorIssue.value).toMatchObject({ kind: 'field', record: 2, field: 'password_enabled' })
    expect(state.errorIssue.value).not.toHaveProperty('raw')
    expect(manifestRestoreShortLinks).not.toHaveBeenCalled()
  })

  it('retires a late file read when the confirmed account changes', async () => {
    const { state, client } = mount()
    const old = pendingFile(csv('old001'))
    const oldRead = state.selectFile(old.file)
    client.setQueryData(['auth', 'me'], { user: { ...actor, id: '00000000-0000-0000-0000-000000009002', username: 'next-user' } })
    state.begin()
    await select(state, csv('new001'), 'new.csv')
    const current = state.parsed.value
    old.resolve()
    await oldRead
    expect(state.parsed.value).toBe(current)
    expect(state.fileName.value).toBe('new.csv')
    expect(state.errorIssue.value).toBeNull()
  })

  it('retires an old read across permission revoke and restoration epochs', async () => {
    const { state, client } = mount()
    const old = pendingFile(csv('old002'))
    const oldRead = state.selectFile(old.file)
    client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: ['domain:use_default'] } })
    client.setQueryData(['auth', 'me'], { user: actor })
    state.begin()
    const fresh = pendingFile(csv('new002'), 'fresh.csv')
    const freshRead = state.selectFile(fresh.file)
    old.resolve()
    await oldRead
    expect(state.reading.value).toBe(true)
    expect(state.parsed.value).toBeNull()
    fresh.resolve()
    await freshRead
    expect(state.parsed.value?.[0]?.slug).toBe('new002')
    expect(state.fileName.value).toBe('fresh.csv')
  })

  it.each(['resolve', 'reject'] as const)('does not let an old %s or finally overwrite a newer file', async finish => {
    const { state } = mount()
    const old = pendingFile(csv('old003'))
    const oldRead = state.selectFile(old.file)
    await select(state, csv('new003'), 'newer.csv')
    const current = state.parsed.value
    if (finish === 'resolve') old.resolve(); else old.reject()
    await oldRead
    expect(state.parsed.value).toBe(current)
    expect(state.fileName.value).toBe('newer.csv')
    expect(state.reading.value).toBe(false)
    expect(state.errorIssue.value).toBeNull()
  })

  it('ignores a late API success and finally after close and unmount', async () => {
    const { state, unmount } = mount()
    await select(state, csv())
    const pending = createDeferred<{ requestId: string; createdCount: number }>()
    vi.mocked(manifestRestoreShortLinks).mockReturnValueOnce(pending.promise)
    const submitting = state.confirm()
    expect(state.pending.value).toBe(true)
    state.close()
    unmount()
    pending.resolve({ requestId: state.snapshot.value!.requestId, createdCount: 1 })
    await submitting
    expect(state.opened.value).toBe(false)
    expect(state.pending.value).toBe(false)
  })

  it('does not let a retired rejection replace a newer pending restore', async () => {
    const { state, client } = mount()
    await select(state, csv('old004'))
    const old = createDeferred<{ requestId: string; createdCount: number }>()
    const fresh = createDeferred<{ requestId: string; createdCount: number }>()
    vi.mocked(manifestRestoreShortLinks).mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise)
    const oldSubmit = state.confirm()
    client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: ['domain:use_default'] } })
    client.setQueryData(['auth', 'me'], { user: actor })
    state.begin()
    await select(state, csv('new004'))
    const newSubmit = state.confirm()
    old.reject(new ApiClientError(200120, 'stale refusal'))
    await oldSubmit
    expect(state.pending.value).toBe(true)
    expect(state.errorKey.value).toBe('')
    fresh.resolve({ requestId: state.snapshot.value!.requestId, createdCount: 1 })
    await newSubmit
    expect(state.errorKey.value).toBe('')
    expect(state.createdCount.value).toBe(1)
  })

  it('sends only once for duplicate confirmation and explicitly retries unknown with the exact key and body', async () => {
    const { state } = mount()
    await select(state, csv())
    const unknown = createDeferred<{ requestId: string; createdCount: number }>()
    vi.mocked(manifestRestoreShortLinks).mockReturnValueOnce(unknown.promise)
      .mockImplementationOnce(async input => ({ requestId: input.requestId, createdCount: input.items.length }))
    const first = state.confirm()
    const duplicate = state.confirm()
    expect(manifestRestoreShortLinks).toHaveBeenCalledTimes(1)
    unknown.reject(new Error('lost response'))
    await Promise.all([first, duplicate])
    expect(state.unknown.value).toBe(true)
    const snapshot = state.snapshot.value
    state.close()
    state.begin()
    expect(state.unknown.value).toBe(true)
    await state.retry()
    expect(manifestRestoreShortLinks).toHaveBeenCalledTimes(2)
    expect(vi.mocked(manifestRestoreShortLinks).mock.calls[0]).toEqual(vi.mocked(manifestRestoreShortLinks).mock.calls[1])
    expect(state.snapshot.value).toBe(snapshot)
  })

  it('keeps a pending request retryable with the same immutable key after close and reopen', async () => {
    const { state } = mount()
    await select(state, csv('retry01'))
    const firstResponse = createDeferred<{ requestId: string; createdCount: number }>()
    const retryResponse = createDeferred<{ requestId: string; createdCount: number }>()
    vi.mocked(manifestRestoreShortLinks).mockReturnValueOnce(firstResponse.promise).mockReturnValueOnce(retryResponse.promise)
    const first = state.confirm()
    const snapshot = state.snapshot.value
    state.close()
    expect(state.opened.value).toBe(false)
    state.begin()
    expect(state.opened.value).toBe(true)
    expect(state.unknown.value).toBe(true)
    firstResponse.resolve({ requestId: snapshot!.requestId, createdCount: 1 })
    await first
    expect(state.unknown.value).toBe(true)
    const retried = state.retry()
    retryResponse.resolve({ requestId: snapshot!.requestId, createdCount: 1 })
    await retried
    expect(vi.mocked(manifestRestoreShortLinks).mock.calls[0]).toEqual(vi.mocked(manifestRestoreShortLinks).mock.calls[1])
  })

  it('does not submit a second restore after a confirmed success', async () => {
    const { state } = mount()
    await select(state, csv())
    vi.mocked(manifestRestoreShortLinks).mockImplementation(async input => ({ requestId: input.requestId, createdCount: input.items.length }))
    await state.confirm()
    await state.confirm()
    expect(manifestRestoreShortLinks).toHaveBeenCalledTimes(1)
  })

  it('does not treat a retry refusal as proof that an earlier unknown write did not commit', async () => {
    const { state } = mount()
    await select(state, csv('unknown1'))
    vi.mocked(manifestRestoreShortLinks).mockRejectedValueOnce(new Error('response lost'))
      .mockRejectedValueOnce(new ApiClientError(200120, 'retry conflict'))
    await state.confirm()
    const snapshot = state.snapshot.value
    await state.retry()
    expect(state.unknown.value).toBe(true)
    expect(state.errorKey.value).toBe('manifestRestore.unknown')
    expect(state.snapshot.value).toBe(snapshot)
    expect(manifestRestoreShortLinks).toHaveBeenCalledTimes(2)
  })

  it('preserves a definite refusal draft and uses a fresh request id for changed content', async () => {
    const { state } = mount()
    await select(state, csv('first01'))
    vi.mocked(manifestRestoreShortLinks).mockRejectedValueOnce(new ApiClientError(200120, 'conflict'))
      .mockImplementationOnce(async input => ({ requestId: input.requestId, createdCount: input.items.length }))
    await state.confirm()
    const firstId = state.snapshot.value?.requestId
    expect(state.parsed.value?.[0]?.slug).toBe('first01')
    expect(state.unknown.value).toBe(false)
    expect(state.errorKey.value).toBe('manifestRestore.conflict')
    await select(state, csv('second1'), 'changed.csv')
    await state.confirm()
    expect(vi.mocked(manifestRestoreShortLinks).mock.calls[1]?.[0].requestId).not.toBe(firstId)
  })
})
