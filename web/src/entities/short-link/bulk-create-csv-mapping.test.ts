import { describe, expect, it } from 'vitest'
import { inspectBulkCreateCsvMapping, parseBulkCreateMappedCsv } from './bulk-create-csv-mapping'
import { parseBulkCreateImportCsv, parseBulkCreateImportCsvDetailed } from './bulk-create-csv'

describe('explicit CSV column mapping', () => {
  const csv = '备注,地址,名称\nsecret,https://example.com/a,Title'

  // Rejecting arbitrary header names rather than following the selected indices breaks these imports.
  it('accepts explicit custom URL and title columns', () => {
    expect(parseBulkCreateMappedCsv(csv, { target: 1, title: 2 })).toEqual({
      success: true, mode: 'titles', data: [{ targetUrl: 'https://example.com/a', title: 'Title' }],
    })
  })

  it('accepts URL-only mapping without metadata columns', () => {
    expect(parseBulkCreateMappedCsv(csv, { target: 1, title: null })).toEqual({
      success: true, mode: 'targets', data: ['https://example.com/a'],
    })
  })

  it('inspects header positions without exposing data records', () => {
    expect(inspectBulkCreateCsvMapping(csv)).toEqual({ success: true, headers: ['备注', '地址', '名称'] })
  })

  it('distinguishes empty and duplicate headers by position and preserves raw selected text', () => {
    const value = ',,ignored\nhttps://example.com/a,"  Name ""quoted""  ",secret'
    expect(inspectBulkCreateCsvMapping(value)).toEqual({ success: true, headers: ['', '', 'ignored'] })
    expect(parseBulkCreateMappedCsv(value, { target: 0, title: 1 })).toEqual({
      success: true, mode: 'titles', data: [{ targetUrl: 'https://example.com/a', title: '  Name "quoted"  ' }],
    })
    expect(parseBulkCreateMappedCsv('name,address\n,https://example.com/a', { target: 1, title: 0 })).toEqual({
      success: true, mode: 'titles', data: [{ targetUrl: 'https://example.com/a', title: '' }],
    })
  })

  it('ignores unselected cells instead of treating them as metadata, HTML or write instructions', () => {
    const value = 'secret,name,url\n"<script>private\npassword</script>",Title,https://example.com/a'
    const result = parseBulkCreateMappedCsv(value, { target: 2, title: null })
    expect(result).toEqual({ success: true, mode: 'targets', data: ['https://example.com/a'] })
    expect(JSON.stringify(result)).not.toMatch(/private|password|script|Title/)
    expect(inspectBulkCreateCsvMapping(value)).toEqual({ success: true, headers: ['secret', 'name', 'url'] })
  })

  it.each(['\n', '\r\n'])('accepts one BOM and quoted header delimiters with %j', newline => {
    const value = `\uFEFF"address, URL",name${newline}https://example.com/a,Title${newline}`
    expect(inspectBulkCreateCsvMapping(value)).toEqual({ success: true, headers: ['address, URL', 'name'] })
    expect(parseBulkCreateMappedCsv(value, { target: 0, title: null })).toEqual({ success: true, mode: 'targets', data: ['https://example.com/a'] })
  })

  it.each([null, -1, 1.5, 3, NaN, Infinity])('rejects an invalid URL column %s', target => {
    expect(parseBulkCreateMappedCsv(csv, { target, title: null })).toEqual({ success: false })
  })

  it.each([-1, 1.5, 3, NaN, Infinity, 1])('rejects an invalid or duplicate title column %s', title => {
    expect(parseBulkCreateMappedCsv(csv, { target: 1, title })).toEqual({ success: false })
  })

  it('accepts eight columns by index and rejects nine', () => {
    const eight = 'x,x,x,x,x,x,x,x\na,b,c,d,e,f,g,https://example.com/a'
    expect(parseBulkCreateMappedCsv(eight, { target: 7, title: null })).toEqual({ success: true, mode: 'targets', data: ['https://example.com/a'] })
    expect(inspectBulkCreateCsvMapping('x,' + eight)).toEqual({ success: false, issue: { kind: 'header', record: 1 } })
    expect(inspectBulkCreateCsvMapping('a,b\n1,2,3,4,5,6,7,8,9')).toEqual({ success: false, issue: { kind: 'width', record: 2 } })
  })

  it.each(['', '\n'])('accepts twenty data records and rejects twenty-one even at EOF %j', ending => {
    const twenty = 'url\n' + Array.from({ length: 20 }, (_, i) => `https://example.com/${i}`).join('\n')
    const result = parseBulkCreateMappedCsv(twenty + ending, { target: 0, title: null })
    expect(result.success && result.data.length).toBe(20)
    const excess = twenty + '\nhttps://example.com/20' + ending
    expect(inspectBulkCreateCsvMapping(excess)).toEqual({ success: false })
    expect(parseBulkCreateMappedCsv(excess, { target: 0, title: null })).toEqual({ success: false })
  })

  it.each(['', '\uFEFF', 'url', 'url\n', '\uFEFF\uFEFFurl\nhttps://example.com', '\uD800\nhttps://example.com'])('rejects missing data, repeated BOM or invalid Unicode %j', value => {
    expect(inspectBulkCreateCsvMapping(value)).toEqual({ success: false })
    expect(parseBulkCreateMappedCsv(value, { target: 0, title: null })).toEqual({ success: false })
  })

  it.each([
    { value: 'url\n"unfinished', kind: 'syntax', record: 2 },
    { value: 'url\nbare"quote', kind: 'syntax', record: 2 },
    { value: 'url\n"closed"tail', kind: 'syntax', record: 2 },
    { value: 'url\rbroken', kind: 'syntax', record: 1 },
    { value: 'url\nx\rbroken', kind: 'syntax', record: 2 },
    { value: 'url,ignored\nhttps://example.com/a,"two\nphysical lines"\nhttps://example.com/b', kind: 'width', record: 3 },
  ])('reports bounded structure without cell values: $kind/$record', ({ value, kind, record }) => {
    expect(inspectBulkCreateCsvMapping(value)).toEqual({ success: false, issue: { kind, record } })
    expect(parseBulkCreateMappedCsv(value, { target: 0, title: null })).toEqual({ success: false })
  })

  it.each(['', ' https://example.com', 'ftp://example.com', 'https://example.com/界', 'https://example.com/' + 'x'.repeat(2048)])('validates the chosen target rather than the ignored cells: %s', url => {
    expect(parseBulkCreateMappedCsv('url,ignored\n' + url + ',https://valid.example', { target: 0, title: null })).toEqual({ success: false })
  })

  it('rejects duplicate selected targets and invalid selected titles', () => {
    expect(parseBulkCreateMappedCsv('url\nhttps://example.com/a\nhttps://example.com/a', { target: 0, title: null })).toEqual({ success: false })
    expect(parseBulkCreateMappedCsv('url,name\nhttps://example.com/a,' + 'x'.repeat(1001), { target: 0, title: 1 })).toEqual({ success: false })
  })

  it('enforces the UTF-8 file cap even when the oversized field would be ignored', () => {
    const prefix = 'url,ignored\nhttps://example.com/a,'
    const value = prefix + 'x'.repeat(65536 - new TextEncoder().encode(prefix).byteLength)
    expect(parseBulkCreateMappedCsv(value, { target: 0, title: null })).toEqual({ success: true, mode: 'targets', data: ['https://example.com/a'] })
    expect(inspectBulkCreateCsvMapping(value + 'x')).toEqual({ success: false })
    expect(parseBulkCreateMappedCsv(value + 'x', { target: 0, title: null })).toEqual({ success: false })
  })

  it('checks the complete titles wire budget independently from the CSV file budget', () => {
    const targetUrl = 'https://example.com/a', requestId = '11111111-1111-4111-8111-111111111111'
    const wire = (title: string) => new TextEncoder().encode(JSON.stringify({ requestId, items: [{ targetUrl, title }] })).byteLength
    const title = '😀' + ' '.repeat(65536 - wire('😀'))
    const value = `u,t\n${targetUrl},${title}`
    expect(wire(title)).toBe(65536)
    expect(wire(title + ' ')).toBe(65537)
    expect(new TextEncoder().encode(value + ' ').byteLength).toBeLessThan(65536)
    expect(parseBulkCreateMappedCsv(value, { target: 0, title: 1 })).toEqual({ success: true, mode: 'titles', data: [{ targetUrl, title }] })
    expect(parseBulkCreateMappedCsv(value + ' ', { target: 0, title: 1 })).toEqual({ success: false })
  })

  // Omitting the targets JSON budget accepts this CSV but the server rejects the resulting write.
  it('accepts exactly 65536 targets wire bytes and refuses the next byte before replacing a draft', () => {
    const requestId = '11111111-1111-4111-8111-111111111111'
    const targets = [...Array.from({ length: 19 }, (_, index) => 'https://example.com/' + '"'.repeat(1604) + index), 'https://example.com/end' + '"'.repeat(2013)]
    const csv = (values: string[]) => 'address\n' + values.map(value => '"' + value.replaceAll('"', '""') + '"').join('\n')
    const oversized = [...targets.slice(0, 19), targets[19]! + 'a']
    expect(new TextEncoder().encode(JSON.stringify({ requestId, targetUrls: targets })).byteLength).toBe(65536)
    expect(new TextEncoder().encode(JSON.stringify({ requestId, targetUrls: oversized })).byteLength).toBe(65537)
    expect(new TextEncoder().encode(csv(targets)).byteLength).toBe(65476)
    expect(new TextEncoder().encode(csv(oversized)).byteLength).toBe(65477)
    expect(parseBulkCreateMappedCsv(csv(targets), { target: 0, title: null })).toEqual({ success: true, mode: 'targets', data: targets })
    expect(parseBulkCreateMappedCsv(csv(oversized), { target: 0, title: null })).toEqual({ success: false })
  })

  it('rejects targets whose JSON escaping exceeds the wire cap although the CSV is small', () => {
    const targets = Array.from({ length: 20 }, (_, index) => 'https://example.com/' + '\\'.repeat(1700) + index)
    const value = 'address\n' + targets.join('\n')
    expect(new TextEncoder().encode(value).byteLength).toBe(34457)
    expect(new TextEncoder().encode(JSON.stringify({ requestId: '11111111-1111-4111-8111-111111111111', targetUrls: targets })).byteLength).toBe(68557)
    expect(parseBulkCreateMappedCsv(value, { target: 0, title: null })).toEqual({ success: false })
  })

  it('keeps strict legacy imports independent instead of silently mapping unknown columns', () => {
    expect(parseBulkCreateImportCsv(csv)).toEqual({ success: false })
    expect(parseBulkCreateImportCsvDetailed('unknown\n"unfinished')).toEqual({ success: false, issue: { kind: 'syntax', record: 2 } })
    const late = 'unknown\n' + Array(20).fill('x').join('\n') + '\nextra'
    expect(parseBulkCreateImportCsvDetailed(late)).toEqual({ success: false, issue: { kind: 'header', record: 1 } })
  })
})
