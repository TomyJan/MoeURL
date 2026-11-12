import { afterEach, describe, expect, it, vi } from 'vitest'
import { TargetHostSuffixDenylistSchema, UpdateTargetHostSuffixDenylistSchema, getTargetHostSuffixDenylist, updateTargetHostSuffixDenylist } from './api'

const version = '2026-11-13T01:00:00.123456Z'
const document = { suffixes: ['blocked.example', 'xn--bcher-kva.example'], updatedAt: version }
const envelope = (data: unknown) => new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }))
afterEach(() => vi.unstubAllGlobals())

describe('independent target host suffix contract', () => {
  it('preserves raw input and full revision while permitting overlapping parent and child rules', () => {
    const input = { suffixes: [' Child.Example.COM. ', 'EXAMPLE.COM'], expectedUpdatedAt: version }
    expect(UpdateTargetHostSuffixDenylistSchema.parse(input)).toEqual(input)
    expect(TargetHostSuffixDenylistSchema.parse({ suffixes: ['child.example.com', 'example.com'], updatedAt: version }).suffixes).toHaveLength(2)
    expect(UpdateTargetHostSuffixDenylistSchema.safeParse({ ...input, suffixes: ['Example.com', ' example.COM. '] }).success).toBe(false)
  })
  it('accepts empty and 100 rules but rejects 101 without truncation', () => {
    for (const count of [0, 100, 101]) {
      const suffixes = Array.from({ length: count }, (_, i) => `h${String(i).padStart(3, '0')}.example`)
      expect(TargetHostSuffixDenylistSchema.safeParse({ suffixes, updatedAt: version }).success).toBe(count <= 100)
      expect(UpdateTargetHostSuffixDenylistSchema.safeParse({ suffixes, expectedUpdatedAt: version }).success).toBe(count <= 100)
    }
  })
  it.each(['', ' ', '\texample.com', 'example.com\n', 'bücher.example', '*.example', 'example.com..', 'https://example.com', 'example.com:443', 'user@example.com', 'example.com/path', '127.0.0.1', '[::1]', 'example.123', 'xn--a.example'])('rejects invalid administrative suffix %j', suffix => {
    expect(UpdateTargetHostSuffixDenylistSchema.safeParse({ suffixes: [suffix], expectedUpdatedAt: version }).success).toBe(false)
  })
  it.each([{}, null, [], { suffixes: null, updatedAt: version }, { ...document, hosts: [] }, { ...document, private: true }, { ...document, suffixes: [null] }, { ...document, suffixes: ['B.example'] }, { ...document, suffixes: ['a.example.'] }, { ...document, suffixes: ['b.example', 'a.example'] }, { ...document, suffixes: ['a.example', 'a.example'] }])('refuses malformed or noncanonical server data %#', input => {
    expect(TargetHostSuffixDenylistSchema.safeParse(input).success).toBe(false)
  })
  it.each(['', '0000-01-01T00:00:00Z', '0001-01-01T00:00:00Z', '0001-01-01T08:00:00+08:00', '2026-02-30T00:00:00Z', '2026-11-13', '2026-11-13T00:00:00', '2026-11-13T00:00:00.123456001Z'])('rejects unusable revision %s', updatedAt => {
    expect(TargetHostSuffixDenylistSchema.safeParse({ suffixes: [], updatedAt }).success).toBe(false)
    expect(UpdateTargetHostSuffixDenylistSchema.safeParse({ suffixes: [], expectedUpdatedAt: updatedAt }).success).toBe(false)
  })
  it.each([version, '2026-11-13T09:00:00.123456000+08:00', '0001-01-01T00:00:00.000001Z'])('preserves full usable revision %s', updatedAt => {
    expect(TargetHostSuffixDenylistSchema.parse({ suffixes: [], updatedAt }).updatedAt).toBe(updatedAt)
    expect(UpdateTargetHostSuffixDenylistSchema.parse({ suffixes: [], expectedUpdatedAt: updatedAt }).expectedUpdatedAt).toBe(updatedAt)
  })
  it('uses the two separate endpoints and retains exact request spelling, order and CAS', async () => {
    const requests: unknown[] = []
    vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
      requests.push({ path, method: init.method, credentials: init.credentials, body: init.body && JSON.parse(String(init.body)) })
      return envelope(document)
    })
    expect(await getTargetHostSuffixDenylist()).toEqual(document)
    const input = { suffixes: [' Z.example. ', 'A.EXAMPLE'], expectedUpdatedAt: version }
    expect(await updateTargetHostSuffixDenylist(input)).toEqual(document)
    expect(requests).toEqual([
      { path: '/api/v1/admin/system/target-host-suffix-denylist', method: 'GET', credentials: 'include', body: undefined },
      { path: '/api/v1/admin/system/target-host-suffix-denylist/update', method: 'POST', credentials: 'include', body: input },
    ])
  })
  it('rejects invalid requests before transport and malformed responses from either method', async () => {
    const requests: string[] = []
    vi.stubGlobal('fetch', async (path: string) => { requests.push(path); return envelope({ ...document, suffixes: ['NOT-CANONICAL.example'] }) })
    await expect(getTargetHostSuffixDenylist()).rejects.toThrow()
    await expect(updateTargetHostSuffixDenylist({ suffixes: [], expectedUpdatedAt: version })).rejects.toThrow()
    await expect(updateTargetHostSuffixDenylist({ suffixes: ['https://example.com'], expectedUpdatedAt: version })).rejects.toThrow()
    expect(UpdateTargetHostSuffixDenylistSchema.safeParse({ suffixes: [], expectedUpdatedAt: version, hosts: [] }).success).toBe(false)
    expect(requests).toEqual(['/api/v1/admin/system/target-host-suffix-denylist', '/api/v1/admin/system/target-host-suffix-denylist/update'])
  })
})
