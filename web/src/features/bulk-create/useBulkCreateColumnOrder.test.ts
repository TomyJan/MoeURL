import { cleanup, render } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { defineComponent } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDeferred } from '@/test/deferred'
import { useBulkCreate } from './useBulkCreate'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const actor = { id: '00000000-0000-0000-0000-000000008101', username: 'order-user', nickname: '', group: 'user', permissions: ['short_link:create', 'domain:use_default', 'short_link:set_metadata', 'short_link:custom_slug', 'short_link:use_intermediate', 'short_link:use_confirmation', 'short_link:set_expiration', 'short_link:set_max_visits'] }
const clients: QueryClient[] = []
const csv = 'intermediate_delay_seconds,max_visits,expires_at,redirect_mode,custom_slug,tags,title,target_url\n3,12,2099-01-01T00:00:00Z,intermediate,Team81,"[""　工具　"",""a,b""]", raw 😀 ,https://example.com/first\n10,,,intermediate,,[], second ,https://example.com/second'
const items = [
  { targetUrl: 'https://example.com/first', title: ' raw 😀 ', tags: ['　工具　', 'a,b'], customSlug: 'Team81', redirectMode: 'intermediate', expiresAt: '2099-01-01T00:00:00Z', maxVisits: '12', intermediateDelaySeconds: '3' },
  { targetUrl: 'https://example.com/second', title: ' second ', tags: [], customSlug: '', redirectMode: 'intermediate', expiresAt: '', maxVisits: '', intermediateDelaySeconds: '10' },
]
const response = (data: unknown) => new Response(JSON.stringify({ code: 0, message: '', data, meta: {} }))
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
function pendingFile(text = csv) {
  const result = createDeferred<ArrayBuffer>(), file = new File([text], 'reordered.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: () => result.promise })
  return { file, resolve: () => result.resolve(new TextEncoder().encode(text).buffer) }
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks() })

describe('reordered CSV through the real batch client', () => {
  it('sends complete raw eighth-protocol values and retries the identical frozen payload and UUID', async () => {
    const { state, fetcher } = mount(), file = pendingFile(), reading = state.importFile(file.file)
    file.resolve(); await reading
    expect(state.importedMode.value).toBe('countdowns'); expect(state.importedItems.value).toStrictEqual(items)
    state.preview(); const input = state.snapshot.value!
    expect(input).toStrictEqual({ requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), items })
    if (!('items' in input)) throw new Error('Structured preview required')
    expect(Object.isFrozen(input)).toBe(true); expect(Object.isFrozen(input.items)).toBe(true)
    expect(Object.isFrozen(input.items[0])).toBe(true); expect(Object.isFrozen((input.items[0] as { tags: readonly string[] }).tags)).toBe(true)
    fetcher.mockRejectedValueOnce(new Error('lost acknowledgement')); await state.submit()
    expect(state.unknown.value).toBe(true); expect(state.snapshot.value).toBe(input)
    await state.submit()
    expect(fetcher.mock.calls).toHaveLength(2)
    for (const [url, init] of fetcher.mock.calls) {
      expect(url).toBe('/api/v1/short-link/batch-create-with-countdowns')
      expect(JSON.parse(init!.body as string)).toStrictEqual({ requestId: input.requestId, items })
      expect(init!.headers).toMatchObject({ 'X-MoeURL-Expected-User-ID': actor.id })
    }
    expect(state.opened.value).toBe(false)
  })
  it('does not revive a delayed reordered file after a permission revoke and restore', async () => {
    const { state, client, fetcher } = mount(); state.draft.value = 'https://example.com/manual'
    const old = pendingFile(), reading = state.importFile(old.file)
    client.setQueryData(['auth', 'me'], { user: { ...actor, permissions: actor.permissions.filter(permission => permission !== 'short_link:set_max_visits') } })
    client.setQueryData(['auth', 'me'], { user: actor }); old.resolve(); await reading
    expect(state.importedItems.value).toBeNull(); expect(state.draft.value).toBe('https://example.com/manual')
    expect(state.errorKey.value).toBe('bulkCreate.visitLimitRequired'); expect(fetcher).not.toHaveBeenCalled()
    const fresh = pendingFile(), next = state.importFile(fresh.file); fresh.resolve(); await next
    expect(state.importedItems.value).toStrictEqual(items); expect(state.errorKey.value).toBe('')
  })
  it('rejects an incomplete column set without replacing a manual draft or issuing HTTP', async () => {
    const { state, fetcher } = mount(); state.draft.value = 'https://example.com/manual'
    const file = pendingFile('expires_at,target_url\n,https://example.com/invalid'), reading = state.importFile(file.file)
    file.resolve(); await reading
    expect(state.errorKey.value).toBe('bulkCreate.csvInvalid'); expect(state.draft.value).toBe('https://example.com/manual')
    expect(state.importedItems.value).toBeNull(); expect(state.snapshot.value).toBeNull(); expect(fetcher).not.toHaveBeenCalled()
  })
})
