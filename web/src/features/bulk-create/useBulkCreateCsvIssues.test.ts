import { cleanup, render } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { defineComponent } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDeferred } from '@/test/deferred'
import { useBulkCreate } from './useBulkCreate'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const actor = { id: '00000000-0000-0000-0000-000000008201', username: 'issue-user', nickname: '', group: 'user', permissions: ['short_link:create', 'domain:use_default', 'short_link:set_metadata'] }
const clients: QueryClient[] = []
const response = (data: unknown) => new Response(JSON.stringify({ code: 0, message: '', data, meta: {} }))
const valid = 'title,target_url\n raw title ,https://example.com/literal'
const header = 'secret\nhttps://secret.invalid'
const width = 'target_url,title\nhttps://example.com'
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client)
  client.setQueryData(['auth', 'me'], { user: actor })
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith('/auth/me')) return response({ user: actor })
    const input = JSON.parse(init!.body as string) as { requestId: string; items: unknown[] }
    return response({ requestId: input.requestId, createdCount: input.items.length })
  })
  vi.stubGlobal('fetch', fetcher)
  let state!: ReturnType<typeof useBulkCreate>
  render(defineComponent({ setup() { state = useBulkCreate(); return () => null } }), { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } })
  state.begin()
  return { state, client, fetcher }
}
function pendingFile(text: string) {
  const result = createDeferred<ArrayBuffer>(), file = new File([text], 'input.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: () => result.promise })
  return { file, reject: result.reject, resolve: () => result.resolve(new TextEncoder().encode(text).buffer) }
}
async function read(state: ReturnType<typeof useBulkCreate>, text: string) {
  const file = pendingFile(text), reading = state.importFile(file.file); file.resolve(); await reading
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks() })

