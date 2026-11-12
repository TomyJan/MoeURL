import { afterEach, expect, it, vi } from 'vitest'
import { TargetHostAllowlistSchema, UpdateTargetHostAllowlistSchema, getTargetHostAllowlist, updateTargetHostAllowlist, adminTargetHostAllowlistKey } from './api'
import { adminTargetHostDenylistKey } from '@/entities/target-host-denylist/api'

const version = '2026-11-12T05:00:00.123456Z'
const original = { enabled: false, hosts: ['allowed.example'], updatedAt: version }
const envelope = (data: unknown) => new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }))
afterEach(() => vi.unstubAllGlobals())
it.each([false, true])('preserves the exact %s flag, raw host order and complete revision', enabled => {
  const input = { enabled, hosts: [' Z.example. ', 'A.EXAMPLE'], expectedUpdatedAt: version }
  expect(UpdateTargetHostAllowlistSchema.parse(input)).toEqual(input)
  expect(TargetHostAllowlistSchema.parse({ ...original, enabled })).toEqual({ ...original, enabled })
  expect(adminTargetHostAllowlistKey).not.toEqual(adminTargetHostDenylistKey)
})
it.each([undefined, null, 'false', 'true', 0, 1, [], {}])('refuses a nonboolean enabled value %j in either direction', enabled => {
  expect(TargetHostAllowlistSchema.safeParse({ ...original, enabled }).success).toBe(false)
  expect(UpdateTargetHostAllowlistSchema.safeParse({ enabled, hosts: [], expectedUpdatedAt: version }).success).toBe(false)
})
it('allows disabled empty or preconfigured lists but never an enabled empty list', () => {
  for (const count of [0, 1, 100]) {
    const hosts = Array.from({ length: count }, (_, index) => `h${String(index).padStart(3, '0')}.example`)
    for (const enabled of [false, true]) {
      expect(TargetHostAllowlistSchema.safeParse({ enabled, hosts, updatedAt: version }).success).toBe(!enabled || count > 0)
      expect(UpdateTargetHostAllowlistSchema.safeParse({ enabled, hosts, expectedUpdatedAt: version }).success).toBe(!enabled || count > 0)
    }
  }
})
it.each([
  {}, null, [], { ...original, unknown: 1 }, { ...original, hosts: null },
  { ...original, hosts: ['a.example', 'a.example'] }, { ...original, hosts: ['b.example', 'a.example'] },
  { ...original, hosts: ['A.example'] }, { ...original, hosts: ['bücher.example'] },
  { ...original, updatedAt: '2026-11-12T05:00:00.123456001Z' },
])('rejects malformed or noncanonical private response %#', value => {
  expect(TargetHostAllowlistSchema.safeParse(value).success).toBe(false)
})
it('uses only its private endpoints and keeps raw values and CAS intact', async () => {
  const requests: unknown[] = []
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
    requests.push({ path, method: init.method, credentials: init.credentials, body: init.body && JSON.parse(String(init.body)) })
    return envelope(original)
  })
  expect(await getTargetHostAllowlist()).toEqual(original)
  const input = { enabled: true, hosts: [' ALLOWED.example. '], expectedUpdatedAt: version }
  expect(await updateTargetHostAllowlist(input)).toEqual(original)
  expect(requests).toEqual([
    { path: '/api/v1/admin/system/target-host-allowlist', method: 'GET', credentials: 'include', body: undefined },
    { path: '/api/v1/admin/system/target-host-allowlist/update', method: 'POST', credentials: 'include', body: input },
  ])
})
it('rejects bad responses and refuses invalid commands before transport', async () => {
  const fetcher = vi.fn(async () => envelope({ ...original, enabled: true, hosts: [] }))
  vi.stubGlobal('fetch', fetcher)
  await expect(getTargetHostAllowlist()).rejects.toThrow()
  await expect(updateTargetHostAllowlist({ enabled: true, hosts: [], expectedUpdatedAt: version })).rejects.toThrow()
  expect(UpdateTargetHostAllowlistSchema.safeParse({ enabled: false, hosts: [], expectedUpdatedAt: version, unknown: 1 }).success).toBe(false)
  expect(UpdateTargetHostAllowlistSchema.safeParse({ enabled: false, hosts: ['A.example', ' a.EXAMPLE. '], expectedUpdatedAt: version }).success).toBe(false)
  expect(UpdateTargetHostAllowlistSchema.safeParse({ enabled: false, hosts: Array.from({ length: 101 }, (_, i) => `h${i}.example`), expectedUpdatedAt: version }).success).toBe(false)
  expect(fetcher).toHaveBeenCalledTimes(1)
})
