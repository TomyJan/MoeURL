import { afterEach, describe, expect, it, vi } from 'vitest'
import { batchCreateShortLinksWithRedirectModes, bulkCreateRedirectModesInputSchema, BulkCreateUnknownError, type BulkCreateRedirectModesInput } from './bulk-create'

const requestId = '00000000-0000-0000-0000-000000007491'
const items = [
  { targetUrl: 'https://example.com/direct', title: ' raw ', tags: [' tag '], customSlug: 'Team74', redirectMode: 'direct' as const },
  { targetUrl: 'https://example.com/intermediate', title: '', tags: [], customSlug: '', redirectMode: 'intermediate' as const },
  { targetUrl: 'https://example.com/confirmation', title: '', tags: [], customSlug: 'Confirm74', redirectMode: 'confirmation' as const },
  { targetUrl: 'https://example.com/empty', title: '', tags: [], customSlug: '', redirectMode: '' as const },
]
const input = { requestId, items }
function response(data: unknown = { requestId, createdCount: 4 }, code = 0) { return new Response(JSON.stringify({ code, message: '', data, meta: {} })) }
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe('independent redirect-mode batch protocol', () => {
  it('sends the exact ordered five fields without normalizing the raw receipt identity', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response()); vi.stubGlobal('fetch', fetcher)
    expect(await batchCreateShortLinksWithRedirectModes(input)).toEqual({ requestId, createdCount: 4 })
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/v1/short-link/batch-create-with-redirect-modes', expect.objectContaining({
      method: 'POST', credentials: 'include', body: JSON.stringify(input), headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    }))
  })
  it.each(['Direct', ' intermediate', 'confirmation ', 'unknown', null, 0])('rejects illegal mode %j before transport', async redirectMode => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    const value = { requestId, items: [{ ...items[0], redirectMode }] }
    expect(bulkCreateRedirectModesInputSchema.safeParse(value).success).toBe(false)
    await expect(batchCreateShortLinksWithRedirectModes(value as BulkCreateRedirectModesInput)).rejects.toMatchObject({ code: 100001 })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(['targetUrl', 'title', 'tags', 'customSlug', 'redirectMode'])('requires the %s field', field => {
    const item: Record<string, unknown> = { ...items[0] }; delete item[field]
    expect(bulkCreateRedirectModesInputSchema.safeParse({ requestId, items: [item] }).success).toBe(false)
  })
  it('rejects unknown fields, duplicate URLs and normalized short codes', () => {
    for (const value of [
      { ...input, extra: true },
      { requestId, items: [{ ...items[0], extra: true }] },
      { requestId, items: [items[0], { ...items[1], targetUrl: items[0].targetUrl }] },
      { requestId, items: [items[0], { ...items[1], customSlug: 'team74' }] },
    ]) expect(bulkCreateRedirectModesInputSchema.safeParse(value).success).toBe(false)
  })
  it.each([200101, 200102, 200120, 200121, 200122, 120001])('preserves definite server refusal %i', async code => {
    vi.stubGlobal('fetch', vi.fn(async () => response(null, code)))
    await expect(batchCreateShortLinksWithRedirectModes(input)).rejects.toMatchObject({ code })
  })
  it.each([null, { requestId, createdCount: 3 }, { requestId, createdCount: 4, extra: true }])('keeps untrusted receipt %j unknown', async data => {
    vi.stubGlobal('fetch', vi.fn(async () => response(data)))
    await expect(batchCreateShortLinksWithRedirectModes(input)).rejects.toBeInstanceOf(BulkCreateUnknownError)
  })
  it('keeps network failure unknown so retry can preserve the identical request', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(response())
    vi.stubGlobal('fetch', fetcher)
    await expect(batchCreateShortLinksWithRedirectModes(input)).rejects.toBeInstanceOf(BulkCreateUnknownError)
    expect(await batchCreateShortLinksWithRedirectModes(input)).toEqual({ requestId, createdCount: 4 })
    expect(fetcher.mock.calls[0]![1]!.body).toBe(fetcher.mock.calls[1]![1]!.body)
  })
})
