import { describe, expect, it } from 'vitest'
import { parseBulkCreateImportCsv } from './bulk-create-csv'

const header = 'target_url,title,tags,custom_slug,redirect_mode,expires_at\n'
const row = (expiresAt: string, index = 0) => `https://example.com/expiry${index}, raw ,"["" tag ""]",Team75${index},intermediate,"${expiresAt.replaceAll('"', '""')}"`

describe('fixed six-column CSV expiration protocol', () => {
  it('accepts canonical UTC seconds and empty expiry without normalizing raw fields', () => {
    const data = ['', '0001-01-01T00:00:00Z', '2000-02-29T23:59:59Z', '2024-02-29T00:00:00Z', '2030-12-31T23:59:59Z', '9999-12-31T23:59:59Z']
    expect(parseBulkCreateImportCsv(header + data.map(row).join('\n'))).toEqual({ success: true, mode: 'expirations', data: data.map((expiresAt, index) => ({
      targetUrl: `https://example.com/expiry${index}`, title: ' raw ', tags: [' tag '], customSlug: `Team75${index}`, redirectMode: 'intermediate', expiresAt,
    })) })
  })

  it.each([
    ' ', '2030-01-01T00:00:00Z ', ' 2030-01-01T00:00:00Z', '2030-01-01t00:00:00Z', '2030-01-01T00:00:00z',
    '2030-01-01T00:00:00+00:00', '2030-01-01T00:00:00.000Z', '2030-01-01T00:00:60Z', '2030-01-01T24:00:00Z',
    '2030-01-01T00:60:00Z', '2030-01-01T-1:00:00Z', '2030-01-01T00:00:00Z\n', '0000-01-01T00:00:00Z',
    '10000-01-01T00:00:00Z', '2030-00-01T00:00:00Z', '2030-13-01T00:00:00Z', '2030-01-00T00:00:00Z',
    '2030-01-32T00:00:00Z', '2030-04-31T00:00:00Z', '1900-02-29T00:00:00Z', '2100-02-29T00:00:00Z',
    '2023-02-29T00:00:00Z', '2030-1-01T00:00:00Z', '2030-01-1T00:00:00Z', '２０３０-01-01T00:00:00Z',
  ])('rejects noncanonical UTC seconds without date normalization: %j', expiresAt => {
    expect(parseBulkCreateImportCsv(header + row(expiresAt))).toEqual({ success: false })
  })

  it('bounds ordered rows, URL and normalized code uniqueness', () => {
    const rows = Array.from({ length: 20 }, (_, i) => row('2030-01-01T00:00:00Z', i))
    const accepted = parseBulkCreateImportCsv(header + rows.join('\n'))
    expect(accepted.success && accepted.mode === 'expirations' && accepted.data).toHaveLength(20)
    for (const text of [header, header + [...rows, row('', 20)].join('\n'), header + rows[0] + '\n' + rows[0], header + rows[0] + '\n' + rows[1]!.replace('Team751', 'team750')]) {
      expect(parseBulkCreateImportCsv(text)).toEqual({ success: false })
    }
  })

  it('rejects wrong headers, field counts, invalid tags and files over 64 KiB', () => {
    for (const text of [
      header.replace('redirect_mode,expires_at', 'expires_at,redirect_mode') + row(''),
      header.replace('expires_at', 'expiresAt') + row(''), header + row('') + ',extra',
      header + 'https://example.com,,[],,direct', header + 'https://example.com,,null,,direct,',
      header + 'https://example.com,,[],,Direct,', header + row('') + ' '.repeat(65536),
      header + 'https://example.com,,[,,direct,', header + 'https://example.com,,[],,direct,\nhttps://example.org,,[],,direct',
    ]) expect(parseBulkCreateImportCsv(text)).toEqual({ success: false })
  })
  it.each(['target_url', 'title', 'tags', 'custom_slug', 'redirect_mode', 'expires_at'])('rejects a changed sixth-protocol %s header', field => {
    expect(parseBulkCreateImportCsv(header.replace(field, 'wrong') + row(''))).toEqual({ success: false })
  })
})
