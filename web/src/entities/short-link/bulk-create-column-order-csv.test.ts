import { describe, expect, it } from 'vitest'
import { parseBulkCreateCsv, parseBulkCreateImportCsv } from './bulk-create-csv'

const names = ['target_url', 'title', 'tags', 'custom_slug', 'redirect_mode', 'expires_at', 'max_visits', 'intermediate_delay_seconds']
const values = ['https://example.com/a,b', ' 标题 "quoted" 😀 ', '["　工具　","a,b"]', 'Team81', 'intermediate', '2099-01-01T00:00:00Z', '12', '3']
const cell = (value: string) => '"' + value.replaceAll('"', '""') + '"'
// Expected objects are hand-written: positional overwrite, trimming or wrong mode selection must fail.
const cases = [
  { count: 1, want: { success: true, mode: 'targets', data: ['https://example.com/a,b'] } },
  { count: 2, want: { success: true, mode: 'titles', data: [{ targetUrl: 'https://example.com/a,b', title: ' 标题 "quoted" 😀 ' }] } },
  { count: 3, want: { success: true, mode: 'metadata', data: [{ targetUrl: 'https://example.com/a,b', title: ' 标题 "quoted" 😀 ', tags: ['　工具　', 'a,b'] }] } },
  { count: 4, want: { success: true, mode: 'custom-slugs', data: [{ targetUrl: 'https://example.com/a,b', title: ' 标题 "quoted" 😀 ', tags: ['　工具　', 'a,b'], customSlug: 'Team81' }] } },
  { count: 5, want: { success: true, mode: 'redirect-modes', data: [{ targetUrl: 'https://example.com/a,b', title: ' 标题 "quoted" 😀 ', tags: ['　工具　', 'a,b'], customSlug: 'Team81', redirectMode: 'intermediate' }] } },
  { count: 6, want: { success: true, mode: 'expirations', data: [{ targetUrl: 'https://example.com/a,b', title: ' 标题 "quoted" 😀 ', tags: ['　工具　', 'a,b'], customSlug: 'Team81', redirectMode: 'intermediate', expiresAt: '2099-01-01T00:00:00Z' }] } },
  { count: 7, want: { success: true, mode: 'visit-limits', data: [{ targetUrl: 'https://example.com/a,b', title: ' 标题 "quoted" 😀 ', tags: ['　工具　', 'a,b'], customSlug: 'Team81', redirectMode: 'intermediate', expiresAt: '2099-01-01T00:00:00Z', maxVisits: '12' }] } },
  { count: 8, want: { success: true, mode: 'countdowns', data: [{ targetUrl: 'https://example.com/a,b', title: ' 标题 "quoted" 😀 ', tags: ['　工具　', 'a,b'], customSlug: 'Team81', redirectMode: 'intermediate', expiresAt: '2099-01-01T00:00:00Z', maxVisits: '12', intermediateDelaySeconds: '3' }] } },
]

describe('CSV standard column order', () => {
  it.each(cases)('reorders every complete standard header without changing raw values ($count columns)', ({ count, want }) => {
    const reverse = Array.from({ length: count }, (_, index) => count - index - 1)
    const adjacent = Array.from({ length: count }, (_, index) => index)
    if (count > 1) [adjacent[0], adjacent[1]] = [1, 0]
    for (const order of [reverse, adjacent]) {
      const csv = '\uFEFF' + order.map(index => names[index]).join(',') + '\r\n' + order.map(index => cell(values[index]!)).join(',') + '\r\n'
      expect(parseBulkCreateImportCsv(csv)).toStrictEqual(want)
      expect(parseBulkCreateCsv(csv)).toStrictEqual(count === 1 ? { success: true, data: ['https://example.com/a,b'] } : { success: false })
    }
  })

  it('preserves data row order and empty defaults in reversed eight-column input', () => {
    const csv = 'intermediate_delay_seconds,max_visits,expires_at,redirect_mode,custom_slug,tags,title,target_url\n3,12,2099-01-01T00:00:00Z,intermediate,First81,[], first ,https://example.com/first\n10,,,intermediate,,[], second ,https://example.com/second'
    expect(parseBulkCreateImportCsv(csv)).toStrictEqual({ success: true, mode: 'countdowns', data: [
      { targetUrl: 'https://example.com/first', title: ' first ', tags: [], customSlug: 'First81', redirectMode: 'intermediate', expiresAt: '2099-01-01T00:00:00Z', maxVisits: '12', intermediateDelaySeconds: '3' },
      { targetUrl: 'https://example.com/second', title: ' second ', tags: [], customSlug: '', redirectMode: 'intermediate', expiresAt: '', maxVisits: '', intermediateDelaySeconds: '10' },
    ] })
  })

  it.each([
    'title,title\nhello,world',
    'target_url,unknown\nhttps://example.com,x',
    'expires_at,title\n,missing-url',
    'tags,target_url,owner\n[],https://example.com,user',
    'Title,target_url\nhello,https://example.com',
    'title, target_url\nhello,https://example.com',
    'title,target_url \nhello,https://example.com',
    'title,target_url\nhello',
    'title,target_url\nhello,https://example.com,extra',
    'title,target_url\nhello,https://example.com\nsecond',
  ])('does not accept duplicate, unknown or missing standard columns (%j)', csv => {
    expect(parseBulkCreateImportCsv(csv)).toStrictEqual({ success: false })
  })

  it('keeps wire and file byte limits after column reordering', () => {
    const requestId = '11111111-1111-4111-8111-111111111111'
    const item = { targetUrl: 'https://example.com', title: '界😀', tags: [] }
    const overhead = new TextEncoder().encode(JSON.stringify({ requestId, items: [item] })).byteLength
    const title = item.title + ' '.repeat(65536 - overhead)
    const wireCsv = 'tags,title,target_url\n[],' + title + ',https://example.com'
    expect(new TextEncoder().encode(JSON.stringify({ requestId, items: [{ ...item, title }] }))).toHaveLength(65536)
    expect(new TextEncoder().encode(wireCsv).length).toBeLessThan(65536)
    expect(parseBulkCreateImportCsv(wireCsv)).toStrictEqual({ success: true, mode: 'metadata', data: [{ targetUrl: 'https://example.com', title, tags: [] }] })
    expect(parseBulkCreateImportCsv(wireCsv.replace(',https://', ' ,https://'))).toStrictEqual({ success: false })

    const start = 'tags,title,target_url\n"', end = '[]",界😀,https://example.com'
    const fileCsv = start + ' '.repeat(65536 - new TextEncoder().encode(start + end).length) + end
    expect(new TextEncoder().encode(fileCsv)).toHaveLength(65536)
    expect(parseBulkCreateImportCsv(fileCsv)).toStrictEqual({ success: true, mode: 'metadata', data: [{ targetUrl: 'https://example.com', title: '界😀', tags: [] }] })
    expect(parseBulkCreateImportCsv(fileCsv + '\n')).toStrictEqual({ success: false })
  })
})
