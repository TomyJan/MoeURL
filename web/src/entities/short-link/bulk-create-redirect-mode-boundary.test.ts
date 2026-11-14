import { describe, expect, it } from 'vitest'
import { parseBulkCreateImportCsv } from './bulk-create-csv'

const requestId = '11111111-1111-4111-8111-111111111111'
const targetUrl = 'https://example.com/boundary'
const bytes = (text: string) => new TextEncoder().encode(text).byteLength
const cell = (text: string) => '"' + text.replaceAll('"', '""') + '"'
const wire = (title: string, tags: string[]) => JSON.stringify({ requestId, items: [{ targetUrl, title, tags, customSlug: 'Team74', redirectMode: 'intermediate' }] })
const csv = (title: string, tags: string[], newline: string, bom: string) =>
  `${bom}target_url,title,tags,custom_slug,redirect_mode${newline}${targetUrl},${cell(title)},${cell(JSON.stringify(tags))},Team74,intermediate${newline}`

describe('five-column CSV and complete redirect-mode request independent byte limits', () => {
  // Removing the wire cap, excluding exactly65536, or counting UTF-16 length must break these observable imports.
  it.each(['\n', '\r\n'])('preserves escaped Unicode metadata at exactly65536 wire bytes and rejects65537 with %j', newline => {
    const tags = ['工具 "quote" \\ path', '😀,tag']
    const content = '界😀'
    const title = content + ' '.repeat(65536 - bytes(wire(content, tags)))
    const accepted = csv(title, tags, newline, '\uFEFF')
    const refused = csv(title + ' ', tags, newline, '\uFEFF')

    expect(bytes(wire(title, tags))).toBe(65536)
    expect(bytes(wire(title + ' ', tags))).toBe(65537)
    expect(wire(title + ' ', tags).length).toBeLessThan(65536)
    expect(bytes(accepted)).toBeLessThan(65536)
    expect(bytes(refused)).toBeLessThan(65536)
    expect(parseBulkCreateImportCsv(accepted)).toEqual({ success: true, mode: 'redirect-modes', data: [{ targetUrl, title, tags, customSlug: 'Team74', redirectMode: 'intermediate' }] })
    expect(parseBulkCreateImportCsv(refused)).toEqual({ success: false })
  })

  // Quote-heavy tags make CSV escaping cost more than the complete JSON envelope. The file cap must stand alone.
  it.each([
    { newline: '\n', bom: '' },
    { newline: '\r\n', bom: '' },
    { newline: '\n', bom: '\uFEFF' },
    { newline: '\r\n', bom: '\uFEFF' },
  ])('accepts exactly65536 CSV bytes and refuses65537 before import with %j', ({ newline, bom }) => {
    const tags = Array.from({ length: 10 }, (_, index) => '"'.repeat(24) + '\\界' + index)
    const content = '😀'
    const title = content + ' '.repeat(65536 - bytes(csv(content, tags, newline, bom)))
    const accepted = csv(title, tags, newline, bom)
    const refused = csv(title + ' ', tags, newline, bom)

    expect(bytes(accepted)).toBe(65536)
    expect(bytes(refused)).toBe(65537)
    expect(refused.length).toBeLessThan(65536)
    expect(bytes(wire(title, tags))).toBeLessThan(65536)
    expect(bytes(wire(title + ' ', tags))).toBeLessThan(65536)
    expect(parseBulkCreateImportCsv(accepted)).toEqual({ success: true, mode: 'redirect-modes', data: [{ targetUrl, title, tags, customSlug: 'Team74', redirectMode: 'intermediate' }] })
    expect(parseBulkCreateImportCsv(refused)).toEqual({ success: false })
  })
})
