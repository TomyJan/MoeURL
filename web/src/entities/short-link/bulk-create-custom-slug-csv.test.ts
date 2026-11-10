import { describe, expect, it } from 'vitest'
import { parseBulkCreateCsv, parseBulkCreateImportCsv } from './bulk-create-csv'

describe('fixed four-column CSV custom short codes', () => {
  it('accepts exactly 65536 UTF-8 file bytes and rejects the next byte before replacing a draft', () => {
    const prefix = '\uFEFFtarget_url,title,tags,custom_slug\r\nhttps://example.com,😀,['
    const suffix = '],Team56\r\n'
    const text = prefix + ' '.repeat(65536 - new TextEncoder().encode(prefix + suffix).byteLength) + suffix
    expect(new TextEncoder().encode(text).byteLength).toBe(65536)
    expect(parseBulkCreateImportCsv(text)).toEqual({ success: true, mode: 'custom-slugs', data: [
      { targetUrl: 'https://example.com', title: '😀', tags: [], customSlug: 'Team56' },
    ] })
    expect(parseBulkCreateImportCsv(text.replace('],Team56', ' ],Team56'))).toEqual({ success: false })
  })

  it('rejects malformed JSON tag text in the fourth protocol', () => {
    expect(parseBulkCreateImportCsv('target_url,title,tags,custom_slug\nhttps://example.com,,[,Team56')).toEqual({ success: false })
  })
  // Dropping the fourth column or normalizing raw text before preview must break this actual import.
  it.each(['\n', '\r\n'])('preserves raw metadata and custom code intent with %j', newline => {
    const text = '\uFEFFtarget_url,title,tags,custom_slug' + newline
      + 'https://example.com, raw ,"[""　工具　"",""a,b""]",TeamDocs56' + newline
      + 'https://example.org,,[],' + newline
    expect(parseBulkCreateImportCsv(text)).toEqual({ success: true, mode: 'custom-slugs', data: [
      { targetUrl: 'https://example.com', title: ' raw ', tags: ['　工具　', 'a,b'], customSlug: 'TeamDocs56' },
      { targetUrl: 'https://example.org', title: '', tags: [], customSlug: '' },
    ] })
    expect(parseBulkCreateCsv(text)).toEqual({ success: false })
  })

  it('accepts twenty rows while rejecting normalized duplicate requested short codes', () => {
    const rows = Array.from({ length: 20 }, (_, i) => `https://example.com/${i},,[],Code${i}`)
    const text = 'target_url,title,tags,custom_slug\n' + rows.join('\n')
    expect(parseBulkCreateImportCsv(text)).toEqual({ success: true, mode: 'custom-slugs', data: Array.from({ length: 20 }, (_, i) => ({ targetUrl: `https://example.com/${i}`, title: '', tags: [], customSlug: `Code${i}` })) })
    expect(parseBulkCreateImportCsv(text + '\nhttps://example.org/extra,,[],Extra56')).toEqual({ success: false })
    expect(parseBulkCreateImportCsv(text.replace('Code1\n', 'code0\n'))).toEqual({ success: false })
  })

  it.each(['ab', 'a'.repeat(33), ' Team56', 'Team56 ', 'team-docs', 'team_docs', 'a/b', '％61bc', 'ｔｅａｍ', 'ab\u0000c'])('rejects invalid raw short code %j without silently falling back to random', slug => {
    expect(parseBulkCreateImportCsv('target_url,title,tags,custom_slug\nhttps://example.com,,[],' + slug)).toEqual({ success: false })
  })

  it('keeps an empty code random and leaves server-reserved names for the authoritative response', () => {
    expect(parseBulkCreateImportCsv('target_url,title,tags,custom_slug\nhttps://example.com,,[],LOGIN')).toEqual({ success: true, mode: 'custom-slugs', data: [{ targetUrl: 'https://example.com', title: '', tags: [], customSlug: 'LOGIN' }] })
  })

  it.each(['Team56\n', 'Team56\r\n', 'Team56\r', 'Team56\u2028'])('rejects quoted line separators in a raw short code %j', customSlug => {
    expect(parseBulkCreateImportCsv('target_url,title,tags,custom_slug\nhttps://example.com,,[],"' + customSlug + '"')).toEqual({ success: false })
  })

  it.each(['target_url,title,custom_slug,tags\nhttps://example.com,,Team56,[]', 'target_url,title,tags,custom_slug\nhttps://example.com,,[]', 'target_url,title,tags,custom_slug\nhttps://example.com,,[],Team56,extra', 'target_url,title,tags,custom_slug\nhttps://example.com,,null,Team56'])('rejects malformed four-column structure %j', text => {
    expect(parseBulkCreateImportCsv(text)).toEqual({ success: false })
  })

  it('bounds the complete four-column future request independently of the file size', () => {
    const requestId = '11111111-1111-4111-8111-111111111111'
    const item = { targetUrl: 'https://example.com', title: '😀', tags: [] as string[], customSlug: 'Team56' }
    const title = item.title + ' '.repeat(65536 - new TextEncoder().encode(JSON.stringify({ requestId, items: [item] })).byteLength)
    const text = `target_url,title,tags,custom_slug\nhttps://example.com,${title},[],Team56`
    expect(new TextEncoder().encode(text).byteLength).toBeLessThan(65536)
    expect(parseBulkCreateImportCsv(text)).toEqual({ success: true, mode: 'custom-slugs', data: [{ ...item, title }] })
    expect(parseBulkCreateImportCsv(text.replace(',[],Team56', ' ,[],Team56'))).toEqual({ success: false })
  })
})
