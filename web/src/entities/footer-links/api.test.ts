import { afterEach, describe, expect, it, vi } from 'vitest'
import corpus from '../../../../testdata/footer-links-urls.json'
import { FooterLinksSchema, FooterLinksSettingsSchema, UpdateFooterLinksSchema, normalizeFooterLinkURL, getPublicFooterLinks, getFooterLinks, updateFooterLinks } from './api'

const version = '2026-10-30T05:00:00.123456789+08:00'
const links = [{ label: 'Docs', url: 'https://example.com/a/../b?x=%2f#part' }]
const envelope = (data: unknown) => new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }))
afterEach(() => vi.unstubAllGlobals())
describe('footer links shared URL contract', () => {
  it('fails closed if the platform parser disagrees with the locally validated authority', () => {
    const NativeURL = URL
    // Fault injection, not a claim that this ordinary URI changes host in a real browser.
    vi.stubGlobal('URL', class extends NativeURL { get hostname() { return 'unexpected.example' } })
    expect(() => normalizeFooterLinkURL('https://example.com/docs')).toThrow('Noncanonical footer DNS spelling')
  })
  it.each(corpus)('$name matches the Go literal acceptance and canonical URL', entry => {
    if (entry.valid) expect(normalizeFooterLinkURL(entry.input)).toBe(entry.normalized)
    else expect(() => normalizeFooterLinkURL(entry.input)).toThrow()
  })
  it('accepts exactly 2048 ASCII bytes and rejects 2049', () => {
    const maximum = 'https://example.com/' + 'a'.repeat(2028)
    expect(maximum).toHaveLength(2048)
    expect(normalizeFooterLinkURL(maximum)).toBe(maximum)
    expect(() => normalizeFooterLinkURL(maximum + 'a')).toThrow()
  })
})
describe('footer links strict DTO and complete revision', () => {
  it('normalizes a copy, keeps order and duplicates, counts codepoints and retains BOM', () => {
    const input = { links: [
      { label: '  😀'.repeat(1) + '😀'.repeat(39) + '　', url: ' HTTPS://Example.COM:00443/a/../b?x=%2f#part ' },
      { label: '\uFEFF', url: 'http://localhost:8080/help' },
      { label: '\uFEFF', url: 'http://localhost:8080/help' },
    ], expectedUpdatedAt: version }
    const original = structuredClone(input)
    expect(UpdateFooterLinksSchema.parse(input)).toEqual({ links: [
      { label: '😀'.repeat(40), url: links[0]!.url },
      { label: '\uFEFF', url: 'http://localhost:8080/help' },
      { label: '\uFEFF', url: 'http://localhost:8080/help' },
    ], expectedUpdatedAt: version })
    expect(input).toEqual(original)
    expect(FooterLinksSchema.parse({ links: [] })).toEqual({ links: [] })
    expect(UpdateFooterLinksSchema.parse({ links: Array.from({ length: 5 }, () => links[0]), expectedUpdatedAt: version }).links).toHaveLength(5)
  })
  it.each([
    {}, { links: null }, { links: {} }, { links: [null] }, { Links: [] },
    { links, updatedAt: version }, { links: [{ ...links[0], id: 'private' }] },
    { links: [{ Label: 'Docs', url: 'https://example.com/' }] },
    { links: [{ label: '', url: 'https://example.com/' }] },
    { links: [{ label: ' '.repeat(2), url: 'https://example.com/' }] },
    { links: [{ label: '😀'.repeat(41), url: 'https://example.com/' }] },
    { links: [{ label: '\tDocs', url: 'https://example.com/' }] },
    { links: [{ label: '\uD800', url: 'https://example.com/' }] },
    { links: [{ label: 'Docs', url: '\uDC00' }] },
    { links: Array.from({ length: 6 }, () => links[0]) },
    { links: [{ label: 'Docs ', url: 'https://example.com/' }] },
    { links: [{ label: 'Docs', url: 'HTTPS://EXAMPLE.COM:443/' }] },
  ])('rejects malformed or noncanonical public data %#', value => {
    expect(FooterLinksSchema.safeParse(value).success).toBe(false)
  })
  it.each(['', '0000-01-01T00:00:00Z', '0001-01-01T00:00:00Z', '0001-01-01T08:00:00+08:00', '2026-10-30', '2026-02-30T00:00:00Z', '2026-10-30T00:00:00', '+10000-01-01T00:00:00Z'])('rejects invalid or zero version %s', updatedAt => {
    expect(FooterLinksSettingsSchema.safeParse({ links, updatedAt }).success).toBe(false)
    expect(UpdateFooterLinksSchema.safeParse({ links, expectedUpdatedAt: updatedAt }).success).toBe(false)
  })
  it.each([version, '0001-01-01T00:00:00.000000001Z', '0001-01-01T01:00:00+02:00'])('retains the exact nonzero version %s', updatedAt => {
    expect(FooterLinksSettingsSchema.parse({ links, updatedAt }).updatedAt).toBe(updatedAt)
  })
  it('uses the three independent endpoints with a canonical complete CAS body', async () => {
    const seen: Array<{ path: string; method: string; body: unknown; credentials: unknown }> = []
    vi.stubGlobal('fetch', vi.fn(async (path: string, init: RequestInit) => {
      seen.push({ path, method: init.method!, body: init.body ? JSON.parse(String(init.body)) : undefined, credentials: init.credentials })
      return envelope(path === '/api/v1/system/footer-links' ? { links } : { links, updatedAt: version })
    }))
    expect(await getPublicFooterLinks()).toEqual({ links })
    expect(await getFooterLinks()).toEqual({ links, updatedAt: version })
    expect(await updateFooterLinks({ links: [{ label: ' Docs ', url: ' HTTPS://Example.COM:443/a/../b?x=%2f#part ' }], expectedUpdatedAt: version })).toEqual({ links, updatedAt: version })
    expect(seen).toEqual([
      { path: '/api/v1/system/footer-links', method: 'GET', body: undefined, credentials: 'include' },
      { path: '/api/v1/admin/system/footer-links', method: 'GET', body: undefined, credentials: 'include' },
      { path: '/api/v1/admin/system/footer-links/update', method: 'POST', body: { links, expectedUpdatedAt: version }, credentials: 'include' },
    ])
  })
  it('rejects public management fields and invalid write input without sending a write', async () => {
    const seen: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (path: string) => { seen.push(path); return envelope({ links, updatedAt: version }) }))
    await expect(getPublicFooterLinks()).rejects.toThrow()
    await expect(updateFooterLinks({ links: [{ label: '', url: 'https://example.com/' }], expectedUpdatedAt: version })).rejects.toThrow()
    expect(seen).toEqual(['/api/v1/system/footer-links'])
  })
})
