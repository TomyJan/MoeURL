import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '@/shared/api/client'
import { transferShortLink } from './transfer'

const input = { id: '00000000-0000-0000-0000-000000000020', newOwnerUsername: 'recipient', expectedUpdatedAt: '2026-10-23T00:00:00.123456Z' }
const result = { id: input.id, ownerId: '00000000-0000-0000-0000-000000000002', updatedAt: '2026-10-23T00:00:00.123457Z' }
afterEach(() => vi.unstubAllGlobals())
describe('ownership transfer API', () => {
  it('posts the exact account and full-precision version and validates the result', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: result, meta: {} })))
    vi.stubGlobal('fetch', fetcher)
    expect(await transferShortLink(input)).toEqual(result)
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/v1/admin/short-link/transfer')
    expect(JSON.parse(fetcher.mock.calls[0]![1]!.body as string)).toEqual(input)
  })
  it.each(['', ' recipient', 'recipient ', 'x'.repeat(65)])('rejects invalid account %j before sending', async (newOwnerUsername) => {
    vi.stubGlobal('fetch', vi.fn())
    await expect(transferShortLink({ ...input, newOwnerUsername })).rejects.toBeInstanceOf(ApiClientError)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('rejects malformed responses and preserves business conflicts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: { ...result, updatedAt: 'invalid' }, meta: {} }))))
    await expect(transferShortLink(input)).rejects.toMatchObject({ code: 100001 })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 200116, message: 'changed', data: null, meta: {} }))))
    await expect(transferShortLink(input)).rejects.toMatchObject({ code: 200116 })
  })
})
