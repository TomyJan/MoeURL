import { afterEach, describe, expect, it, vi } from 'vitest'
import { batchCreateShortLinksWithRedirectModes, batchCreateShortLinksWithExpirations, bulkCreateExpirationsInputSchema, BulkCreateUnknownError, type BulkCreateExpirationsInput } from './bulk-create'

const requestId = '00000000-0000-0000-0000-000000007591'
const item = { targetUrl: 'https://example.com/expiry', title: ' raw ', tags: [' tag '], customSlug: 'Team75', redirectMode: 'direct' as const, expiresAt: '2030-01-01T00:00:00Z' }
const input = { requestId, items: [item] }
const response = (data: unknown = { requestId, createdCount: 1 }, code = 0) => new Response(JSON.stringify({ code, message: '', data, meta: {} }))

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe('definite expiration refusal', () => {
  it('preserves the definite 200108 business response through shared batch transport', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 200108, message: '', data: null, meta: {} }))))
    await expect(batchCreateShortLinksWithRedirectModes({ requestId: '00000000-0000-0000-0000-000000007591', items: [{ targetUrl: 'https://example.com/expiry', title: '', tags: [], customSlug: '', redirectMode: 'direct' }] })).rejects.toMatchObject({ code: 200108 })
  })

  it('uses the independent sixth endpoint with exact ordered raw fields and no optional expected-user header', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response()); vi.stubGlobal('fetch', fetcher)
    expect(await batchCreateShortLinksWithExpirations(input)).toEqual({ requestId, createdCount: 1 })
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/v1/short-link/batch-create-with-expirations', expect.objectContaining({ method: 'POST', credentials: 'include', body: JSON.stringify(input), headers: { Accept: 'application/json', 'Content-Type': 'application/json' } }))
  })
  it.each(['targetUrl', 'title', 'tags', 'customSlug', 'redirectMode', 'expiresAt'])('requires the exact %s field before transport', async field => {
    const changed: Record<string, unknown> = { ...item }; delete changed[field]
    const invalid = { requestId, items: [changed] }, fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    expect(bulkCreateExpirationsInputSchema.safeParse(invalid).success).toBe(false)
    await expect(batchCreateShortLinksWithExpirations(invalid as unknown as BulkCreateExpirationsInput)).rejects.toMatchObject({ code: 100001 })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([null, 0, '2030-02-30T00:00:00Z', '2030-01-01T00:00:00.0Z'])('rejects invalid raw expiry %j and unknown envelope fields', expiresAt => {
    for (const value of [{ requestId, items: [{ ...item, expiresAt }] }, { ...input, extra: true }, { requestId, items: [{ ...item, extra: true }] }]) expect(bulkCreateExpirationsInputSchema.safeParse(value).success).toBe(false)
  })
  it.each([200108, 200101, 200102, 200120, 200121, 200122, 120001, 401, 403])('retains definite server refusal %i', async code => {
    vi.stubGlobal('fetch', vi.fn(async () => response(null, code)))
    await expect(batchCreateShortLinksWithExpirations(input)).rejects.toMatchObject({ code })
  })
  it.each([null, { requestId, createdCount: 2 }, { requestId, createdCount: 1, extra: true }, { requestId: '00000000-0000-0000-0000-000000007592', createdCount: 1 }])('keeps malformed or mismatched receipt %j unknown', async data => {
    vi.stubGlobal('fetch', vi.fn(async () => response(data)))
    await expect(batchCreateShortLinksWithExpirations(input)).rejects.toBeInstanceOf(BulkCreateUnknownError)
  })
  it('keeps a transport failure unknown and retries the identical sixth-protocol payload', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('lost')).mockResolvedValueOnce(response()); vi.stubGlobal('fetch', fetcher)
    await expect(batchCreateShortLinksWithExpirations(input)).rejects.toBeInstanceOf(BulkCreateUnknownError)
    expect(await batchCreateShortLinksWithExpirations(input)).toEqual({ requestId, createdCount: 1 })
    expect(fetcher.mock.calls[0]![1]!.body).toBe(fetcher.mock.calls[1]![1]!.body)
  })
})
