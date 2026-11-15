import { afterEach, describe, expect, it, vi } from 'vitest'
import { batchCreateShortLinksWithCountdowns, bulkCreateCountdownsInputSchema, BulkCreateUnknownError, type BulkCreateCountdownsInput } from './bulk-create'

const requestId = '00000000-0000-0000-0000-000000007791'
const item = { targetUrl: 'https://example.com/delay', title: ' raw ', tags: [' tag '], customSlug: 'Team77', redirectMode: 'intermediate' as const, expiresAt: '', maxVisits: '1', intermediateDelaySeconds: '3' }
const input = { requestId, items: [item] }
const response = (data: unknown = { requestId, createdCount: 1 }, code = 0) => new Response(JSON.stringify({ code, message: '', data, meta: {} }))
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('eighth batch client', () => {
  it('sends all eight ordered raw fields to its own endpoint with the expected account', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response()); vi.stubGlobal('fetch', fetcher)
    expect(await batchCreateShortLinksWithCountdowns(input, 'countdown-user')).toEqual({ requestId, createdCount: 1 })
    expect(fetcher.mock.calls).toEqual([['/api/v1/short-link/batch-create-with-countdowns', expect.objectContaining({ method: 'POST', credentials: 'include', body: JSON.stringify(input), headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-MoeURL-Expected-User-ID': 'countdown-user' } })]])
  })
  it.each([null, 3, 0, '0', '2', '11', '03', '+3', '-3', ' 3', '3 ', '3.0', '3e0', '３', '٣'])('rejects delay %j before transport', async intermediateDelaySeconds => {
    const invalid = { requestId, items: [{ ...item, intermediateDelaySeconds }] }, fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    expect(bulkCreateCountdownsInputSchema.safeParse(invalid).success).toBe(false)
    await expect(batchCreateShortLinksWithCountdowns(invalid as unknown as BulkCreateCountdownsInput)).rejects.toMatchObject({ code: 100001 })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(['targetUrl', 'title', 'tags', 'customSlug', 'redirectMode', 'expiresAt', 'maxVisits', 'intermediateDelaySeconds'])('requires the explicit %s field', field => {
    const changed: Record<string, unknown> = { ...item }; delete changed[field]
    expect(bulkCreateCountdownsInputSchema.safeParse({ requestId, items: [changed] }).success).toBe(false)
  })
  it.each(['', '3', '4', '5', '6', '7', '8', '9', '10'])('preserves valid raw delay %j without an absent expected-account header', async intermediateDelaySeconds => {
    const fetcher = vi.fn<typeof fetch>(async () => response()); vi.stubGlobal('fetch', fetcher)
    const body = { requestId, items: [{ ...item, intermediateDelaySeconds }] }
    await batchCreateShortLinksWithCountdowns(body)
    expect(fetcher.mock.calls[0]![1]!.body).toBe(JSON.stringify(body))
    expect(fetcher.mock.calls[0]![1]!.headers).not.toHaveProperty('X-MoeURL-Expected-User-ID')
  })
  it.each(['', 'direct', 'confirmation'])('requires an empty delay for mode %j', redirectMode => {
    expect(bulkCreateCountdownsInputSchema.safeParse({ requestId, items: [{ ...item, redirectMode }] }).success).toBe(false)
    expect(bulkCreateCountdownsInputSchema.safeParse({ requestId, items: [{ ...item, redirectMode, intermediateDelaySeconds: '' }] }).success).toBe(true)
  })
  it.each([200108, 200101, 200102, 200120, 200121, 200122, 120001, 401, 403])('preserves definite business refusal %i', async code => {
    vi.stubGlobal('fetch', vi.fn(async () => response(null, code)))
    await expect(batchCreateShortLinksWithCountdowns(input)).rejects.toMatchObject({ code })
  })
  it.each([null, { requestId, createdCount: 2 }, { requestId, createdCount: 1, extra: true }])('keeps mismatched receipt %j unknown', async data => {
    vi.stubGlobal('fetch', vi.fn(async () => response(data)))
    await expect(batchCreateShortLinksWithCountdowns(input)).rejects.toBeInstanceOf(BulkCreateUnknownError)
  })
  it('retains legacy strict validation for caps, expirations, extras and conflicting targets or codes', () => {
    for (const body of [{ ...input, extra: true }, { requestId, items: [{ ...item, extra: true }] }, { requestId, items: [{ ...item, maxVisits: '01' }] }, { requestId, items: [{ ...item, expiresAt: '2099-02-31T00:00:00Z' }] }, { requestId, items: [item, { ...item, customSlug: '' }] }, { requestId, items: [item, { ...item, targetUrl: 'https://example.com/other', customSlug: 'team77' }] }]) expect(bulkCreateCountdownsInputSchema.safeParse(body).success).toBe(false)
  })
})
