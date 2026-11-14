import { describe, expect, it } from 'vitest'
import { parseBulkCreateImportCsv } from './bulk-create-csv'

describe('fixed five-column CSV redirect modes', () => {
  it('preserves all three modes and the explicit empty direct mode with raw metadata', () => {
    const text = 'target_url,title,tags,custom_slug,redirect_mode\n'
      + 'https://example.com/direct, raw ,"["" tag ""]",Team74,direct\n'
      + 'https://example.com/intermediate,,[],,intermediate\n'
      + 'https://example.com/confirmation,,[],Confirm74,confirmation\n'
      + 'https://example.com/empty,,[],,'
    expect(parseBulkCreateImportCsv(text)).toEqual({ success: true, mode: 'redirect-modes', data: [
      { targetUrl: 'https://example.com/direct', title: ' raw ', tags: [' tag '], customSlug: 'Team74', redirectMode: 'direct' },
      { targetUrl: 'https://example.com/intermediate', title: '', tags: [], customSlug: '', redirectMode: 'intermediate' },
      { targetUrl: 'https://example.com/confirmation', title: '', tags: [], customSlug: 'Confirm74', redirectMode: 'confirmation' },
      { targetUrl: 'https://example.com/empty', title: '', tags: [], customSlug: '', redirectMode: '' },
    ] })
  })

  it.each(['Direct', 'INTERMEDIATE', ' confirmation', 'direct ', 'other', 'null', '中间页'])('rejects invalid raw mode %j', mode => {
    expect(parseBulkCreateImportCsv('target_url,title,tags,custom_slug,redirect_mode\nhttps://example.com,,[],,' + mode)).toEqual({ success: false })
  })
  it.each([
    'target_url,title,tags,redirect_mode,custom_slug\nhttps://example.com,,[],direct,',
    'target_url,title,tags,custom_slug,redirect_mode\nhttps://example.com,,[],',
    'target_url,title,tags,custom_slug,redirect_mode\nhttps://example.com,,[],,direct,extra',
    'target_url,title,tags,custom_slug,redirect_mode\nhttps://example.com,,null,,direct',
    'target_url,title,tags,custom_slug,redirect_mode\nhttps://example.com,,[,,direct',
    'target_url,title,tags,custom_slug,redirect_mode\nhttps://example.com,,[],"","direct\n"',
  ])('rejects malformed five-column records without dropping mode fields: %j', text => {
    expect(parseBulkCreateImportCsv(text)).toEqual({ success: false })
  })
  it('accepts twenty ordered rows and rejects duplicate raw targets or normalized short codes', () => {
    const header = 'target_url,title,tags,custom_slug,redirect_mode\n'
    const rows = Array.from({ length: 20 }, (_, i) => 'https://example.com/' + i + ',,[],Code' + i + ',' + (i % 2 ? 'confirmation' : 'intermediate'))
    const accepted = parseBulkCreateImportCsv(header + rows.join('\n'))
    expect(accepted.success && accepted.mode === 'redirect-modes' && accepted.data).toHaveLength(20)
    expect(parseBulkCreateImportCsv(header + rows.join('\n') + '\nhttps://example.com/extra,,[],,direct')).toEqual({ success: false })
    expect(parseBulkCreateImportCsv(header + rows[0] + '\n' + rows[0])).toEqual({ success: false })
    expect(parseBulkCreateImportCsv(header + rows[0] + '\n' + rows[1]!.replace('Code1', 'code0'))).toEqual({ success: false })
  })

})
