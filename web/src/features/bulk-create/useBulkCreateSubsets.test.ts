import { cleanup, render } from '@testing-library/vue'
import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { defineComponent, nextTick } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDeferred } from '@/test/deferred'
import { useBulkCreate } from './useBulkCreate'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('vue-sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
const actor = { id: '00000000-0000-0000-0000-000000008601', username: 'subset-user', nickname: '', group: 'user', permissions: ['short_link:create', 'domain:use_default', 'short_link:set_metadata', 'short_link:custom_slug', 'short_link:use_intermediate', 'short_link:use_confirmation', 'short_link:set_expiration', 'short_link:set_max_visits'] }
const clients: QueryClient[] = []
const without = (permission: string) => ({ ...actor, permissions: actor.permissions.filter(value => value !== permission) })
const response = (data: unknown) => new Response(JSON.stringify({ code: 0, message: '', data, meta: {} }))
function mount(user = actor) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); clients.push(client)
  client.setQueryData(['auth', 'me'], { user })
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith('/auth/me')) return response({ user })
    const input = JSON.parse(init!.body as string) as { requestId: string; items?: unknown[]; targetUrls?: string[] }
    return response({ requestId: input.requestId, createdCount: input.items?.length ?? input.targetUrls!.length })
  })
  vi.stubGlobal('fetch', fetcher)
  let state!: ReturnType<typeof useBulkCreate>
  render(defineComponent({ setup() { state = useBulkCreate(); return () => null } }), { global: { plugins: [[VueQueryPlugin, { queryClient: client }]] } })
  state.begin()
  return { state, client, fetcher }
}
function pendingFile(text: string) {
  const result = createDeferred<ArrayBuffer>(), file = new File([text], 'subsets.csv', { type: 'text/csv' })
  Object.defineProperty(file, 'arrayBuffer', { value: () => result.promise })
  return { file, resolve: () => result.resolve(new TextEncoder().encode(text).buffer), reject: () => result.reject(new Error('private file failure')) }
}
afterEach(() => { cleanup(); clients.splice(0).forEach(client => client.clear()); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.clearAllMocks() })

const protocols = [
  { text: 'target_url\nhttps://example.com/targets86', endpoint: 'batch-create', want: { targetUrls: ['https://example.com/targets86'] } },
  { text: 'title,target_url\n raw ,https://example.com/titles86', endpoint: 'batch-create-with-titles', want: { items: [{ targetUrl: 'https://example.com/titles86', title: ' raw ' }] } },
  { text: 'tags,target_url\n"["" tag ""]",https://example.com/tags86', endpoint: 'batch-create-with-metadata', want: { items: [{ targetUrl: 'https://example.com/tags86', title: '', tags: [' tag '] }] } },
  { text: 'custom_slug,target_url\nTeam86,https://example.com/slug86', endpoint: 'batch-create-with-custom-slugs', want: { items: [{ targetUrl: 'https://example.com/slug86', title: '', tags: [], customSlug: 'Team86' }] } },
  { text: 'redirect_mode,target_url\nconfirmation,https://example.com/mode86', endpoint: 'batch-create-with-redirect-modes', want: { items: [{ targetUrl: 'https://example.com/mode86', title: '', tags: [], customSlug: '', redirectMode: 'confirmation' }] } },
  { text: 'expires_at,target_url\n2099-01-01T00:00:00Z,https://example.com/expiry86', endpoint: 'batch-create-with-expirations', want: { items: [{ targetUrl: 'https://example.com/expiry86', title: '', tags: [], customSlug: '', redirectMode: '', expiresAt: '2099-01-01T00:00:00Z' }] } },
  { text: 'max_visits,target_url\n12,https://example.com/limit86', endpoint: 'batch-create-with-visit-limits', want: { items: [{ targetUrl: 'https://example.com/limit86', title: '', tags: [], customSlug: '', redirectMode: '', expiresAt: '', maxVisits: '12' }] } },
  { text: 'intermediate_delay_seconds,target_url,redirect_mode\n3,https://example.com/countdown86,intermediate', endpoint: 'batch-create-with-countdowns', want: { items: [{ targetUrl: 'https://example.com/countdown86', title: '', tags: [], customSlug: '', redirectMode: 'intermediate', expiresAt: '', maxVisits: '', intermediateDelaySeconds: '3' }] } },
]
const refusals = [
  { text: 'tags,target_url\n[],https://example.com/a', permission: 'short_link:set_metadata', error: 'bulkCreate.metadataRequired' },
  { text: 'expires_at,target_url\n,https://example.com/a', permission: 'short_link:set_metadata', error: 'bulkCreate.metadataRequired' },
  { text: 'custom_slug,target_url\n,https://example.com/a', permission: 'short_link:custom_slug', error: 'bulkCreate.customSlugRequired' },
  { text: 'expires_at,target_url\n,https://example.com/a', permission: 'short_link:custom_slug', error: 'bulkCreate.customSlugRequired' },
  { text: 'redirect_mode,target_url\nintermediate,https://example.com/a', permission: 'short_link:use_intermediate', error: 'bulkCreate.redirectModeRequired' },
  { text: 'redirect_mode,target_url\nconfirmation,https://example.com/a', permission: 'short_link:use_confirmation', error: 'bulkCreate.redirectModeRequired' },
  { text: 'expires_at,target_url\n2099-01-01T00:00:00Z,https://example.com/a', permission: 'short_link:set_expiration', error: 'bulkCreate.expirationRequired' },
  { text: 'max_visits,target_url\n12,https://example.com/a', permission: 'short_link:set_max_visits', error: 'bulkCreate.visitLimitRequired' },
]

