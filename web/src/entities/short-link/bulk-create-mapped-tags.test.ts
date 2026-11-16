// Dropping the explicit tags selection or downgrading empty arrays must change these exact results.
import { describe, expect, it } from 'vitest'
import { inspectBulkCreateCsvMapping, parseBulkCreateMappedCsv } from './bulk-create-csv-mapping'
import { parseBulkCreateImportCsv } from './bulk-create-csv'

const cell = (value: string) => '"' + value.replaceAll('"', '""') + '"'
const record = (values: readonly string[]) => values.map(cell).join(',')
const csv = (headers: readonly string[], rows: readonly (readonly string[])[]) => [record(headers), ...rows.map(record)].join('\r\n')
const targetUrl = 'https://example.com/mapped-tags'

describe('explicit tags column mapping', () => {
  it.each([null, 1])('imports only the selected URL, optional title %s and JSON tags through metadata', title => {
    const text = csv(['Address', 'Name', 'Categories', 'Private'], [[targetUrl, '  Literal title  ', '["工程","docs"]', 'secret-not-for-upload']])
    // A variable keeps this valid against the old structural input type: the RED must be behavioral.
    const columns = { target: 0, title, tags: 2 }
    expect(parseBulkCreateMappedCsv(text, columns)).toEqual({ success: true, mode: 'metadata', data: [{ targetUrl, title: title === null ? '' : '  Literal title  ', tags: ['工程', 'docs'] }] })
  })

  it('keeps the old exact targets/titles results when tags are omitted or explicitly null', () => {
    const text = csv(['Address', 'Name', 'Categories'], [[targetUrl, 'Name', 'not JSON and deliberately ignored']])
    for (const tags of [undefined, null]) {
      const urlOnly = { target: 0, title: null, tags }, titled = { target: 0, title: 1, tags }
      expect(parseBulkCreateMappedCsv(text, urlOnly)).toEqual({ success: true, mode: 'targets', data: [targetUrl] })
      expect(parseBulkCreateMappedCsv(text, titled)).toEqual({ success: true, mode: 'titles', data: [{ targetUrl, title: 'Name' }] })
    }
  })

  it('treats an explicitly selected empty JSON array as metadata, never as URL-only input', () => {
    const columns = { target: 0, title: null, tags: 1 }
    expect(parseBulkCreateMappedCsv(csv(['Address', 'Category'], [[targetUrl, '[]']]), columns)).toEqual({ success: true, mode: 'metadata', data: [{ targetUrl, title: '', tags: [] }] })
  })

  it.each([
    '', 'docs,news', 'null', '{}', '"docs"', '[null]', '[1]', '[""]', '["same","same"]', '["same"," same "]', '["bad\\u0000tag"]',
    JSON.stringify(Array.from({ length: 11 }, (_, i) => String(i))), JSON.stringify(['界'.repeat(33)]), '["\\ud800"]',
  ])('refuses invalid selected JSON tags %j without exposing selected or ignored cells', tags => {
    const columns = { target: 0, title: null, tags: 1 }
    expect(parseBulkCreateMappedCsv(csv(['Address', 'Category', 'Private'], [[targetUrl, tags, 'private-value']]), columns)).toEqual({ success: false })
  })

  it('retains literal valid Unicode tags and accepts the original ten-tag and 32-code-point limits', () => {
    const tags = ['😀'.repeat(32), ...Array.from({ length: 9 }, (_, i) => '  tag-' + i + '  ')]
    const columns = { target: 0, title: null, tags: 1 }
    expect(parseBulkCreateMappedCsv(csv(['Address', 'Category'], [[targetUrl, JSON.stringify(tags)]]), columns)).toEqual({ success: true, mode: 'metadata', data: [{ targetUrl, title: '', tags }] })
  })

  it.each([-1, 0.5, 3, NaN, Infinity, 0, 1])('refuses invalid or already-selected tags index %s', tags => {
    const columns = { target: 0, title: 1, tags }
    expect(parseBulkCreateMappedCsv(csv(['Address', 'Name', 'Category'], [[targetUrl, 'Name', '[]']]), columns)).toEqual({ success: false })
  })

  it.each([[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]])('projects original cells without overwriting them for order %j', (target, title, tags) => {
    const values = ['', '', '']; values[target!] = targetUrl; values[title!] = 'Literal title'; values[tags!] = '["docs"]'
    const columns = { target: target!, title: title!, tags: tags! }
    expect(parseBulkCreateMappedCsv(csv(['Same', 'Same', ''], [values]), columns)).toEqual({ success: true, mode: 'metadata', data: [{ targetUrl, title: 'Literal title', tags: ['docs'] }] })
  })

  it('retains row order, quoted data and the original twenty-row limit', () => {
    const rows = Array.from({ length: 20 }, (_, i) => ['https://example.com/' + i, JSON.stringify(['one,"quoted"', 'two'])])
    const columns = { target: 0, title: null, tags: 1 }
    expect(parseBulkCreateMappedCsv('\uFEFF' + csv(['Address', 'Category'], rows), columns)).toEqual({ success: true, mode: 'metadata', data: rows.map(([url]) => ({ targetUrl: url, title: '', tags: ['one,"quoted"', 'two'] })) })
    expect(parseBulkCreateMappedCsv(csv(['Address', 'Category'], [...rows, ['https://example.com/20', '[]']]), columns)).toEqual({ success: false })
  })

  it('enforces exactly 65536 complete metadata wire bytes independently of the CSV cap', () => {
    const requestId = '11111111-1111-4111-8111-111111111111', tags = ['工程']
    const wire = (title: string) => new TextEncoder().encode(JSON.stringify({ requestId, items: [{ targetUrl, title, tags }] })).byteLength
    const title = '界' + ' '.repeat(65536 - wire('界'))
    const text = (value: string) => csv(['Address', 'Name', 'Category'], [[targetUrl, value, JSON.stringify(tags)]])
    const columns = { target: 0, title: 1, tags: 2 }
    expect(wire(title)).toBe(65536); expect(wire(title + ' ')).toBe(65537)
    expect(new TextEncoder().encode(text(title + ' ')).byteLength).toBeLessThan(65536)
    expect(parseBulkCreateMappedCsv(text(title), columns)).toEqual({ success: true, mode: 'metadata', data: [{ targetUrl, title, tags }] })
    expect(parseBulkCreateMappedCsv(text(title + ' '), columns)).toEqual({ success: false })
  })

  it('does not weaken strict standard headers or scan private data into the inspection result', () => {
    const text = csv(['Address', 'Category', 'Private'], [[targetUrl, '["docs"]', '<script>never-upload</script>']])
    expect(inspectBulkCreateCsvMapping(text)).toEqual({ success: true, headers: ['Address', 'Category', 'Private'] })
    expect(parseBulkCreateImportCsv(text)).toEqual({ success: false })
    const columns = { target: 0, title: null, tags: 1 }
    expect(JSON.stringify(parseBulkCreateMappedCsv(text, columns))).not.toMatch(/never-upload|script|Private|Category/)
  })
})
