import { afterEach, describe, expect, it, vi } from 'vitest'
import { TargetIPDenylistSchema, UpdateTargetIPDenylistSchema, normalizeTargetPolicyIP, getTargetIPDenylist, updateTargetIPDenylist } from './api'

const version = '2026-11-13T05:00:00.123456Z'
const document = { addresses: ['192.0.2.1', '2001:db8::1'], updatedAt: version }
const envelope = (data: unknown) => new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }))
afterEach(() => vi.unstubAllGlobals())

describe('independent exact target IP contract', () => {
  // URL's permissive numeric-host parser must not broaden Go netip input.
  it.each([
    ['192.0.2.1', '192.0.2.1'], [' ::ffff:192.0.2.1 ', '192.0.2.1'], ['::ffff:c000:201', '192.0.2.1'],
    ['2001:0DB8:0:0::1', '2001:db8::1'], ['::192.0.2.1', '::c000:201'], ['\u00a0203.0.113.9\u00a0', '203.0.113.9'],
    ['::', '::'], ['::1', '::1'], ['0:0:0:0:0:ffff:ffff:ffff', '255.255.255.255'],
    ['2001:0:0:1:0:0:1:1', '2001::1:0:0:1:1'], ['2001:db8:0:1:1:1:1:1', '2001:db8:0:1:1:1:1:1'],
  ])('TestIPSchemaCanonicalVectors %j => %s', (raw, canonical) => {
    expect(normalizeTargetPolicyIP(raw)).toBe(canonical)
  })
  it.each([
    '', ' ', '\t192.0.2.1', '192.0.2.1\n', '192.0.2.1\0', '\u0085192.0.2.1', '\uFEFF192.0.2.1', '\uD800',
    '127.1', '2130706433', '0177.0.0.1', '0x7f.0.0.1', '192.000.2.1', '192.0.2.1.',
    '256.0.2.1', '-1.0.2.1', '192.0.2', '1.2.3.4.5', '1.2.3.', '192. 0.2.1',
    'fe80::1%eth0', 'fe80::1%25eth0', '192.0.2.0/24', 'https://192.0.2.1', '[2001:db8::1]',
    '192.0.2.1:443', 'name@192.0.2.1', 'example.com', '２００１:db8::1',
    '::ffff:192.000.2.1', '::ffff:127.1', '::ffff:256.0.2.1', ':', '::::', '1::2::3',
    '2001:db8::g', '12345::1', '192.0.2.1::', '1:2:3:4:5:6:7', '1:2:3:4:5:6:7:8:9', 'a'.repeat(46),
  ])('refuses malformed or ambiguous raw address %j', raw => {
    expect(() => normalizeTargetPolicyIP(raw)).toThrow()
    expect(UpdateTargetIPDenylistSchema.safeParse({ addresses: [raw], expectedUpdatedAt: version }).success).toBe(false)
  })
  it('retains raw order and spelling, but rejects aliases of the same address', () => {
    const input = { addresses: [' 2001:0DB8::1 ', '::ffff:192.0.2.1'], expectedUpdatedAt: version }
    expect(UpdateTargetIPDenylistSchema.parse(input)).toEqual(input)
    for (const addresses of [['192.0.2.1', '::ffff:c000:201'], ['::ffff:192.0.2.1', '::ffff:c000:201'], ['2001:0db8::1', '2001:db8::1']]) {
      expect(UpdateTargetIPDenylistSchema.safeParse({ ...input, addresses }).success).toBe(false)
    }
    expect(UpdateTargetIPDenylistSchema.parse({ ...input, addresses: ['192.0.2.1', '::192.0.2.1'] }).addresses).toEqual(['192.0.2.1', '::192.0.2.1'])
  })
  it('accepts zero and exactly 100 rows and rejects 101 without dropping data', () => {
    for (const count of [0, 100]) {
      const addresses = Array.from({ length: count }, (_, i) => `192.0.2.${i}`).sort()
      expect(TargetIPDenylistSchema.parse({ addresses, updatedAt: version }).addresses).toHaveLength(count)
      expect(UpdateTargetIPDenylistSchema.parse({ addresses, expectedUpdatedAt: version }).addresses).toHaveLength(count)
    }
    expect(UpdateTargetIPDenylistSchema.safeParse({ addresses: Array.from({ length: 101 }, (_, i) => `192.0.2.${i}`), expectedUpdatedAt: version }).success).toBe(false)
  })
  it.each([
    {}, null, [], { addresses: null, updatedAt: version }, { ...document, hosts: [] }, { ...document, addresses: [null] },
    { ...document, addresses: ['::ffff:c000:201'] }, { ...document, addresses: ['::192.0.2.1'] },
    { ...document, addresses: ['2001:0DB8::1'] }, { ...document, addresses: [' 192.0.2.1 '] }, { ...document, addresses: ['127.1'] },
    { ...document, addresses: ['2001:db8::1', '192.0.2.1'] }, { ...document, addresses: ['192.0.2.1', '192.0.2.1'] },
  ].map(input => [input]))('rejects malformed or noncanonical server document %#', input => {
    expect(input).not.toBeUndefined()
    expect(TargetIPDenylistSchema.safeParse(input).success).toBe(false)
  })
  it.each(['', '0000-01-01T00:00:00Z', '0001-01-01T00:00:00Z', '0001-01-01T08:00:00+08:00', '2026-02-30T00:00:00Z', '2026-11-13', '2026-11-13T00:00:00', '2026-11-13T00:00:00.123456001Z'])('rejects invalid, zero or submicrosecond revision %s', updatedAt => {
    expect(TargetIPDenylistSchema.safeParse({ addresses: [], updatedAt }).success).toBe(false)
    expect(UpdateTargetIPDenylistSchema.safeParse({ addresses: [], expectedUpdatedAt: updatedAt }).success).toBe(false)
  })
  it.each([version, '2026-11-13T13:00:00.123456000+08:00', '0001-01-01T00:00:00.000001Z'])('keeps the complete usable microsecond revision %s', updatedAt => {
    expect(TargetIPDenylistSchema.parse({ addresses: [], updatedAt }).updatedAt).toBe(updatedAt)
    expect(UpdateTargetIPDenylistSchema.parse({ addresses: [], expectedUpdatedAt: updatedAt }).expectedUpdatedAt).toBe(updatedAt)
  })
  it('uses the independent endpoints once with the original draft and exact CAS', async () => {
    const requests: unknown[] = []
    vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
      requests.push({ path, method: init.method, credentials: init.credentials, body: init.body && JSON.parse(String(init.body)) })
      return envelope(document)
    })
    expect(await getTargetIPDenylist()).toEqual(document)
    const input = { addresses: [' 2001:0DB8::1 ', '::ffff:192.0.2.1'], expectedUpdatedAt: version }
    expect(await updateTargetIPDenylist(input)).toEqual(document)
    expect(requests).toEqual([
      { path: '/api/v1/admin/system/target-ip-denylist', method: 'GET', credentials: 'include', body: undefined },
      { path: '/api/v1/admin/system/target-ip-denylist/update', method: 'POST', credentials: 'include', body: input },
    ])
  })
  it('rejects invalid reads and write responses, and rejects bad input before dispatch', async () => {
    const requests: string[] = []
    vi.stubGlobal('fetch', async (path: string) => { requests.push(path); return envelope({ ...document, addresses: ['::ffff:c000:201'] }) })
    await expect(getTargetIPDenylist()).rejects.toThrow()
    await expect(updateTargetIPDenylist({ addresses: [], expectedUpdatedAt: version })).rejects.toThrow()
    await expect(updateTargetIPDenylist({ addresses: ['127.1'], expectedUpdatedAt: version })).rejects.toThrow()
    expect(UpdateTargetIPDenylistSchema.safeParse({ addresses: [], expectedUpdatedAt: version, ignored: true }).success).toBe(false)
    expect(requests).toEqual(['/api/v1/admin/system/target-ip-denylist', '/api/v1/admin/system/target-ip-denylist/update'])
  })
})