describe('standard field subsets through real File, hook and HTTP client', () => {
  it.each(protocols)('uses the original $endpoint with complete literal defaults', async ({ text, endpoint, want }) => {
    const { state, fetcher } = mount(), file = pendingFile(text), reading = state.importFile(file.file)
    file.resolve(); await reading; state.preview()
    const input = state.snapshot.value!
    expect(input).toStrictEqual({ requestId: expect.stringMatching(/^[0-9a-f-]{36}$/), ...want })
    expect(Object.isFrozen(input)).toBe(true)
    if ('items' in input) { expect(Object.isFrozen(input.items)).toBe(true); expect(Object.isFrozen(input.items[0])).toBe(true) }
    await state.submit()
    expect(fetcher.mock.calls).toHaveLength(1)
    const [url, init] = fetcher.mock.calls[0]!
    expect(url).toBe('/api/v1/short-link/' + endpoint)
    expect(JSON.parse(init!.body as string)).toStrictEqual({ requestId: input.requestId, ...want })
    expect(init!.headers).toMatchObject({ 'X-MoeURL-Expected-User-ID': actor.id })
    expect(state.opened.value).toBe(false)
  })
  it.each(refusals)('preserves the draft when $permission is missing for $text', async ({ text, permission, error }) => {
    const { state, fetcher } = mount(without(permission)); state.draft.value = 'https://example.com/manual'
    const file = pendingFile(text), reading = state.importFile(file.file); file.resolve(); await reading
    expect(state.errorKey.value).toBe(error); expect(state.importedItems.value).toBeNull()
    expect(state.draft.value).toBe('https://example.com/manual'); expect(state.snapshot.value).toBeNull(); expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(refusals)('does not revive an old sparse file after revoke/restore of $permission', async ({ text, permission, error }) => {
    const { state, client, fetcher } = mount(); state.draft.value = 'https://example.com/manual'
    const file = pendingFile(text), reading = state.importFile(file.file)
    client.setQueryData(['auth', 'me'], { user: without(permission) }); client.setQueryData(['auth', 'me'], { user: actor })
    file.resolve(); await reading
    expect(state.errorKey.value).toBe(error); expect(state.importedItems.value).toBeNull()
    expect(state.draft.value).toBe('https://example.com/manual'); expect(fetcher).not.toHaveBeenCalled()
    const fresh = pendingFile(text), next = state.importFile(fresh.file); fresh.resolve(); await next
    expect(state.importedItems.value).not.toBeNull(); expect(state.errorKey.value).toBe('')
  })
  it('does not require unused extra grants for empty later fields', async () => {
    const user = { ...actor, permissions: actor.permissions.filter(value => !['short_link:set_expiration', 'short_link:set_max_visits', 'short_link:use_intermediate', 'short_link:use_confirmation'].includes(value)) }
    const { state, fetcher } = mount(user), file = pendingFile('intermediate_delay_seconds,target_url\n,https://example.com/defaults'), reading = state.importFile(file.file)
    file.resolve(); await reading; state.preview(); await state.submit()
    expect(fetcher.mock.calls[0]![0]).toBe('/api/v1/short-link/batch-create-with-countdowns')
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string).items).toStrictEqual([{ targetUrl: 'https://example.com/defaults', title: '', tags: [], customSlug: '', redirectMode: '', expiresAt: '', maxVisits: '', intermediateDelaySeconds: '' }])
  })
  it.each(['resolve', 'reject'] as const)('ignores late old-file %s and its finally while a newer file is pending', async outcome => {
    const { state, fetcher } = mount(), old = pendingFile('max_visits,target_url\n1,https://example.com/old'), newer = pendingFile('tags,target_url\n[],https://example.com/new')
    const first = state.importFile(old.file), second = state.importFile(newer.file)
    old[outcome](); await first
    expect(state.reading.value).toBe(true); expect(state.errorKey.value).toBe(''); expect(state.importedItems.value).toBeNull()
    newer.resolve(); await second
    expect(state.reading.value).toBe(false); expect(state.importedMode.value).toBe('metadata')
    expect(state.importedItems.value).toStrictEqual([{ targetUrl: 'https://example.com/new', title: '', tags: [] }]); expect(fetcher).not.toHaveBeenCalled()
  })
  it('retires the old identity without allowing its late error to unlock the new read', async () => {
    const { state, client, fetcher } = mount(), old = pendingFile(protocols[2]!.text), first = state.importFile(old.file)
    const nextActor = { ...actor, id: '00000000-0000-0000-0000-000000008602', username: 'next-subset-user' }
    client.setQueryData(['auth', 'me'], { user: nextActor }); await nextTick(); state.begin()
    const newer = pendingFile('tags,target_url\n[],https://example.com/new-account'), second = state.importFile(newer.file)
    old.reject(); await first; expect(state.reading.value).toBe(true); expect(state.errorKey.value).toBe('')
    newer.resolve(); await second; state.preview(); await state.submit()
    expect(fetcher.mock.calls).toHaveLength(1)
    expect(fetcher.mock.calls[0]![1]!.headers).toMatchObject({ 'X-MoeURL-Expected-User-ID': nextActor.id })
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string).items).toStrictEqual([{ targetUrl: 'https://example.com/new-account', title: '', tags: [] }])
  })
  it('preserves the same frozen endpoint, UUID, payload and identity after an unknown result', async () => {
    const { state, fetcher } = mount(), file = pendingFile(protocols[6]!.text), reading = state.importFile(file.file)
    file.resolve(); await reading; state.preview(); const frozen = state.snapshot.value
    fetcher.mockRejectedValueOnce(new Error('lost acknowledgement')); await state.submit()
    expect(state.unknown.value).toBe(true); expect(state.snapshot.value).toBe(frozen)
    const rejected = pendingFile(protocols[2]!.text); await state.importFile(rejected.file)
    expect(state.snapshot.value).toBe(frozen); await state.submit()
    expect(fetcher.mock.calls).toHaveLength(2)
    const [first, second] = fetcher.mock.calls
    expect(first![0]).toBe('/api/v1/short-link/batch-create-with-visit-limits'); expect(second![0]).toBe(first![0])
    expect(second![1]!.body).toBe(first![1]!.body); expect(JSON.parse(second![1]!.body as string)).toStrictEqual(frozen)
    expect(second![1]!.headers).toMatchObject({ 'X-MoeURL-Expected-User-ID': actor.id })
  })
  it('keeps the previous draft when expansion exceeds the complete wire budget', async () => {
    const item = { targetUrl: 'https://example.com', title: '界😀', tags: [], customSlug: '', redirectMode: '', expiresAt: '2099-01-01T00:00:00Z' }
    const overhead = new TextEncoder().encode(JSON.stringify({ requestId: '11111111-1111-4111-8111-111111111111', items: [item] })).length
    const text = 'expires_at,title,target_url\n2099-01-01T00:00:00Z,' + item.title + ' '.repeat(65537 - overhead) + ',https://example.com'
    expect(new TextEncoder().encode(text).length).toBeLessThan(65536)
    const { state, fetcher } = mount(); state.draft.value = 'https://example.com/keep'
    const file = pendingFile(text), reading = state.importFile(file.file); file.resolve(); await reading
    expect(state.errorKey.value).toBe('bulkCreate.csvInvalid'); expect(state.draft.value).toBe('https://example.com/keep')
    expect(state.importedItems.value).toBeNull(); expect(state.snapshot.value).toBeNull(); expect(fetcher).not.toHaveBeenCalled()
  })
})
