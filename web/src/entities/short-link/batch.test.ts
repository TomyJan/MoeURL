import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '@/shared/api/client'
import { batchShortLinks } from './batch'

/** Exercises the batch contract through the real authenticated transport. */
function respond(data: unknown, code = 0, status = 200) {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ code, message: 'private', data, meta: {} }), { status }))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
afterEach(() => vi.unstubAllGlobals())
describe('batch short links API', () => {
  it.each(['own', 'admin'] as const)('posts frozen IDs and every action to the %s endpoint', async (context) => {
    for (const action of ['enable', 'disable', 'delete'] as const) {
      const fetcher = respond({ affectedCount: 2 })
      await expect(batchShortLinks({ ids: ['one', 'two'], action }, context)).resolves.toEqual({ affectedCount: 2 })
      expect(fetcher).toHaveBeenCalledExactlyOnceWith(`/api/v1/${context === 'admin' ? 'admin/' : ''}short-link/batch`, expect.objectContaining({ method: 'POST', credentials: 'include', body: JSON.stringify({ ids: ['one', 'two'], action }) }))
    }
  })
  it.each([null, {}, { affectedCount: 0 }, { affectedCount: -1 }, { affectedCount: 101 }, { affectedCount: 1.5 }, { affectedCount: '2' }, { affectedCount: 2, extra: true }, { affectedCount: 1 }])('rejects malformed or nonmatching success counts %#', async (data) => {
    respond(data)
    await expect(batchShortLinks({ ids: ['one', 'two'], action: 'delete' }, 'own')).rejects.toEqual(new ApiClientError(100001, 'Invalid batch response'))
  })
  it('accepts the upper matched-count boundary', async () => {
    respond({ affectedCount: 100 })
    await expect(batchShortLinks({ ids: Array.from({ length: 100 }, (_, index) => String(index)), action: 'enable' }, 'admin')).resolves.toEqual({ affectedCount: 100 })
  })
  it.each([[120001, 200, 120001], [200104, 200, 200104], [900000, 500, 500]])('preserves shared transport errors %s/%s', async (code, status, expected) => {
    respond(null, code, status)
    await expect(batchShortLinks({ ids: ['one'], action: 'disable' }, 'own')).rejects.toMatchObject({ code: expected })
  })
})
