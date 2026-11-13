import { afterEach, describe, expect, it, vi } from 'vitest'
import { TargetCIDRDenylistSchema, UpdateTargetCIDRDenylistSchema, normalizeTargetPolicyCIDR, getTargetCIDRDenylist, updateTargetCIDRDenylist } from './api'

const version = '2026-11-14T05:00:00.123456Z'
const document = { prefixes: ['192.0.2.0/24', '2001:db8::/32'], updatedAt: version }
const envelope = (data: unknown) => new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }))
afterEach(() => vi.unstubAllGlobals())

describe('independent target CIDR contract', () => {
  // Leaving host bits, unmapping a rule, or using floating-point masks breaks these literal vectors.
  it.each([
    ['192.0.2.129/24', '192.0.2.0/24'], ['192.0.2.129/25', '192.0.2.128/25'],
    ['255.255.255.255/0', '0.0.0.0/0'], ['255.255.255.255/32', '255.255.255.255/32'],
    ['192.0.2.1/31', '192.0.2.0/31'], ['0.0.0.1/1', '0.0.0.0/1'],
    ['2001:0DB8:1234::9/48', '2001:db8:1234::/48'],
    ['ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff/0', '::/0'],
    ['2001:db8::3/127', '2001:db8::2/127'], ['2001:db8::1/128', '2001:db8::1/128'],
    ['2001:db8:ffff:ffff:ffff:ffff:ffff:ffff/33', '2001:db8:8000::/33'],
    ['2001:db8:1234:5678:9abc:def0:1234:5678/65', '2001:db8:1234:5678:8000::/65'],
    ['::192.0.2.9/120', '::c000:200/120'], ['::/128', '::/128'],
    ['\u00a0192.0.2.1/24\u00a0', '192.0.2.0/24'],
  ])('normalizes literal CIDR %j => %s', (raw, canonical) => {
    expect(normalizeTargetPolicyCIDR(raw)).toBe(canonical)
  })
  it.each([
    '', ' ', '192.0.2.1', '/24', '192.0.2.1/', '192.0.2.1/024', '192.0.2.1/00',
    '192.0.2.1/+24', '192.0.2.1/-1', '192.0.2.1/24.0', '192.0.2.1/ 24', '192.0.2.1/33',
    '192.0.2.1/1000', '192.0.2.1/２４', '192.0.2.1/24/24', '192.0.2.1 /24', '2001:db8::1 /64', '2001:db8::1/129',
    '::ffff:192.0.2.1/120', '::ffff:c000:201/128', '0:0:0:0:0:ffff:c000:201/96',
    '\t192.0.2.1/24', '192.0.2.1/24\n', '192.0.2.1/24\0', '\u0085192.0.2.1/24',
    '\uFEFF192.0.2.1/24', '\uD800/24', '127.1/8', '2130706433/32', '0177.0.0.1/8',
    '0x7f.0.0.1/8', '192.000.2.1/24', '256.0.2.1/24', '192.0.2.1./24',
    'fe80::1%eth0/64', '[2001:db8::1]/64', 'https://192.0.2.1/24', 'example.com/24',
    '192.0.2.1:443/24', '::192.000.2.1/120', '1::2::3/64',
  ])('rejects malformed, ambiguous or mapped rule %j', raw => {
    expect(() => normalizeTargetPolicyCIDR(raw)).toThrow()
    expect(UpdateTargetCIDRDenylistSchema.safeParse({ prefixes: [raw], expectedUpdatedAt: version }).success).toBe(false)
  })
  it('preserves original editable spelling and order, rejects canonical duplicates, and retains overlap', () => {
    const input = { prefixes: [' 2001:0DB8::9/32 ', '192.0.2.129/24', '192.0.2.129/25'], expectedUpdatedAt: version }
    expect(UpdateTargetCIDRDenylistSchema.parse(input)).toEqual(input)
    for (const prefixes of [['192.0.2.129/24', '192.0.2.0/24'], ['2001:0DB8::9/32', '2001:db8::/32']]) {
      expect(UpdateTargetCIDRDenylistSchema.safeParse({ prefixes, expectedUpdatedAt: version }).success).toBe(false)
    }
    expect(TargetCIDRDenylistSchema.parse({ prefixes: ['0.0.0.0/0', '192.0.2.0/24', '::/0'], updatedAt: version }).prefixes).toHaveLength(3)
  })
  it('accepts zero and 100 complete rows and rejects 101 without dropping rules', () => {
    for (const count of [0, 100]) {
      const prefixes = Array.from({ length: count }, (_, i) => `192.0.2.${i}/32`).sort()
      expect(TargetCIDRDenylistSchema.parse({ prefixes, updatedAt: version }).prefixes).toHaveLength(count)
      expect(UpdateTargetCIDRDenylistSchema.parse({ prefixes, expectedUpdatedAt: version }).prefixes).toHaveLength(count)
    }
    expect(UpdateTargetCIDRDenylistSchema.safeParse({ prefixes: Array.from({ length: 101 }, (_, i) => `192.0.2.${i}/32`), expectedUpdatedAt: version }).success).toBe(false)
  })
  it.each([
    {}, null, [], { prefixes: null, updatedAt: version }, { ...document, addresses: [] }, { ...document, prefixes: [null] }, { ...document, prefixes: ['::ffff:c000:201/120'] },
    { ...document, prefixes: ['192.0.2.1/24'] }, { ...document, prefixes: ['2001:0DB8::/32'] },
    { ...document, prefixes: [' 192.0.2.0/24 '] }, { ...document, prefixes: ['2001:db8::/32', '192.0.2.0/24'] },
    { ...document, prefixes: ['192.0.2.0/24', '192.0.2.0/24'] },
  ].map(input => [input]))('rejects incomplete or noncanonical server documents %#', input => {
    expect(TargetCIDRDenylistSchema.safeParse(input).success).toBe(false)
  })
  it.each(['', '0000-01-01T00:00:00Z', '0001-01-01T00:00:00Z', '2026-02-30T00:00:00Z', '2026-11-14T00:00:00.123456001Z'])('rejects unusable revision %s', updatedAt => {
    expect(TargetCIDRDenylistSchema.safeParse({ prefixes: [], updatedAt }).success).toBe(false)
    expect(UpdateTargetCIDRDenylistSchema.safeParse({ prefixes: [], expectedUpdatedAt: updatedAt }).success).toBe(false)
  })
  it.each([version, '2026-11-14T13:00:00.123456000+08:00', '0001-01-01T00:00:00.000001Z'])('retains the usable full revision %s', updatedAt => {
    expect(TargetCIDRDenylistSchema.parse({ prefixes: [], updatedAt }).updatedAt).toBe(updatedAt)
    expect(UpdateTargetCIDRDenylistSchema.parse({ prefixes: [], expectedUpdatedAt: updatedAt }).expectedUpdatedAt).toBe(updatedAt)
  })
  it('uses independent GET and one raw POST with exact CAS and credentials', async () => {
    const requests: unknown[] = []
    vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
      requests.push({ path, method: init.method, credentials: init.credentials, body: init.body && JSON.parse(String(init.body)) })
      return envelope(document)
    })
    expect(await getTargetCIDRDenylist()).toEqual(document)
    const input = { prefixes: [' 2001:0DB8::9/32 ', '192.0.2.129/24'], expectedUpdatedAt: version }
    expect(await updateTargetCIDRDenylist(input)).toEqual(document)
    expect(requests).toEqual([
      { path: '/api/v1/admin/system/target-cidr-denylist', method: 'GET', credentials: 'include', body: undefined },
      { path: '/api/v1/admin/system/target-cidr-denylist/update', method: 'POST', credentials: 'include', body: input },
    ])
  })
  it('rejects malformed reads and responses and refuses bad input before any write', async () => {
    const requests: string[] = []
    vi.stubGlobal('fetch', async (path: string) => { requests.push(path); return envelope({ ...document, prefixes: ['192.0.2.1/24'] }) })
    await expect(getTargetCIDRDenylist()).rejects.toThrow()
    await expect(updateTargetCIDRDenylist({ prefixes: [], expectedUpdatedAt: version })).rejects.toThrow()
    await expect(updateTargetCIDRDenylist({ prefixes: ['::ffff:c000:201/120'], expectedUpdatedAt: version })).rejects.toThrow()
    expect(UpdateTargetCIDRDenylistSchema.safeParse({ prefixes: [], expectedUpdatedAt: version, ignored: true }).success).toBe(false)
    expect(requests).toEqual(['/api/v1/admin/system/target-cidr-denylist', '/api/v1/admin/system/target-cidr-denylist/update'])
  })
})
