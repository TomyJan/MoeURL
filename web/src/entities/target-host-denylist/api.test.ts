import { afterEach, describe, expect, it, vi } from 'vitest'
import { TargetHostDenylistSchema, UpdateTargetHostDenylistSchema, normalizeTargetPolicyHost, getTargetHostDenylist, updateTargetHostDenylist } from './api'

const version = '2026-11-11T05:00:00.123456Z'
const document = { hosts: ['blocked.example', 'xn--bcher-kva.example'], updatedAt: version }
const envelope = (data: unknown) => new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }))
afterEach(() => vi.unstubAllGlobals())

describe('independent target host policy contract', () => {
  it.each([
    [' EXAMPLE.COM. ', 'example.com'], ['\u3000EXAMPLE.COM\u00a0', 'example.com'],
    ['localhost', 'localhost'], ['ab--cd.example', 'ab--cd.example'],
    ['XN--BCHER-KVA.example', 'xn--bcher-kva.example'],
    ['a'.repeat(63) + '.example', 'a'.repeat(63) + '.example'],
  ])('validates %s with the same literal host as the backend', (raw, canonical) => {
    expect(normalizeTargetPolicyHost(raw)).toBe(canonical)
  })
  it.each([
    '', ' ', '\texample.com', 'example.com\n', '\u0085example.com', '\uFEFFexample.com', '\uD800',
    'K.example', 'İ.example', 'bücher.example', '*.example', 'example.com..', '.example',
    'https://example.com', 'example.com:443', 'user@example.com', 'example.com/path',
    'example.com?x', 'example.com#x', 'example_com', '-a.example', 'a-.example',
    'a'.repeat(64) + '.example', '127.0.0.1', '127.1', '[::1]', '::1', '123',
    'example.0x', 'example.0xabcdef', 'example.123', 'xn--a.example', 'xn--0.example',
    'xn--62g.example', 'a'.repeat(63) + '.' + 'b'.repeat(63) + '.' + 'c'.repeat(63) + '.' + 'd'.repeat(62),
  ])('refuses invalid or ambiguous administrative host %j', raw => {
    expect(() => normalizeTargetPolicyHost(raw)).toThrow()
  })
  it('preserves raw input order and spelling for the server, and rejects normalized duplicates', () => {
    const input = { hosts: [' Z.example. ', 'A.EXAMPLE'], expectedUpdatedAt: version }
    expect(UpdateTargetHostDenylistSchema.parse(input)).toEqual(input)
    expect(UpdateTargetHostDenylistSchema.safeParse({ ...input, hosts: ['A.example', ' a.EXAMPLE. '] }).success).toBe(false)
  })
  it('accepts zero and exactly 100 hosts but rejects 101 without silently dropping a row', () => {
    for (const count of [0, 100]) {
      const hosts = Array.from({ length: count }, (_, i) => `h${String(i).padStart(3, '0')}.example`)
      expect(TargetHostDenylistSchema.parse({ hosts, updatedAt: version }).hosts).toHaveLength(count)
      expect(UpdateTargetHostDenylistSchema.parse({ hosts, expectedUpdatedAt: version }).hosts).toHaveLength(count)
    }
    expect(UpdateTargetHostDenylistSchema.safeParse({ hosts: Array.from({ length: 101 }, (_, i) => `h${i}.example`), expectedUpdatedAt: version }).success).toBe(false)
    const maximum = ['a'.repeat(63), 'b'.repeat(63), 'c'.repeat(63), 'd'.repeat(61)].join('.')
    expect(maximum).toHaveLength(253)
    expect(normalizeTargetPolicyHost(maximum)).toBe(maximum)
    expect(() => normalizeTargetPolicyHost(maximum + '.')).toThrow()
  })
  it.each([{}, null, [], { hosts: null, updatedAt: version }, { ...document, private: true }, { ...document, hosts: [null] }, { ...document, hosts: ['https://example.com'] }, { ...document, hosts: ['B.example'] }, { ...document, hosts: ['a.example.'] }, { ...document, hosts: ['b.example', 'a.example'] }, { ...document, hosts: ['a.example', 'a.example'] }])('rejects malformed or noncanonical server document %#', input => {
    expect(TargetHostDenylistSchema.safeParse(input).success).toBe(false)
  })
  it.each(['', '0000-01-01T00:00:00Z', '0001-01-01T00:00:00Z', '0001-01-01T08:00:00+08:00', '2026-02-30T00:00:00Z', '2026-11-11', '2026-11-11T00:00:00', '2026-11-11T00:00:00.123456001Z'])('rejects invalid, zero or submicrosecond revision %s', updatedAt => {
    expect(TargetHostDenylistSchema.safeParse({ hosts: [], updatedAt }).success).toBe(false)
    expect(UpdateTargetHostDenylistSchema.safeParse({ hosts: [], expectedUpdatedAt: updatedAt }).success).toBe(false)
  })
  it.each([version, '2026-11-11T13:00:00.123456000+08:00', '0001-01-01T00:00:00.000001Z'])('preserves the complete usable revision %s', updatedAt => {
    expect(TargetHostDenylistSchema.parse({ hosts: [], updatedAt }).updatedAt).toBe(updatedAt)
    expect(UpdateTargetHostDenylistSchema.parse({ hosts: [], expectedUpdatedAt: updatedAt }).expectedUpdatedAt).toBe(updatedAt)
  })
  it('uses only the two private endpoints and sends the unchanged draft plus exact CAS version', async () => {
    const requests: unknown[] = []
    vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
      requests.push({ path, method: init.method, credentials: init.credentials, body: init.body && JSON.parse(String(init.body)) })
      return envelope(document)
    })
    expect(await getTargetHostDenylist()).toEqual(document)
    const input = { hosts: [' Z.example. ', 'A.EXAMPLE'], expectedUpdatedAt: version }
    expect(await updateTargetHostDenylist(input)).toEqual(document)
    expect(requests).toEqual([
      { path: '/api/v1/admin/system/target-host-denylist', method: 'GET', credentials: 'include', body: undefined },
      { path: '/api/v1/admin/system/target-host-denylist/update', method: 'POST', credentials: 'include', body: input },
    ])
  })
  it('rejects malformed server data and refuses invalid commands before any write', async () => {
    const requests: string[] = []
    vi.stubGlobal('fetch', async (path: string) => { requests.push(path); return envelope({ ...document, hosts: ['NOT-CANONICAL.example'] }) })
    await expect(getTargetHostDenylist()).rejects.toThrow()
    await expect(updateTargetHostDenylist({ hosts: ['https://example.com'], expectedUpdatedAt: version })).rejects.toThrow()
    expect(UpdateTargetHostDenylistSchema.safeParse({ hosts: [], expectedUpdatedAt: version, ignored: true }).success).toBe(false)
    expect(requests).toEqual(['/api/v1/admin/system/target-host-denylist'])
  })
})
