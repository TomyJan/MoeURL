import { afterEach, describe, expect, it, vi } from 'vitest'
import { batchCreateShortLinksWithVisitLimits, bulkCreateVisitLimitsInputSchema, BulkCreateUnknownError, type BulkCreateVisitLimitsInput } from './bulk-create'

const requestId = '00000000-0000-0000-0000-000000007691'
const item = { targetUrl: 'https://example.com/cap', title: ' raw ', tags: [' tag '], customSlug: 'Team76', redirectMode: 'direct' as const, expiresAt: '', maxVisits: '1' }
const input = { requestId, items: [item] }
const response = (data: unknown = { requestId, createdCount: 1 }, code = 0) => new Response(JSON.stringify({ code, message: '', data, meta: {} }))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('seventh batch client', () => {
  it('sends exact ordered raw fields to its own endpoint and binds the expected account', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response()); vi.stubGlobal('fetch', fetcher)
    expect(await batchCreateShortLinksWithVisitLimits(input, 'cap-user')).toEqual({ requestId, createdCount: 1 })
    expect(fetcher.mock.calls).toEqual([['/api/v1/short-link/batch-create-with-visit-limits', expect.objectContaining({ method: 'POST', credentials: 'include', body: JSON.stringify(input), headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-MoeURL-Expected-User-ID': 'cap-user' } })]])
  })
  it.each([null, 1, 0, '0', '01', '+1', '-1', ' 1', '1 ', '1.0', '1e2', '１', '2147483648', '10000000000'])('rejects cap %j before transport', async maxVisits => {
    const invalid = { requestId, items: [{ ...item, maxVisits }] }, fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    expect(bulkCreateVisitLimitsInputSchema.safeParse(invalid).success).toBe(false)
    await expect(batchCreateShortLinksWithVisitLimits(invalid as unknown as BulkCreateVisitLimitsInput)).rejects.toMatchObject({ code: 100001 })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(['targetUrl', 'title', 'tags', 'customSlug', 'redirectMode', 'expiresAt', 'maxVisits'])('requires the exact %s field', field => {
    const changed: Record<string, unknown> = { ...item }; delete changed[field]
    expect(bulkCreateVisitLimitsInputSchema.safeParse({ requestId, items: [changed] }).success).toBe(false)
  })
  it.each(['', '1', '2147483647'])('preserves valid raw cap %j without adding a header when no expected account is supplied', async maxVisits => {
    const fetcher = vi.fn<typeof fetch>(async () => response()); vi.stubGlobal('fetch', fetcher)
    const body = { requestId, items: [{ ...item, maxVisits }] }
    await batchCreateShortLinksWithVisitLimits(body)
    expect(fetcher.mock.calls[0]![1]!.body).toBe(JSON.stringify(body))
    expect(fetcher.mock.calls[0]![1]!.headers).not.toHaveProperty('X-MoeURL-Expected-User-ID')
  })
  it.each([200108, 200101, 200102, 200120, 200121, 200122, 120001, 401, 403])('preserves definite business refusal %i', async code => {
    vi.stubGlobal('fetch', vi.fn(async () => response(null, code)))
    await expect(batchCreateShortLinksWithVisitLimits(input)).rejects.toMatchObject({ code })
  })
  it.each([null, { requestId, createdCount: 2 }, { requestId, createdCount: 1, extra: true }])('keeps mismatched receipt %j unknown', async data => {
    vi.stubGlobal('fetch', vi.fn(async () => response(data)))
    await expect(batchCreateShortLinksWithVisitLimits(input)).rejects.toBeInstanceOf(BulkCreateUnknownError)
  })
  it('rejects extra fields and duplicate targets or case-folded codes', () => {
    for (const body of [{ ...input, extra: true }, { requestId, items: [{ ...item, extra: true }] }, { requestId, items: [item, { ...item, customSlug: '' }] }, { requestId, items: [item, { ...item, targetUrl: 'https://example.com/other', customSlug: 'team76' }] }]) expect(bulkCreateVisitLimitsInputSchema.safeParse(body).success).toBe(false)
  })
})
