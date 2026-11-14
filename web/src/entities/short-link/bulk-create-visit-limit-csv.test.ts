import { describe, expect, it } from 'vitest'
import { parseBulkCreateImportCsv } from './bulk-create-csv'

const header = 'target_url,title,tags,custom_slug,redirect_mode,expires_at,max_visits'

describe('seven-column visit-limit CSV', () => {
  it('preserves empty, one and int32 maximum as raw strings in the independent seventh protocol', () => {
    const text = header + '\nhttps://example.com/unlimited, raw ,[],Team76,direct,,\nhttps://example.com/once,,[],,intermediate,,1\nhttps://example.com/campaign,,[],,confirmation,2099-01-01T00:00:00Z,2147483647'
    expect(parseBulkCreateImportCsv(text)).toEqual({ success: true, mode: 'visit-limits', data: [
      { targetUrl: 'https://example.com/unlimited', title: ' raw ', tags: [], customSlug: 'Team76', redirectMode: 'direct', expiresAt: '', maxVisits: '' },
      { targetUrl: 'https://example.com/once', title: '', tags: [], customSlug: '', redirectMode: 'intermediate', expiresAt: '', maxVisits: '1' },
      { targetUrl: 'https://example.com/campaign', title: '', tags: [], customSlug: '', redirectMode: 'confirmation', expiresAt: '2099-01-01T00:00:00Z', maxVisits: '2147483647' },
    ] })
  })

  it.each(['0', '01', '+1', '-1', ' 1', '1 ', '1.0', '1e2', '１', '١', '2147483648', '10000000000', '\u0000', '1\n'])('rejects noncanonical cap %j without normalization', cap => {
    expect(parseBulkCreateImportCsv(header + '\nhttps://example.com/cap,,[],,,,"' + cap + '"')).toEqual({ success: false })
  })

  it.each(['\n', '\r\n'])('accepts twenty unique rows and rejects twenty-one with %j', newline => {
    const rows = Array.from({ length: 21 }, (_, i) => `https://example.com/${i},,[],,,,1`)
    expect(parseBulkCreateImportCsv('\uFEFF' + header + newline + rows.slice(0, 20).join(newline) + newline)).toMatchObject({ success: true, mode: 'visit-limits' })
    expect(parseBulkCreateImportCsv(header + newline + rows.join(newline))).toEqual({ success: false })
  })

  it.each([
    header + '\nhttps://example.com/cap,,[],,,',
    header + '\nhttps://example.com/cap,,[],,,,1,extra',
    header + '\nhttps://example.com/cap,,invalid,,,,1',
    header + '\nhttps://example.com/cap,,null,,,,1',
    header.replace('expires_at,max_visits', 'max_visits,expires_at') + '\nhttps://example.com/cap,,[],,,,1',
    header + '\nhttps://example.com/cap,,[],,,,1\nhttps://example.com/cap,,[],,,,2',
    header + '\nhttps://example.com/a,,[],Team76,,,1\nhttps://example.com/b,,[],team76,,,2',
  ])('rejects malformed or conflicting seven-column content', text => {
    expect(parseBulkCreateImportCsv(text)).toEqual({ success: false })
  })
})
