import { describe, expect, it } from 'vitest'
import { parseBulkCreateCsv, parseBulkCreateImportCsv, parseBulkCreateImportCsvDetailed as detailed } from './bulk-create-csv'
import { scanBulkCreateCsv } from './bulk-create-csv-scan'

describe('bounded CSV structure diagnostics', () => {
  it.each([
    ['unknown\nhttps://secret.invalid', 'header', 1],
    ['target_url\n"secret', 'syntax', 2],
    ['target_url,title\nhttps://example.com', 'width', 2],
  ])('locates the structural failure in %j', (text, kind, record) => {
    expect(detailed(String(text))).toEqual({ success: false, issue: { kind, record } })
  })

  it.each(['', '\uFEFF', 'TARGET_URL\nhttps://example.com', 'title,target_url,title\nx,x,x', 'target_url,title,tags,custom_slug,redirect_mode,expires_at,max_visits,intermediate_delay_seconds,extra\nx'])('identifies only a trusted header issue for %j', text => {
    expect(detailed(text)).toStrictEqual({ success: false, issue: { kind: 'header', record: 1 } })
  })

  it.each(['https://example.com/"raw', '"https://example.com"x', '"https://example.com', 'https://example.com\r'])('identifies syntax without echoing %j', row => {
    expect(detailed('target_url\n' + row)).toStrictEqual({ success: false, issue: { kind: 'syntax', record: 2 } })
  })

  it('reports logical records after quoted newlines', () => {
    expect(detailed('target_url,title\r\nhttps://example.com,"line1\r\nline2\nline3"\r\nhttps://example.org')).toStrictEqual({ success: false, issue: { kind: 'width', record: 3 } })
  })

  it('preserves scan-before-header rejection order', () => {
    expect(detailed('unknown\nhttps://secret.invalid\n"secret')).toStrictEqual({ success: false, issue: { kind: 'syntax', record: 3 } })
    expect(detailed('unknown,title\nhttps://secret.invalid')).toStrictEqual({ success: false, issue: { kind: 'header', record: 1 } })
  })

  it('reports the first bad width before business validation', () => {
    expect(detailed('target_url,title\nnot-a-url,ok\nhttps://example.com\nhttps://example.org')).toStrictEqual({ success: false, issue: { kind: 'width', record: 3 } })
    expect(detailed('target_url\nx,x,x,x,x,x,x,x,x')).toStrictEqual({ success: false, issue: { kind: 'width', record: 2 } })
    expect(detailed('target_url,title\n\n')).toStrictEqual({ success: false, issue: { kind: 'width', record: 2 } })
  })

  it('bounds the last diagnostic at record21', () => {
    const beforeLast = 'target_url\n' + Array.from({ length: 19 }, (_, i) => `https://example.com/${i}\n`).join('')
    expect(detailed(beforeLast + '"secret')).toStrictEqual({ success: false, issue: { kind: 'syntax', record: 21 } })
    expect(detailed(beforeLast + 'https://example.org,extra')).toStrictEqual({ success: false, issue: { kind: 'width', record: 21 } })
  })

  it.each(['"secret', 'https://example.org,extra', 'a,b,c,d,e,f,g,h,i', 'https://example.org\r', 'https://example.org\n'])('keeps generic failures beyond record21 with %j', last => {
    const text = 'target_url\n' + Array.from({ length: 20 }, (_, i) => `https://example.com/${i}\n`).join('') + last
    expect(detailed(text)).toStrictEqual({ success: false })
  })

  it.each(['target_url', 'target_url\n', 'target_url\nftp://example.com', 'target_url\nhttps://example.com/\uD800', 'target_url,title\nhttps://example.com,"line1\rline2"', 'target_url,title,tags\nhttps://example.com,title,not-json', 'target_url,title,tags\nhttps://example.com,title,{}'])('keeps non-structure failures generic for %j', text => {
    expect(detailed(text)).toStrictEqual({ success: false })
  })

  it('checks Unicode and total bytes before scanning structure', () => {
    expect(detailed('unknown\n"secret\uD800')).toStrictEqual({ success: false })
    expect(detailed('unknown\n"' + 'x'.repeat(65536))).toStrictEqual({ success: false })
  })

  it('preserves the exact65536-byte file boundary while refusing an oversized complete request', () => {
    const urls = Array.from({ length: 20 }, (_, i) => {
      const prefix = `https://example.com/${i}/`, quotes = i === 0 ? 1231 : 1225
      return prefix + '"'.repeat(quotes) + 'x'.repeat(2048 - prefix.length - quotes)
    })
    const csv = 'target_url\n' + urls.map(url => '"' + url.replaceAll('"', '""') + '"').join('\n')
    expect(new TextEncoder().encode(csv)).toHaveLength(65536)
    expect(scanBulkCreateCsv(csv)).toStrictEqual({ success: true, records: [['target_url'], ...urls.map(url => [url])] })
    expect(new TextEncoder().encode(JSON.stringify({ requestId: '11111111-1111-4111-8111-111111111111', targetUrls: urls }))).toHaveLength(65593)
    expect(detailed(csv)).toStrictEqual({ success: false })
    expect(parseBulkCreateCsv(csv)).toStrictEqual({ success: false })
    expect(scanBulkCreateCsv(csv + '\n')).toStrictEqual({ success: false })
    expect(detailed(csv + '\n')).toStrictEqual({ success: false })
  })

  it.each([1, 2, 3, 4, 5, 6, 7, 8])('preserves literal reversed success for format%i with BOM and CRLF', width => {
    const columns = ['target_url', 'title', 'tags', 'custom_slug', 'redirect_mode', 'expires_at', 'max_visits', 'intermediate_delay_seconds']
    const values = ['https://example.com/literal', ' raw 😀 ', '[]', 'Team82', 'intermediate', '2099-01-01T00:00:00Z', '12', '3']
    const modes = ['targets', 'titles', 'metadata', 'custom-slugs', 'redirect-modes', 'expirations', 'visit-limits', 'countdowns']
    const names = ['targetUrl', 'title', 'tags', 'customSlug', 'redirectMode', 'expiresAt', 'maxVisits', 'intermediateDelaySeconds']
    const item = Object.fromEntries(names.slice(0, width).map((name, index) => [name, index === 2 ? [] : values[index]]))
    const csv = '\uFEFF' + columns.slice(0, width).reverse().join(',') + '\r\n' + values.slice(0, width).reverse().map(value => '"' + value + '"').join(',') + '\r\n'
    const expected = { success: true, mode: modes[width - 1], data: width === 1 ? [values[0]] : [item] }
    expect(detailed(csv)).toStrictEqual(expected)
    expect(parseBulkCreateImportCsv(csv)).toStrictEqual(expected)
    expect(parseBulkCreateCsv(csv)).toStrictEqual(width === 1 ? { success: true, data: [values[0]] } : { success: false })
  })

  it.each(['unknown\nsecret', 'target_url\n"secret', 'target_url,title\nhttps://example.com', 'target_url\nftp://example.com'])('keeps both legacy failures exact for %j', text => {
    expect(parseBulkCreateImportCsv(text)).toStrictEqual({ success: false })
    expect(parseBulkCreateCsv(text)).toStrictEqual({ success: false })
  })

  it('never includes secrets, URLs or markup in any diagnostic', () => {
    for (const text of ['<img src=x onerror=secret>\nhttps://secret.invalid', 'target_url\n"https://secret.invalid', 'target_url,title\nhttps://secret.invalid']) {
      const result = detailed(text)
      expect(result.success).toBe(false)
      if (result.success) throw new Error('Expected a rejected file')
      expect(Object.keys(result).sort()).toStrictEqual(['issue', 'success'])
      expect(Object.keys(result.issue!).sort()).toStrictEqual(['kind', 'record'])
      expect(JSON.stringify(result)).not.toMatch(/secret|https|img|onerror/)
    }
  })
})
