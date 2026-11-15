import { cleanup, render } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { defineComponent } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useBulkCreate } from './useBulkCreate'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const actor = { id: '00000000-0000-0000-0000-000000008311', username: 'budget-user', nickname: '', group: 'user', permissions: ['short_link:create', 'domain:use_default', 'short_link:set_metadata'] }
const clients: QueryClient[] = []
const response = (data: unknown) => new Response(JSON.stringify({ code: 0, message: '', data, meta: {} }))
const targets = (extra = '') => [...Array.from({ length: 19 }, (_, index) => 'https://example.com/' + '"'.repeat(1604) + index), 'https://example.com/end' + '"'.repeat(2013) + extra]
function mount(unknownFirst = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client)
  client.setQueryData(['auth', 'me'], { user: actor })
  const requests: { path: string; body: string }[] = []
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith('/auth/me')) return response({ user: actor })
    const body = init!.body as string
    requests.push({ path: String(url), body })
    if (unknownFirst && requests.length === 1) throw new Error('transport result unavailable')
    const value = JSON.parse(body) as { requestId: string; targetUrls?: string[]; items?: unknown[] }
    return response({ requestId: value.requestId, createdCount: (value.targetUrls ?? value.items)!.length })
  }))
  let state!: ReturnType<typeof useBulkCreate>
  render(defineComponent({ setup() { state = useBulkCreate(); return () => null } }), { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } })
  state.begin()
  return { state, requests }
}
async function read(state: ReturnType<typeof useBulkCreate>, text: string) {
  const file = new File([text], 'targets.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode(text).buffer })
  await state.importFile(file)
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks() })

describe('targets budget at the draft boundary', () => {
  // Delaying validation until the API would allocate a UUID and expose an unusable snapshot.
  it('refuses oversized manual preview without generating an identifier', async () => {
    const { state, requests } = mount(), value = targets('a').join('\n')
    const uuid = vi.spyOn(crypto, 'randomUUID')
    state.draft.value = value; state.preview(); await state.submit()
    expect(state.errorKey.value).toBe('bulkCreate.invalid')
    expect(state.snapshot.value).toBeNull(); expect(state.previewItems.value).toEqual([])
    expect(state.draft.value).toBe(value); expect(uuid).not.toHaveBeenCalled(); expect(requests).toEqual([])
  })

  // Accepting an oversized standard import would replace one of these exact prior drafts.
  it.each(['manual', 'structured'])('keeps the exact %s draft when standard targets exceed the complete budget', async kind => {
    const { state, requests } = mount()
    if (kind === 'manual') state.draft.value = 'https://example.com/manual'
    else await read(state, 'target_url,title\nhttps://example.com/titled,Original title')
    const previous = { draft: state.draft.value, items: state.importedItems.value, mode: state.importedMode.value }
    const text = 'target_url\n' + targets('a').map(value => '"' + value.replaceAll('"', '""') + '"').join('\n')
    expect(new TextEncoder().encode(text).byteLength).toBe(65480)
    await read(state, text)
    expect(state.errorKey.value).toBe('bulkCreate.csvInvalid'); expect(state.csvIssue.value).toBeNull()
    expect(state.draft.value).toBe(previous.draft); expect(state.importedItems.value).toBe(previous.items); expect(state.importedMode.value).toBe(previous.mode)
    expect(state.snapshot.value).toBeNull(); expect(state.reading.value).toBe(false); expect(requests).toEqual([])
    state.preview(); await state.submit()
    expect(requests.map(value => ({ path: value.path, body: JSON.parse(value.body) }))).toEqual(kind === 'manual'
      ? [{ path: '/api/v1/short-link/batch-create', body: { requestId: expect.any(String), targetUrls: ['https://example.com/manual'] } }]
      : [{ path: '/api/v1/short-link/batch-create-with-titles', body: { requestId: expect.any(String), items: [{ targetUrl: 'https://example.com/titled', title: 'Original title' }] } }])
  })

  it('keeps an exact-budget preview and unknown retry on one immutable UUID and payload', async () => {
    const { state, requests } = mount(true), values = targets()
    state.draft.value = values.join('\n'); state.preview()
    const snapshot = state.snapshot.value
    expect(snapshot).toEqual({ requestId: expect.any(String), targetUrls: values })
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(new TextEncoder().encode(JSON.stringify(snapshot)).byteLength).toBe(65536)
    await state.submit()
    expect(state.unknown.value).toBe(true); expect(state.errorKey.value).toBe('bulkCreate.unknown')
    state.preview(); expect(state.snapshot.value).toBe(snapshot)
    await state.submit()
    expect(requests).toHaveLength(2); expect(requests[1]).toEqual(requests[0])
    expect(JSON.parse(requests[0]!.body)).toEqual(snapshot)
    expect(state.opened.value).toBe(false)
  })
})
