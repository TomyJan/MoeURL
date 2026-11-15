import { describe, expect, it } from 'vitest'
import { parseBulkCreateImportCsv } from './bulk-create-csv'

const requestId = '11111111-1111-4111-8111-111111111111', targetUrl = 'https://example.com/boundary77'
const bytes = (text: string) => new TextEncoder().encode(text).byteLength
const cell = (text: string) => '"' + text.replaceAll('"', '""') + '"'
const item = (title: string, tags: string[]) => ({ targetUrl, title, tags, customSlug: 'Boundary77', redirectMode: 'intermediate', expiresAt: '2099-01-01T00:00:00Z', maxVisits: '2147483647', intermediateDelaySeconds: '10' })
const wire = (title: string, tags: string[]) => JSON.stringify({ requestId, items: [item(title, tags)] })
const csv = (title: string, tags: string[], newline: string, bom: string) => bom + 'target_url,title,tags,custom_slug,redirect_mode,expires_at,max_visits,intermediate_delay_seconds' + newline + [targetUrl, title, JSON.stringify(tags), 'Boundary77', 'intermediate', '2099-01-01T00:00:00Z', '2147483647', '10'].map(cell).join(',') + newline

describe('eight-column independent byte limits', () => {
  it.each(['\n', '\r\n'])('accepts exactly 65536 wire bytes and rejects 65537 with %j', newline => {
    const tags = ['工具 "quote" \\ path', '😀,tag'], content = '界😀'
    const title = content + ' '.repeat(65536 - bytes(wire(content, tags)))
    expect(bytes(wire(title, tags))).toBe(65536); expect(bytes(wire(title + ' ', tags))).toBe(65537)
    expect(wire(title + ' ', tags).length).toBeLessThan(65536)
    expect(bytes(csv(title + ' ', tags, newline, '\uFEFF'))).toBeLessThan(65536)
    expect(parseBulkCreateImportCsv(csv(title, tags, newline, '\uFEFF'))).toEqual({ success: true, mode: 'countdowns', data: [item(title, tags)] })
    expect(parseBulkCreateImportCsv(csv(title + ' ', tags, newline, '\uFEFF'))).toEqual({ success: false })
  })
  it.each([{ newline: '\n', bom: '' }, { newline: '\r\n', bom: '' }, { newline: '\n', bom: '\uFEFF' }, { newline: '\r\n', bom: '\uFEFF' }])('accepts exactly 65536 file bytes and rejects 65537 with %j', ({ newline, bom }) => {
    const tags = Array.from({ length: 10 }, (_, i) => '"'.repeat(24) + '\\界' + i), content = '😀'
    const title = content + ' '.repeat(65536 - bytes(csv(content, tags, newline, bom)))
    expect(bytes(csv(title, tags, newline, bom))).toBe(65536); expect(bytes(csv(title + ' ', tags, newline, bom))).toBe(65537)
    expect(csv(title + ' ', tags, newline, bom).length).toBeLessThan(65536); expect(bytes(wire(title + ' ', tags))).toBeLessThan(65536)
    expect(parseBulkCreateImportCsv(csv(title, tags, newline, bom))).toEqual({ success: true, mode: 'countdowns', data: [item(title, tags)] })
    expect(parseBulkCreateImportCsv(csv(title + ' ', tags, newline, bom))).toEqual({ success: false })
  })
})
