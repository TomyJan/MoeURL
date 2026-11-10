import { afterEach, describe, expect, it, vi } from 'vitest'
import { batchCreateShortLinksWithTitles, BulkCreateUnknownError, type BulkCreateTitlesInput } from './bulk-create'
import { parseBulkCreateImportCsv } from './bulk-create-csv'

const input = { requestId: '00000000-0000-0000-0000-000000003891', items: [{ targetUrl: 'https://example.com/one', title: '  中文, "原文"  ' }, { targetUrl: 'http://example.org/two', title: '' }] }
/** Supplies a fresh transport body per request. */
function response(data: unknown = { requestId: input.requestId, createdCount: 2 }, code = 0, status = 200) {
  return new Response(JSON.stringify({ code, message: '', data, meta: {} }), { status })
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('CSV title import contract', () => {
  // Splitting on commas, trimming titles, or normalizing URLs would corrupt this payload.
  it.each(['\n', '\r\n'])('preserves exact two-column content with %j records', newline => {
    expect(parseBulkCreateImportCsv('\uFEFFtarget_url,title' + newline + 'https://example.com/one,"  中文, ""原文""  "' + newline + 'http://example.org/two,' + newline)).toEqual({ success: true, mode: 'titles', data: input.items })
    expect(parseBulkCreateImportCsv('target_url' + newline + 'https://example.com')).toEqual({ success: true, mode: 'targets', data: ['https://example.com'] })
  })
  it.each(['', '\u0085', '\t x \r\n', '😀'.repeat(120), '\ufeff' + 'x'.repeat(119)])('accepts Go-compatible title %j without normalizing its raw value', title => {
    const csv = 'target_url,title\nhttps://example.com,"' + title + '"'
    expect(parseBulkCreateImportCsv(csv)).toEqual({ success: true, mode: 'titles', data: [{ targetUrl: 'https://example.com', title }] })
  })
  it.each([
    'target_url,title', 'target_url,title\n', 'target_url,title\n\n', 'target_url,title\nhttps://example.com',
    'target_url,title\nhttps://example.com,a,', 'target_url,title\nhttps://example.com,a\n\n',
    'title,target_url\nx,https://example.com', 'target_url,Title\nhttps://example.com,a',
    '\ufeff\ufefftarget_url,title\nhttps://example.com,a', 'target_url,title\nhttps://example.com,a\r',
    'target_url,title\nhttps://example.com,"x\ny"', 'target_url,title\nhttps://example.com,"x\ry"',
    'target_url,title\nhttps://example.com,x\u0000', 'target_url,title\nhttps://example.com,"x\u0085y"',
    'target_url,title\nhttps://example.com,' + '😀'.repeat(121),
    'target_url,title\nhttps://example.com,\ufeff' + 'x'.repeat(120),
    'target_url,title\nhttps://example.com,\ud800', 'target_url,title\nhttps://example.com,\udc00',
    'target_url,title\nhttps://example.com,a\nhttps://example.com,b',
    'target_url,title\nftp://example.com,a', 'target_url,title\nhttps://example.com/中文,a',
    'target_url,title\nhttps://example.com,"a"b', 'target_url,title\nhttps://example.com,a"b',
    'target_url,title\nhttps://example.com,"a', 'target_url,title\nhttps://example.com,' + 'x'.repeat(65536),
    'target_url,title\n' + Array.from({ length: 21 }, (_, i) => `https://example.com/${i},a`).join('\n'),
  ])('rejects the entire malformed import %j', csv => {
    expect(parseBulkCreateImportCsv(csv)).toEqual({ success: false })
  })
  it('accepts twenty distinct titled items without truncation', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({ targetUrl: `https://example.com/${i}`, title: `标题${i}` }))
    expect(parseBulkCreateImportCsv('target_url,title\n' + rows.map(row => `${row.targetUrl},${row.title}`).join('\n'))).toEqual({ success: true, mode: 'titles', data: rows })
  })
})

describe('title API acknowledgement safety', () => {
  it('sends literal titles through the independent protocol with captured owner', async () => {
    const fetcher = vi.fn(async () => response()); vi.stubGlobal('fetch', fetcher)
    await expect(batchCreateShortLinksWithTitles(input, 'owner')).resolves.toEqual({ requestId: input.requestId, createdCount: 2 })
    expect(fetcher.mock.calls[0]).toEqual(['/api/v1/short-link/batch-create-with-titles', expect.objectContaining({ method: 'POST', body: JSON.stringify(input), headers: expect.objectContaining({ 'X-MoeURL-Expected-User-ID': 'owner' }) })])
  })
  it.each([
    { ...input, extra: true }, { ...input, items: [] }, { ...input, requestId: 'bad' },
    { ...input, items: [{ targetUrl: 'https://example.com', title: 'x', extra: true }] },
    { ...input, items: [{ targetUrl: 'https://example.com' }] },
    { ...input, items: [{ targetUrl: 'https://example.com', title: '\ud800' }] },
    { ...input, items: [{ targetUrl: 'https://example.com', title: 'a'.repeat(121) }] },
    { ...input, items: [input.items[0], input.items[0]] },
    { ...input, items: [{ targetUrl: 'https://example.com', title: '\u0085'.repeat(65536) }] },
  ])('rejects malformed or oversized input before transport', async value => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
    await expect(batchCreateShortLinksWithTitles(value as BulkCreateTitlesInput)).rejects.toMatchObject({ code: 100001 })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([100001, 120001, 200101, 200103, 200114, 200120])('retains definite business denial %i', async code => {
    vi.stubGlobal('fetch', vi.fn(async () => response(null, code)))
    await expect(batchCreateShortLinksWithTitles(input)).rejects.toMatchObject({ code })
  })
  it.each([401, 403])('retains HTTP denial %i', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => response(null, 0, status)))
    await expect(batchCreateShortLinksWithTitles(input)).rejects.toMatchObject({ code: status })
  })
  it.each([null, {}, { requestId: input.requestId, createdCount: 1 }, { requestId: '00000000-0000-0000-0000-000000003892', createdCount: 2 }, { requestId: input.requestId, createdCount: 2, extra: true }])('rejects untrustworthy acknowledgement as unknown', async data => {
    vi.stubGlobal('fetch', vi.fn(async () => response(data)))
    await expect(batchCreateShortLinksWithTitles(input)).rejects.toBeInstanceOf(BulkCreateUnknownError)
  })
  it.each(['network', '500', 'bad-json', 'system'])('classifies %s as unknown', async kind => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (kind === 'network') throw new Error('offline')
      if (kind === '500') return response(null, 0, 500)
      if (kind === 'bad-json') return new Response('{')
      return response(null, 900000)
    }))
    await expect(batchCreateShortLinksWithTitles(input)).rejects.toBeInstanceOf(BulkCreateUnknownError)
  })
  it('bounds a stalled titled write and clears its timer', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise<Response>((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }))))
    const request = batchCreateShortLinksWithTitles(input).catch(error => error)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await request).toBeInstanceOf(BulkCreateUnknownError)
    expect(vi.getTimerCount()).toBe(0)
  })
})
