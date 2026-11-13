import { afterEach, expect, it, vi } from 'vitest'
import { TargetCIDRAllowlistSchema, UpdateTargetCIDRAllowlistSchema, getTargetCIDRAllowlist, updateTargetCIDRAllowlist, adminTargetCIDRAllowlistKey } from './api'
import { adminTargetCIDRDenylistKey } from '@/entities/target-cidr-denylist/api'
import { adminTargetHostAllowlistKey } from '@/entities/target-host-allowlist/api'
import { adminTargetHostSuffixAllowlistKey } from '@/entities/target-host-suffix-allowlist/api'

const version = '2026-11-14T05:00:00.123456Z'
const original = { enabled: false, prefixes: ['192.0.2.0/24'], updatedAt: version }
const envelope = (data: unknown) => new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }))
afterEach(() => vi.unstubAllGlobals())

it('keeps IPv4 and native IPv6 boundaries and overlapping CIDRs without merging', () => {
  const prefixes = ['0.0.0.0/0', '192.0.2.0/24', '192.0.2.9/32', '2001:db8::/32', '2001:db8::1/128', '::/0']
  expect(TargetCIDRAllowlistSchema.parse({ enabled: true, prefixes, updatedAt: version })).toEqual({ enabled: true, prefixes, updatedAt: version })
  const input = { enabled: true, prefixes: [' 2001:0DB8:0:0::1/48 ', '192.0.2.129/24'], expectedUpdatedAt: version }
  expect(UpdateTargetCIDRAllowlistSchema.parse(input)).toEqual(input)
})
it.each([false, true])('preserves exact enabled=%s, raw CIDR order and the full revision', enabled => {
  const input = { enabled, prefixes: [' 2001:0DB8::1/48 ', '192.0.2.129/24'], expectedUpdatedAt: version }
  expect(UpdateTargetCIDRAllowlistSchema.parse(input)).toEqual(input)
  expect(TargetCIDRAllowlistSchema.parse({ ...original, enabled })).toEqual({ ...original, enabled })
  for (const other of [adminTargetCIDRDenylistKey, adminTargetHostAllowlistKey, adminTargetHostSuffixAllowlistKey]) expect(adminTargetCIDRAllowlistKey).not.toEqual(other)
})
it.each([undefined, null, 'false', 'true', 0, 1, [], {}].map(enabled => [enabled] as const))('refuses nonboolean enabled=%j in either direction', enabled => {
  expect(TargetCIDRAllowlistSchema.safeParse({ ...original, enabled }).success).toBe(false)
  expect(UpdateTargetCIDRAllowlistSchema.safeParse({ enabled, prefixes: [], expectedUpdatedAt: version }).success).toBe(false)
})
it('allows disabled empty or preconfigured lists but never an enabled empty list or 101 rows', () => {
  for (const count of [0, 1, 100, 101]) {
    const prefixes = Array.from({ length: count }, (_, i) => '192.0.2.' + i + '/32').sort()
    for (const enabled of [false, true]) {
      const valid = count <= 100 && (!enabled || count > 0)
      expect(TargetCIDRAllowlistSchema.safeParse({ enabled, prefixes, updatedAt: version }).success).toBe(valid)
      expect(UpdateTargetCIDRAllowlistSchema.safeParse({ enabled, prefixes, expectedUpdatedAt: version }).success).toBe(valid)
    }
  }
})
it.each([
  {}, null, [], { ...original, unknown: 1 }, { ...original, prefixes: null },
  { ...original, prefixes: ['192.0.2.0/24', '192.0.2.0/24'] },
  { ...original, prefixes: ['2001:db8::/32', '192.0.2.0/24'] },
  { ...original, prefixes: ['192.0.2.129/24'] }, { ...original, prefixes: ['2001:DB8::/32'] },
  { ...original, updatedAt: '2026-11-14T05:00:00.123456001Z' },
].map(value => [value] as const))('rejects malformed or noncanonical response %#', value => {
  expect(TargetCIDRAllowlistSchema.safeParse(value).success).toBe(false)
})
it.each(['', 'example.com/24', '192.0.2.0/024', '192.0.2.0/33', '2001:db8::/129', '::ffff:192.0.2.1/120', '192.0.2.0/24\u0000', '192.0.2.0/24\n', '[2001:db8::]/32'])('refuses invalid or mapped CIDR %j before transport', async prefix => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  await expect(updateTargetCIDRAllowlist({ enabled: false, prefixes: [prefix], expectedUpdatedAt: version })).rejects.toThrow()
  expect(fetcher).not.toHaveBeenCalled()
})
it('uses only its private endpoints and keeps raw values and CAS intact', async () => {
  const requests: unknown[] = []
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
    requests.push({ path, method: init.method, credentials: init.credentials, body: init.body && JSON.parse(String(init.body)) })
    return envelope(original)
  })
  expect(await getTargetCIDRAllowlist()).toEqual(original)
  const input = { enabled: true, prefixes: [' 192.0.2.129/24 '], expectedUpdatedAt: version }
  expect(await updateTargetCIDRAllowlist(input)).toEqual(original)
  expect(requests).toEqual([
    { path: '/api/v1/admin/system/target-cidr-allowlist', method: 'GET', credentials: 'include', body: undefined },
    { path: '/api/v1/admin/system/target-cidr-allowlist/update', method: 'POST', credentials: 'include', body: input },
  ])
})
it('rejects malformed responses and duplicate canonical commands without writing', async () => {
  const fetcher = vi.fn(async () => envelope({ ...original, enabled: true, prefixes: [] }))
  vi.stubGlobal('fetch', fetcher)
  await expect(getTargetCIDRAllowlist()).rejects.toThrow()
  await expect(updateTargetCIDRAllowlist({ enabled: true, prefixes: [], expectedUpdatedAt: version })).rejects.toThrow()
  expect(UpdateTargetCIDRAllowlistSchema.safeParse({ enabled: false, prefixes: [], expectedUpdatedAt: version, unknown: 1 }).success).toBe(false)
  expect(UpdateTargetCIDRAllowlistSchema.safeParse({ enabled: false, prefixes: ['192.0.2.1/24', ' 192.0.2.129/24 '], expectedUpdatedAt: version }).success).toBe(false)
  expect(fetcher).toHaveBeenCalledTimes(1)
})
