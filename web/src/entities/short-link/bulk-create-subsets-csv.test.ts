// Subsets must preserve original values and protocols while filling only absent predecessor columns.
import { describe, expect, it } from 'vitest'
import { parseBulkCreateCsv, parseBulkCreateImportCsv, parseBulkCreateImportCsvDetailed } from './bulk-create-csv'

const url = 'https://example.com/a,b'
const cell = (text: string) => '"' + text.replaceAll('"', '""') + '"'
const csv = (names: readonly string[], values: readonly string[]) => names.join(',') + '\n' + values.map(cell).join(',')

describe('CSV standard field subsets', () => {
  it('imports tags without a title column and preserves their raw order and whitespace', () => {
    const text = csv(['tags', 'target_url'], ['[" 工具 ","a,b"]', url])
    expect(parseBulkCreateImportCsv(text)).toStrictEqual({ success: true, mode: 'metadata', data: [{ targetUrl: url, title: '', tags: [' 工具 ', 'a,b'] }] })
    expect(parseBulkCreateCsv(text)).toStrictEqual({ success: false })
  })

  it.each([
    { header: 'custom_slug', value: 'Team86', mode: 'custom-slugs', want: { targetUrl: url, title: '', tags: [], customSlug: 'Team86' } },
    { header: 'redirect_mode', value: 'confirmation', mode: 'redirect-modes', want: { targetUrl: url, title: '', tags: [], customSlug: '', redirectMode: 'confirmation' } },
    { header: 'expires_at', value: '2099-01-01T00:00:00Z', mode: 'expirations', want: { targetUrl: url, title: '', tags: [], customSlug: '', redirectMode: '', expiresAt: '2099-01-01T00:00:00Z' } },
    { header: 'max_visits', value: '12', mode: 'visit-limits', want: { targetUrl: url, title: '', tags: [], customSlug: '', redirectMode: '', expiresAt: '', maxVisits: '12' } },
    { header: 'intermediate_delay_seconds', value: '', mode: 'countdowns', want: { targetUrl: url, title: '', tags: [], customSlug: '', redirectMode: '', expiresAt: '', maxVisits: '', intermediateDelaySeconds: '' } },
  ])('selects the existing protocol from the highest named field ($header)', ({ header, value, mode, want }) => {
    expect(parseBulkCreateImportCsv(csv([header, 'target_url'], [value, url]))).toStrictEqual({ success: true, mode, data: [want] })
  })

  it('requires explicit intermediate mode for a nonempty countdown instead of inferring it', () => {
    expect(parseBulkCreateImportCsv(csv(['target_url', 'intermediate_delay_seconds'], [url, '3']))).toStrictEqual({ success: false })
    expect(parseBulkCreateImportCsv(csv(['intermediate_delay_seconds', 'target_url', 'redirect_mode'], ['3', url, 'intermediate']))).toStrictEqual({
      success: true, mode: 'countdowns', data: [{ targetUrl: url, title: '', tags: [], customSlug: '', redirectMode: 'intermediate', expiresAt: '', maxVisits: '', intermediateDelaySeconds: '3' }],
    })
  })

  it('does not downgrade a higher protocol just because its provided cell is empty', () => {
    expect(parseBulkCreateImportCsv(csv(['max_visits', 'target_url'], ['', url]))).toStrictEqual({ success: true, mode: 'visit-limits', data: [{ targetUrl: url, title: '', tags: [], customSlug: '', redirectMode: '', expiresAt: '', maxVisits: '' }] })
  })

  it.each([
    ['target_url,tags\nhttps://example.com,', undefined],
    ['target_url,tags\nhttps://example.com,null', undefined],
    ['target_url,tags\nhttps://example.com,{}', undefined],
    ['title,tags\ntitle,[]', 'header'],
    ['target_url,target_url\nhttps://example.com,https://example.com', 'header'],
    ['target_url,owner\nhttps://example.com,user', 'header'],
    ['target_url,Tags\nhttps://example.com,[]', 'header'],
    ['target_url, tags\nhttps://example.com,[]', 'header'],
    ['target_url,tags \nhttps://example.com,[]', 'header'],
    ['target_url,max_visits\nhttps://example.com', 'width'],
    ['target_url,max_visits\nhttps://example.com,3,extra', 'width'],
  ] as const)('rejects invalid provided values or shape without repairing them (%s)', (text, issue) => {
    const result = parseBulkCreateImportCsvDetailed(text)
    expect(result.success).toBe(false)
    if (issue) expect(result).toMatchObject({ issue: { kind: issue } })
    expect(parseBulkCreateImportCsv(text)).toStrictEqual({ success: false })
  })

  it('keeps row order and present empty fields distinct from omitted fields', () => {
    const text = 'max_visits,title,target_url\n12, raw 😀 ,https://example.com/first\n,,https://example.com/second'
    expect(parseBulkCreateImportCsv(text)).toStrictEqual({ success: true, mode: 'visit-limits', data: [
      { targetUrl: 'https://example.com/first', title: ' raw 😀 ', tags: [], customSlug: '', redirectMode: '', expiresAt: '', maxVisits: '12' },
      { targetUrl: 'https://example.com/second', title: '', tags: [], customSlug: '', redirectMode: '', expiresAt: '', maxVisits: '' },
    ] })
  })

  const standard = ['target_url', 'title', 'tags', 'custom_slug', 'redirect_mode', 'expires_at', 'max_visits', 'intermediate_delay_seconds']
  const property = ['targetUrl', 'title', 'tags', 'customSlug', 'redirectMode', 'expiresAt', 'maxVisits', 'intermediateDelaySeconds']
  const modes = ['targets', 'titles', 'metadata', 'custom-slugs', 'redirect-modes', 'expirations', 'visit-limits', 'countdowns']
  // Every possible subset containing URL is exercised in normal and reverse order.
  const subsets = Array.from({ length: 128 }, (_, mask) => ({ mask, label: standard.filter((_, index) => index === 0 || (mask & (1 << (index - 1))) !== 0).join(',') }))
  it.each(subsets)('preserves all selected fields and fills only omitted predecessors ($label)', ({ mask }) => {
    const chosen = [0, ...Array.from({ length: 7 }, (_, index) => index + 1).filter(index => (mask & (1 << (index - 1))) !== 0)]
    const last = chosen.at(-1)!
    const values = [url, ' raw 😀 ', '[" 工具 ","a,b"]', 'Team86', 'intermediate', '2099-01-01T00:00:00Z', '12', chosen.includes(4) ? '3' : '']
    const expected: Record<string, unknown> = { targetUrl: url }
    for (let index = 1; index <= last; index++) expected[property[index]!] = index === 2
      ? chosen.includes(index) ? [' 工具 ', 'a,b'] : []
      : chosen.includes(index) ? values[index] : ''
    const want = last === 0 ? { success: true, mode: 'targets', data: [url] } : { success: true, mode: modes[last], data: [expected] }
    for (const order of [chosen, [...chosen].reverse()]) {
      const text = '\uFEFF' + csv(order.map(index => standard[index]!), order.map(index => values[index]!)) + '\r\n'
      expect(parseBulkCreateImportCsv(text)).toStrictEqual(want)
      expect(parseBulkCreateCsv(text)).toStrictEqual(last === 0 ? { success: true, data: [url] } : { success: false })
    }
  })

  it('checks the full expanded wire JSON before admitting a smaller sparse CSV', () => {
    const requestId = '11111111-1111-4111-8111-111111111111'
    const item = { targetUrl: 'https://example.com', title: '界😀', tags: [], customSlug: '', redirectMode: '', expiresAt: '2099-01-01T00:00:00Z' }
    const overhead = new TextEncoder().encode(JSON.stringify({ requestId, items: [item] })).byteLength
    const title = item.title + ' '.repeat(65536 - overhead)
    const body = { requestId, items: [{ ...item, title }] }
    const input = (value: string) => 'expires_at,title,target_url\n2099-01-01T00:00:00Z,' + value + ',https://example.com'
    expect(new TextEncoder().encode(JSON.stringify(body))).toHaveLength(65536)
    expect(new TextEncoder().encode(input(title)).length).toBeLessThan(65536)
    expect(parseBulkCreateImportCsv(input(title))).toStrictEqual({ success: true, mode: 'expirations', data: body.items })
    expect(new TextEncoder().encode(JSON.stringify({ requestId, items: [{ ...item, title: title + ' ' }] }))).toHaveLength(65537)
    expect(parseBulkCreateImportCsv(input(title + ' '))).toStrictEqual({ success: false })
  })

  it('keeps the raw file boundary even when the parsed tags and default title are small', () => {
    const start = 'tags,target_url\n"', end = '[]",https://example.com'
    const text = start + ' '.repeat(65536 - new TextEncoder().encode(start + end).length) + end
    expect(new TextEncoder().encode(text)).toHaveLength(65536)
    expect(parseBulkCreateImportCsv(text)).toStrictEqual({ success: true, mode: 'metadata', data: [{ targetUrl: 'https://example.com', title: '', tags: [] }] })
    expect(parseBulkCreateImportCsv(text + '\n')).toStrictEqual({ success: false })
  })
})
