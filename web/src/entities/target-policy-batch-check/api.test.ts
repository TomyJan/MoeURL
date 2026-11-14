import { afterEach, expect, it, vi } from 'vitest'
import { checkTargetPolicyBatch, TargetPolicyBatchCheckInputSchema, TargetPolicyBatchCheckResultSchema } from './api'

afterEach(() => vi.unstubAllGlobals())
const response = (data: unknown, code = 0) => new Response(JSON.stringify({ code, message: 'fixed', data, meta: {} }))

// A wrong endpoint, reordered/deduplicated input or optimistic response decoder
// must change the externally observable request or accepted ordered decisions.
it('posts exact original positions including duplicates and whitespace once', async () => {
  const data = { items: [{ index: 1, outcome: 'allowed' }, { index: 2, outcome: 'invalid_target' }, { index: 3, outcome: 'restricted' }] }
  const fetcher = vi.fn().mockResolvedValue(response(data)); vi.stubGlobal('fetch', fetcher)
  const input = { targetUrls: [' https://example.com/ ', 'https://other.example/', ' https://example.com/ '] }
  expect(await checkTargetPolicyBatch(input)).toEqual(data)
  expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/v1/admin/system/target-policy/check-batch', expect.objectContaining({ method: 'POST', credentials: 'include', body: JSON.stringify(input) }))
})
it.each([1, 20])('accepts exactly %i ordered decisions for that bounded request', async count => {
  const items = Array.from({ length: count }, (_, i) => ({ index: i + 1, outcome: 'allowed' }))
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ items })))
  expect(await checkTargetPolicyBatch({ targetUrls: Array.from({ length: count }, () => 'https://example.com/') })).toEqual({ items })
})
it.each([
  null, {}, [], { items: null }, { items: [] },
  { items: [{ index: 1, outcome: 'allowed' }], targetUrl: 'private' },
  { items: [{ index: 1, outcome: 'allowed', targetUrl: 'private' }] },
  { items: [{ index: 1, outcome: 'ALLOW' }] }, { items: [{ index: 1, outcome: null }] },
  { items: [{ outcome: 'allowed' }] }, { items: [{ index: 0, outcome: 'allowed' }] },
  { items: [{ index: -1, outcome: 'allowed' }] }, { items: [{ index: 1.5, outcome: 'allowed' }] },
  { items: [{ index: '1', outcome: 'allowed' }] }, { items: [{ index: 2, outcome: 'allowed' }] },
].map(data => ({ data })))('rejects malformed, unindexed or over-disclosing results $data', async ({ data }) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(data)))
  expect(TargetPolicyBatchCheckResultSchema.safeParse(data).success).toBe(false)
  await expect(checkTargetPolicyBatch({ targetUrls: ['https://example.com/'] })).rejects.toThrow()
})
it.each([
  [{ index: 1, outcome: 'allowed' }],
  [{ index: 1, outcome: 'allowed' }, { index: 1, outcome: 'restricted' }],
  [{ index: 2, outcome: 'restricted' }, { index: 1, outcome: 'allowed' }],
  [{ index: 1, outcome: 'allowed' }, { index: 3, outcome: 'restricted' }],
  [{ index: 1, outcome: 'allowed' }, { index: 2, outcome: 'restricted' }, { index: 3, outcome: 'allowed' }],
].map(items => ({ items })))('rejects missing, extra, reordered or duplicate positions for a two-item request $items', async ({ items }) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ items })))
  await expect(checkTargetPolicyBatch({ targetUrls: ['https://first.example/', 'https://second.example/'] })).rejects.toThrow()
})
it('rejects an otherwise ordered response beyond the twenty-item bound', () => {
  expect(TargetPolicyBatchCheckResultSchema.safeParse({ items: Array.from({ length: 21 }, (_, i) => ({ index: i + 1, outcome: 'allowed' })) }).success).toBe(false)
})
it.each(['', 'https://example.com/\n', 'https://example.com/\u0085', 'https://example.com/\ud800', 'https://example.com/\udfff', 'a'.repeat(2049), '界'.repeat(683)])('rejects an invalid member without dropping it or sending the rest', async target => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  const input = { targetUrls: ['https://valid.example/', target] }
  expect(TargetPolicyBatchCheckInputSchema.safeParse(input).success).toBe(false)
  await expect(checkTargetPolicyBatch(input)).rejects.toThrow()
  expect(fetcher).not.toHaveBeenCalled()
})
it('keeps UTF-8 limits and valid Unicode while rejecting request shape and count errors', () => {
  const input = { targetUrls: ['界'.repeat(682) + 'aa', '😀'.repeat(512), '�', ' https://example.com/ '] }
  expect(TargetPolicyBatchCheckInputSchema.parse(input)).toEqual(input)
  for (const invalid of [null, {}, [], { targetUrls: null }, { targetUrls: 'https://example.com/' }, { targetUrls: [null] }, { targetUrls: [3] }, { targetUrls: [] }, { targetUrls: Array.from({ length: 21 }, () => 'https://example.com/') }, { targetUrls: ['ok'], extra: 1 }]) {
    expect(TargetPolicyBatchCheckInputSchema.safeParse(invalid).success).toBe(false)
  }
})
it.each([900227, 120001, 900000])('preserves business failure %s without retrying', async code => {
  const fetcher = vi.fn().mockResolvedValue(response(null, code)); vi.stubGlobal('fetch', fetcher)
  await expect(checkTargetPolicyBatch({ targetUrls: ['https://example.com/'] })).rejects.toMatchObject({ code })
  expect(fetcher).toHaveBeenCalledTimes(1)
})
