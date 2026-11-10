import { describe, expect, it } from 'vitest'
import { parseBulkCreateCsv, parseBulkCreateImportCsv } from './bulk-create-csv'

describe('fixed CSV title and JSON tag import', () => {
  // Missing three-column support, lossy tag splitting or eager trimming must fail this visible draft contract.
  it.each(['\n', '\r\n'])('preserves raw title and ordered comma/quote/Unicode tag strings with %j', newline => {
    const csv = '\uFEFFtarget_url,title,tags' + newline
      + 'https://example.com, raw ,"[""　工具　"",""a,b"",""say \\""hi\\""""]"' + newline
      + 'https://example.org,,[]' + newline
    expect(parseBulkCreateImportCsv(csv)).toEqual({ success: true, mode: 'metadata', data: [
      { targetUrl: 'https://example.com', title: ' raw ', tags: ['　工具　', 'a,b', 'say "hi"'] },
      { targetUrl: 'https://example.org', title: '', tags: [] },
    ] })
    expect(parseBulkCreateCsv(csv)).toEqual({ success: false })
  })

  it('accepts twenty distinct targets and ten ordered case-sensitive tags of exactly32 code points', () => {
    const tags = ['界'.repeat(32), 'a', 'A', '3', '4', '5', '6', '7', '8', '9']
    const tagCell = '"' + JSON.stringify(tags).replaceAll('"', '""') + '"'
    const csv = 'target_url,title,tags\n' + Array.from({ length: 20 }, (_, i) => `https://example.com/${i},title,${tagCell}`).join('\n')
    const result = parseBulkCreateImportCsv(csv)
    expect(result).toEqual({ success: true, mode: 'metadata', data: Array.from({ length: 20 }, (_, i) => ({ targetUrl: `https://example.com/${i}`, title: 'title', tags })) })
    expect(parseBulkCreateImportCsv(csv + '\nhttps://example.com/extra,title,[]')).toEqual({ success: false })
  })

  it.each(['', 'null', '{}', '"tag"', '[null]', '[1]', '[[]]', '[{}]', '[""]', '["　 "]', '["a"," a "]', '["a\\nb"]', '["' + '界'.repeat(33) + '"]', '["1","2","3","4","5","6","7","8","9","10","11"]', '["\\ud800"]', '["\\udfff"]', '["\\ud800\\u0041"]'])('rejects the whole file for invalid tags JSON %j', tags => {
    const cell = '"' + tags.replaceAll('"', '""') + '"'
    expect(parseBulkCreateImportCsv('target_url,title,tags\nhttps://example.com,title,' + cell)).toEqual({ success: false })
  })

  it.each([
    'target_url,tags,title\nhttps://example.com,[],title',
    'target_url,title,Tags\nhttps://example.com,title,[]',
    'target_url,title,tags\nhttps://example.com,title',
    'target_url,title,tags\nhttps://example.com,title,[],extra',
    'target_url,title,tags\nhttps://example.com,title,[]\n',
  ])('keeps strict header/column and record semantics for %j', csv => {
    const result = parseBulkCreateImportCsv(csv)
    expect(result).toEqual(csv.endsWith(',[]\n') ? { success: true, mode: 'metadata', data: [{ targetUrl: 'https://example.com', title: 'title', tags: [] }] } : { success: false })
  })

  it('validates the full future JSON body before replacing a draft, preserving raw whitespace', () => {
    const requestId = '11111111-1111-4111-8111-111111111111'
    const overhead = new TextEncoder().encode(JSON.stringify({ requestId, items: [{ targetUrl: 'https://example.com', title: '', tags: [] }] })).byteLength
    const title = ' '.repeat(65536 - overhead)
    const csv = `target_url,title,tags\nhttps://example.com,${title},[]`
    expect(new TextEncoder().encode(csv).byteLength).toBeLessThan(65536)
    expect(parseBulkCreateImportCsv(csv)).toEqual({ success: true, mode: 'metadata', data: [{ targetUrl: 'https://example.com', title, tags: [] }] })
    expect(parseBulkCreateImportCsv(csv.replace(',[]', ' ,[]'))).toEqual({ success: false })
  })

  it('preserves legitimate supplementary/replacement characters and literal escaped text', () => {
    expect(parseBulkCreateImportCsv('target_url,title,tags\nhttps://example.com,😀,"[""\\ud83d\\ude00"",""�"",""\\\\ud800""]"')).toEqual({ success: true, mode: 'metadata', data: [{ targetUrl: 'https://example.com', title: '😀', tags: ['😀', '�', '\\ud800'] }] })
  })
})
