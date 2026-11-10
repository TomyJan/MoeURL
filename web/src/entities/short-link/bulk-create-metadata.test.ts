import { afterEach, describe, expect, it, vi } from 'vitest'
import { batchCreateShortLinksWithMetadata, BulkCreateUnknownError, type BulkCreateMetadataInput } from './bulk-create'

const input = { requestId: '11111111-1111-4111-8111-111111115510', items: [{ targetUrl: 'https://example.com/tags', title: ' raw ', tags: ['　工具　', 'a,b'] }] }
/** Returns one fresh response body per attempt. */
function response(data: unknown = { requestId: input.requestId, createdCount: 1 }, code = 0, status = 200) {
  return new Response(JSON.stringify({ code, message: '', data, meta: {} }), { status })
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('metadata API wire and acknowledgement safety', () => {
  it.each([input, { ...input, items: [{ ...input.items[0]!, tags: [] }] }])('sends raw metadata, including empty tags, to its independent endpoint', async payload => {
    const fetcher = vi.fn(async () => response()); vi.stubGlobal('fetch', fetcher)
    await expect(batchCreateShortLinksWithMetadata(payload, 'owner')).resolves.toEqual({ requestId: input.requestId, createdCount: 1 })
    expect(fetcher.mock.calls[0]).toEqual(['/api/v1/short-link/batch-create-with-metadata', expect.objectContaining({ method: 'POST', body: JSON.stringify(payload), headers: expect.objectContaining({ 'X-MoeURL-Expected-User-ID': 'owner' }) })])
  })
  it.each([
    { ...input, extra: true }, { ...input, items: [] }, { ...input, requestId: 'bad' },
    { ...input, items: [{ ...input.items[0], tags: null }] },
    { ...input, items: [{ targetUrl: 'https://example.com', title: '' }] },
    { ...input, items: [{ ...input.items[0], tags: ['a', ' a '] }] },
    { ...input, items: [{ ...input.items[0], tags: ['\ud800'] }] },
    { ...input, items: [{ ...input.items[0], tags: ['a\nb'] }] },
    { ...input, items: [{ ...input.items[0], tags: ['😀'.repeat(33)] }] },
    { ...input, items: [{ ...input.items[0], tags: [], title: ' '.repeat(65536) }] },
    { ...input, items: [{ ...input.items[0], extra: true }] },
  ])('rejects invalid metadata before transport', async payload => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await expect(batchCreateShortLinksWithMetadata(payload as unknown as BulkCreateMetadataInput)).rejects.toMatchObject({ code: 100001 })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([100001, 120001, 200101, 200103, 200114, 200120])('retains definite business denial %i', async code => {
    vi.stubGlobal('fetch', vi.fn(async () => response(null, code)))
    await expect(batchCreateShortLinksWithMetadata(input)).rejects.toMatchObject({ code })
  })
  it.each([401, 403])('retains HTTP denial %i', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => response(null, 0, status)))
    await expect(batchCreateShortLinksWithMetadata(input)).rejects.toMatchObject({ code: status })
  })
  it.each([null, {}, { requestId: input.requestId, createdCount: 2 }, { requestId: '11111111-1111-4111-8111-111111115511', createdCount: 1 }, { requestId: input.requestId, createdCount: 1, extra: true }])('classifies untrustworthy acknowledgements as unknown', async data => {
    vi.stubGlobal('fetch', vi.fn(async () => response(data)))
    await expect(batchCreateShortLinksWithMetadata(input)).rejects.toBeInstanceOf(BulkCreateUnknownError)
  })
  it.each(['network', '500', 'bad-json', 'system'])('classifies %s as unknown without automatic retry', async kind => {
    const fetcher = vi.fn(async () => {
      if (kind === 'network') throw new Error('offline')
      if (kind === '500') return response(null, 0, 500)
      if (kind === 'bad-json') return new Response('{')
      return response(null, 900000)
    }); vi.stubGlobal('fetch', fetcher)
    await expect(batchCreateShortLinksWithMetadata(input)).rejects.toBeInstanceOf(BulkCreateUnknownError)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  it('bounds a stalled metadata write and clears the deadline timer', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }))))
    const request = batchCreateShortLinksWithMetadata(input).catch(error => error)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await request).toBeInstanceOf(BulkCreateUnknownError)
    expect(vi.getTimerCount()).toBe(0)
  })
})