describe('current file structure diagnostics', () => {
  it('changes location under the same error key without changing a manual draft or HTTP', async () => {
    const { state, fetcher } = mount(); state.draft.value = 'https://example.com/manual'
    await read(state, header)
    expect(state.csvIssue.value).toStrictEqual({ kind: 'header', record: 1 })
    await read(state, 'target_url\nhttps://example.com\n"secret')
    expect(state.csvIssue.value).toStrictEqual({ kind: 'syntax', record: 3 })
    expect(state.errorKey.value).toBe('bulkCreate.csvInvalid')
    expect(state.draft.value).toBe('https://example.com/manual'); expect(state.importedItems.value).toBeNull()
    expect(state.snapshot.value).toBeNull(); expect(fetcher).not.toHaveBeenCalled()
  })

  it('keeps a structured draft and clears the issue before preview and explicit clear', async () => {
    const { state, fetcher } = mount(); await read(state, valid)
    const previous = state.importedItems.value
    await read(state, width)
    expect(state.csvIssue.value).toStrictEqual({ kind: 'width', record: 2 })
    expect(state.importedItems.value).toBe(previous)
    state.preview(); expect(state.csvIssue.value).toBeNull(); expect(state.snapshot.value).toMatchObject({ items: previous })
    state.edit(); await read(state, header); expect(state.csvIssue.value).toStrictEqual({ kind: 'header', record: 1 })
    state.clearImport(); expect(state.csvIssue.value).toBeNull(); expect(state.importedItems.value).toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('clears diagnosis at read start, on success and on a generic schema failure', async () => {
    const { state } = mount(); await read(state, header)
    expect(state.csvIssue.value).toStrictEqual({ kind: 'header', record: 1 })
    const file = pendingFile(valid), reading = state.importFile(file.file)
    expect(state.reading.value).toBe(true); expect(state.csvIssue.value).toBeNull()
    file.resolve(); await reading
    expect(state.csvIssue.value).toBeNull(); expect(state.errorKey.value).toBe('')
    await read(state, width); expect(state.csvIssue.value).toStrictEqual({ kind: 'width', record: 2 })
    await read(state, 'target_url\nftp://secret.invalid')
    expect(state.errorKey.value).toBe('bulkCreate.csvInvalid'); expect(state.csvIssue.value).toBeNull()
  })

  it('hides a prior issue for other errors and on close', async () => {
    const { state } = mount(); await read(state, header)
    expect(state.csvIssue.value).toStrictEqual({ kind: 'header', record: 1 })
    state.preview(); expect(state.errorKey.value).toBe('bulkCreate.invalid'); expect(state.csvIssue.value).toBeNull()
    await read(state, header); state.close(); state.begin()
    expect(state.csvIssue.value).toBeNull(); expect(state.errorKey.value).toBe('')
    await read(state, width)
    await state.importFile(new File(['x'.repeat(65537)], 'too-large.csv'))
    expect(state.errorKey.value).toBe('bulkCreate.csvTooLarge'); expect(state.csvIssue.value).toBeNull()
  })

  it('keeps read and UTF8 failures generic without retaining a previous issue', async () => {
    const { state } = mount(); await read(state, header)
    const file = pendingFile(valid), reading = state.importFile(file.file)
    file.reject(new Error('secret failure')); await reading
    expect(state.errorKey.value).toBe('bulkCreate.csvReadFailed'); expect(state.csvIssue.value).toBeNull()
    await read(state, header)
    const invalid = new File([new Uint8Array([255])], 'invalid.csv')
    Object.defineProperty(invalid, 'arrayBuffer', { value: async () => new Uint8Array([255]).buffer })
    await state.importFile(invalid)
    expect(state.errorKey.value).toBe('bulkCreate.csvReadFailed'); expect(state.csvIssue.value).toBeNull()
  })

  it('does not let an old finally unlock a newer pending read', async () => {
    const { state } = mount(), old = pendingFile(header), fresh = pendingFile(width)
    const first = state.importFile(old.file), second = state.importFile(fresh.file)
    old.resolve(); await first
    expect(state.reading.value).toBe(true); expect(state.csvIssue.value).toBeNull(); expect(state.errorKey.value).toBe('')
    fresh.resolve(); await second
    expect(state.reading.value).toBe(false); expect(state.csvIssue.value).toStrictEqual({ kind: 'width', record: 2 })
  })

  it.each(['resolve', 'reject'] as const)('ignores an older %s after the new file finished', async finish => {
    const { state } = mount(), old = pendingFile(header), first = state.importFile(old.file)
    await read(state, width)
    expect(state.csvIssue.value).toStrictEqual({ kind: 'width', record: 2 })
    if (finish === 'resolve') old.resolve(); else old.reject(new Error('secret'))
    await first
    expect(state.csvIssue.value).toStrictEqual({ kind: 'width', record: 2 }); expect(state.errorKey.value).toBe('bulkCreate.csvInvalid')
  })

  it('does not revive a late issue after close and account replacement', async () => {
    const { state, client } = mount(), old = pendingFile(header), first = state.importFile(old.file)
    state.close(); client.setQueryData(['auth', 'me'], { user: { ...actor, id: '00000000-0000-0000-0000-000000008202', username: 'next-user' } })
    state.begin(); await read(state, valid); const items = state.importedItems.value
    old.resolve(); await first
    expect(state.opened.value).toBe(true); expect(state.importedItems.value).toBe(items)
    expect(state.csvIssue.value).toBeNull(); expect(state.errorKey.value).toBe('')
  })

  it('retires a late issue across base permission revocation and restoration', async () => {
    const { state, client, fetcher } = mount(), old = pendingFile(header), first = state.importFile(old.file)
    client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: ['domain:use_default'] } })
    client.setQueryData(['auth', 'me'], { user: actor }); state.begin()
    const fresh = pendingFile(width), second = state.importFile(fresh.file)
    old.resolve(); await first
    expect(state.reading.value).toBe(true); expect(state.csvIssue.value).toBeNull()
    fresh.resolve(); await second
    expect(state.csvIssue.value).toStrictEqual({ kind: 'width', record: 2 }); expect(fetcher).not.toHaveBeenCalled()
  })

  it('preserves the exact frozen payload and UUID retry after a diagnosed import', async () => {
    const { state, fetcher } = mount(); await read(state, header); await read(state, valid); state.preview()
    const snapshot = state.snapshot.value
    fetcher.mockRejectedValueOnce(new Error('lost response')); await state.submit()
    expect(state.unknown.value).toBe(true); expect(state.csvIssue.value).toBeNull()
    await read(state, width); expect(state.snapshot.value).toBe(snapshot); expect(state.csvIssue.value).toBeNull()
    await state.submit(); expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/short-link/batch-create-with-titles')
    expect(fetcher.mock.calls[1]![1]!.body).toBe(fetcher.mock.calls[0]![1]!.body)
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toStrictEqual(snapshot)
  })
})
