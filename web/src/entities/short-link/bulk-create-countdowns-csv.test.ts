import { describe, expect, it } from 'vitest'
import { parseBulkCreateCsv, parseBulkCreateImportCsv } from './bulk-create-csv'

const header = 'target_url,title,tags,custom_slug,redirect_mode,expires_at,max_visits,intermediate_delay_seconds'

describe('eight-column countdown CSV', () => {
  it('preserves three, ten and empty defaults in the independent eighth protocol', () => {
    const text = header + '\nhttps://example.com/three, raw ,[],Team77,intermediate,,1,3\nhttps://example.com/ten,,[],,intermediate,,,10\nhttps://example.com/default,,[],,intermediate,,,'
    expect(parseBulkCreateImportCsv(text)).toEqual({ success: true, mode: 'countdowns', data: [
      { targetUrl: 'https://example.com/three', title: ' raw ', tags: [], customSlug: 'Team77', redirectMode: 'intermediate', expiresAt: '', maxVisits: '1', intermediateDelaySeconds: '3' },
      { targetUrl: 'https://example.com/ten', title: '', tags: [], customSlug: '', redirectMode: 'intermediate', expiresAt: '', maxVisits: '', intermediateDelaySeconds: '10' },
      { targetUrl: 'https://example.com/default', title: '', tags: [], customSlug: '', redirectMode: 'intermediate', expiresAt: '', maxVisits: '', intermediateDelaySeconds: '' },
    ] })
    expect(parseBulkCreateCsv(text)).toEqual({ success: false })
  })
  it.each(['3', '4', '5', '6', '7', '8', '9', '10'])('preserves canonical intermediate delay %j', delay => {
    expect(parseBulkCreateImportCsv(header + '\nhttps://example.com/delay,,[],,intermediate,,,' + delay)).toMatchObject({ success: true, mode: 'countdowns', data: [{ intermediateDelaySeconds: delay }] })
  })
  it.each(['2', '11', '0', '-1', '+3', '03', '3.0', '3e0', ' 3', '3 ', '３', '٣', '\u0000', '3\n'])('rejects noncanonical delay %j without normalization', delay => {
    expect(parseBulkCreateImportCsv(header + '\nhttps://example.com/delay,,[],,intermediate,,,"' + delay + '"')).toEqual({ success: false })
  })
  it.each(['', 'direct', 'confirmation'])('requires empty delay for non-intermediate mode %j', mode => {
    expect(parseBulkCreateImportCsv(header + '\nhttps://example.com/delay,,[],,' + mode + ',,,3')).toEqual({ success: false })
    expect(parseBulkCreateImportCsv(header + '\nhttps://example.com/delay,,[],,' + mode + ',,,')).toMatchObject({ success: true, mode: 'countdowns', data: [{ intermediateDelaySeconds: '' }] })
  })
  it.each(['\n', '\r\n'])('accepts twenty rows and rejects twenty-one with %j', newline => {
    const rows = Array.from({ length: 21 }, (_, i) => `https://example.com/${i},,[],,intermediate,,,3`)
    expect(parseBulkCreateImportCsv('\uFEFF' + header + newline + rows.slice(0, 20).join(newline) + newline)).toMatchObject({ success: true, mode: 'countdowns' })
    expect(parseBulkCreateImportCsv(header + newline + rows.join(newline))).toEqual({ success: false })
  })
  it.each([
    header + '\nhttps://example.com/delay,,[],,intermediate,,',
    header + '\nhttps://example.com/delay,,[],,intermediate,,,3,extra',
    header + '\nhttps://example.com/delay,,invalid,,intermediate,,,3',
    header + '\nhttps://example.com/delay,,null,,intermediate,,,3',
    header.replace('max_visits,intermediate_delay_seconds', 'intermediate_delay_seconds,max_visits') + '\nhttps://example.com/delay,,[],,intermediate,,,3',
    header + '\nhttps://example.com/delay,,[],,intermediate,,,3\nhttps://example.com/delay,,[],,intermediate,,,10',
    header + '\nhttps://example.com/a,,[],Team77,intermediate,,,3\nhttps://example.com/b,,[],team77,intermediate,,,10',
  ])('rejects malformed or conflicting eight-column content', text => {
    expect(parseBulkCreateImportCsv(text)).toEqual({ success: false })
  })
})
