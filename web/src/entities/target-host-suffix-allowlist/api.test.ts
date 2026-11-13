import { afterEach, expect, it, vi } from 'vitest'
import { TargetHostSuffixAllowlistSchema, UpdateTargetHostSuffixAllowlistSchema, getTargetHostSuffixAllowlist, updateTargetHostSuffixAllowlist, adminTargetHostSuffixAllowlistKey } from './api'
import { adminTargetHostSuffixDenylistKey } from '@/entities/target-host-suffix-denylist/api'
import { adminTargetHostAllowlistKey } from '@/entities/target-host-allowlist/api'

const version = '2026-11-12T05:00:00.123456Z'
const original = { enabled: false, suffixes: ['allowed.example'], updatedAt: version }
const envelope = (data: unknown) => new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }))
afterEach(() => vi.unstubAllGlobals())
it('preserves broad and overlapping suffix rules and keeps raw draft order', () => {
  const suffixes = ['com', 'example.com', 'sub.example.com']
  expect(TargetHostSuffixAllowlistSchema.parse({ enabled: true, suffixes, updatedAt: version })).toEqual({ enabled: true, suffixes, updatedAt: version })
  const input = { enabled: true, suffixes: [' Sub.Example.COM. ', 'com', 'example.com'], expectedUpdatedAt: version }
  expect(UpdateTargetHostSuffixAllowlistSchema.parse(input)).toEqual(input)
})
it.each([false, true])('preserves the exact %s flag, raw suffix order and complete revision', enabled => {
  const input = { enabled, suffixes: [' Z.example. ', 'A.EXAMPLE'], expectedUpdatedAt: version }
  expect(UpdateTargetHostSuffixAllowlistSchema.parse(input)).toEqual(input)
  expect(TargetHostSuffixAllowlistSchema.parse({ ...original, enabled })).toEqual({ ...original, enabled })
  expect(adminTargetHostSuffixAllowlistKey).not.toEqual(adminTargetHostSuffixDenylistKey)
  expect(adminTargetHostSuffixAllowlistKey).not.toEqual(adminTargetHostAllowlistKey)
})
it.each([undefined, null, 'false', 'true', 0, 1, [], {}].map(enabled => [enabled] as const))('refuses a nonboolean enabled value %j in either direction', enabled => {
  expect(TargetHostSuffixAllowlistSchema.safeParse({ ...original, enabled }).success).toBe(false)
  expect(UpdateTargetHostSuffixAllowlistSchema.safeParse({ enabled, suffixes: [], expectedUpdatedAt: version }).success).toBe(false)
})
it('allows disabled empty or preconfigured lists but never an enabled empty list', () => {
  for (const count of [0, 1, 100]) {
    const suffixes = Array.from({ length: count }, (_, index) => `h${String(index).padStart(3, '0')}.example`)
    for (const enabled of [false, true]) {
      expect(TargetHostSuffixAllowlistSchema.safeParse({ enabled, suffixes, updatedAt: version }).success).toBe(!enabled || count > 0)
      expect(UpdateTargetHostSuffixAllowlistSchema.safeParse({ enabled, suffixes, expectedUpdatedAt: version }).success).toBe(!enabled || count > 0)
    }
  }
})
it.each([
  {}, null, [], { ...original, unknown: 1 }, { ...original, suffixes: null },
  { ...original, suffixes: ['a.example', 'a.example'] }, { ...original, suffixes: ['b.example', 'a.example'] },
  { ...original, suffixes: ['A.example'] }, { ...original, suffixes: ['bücher.example'] },
  { ...original, updatedAt: '2026-11-12T05:00:00.123456001Z' },
].map(value => [value] as const))('rejects malformed or noncanonical private response %#', value => {
  expect(TargetHostSuffixAllowlistSchema.safeParse(value).success).toBe(false)
})
it('uses only its private endpoints and keeps raw values and CAS intact', async () => {
  const requests: unknown[] = []
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
    requests.push({ path, method: init.method, credentials: init.credentials, body: init.body && JSON.parse(String(init.body)) })
    return envelope(original)
  })
  expect(await getTargetHostSuffixAllowlist()).toEqual(original)
  const input = { enabled: true, suffixes: [' ALLOWED.example. '], expectedUpdatedAt: version }
  expect(await updateTargetHostSuffixAllowlist(input)).toEqual(original)
  expect(requests).toEqual([
    { path: '/api/v1/admin/system/target-host-suffix-allowlist', method: 'GET', credentials: 'include', body: undefined },
    { path: '/api/v1/admin/system/target-host-suffix-allowlist/update', method: 'POST', credentials: 'include', body: input },
  ])
})
it('rejects bad responses and refuses invalid commands before transport', async () => {
  const fetcher = vi.fn(async () => envelope({ ...original, enabled: true, suffixes: [] }))
  vi.stubGlobal('fetch', fetcher)
  await expect(getTargetHostSuffixAllowlist()).rejects.toThrow()
  await expect(updateTargetHostSuffixAllowlist({ enabled: true, suffixes: [], expectedUpdatedAt: version })).rejects.toThrow()
  expect(UpdateTargetHostSuffixAllowlistSchema.safeParse({ enabled: false, suffixes: [], expectedUpdatedAt: version, unknown: 1 }).success).toBe(false)
  expect(UpdateTargetHostSuffixAllowlistSchema.safeParse({ enabled: false, suffixes: ['A.example', ' a.EXAMPLE. '], expectedUpdatedAt: version }).success).toBe(false)
  expect(UpdateTargetHostSuffixAllowlistSchema.safeParse({ enabled: false, suffixes: Array.from({ length: 101 }, (_, i) => `h${i}.example`), expectedUpdatedAt: version }).success).toBe(false)
  expect(fetcher).toHaveBeenCalledTimes(1)
})
