import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '@/shared/api/client'
import { batchCreateShortLinks, BulkCreateUnknownError, bulkCreateTargetsSchema, parseBulkCreateLines, type BulkCreateInput } from './bulk-create'

const input = { requestId: '00000000-0000-0000-0000-000000003891', targetUrls: ['https://example.com/one', 'http://example.org/two'] }
/** Creates a fresh body for every attempt, never reusing a consumed Response. */
function response(data: unknown = { requestId: input.requestId, createdCount: 2 }, code = 0, status = 200) {
  return new Response(JSON.stringify({ code, message: 'private server detail', data, meta: {} }), { status })
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('bounded creation protocol', () => {
  it('preserves URL order and only trims ASCII padding and empty CRLF lines', () => {
    expect(parseBulkCreateLines(' \t https://example.com/one\t\r\n\nhttp://example.org/two \n').data).toEqual(input.targetUrls)
    const longest = 'https://example.com/' + 'a'.repeat(2048 - 'https://example.com/'.length)
    expect(bulkCreateTargetsSchema.safeParse([longest]).success).toBe(true)
    expect(bulkCreateTargetsSchema.safeParse(Array.from({ length: 20 }, (_, i) => 'https://example.com/' + i)).success).toBe(true)
  })
  it.each(['', ' \t\r\n ', 'not a URL', 'ftp://example.com/x', 'https://example.com/中文', '\u00a0https://example.com', '\ufeffhttps://example.com', 'https://example.com/\u0000', 'https://example.com/x\r', 'https://example.com/' + 'a'.repeat(2030), 'https://example.com/x\n https://example.com/x ', Array.from({ length: 21 }, (_, i) => 'https://example.com/' + i).join('\n')])('rejects invalid, duplicate or out-of-bound preview %j', text => {
    expect(parseBulkCreateLines(text).success).toBe(false)
  })
  it('posts one strict ordered payload and accepts only its exact receipt', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => response())
    vi.stubGlobal('fetch', fetcher)
    expect(await batchCreateShortLinks(input)).toEqual({ requestId: input.requestId, createdCount: 2 })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]).toEqual(['/api/v1/short-link/batch-create', expect.objectContaining({ method: 'POST', credentials: 'include', body: JSON.stringify(input), headers: { Accept: 'application/json', 'Content-Type': 'application/json' } })])
  })
  it.each([{ ...input, requestId: 'bad' }, { ...input, requestId: '00000000-0000-0000-0000-000000000000' }, { ...input, requestId: 'ABCDEFAB-ABCD-ABCD-ABCD-ABCDEFABCDEF' }, { ...input, targetUrls: [] }, { ...input, extra: true }])('rejects malformed local request without sending %j', async value => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await expect(batchCreateShortLinks(value as BulkCreateInput)).rejects.toMatchObject({ code: 100001 })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([100001, 120001, 200101, 200103, 200114, 200120])('preserves definite server refusal %i', async code => {
    vi.stubGlobal('fetch', vi.fn(async () => response(null, code)))
    await expect(batchCreateShortLinks(input)).rejects.toMatchObject({ code })
  })
  it.each([401, 403])('treats HTTP authority denial %i as definite', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => response(null, 0, status)))
    await expect(batchCreateShortLinks(input)).rejects.toBeInstanceOf(ApiClientError)
  })
  it.each([null, {}, { requestId: input.requestId, createdCount: 1 }, { requestId: '00000000-0000-0000-0000-000000003892', createdCount: 2 }, { requestId: input.requestId, createdCount: 2, extra: true }])('treats an untrustworthy success receipt as unknown %j', async data => {
    vi.stubGlobal('fetch', vi.fn(async () => response(data)))
    await expect(batchCreateShortLinks(input)).rejects.toBeInstanceOf(BulkCreateUnknownError)
  })
  it.each(['network', '500', 'bad-json', 'bad-envelope', 'business-system'])('treats %s as unknown rather than a rejected write', async kind => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (kind === 'network') throw new Error('private transport detail')
      if (kind === '500') return response(null, 0, 500)
      if (kind === 'bad-json') return new Response('{')
      if (kind === 'bad-envelope') return new Response('[]')
      return response(null, 900000)
    }))
    await expect(batchCreateShortLinks(input)).rejects.toEqual(expect.objectContaining({ name: 'BulkCreateUnknownError', message: 'Batch result is unknown' }))
  })
})
