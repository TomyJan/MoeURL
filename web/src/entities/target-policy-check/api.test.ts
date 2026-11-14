import { afterEach, expect, it, vi } from 'vitest'
import { checkTargetPolicy, TargetPolicyCheckInputSchema, TargetPolicyCheckResultSchema } from './api'

afterEach(() => vi.unstubAllGlobals())
const response = (data: unknown, code = 0) => new Response(JSON.stringify({ code, message: 'fixed', data, meta: {} }))

it.each(['allowed', 'invalid_target', 'restricted'])('decodes only the exact %s outcome and posts original bytes once', async outcome => {
  const fetcher = vi.fn().mockResolvedValue(response({ outcome }))
  vi.stubGlobal('fetch', fetcher)
  const input = { targetUrl: 'https://example.com/private?secret=fixture' }
  expect(await checkTargetPolicy(input)).toEqual({ outcome })
  expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/v1/admin/system/target-policy/check', expect.objectContaining({ method: 'POST', credentials: 'include', body: JSON.stringify(input) }))
})
it.each([null, {}, { outcome: 'ALLOW' }, { outcome: null }, { outcome: 'allowed', targetUrl: 'private' }, { outcome: ['allowed'] }])('rejects malformed or over-disclosing decisions %j', async data => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(data)))
  await expect(checkTargetPolicy({ targetUrl: 'https://example.com/' })).rejects.toThrow()
  expect(TargetPolicyCheckResultSchema.safeParse(data).success).toBe(false)
})
it.each(['', 'https://example.com/\n', 'https://example.com/\u0085', 'https://example.com/\ud800', 'a'.repeat(2049), '界'.repeat(683)])('rejects invalid input locally without sending it', async targetUrl => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher)
  expect(TargetPolicyCheckInputSchema.safeParse({ targetUrl }).success).toBe(false)
  await expect(checkTargetPolicy({ targetUrl })).rejects.toThrow()
  expect(fetcher).not.toHaveBeenCalled()
})
it('uses UTF-8 bytes, preserves whitespace and rejects extra request fields', () => {
  expect(TargetPolicyCheckInputSchema.parse({ targetUrl: '界'.repeat(682) + 'aa' }).targetUrl).toHaveLength(684)
  expect(TargetPolicyCheckInputSchema.parse({ targetUrl: ' https://example.com/ ' }).targetUrl).toBe(' https://example.com/ ')
  expect(TargetPolicyCheckInputSchema.safeParse({ targetUrl: 'ok', extra: 1 }).success).toBe(false)
  expect(TargetPolicyCheckInputSchema.safeParse({ targetUrl: null }).success).toBe(false)
})
it.each([900226, 120001, 900000])('preserves business failure %s without retrying', async code => {
  const fetcher = vi.fn().mockResolvedValue(response(null, code)); vi.stubGlobal('fetch', fetcher)
  await expect(checkTargetPolicy({ targetUrl: 'https://example.com/' })).rejects.toMatchObject({ code })
  expect(fetcher).toHaveBeenCalledTimes(1)
})
