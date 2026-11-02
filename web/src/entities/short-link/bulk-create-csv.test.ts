import { describe, expect, it } from 'vitest'
import { parseBulkCreateCsv } from './bulk-create-csv'

describe('strict one-column target CSV', () => {
  // A lossy split or URL reserialization changes these exact preview targets.
  it.each(['\n', '\r\n'])('preserves quoted commas, doubled quotes, order and one opening BOM with %j records', newline => {
    expect(parseBulkCreateCsv('\uFEFFtarget_url' + newline + '"https://example.com/a,b"' + newline + '"https://example.org/""literal"""' + newline)).toEqual({ success: true, data: ['https://example.com/a,b', 'https://example.org/"literal"'] })
  })
  it('accepts an unterminated last record and exactly twenty targets', () => {
    const urls = Array.from({ length: 20 }, (_, i) => `https://example.com/${i}`)
    expect(parseBulkCreateCsv('target_url\n' + urls.join('\n'))).toEqual({ success: true, data: urls })
  })
  it.each([
    '', '\uFEFF', 'target_url', 'target_url\n', 'target_url\n\n',
    'Target_URL\nhttps://example.com', ' target_url\nhttps://example.com', '\uFEFF\uFEFFtarget_url\nhttps://example.com',
    'target_url\n https://example.com', 'target_url\nhttps://example.com ',
    'target_url\nhttps://example.com\n\n', 'target_url\nhttps://example.com\r', 'target_url\rhttps://example.com',
    'target_url\n"https://example.com', 'target_url\nhttps://example.com/"x',
    'target_url\n"https://example.com"x', 'target_url\n"https://example.com" ',
    'target_url\nhttps://example.com,', 'target_url,ignored\nhttps://example.com,x',
    'target_url\n"https://example.com/\nnext"', 'target_url\n"https://example.com/\rnext"',
    'target_url\nhttps://example.com/\u0000', 'target_url\nhttps://example.com/中文',
    'target_url\n=HYPERLINK("https://example.com")', 'target_url\nftp://example.com',
    'target_url\nhttps://example.com\nhttps://example.com', 'target_url\n""',
  ])('rejects the whole malformed or invalid input %j', text => {
    expect(parseBulkCreateCsv(text)).toEqual({ success: false })
  })
  it.each(['', '\n'])('rejects the twenty-first target instead of truncating the batch with ending %j', ending => {
    expect(parseBulkCreateCsv('target_url\n' + Array.from({ length: 21 }, (_, i) => `https://example.com/${i}`).join('\n') + ending)).toEqual({ success: false })
  })
  it('rejects a target exceeding the original 2048-byte contract', () => {
    const url = 'https://example.com/' + 'x'.repeat(2030)
    expect(parseBulkCreateCsv('target_url\n' + url)).toEqual({ success: false })
  })
  it('accepts the exact byte budget but rejects one extra byte without partial results', () => {
    const urls = Array.from({ length: 20 }, (_, i) => {
      const prefix = `https://example.com/${i}/`, quotes = i === 0 ? 1231 : 1225
      return prefix + '"'.repeat(quotes) + 'x'.repeat(2048 - prefix.length - quotes)
    })
    // 11 header + 40960 target bytes + 24506 escaped quotes + 40 wrappers + 19 separators.
    const csv = 'target_url\n' + urls.map(url => '"' + url.replaceAll('"', '""') + '"').join('\n')
    expect(new TextEncoder().encode(csv)).toHaveLength(65536)
    expect(parseBulkCreateCsv(csv)).toEqual({ success: true, data: urls })
    expect(parseBulkCreateCsv(csv + '\n')).toEqual({ success: false })
  })
  it('does not misrepresent the existing seventeen-column export as a restorable batch', () => {
    const exported = 'id,short_url,slug,target_url,title,tags,status,redirect_mode,intermediate_delay_seconds,expires_at,password_enabled,max_visits,visits_used,created_at,updated_at,owner_id,owner_username\r\n1,https://s.example/a,a,https://example.com,,,,,,,,,,,,,'
    expect(parseBulkCreateCsv(exported)).toEqual({ success: false })
  })
})
