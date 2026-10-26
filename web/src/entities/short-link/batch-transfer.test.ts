import { afterEach, describe, expect, it, vi } from 'vitest'
import * as transfer from './transfer'

const input = { items: [{ id: '00000000-0000-0000-0000-000000000020', expectedUpdatedAt: '2026-10-25T00:00:00.123456789Z' }], newOwnerUsername: ' Recipient ' }
afterEach(() => vi.unstubAllGlobals())
describe('batch ownership transfer HTTP boundary', () => {
  it('offers one atomic batch request with exact usernames and full precision', async () => {
    expect(transfer).toHaveProperty('batchTransferShortLinks', expect.any(Function))
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: { transferredCount: 1, unchangedCount: 0 }, meta: {} })))
    vi.stubGlobal('fetch', fetcher)
    expect(await transfer.batchTransferShortLinks(input)).toEqual({ transferredCount: 1, unchangedCount: 0 })
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/admin/short-link/batch-transfer')
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual(input)
  })
  it.each([
    { ...input, items: [] }, { ...input, items: Array.from({ length: 101 }, () => input.items[0]) },
    { ...input, items: [input.items[0], input.items[0]] }, { ...input, newOwnerUsername: '' },
    ...['00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-00000000002A', 'bad'].map(id => ({ ...input, items: [{ ...input.items[0], id }] })),
    ...['0001-01-01T00:00:00Z', 'bad'].map(expectedUpdatedAt => ({ ...input, items: [{ ...input.items[0], expectedUpdatedAt }] })),
    { ...input, extra: true },
  ])('rejects invalid input before sending: %j', async request => {
    vi.stubGlobal('fetch', vi.fn())
    await expect(transfer.batchTransferShortLinks(request as typeof input)).rejects.toMatchObject({ code: 100001 })
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each([
    { transferredCount: -1, unchangedCount: 2 }, { transferredCount: 0.5, unchangedCount: 0.5 },
    { transferredCount: 0, unchangedCount: 0 }, { transferredCount: 1, unchangedCount: 1 },
    { transferredCount: 1 }, { transferredCount: 1, unchangedCount: 0, extra: true },
  ])('rejects inconsistent or malformed counts: %j', async data => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }))))
    await expect(transfer.batchTransferShortLinks(input)).rejects.toMatchObject({ code: 100001 })
  })
  it.each([100001, 120001, 200104, 200116, 200117, 900000])('preserves error %i and never automatically retries', async code => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code, message: 'private', data: null, meta: {} }))))
    await expect(transfer.batchTransferShortLinks(input)).rejects.toMatchObject({ code })
    expect(fetch).toHaveBeenCalledTimes(1)
  })
  it.each(['中'.repeat(100), ' account ', 'ACCOUNT'])('accepts 100 distinct targets and existing exact username %j', async newOwnerUsername => {
    const request = { items: Array.from({ length: 100 }, (_, index) => ({ id: `00000000-0000-0000-0000-${(index + 1).toString(16).padStart(12, '0')}`, expectedUpdatedAt: input.items[0]!.expectedUpdatedAt })), newOwnerUsername }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: { transferredCount: 0, unchangedCount: 100 }, meta: {} }))))
    expect(await transfer.batchTransferShortLinks(request)).toEqual({ transferredCount: 0, unchangedCount: 100 })
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)).toEqual(request)
  })
  it('preserves a valid nonzero nanosecond version near the zero instant', async () => {
    const request = { ...input, items: [{ ...input.items[0]!, expectedUpdatedAt: '0001-01-01T00:00:00.000000001Z' }] }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: { transferredCount: 1, unchangedCount: 0 }, meta: {} }))))
    expect(await transfer.batchTransferShortLinks(request)).toEqual({ transferredCount: 1, unchangedCount: 0 })
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0]![1]!.body as string)).toEqual(request)
  })
})
