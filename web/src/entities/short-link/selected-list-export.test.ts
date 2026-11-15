import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportSelectedShortLinkList } from './selected-list-export'
import { exportShortLinkList } from './list-export'
import { ApiClientError } from '@/shared/api/client'

const actor = '10000000-0000-0000-0000-000000000001'
const id = 'abcdef01-0000-0000-0000-000000000001'
const header = '\uFEFFid,short_url,slug,target_url,title,tags,status,redirect_mode,intermediate_delay_seconds,expires_at,password_enabled,max_visits,visits_used,created_at,updated_at,owner_id,owner_username\r\n'
const file = { fileName: 'moeurl-links-own-selected.csv', contentType: 'text/csv;charset=utf-8', content: header }
/** Replaces only the external transport while exercising the real validation and API client. */
function respond(data: unknown, code = 0, status = 200) {
  const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ code, message: 'private', data, meta: {} }), { status }))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
afterEach(() => vi.unstubAllGlobals())

describe('selected list export entity', () => {
  it.each(['own', 'admin'] as const)('sends one explicit %s POST with only IDs, actor binding and cancellation', async context => {
    const descriptor = { ...file, fileName: context === 'own' ? file.fileName : 'moeurl-links-all-selected.csv' }
    const fetcher = respond(descriptor), controller = new AbortController()
    await expect(exportSelectedShortLinkList({ ids: [id] }, context, actor, controller.signal)).resolves.toEqual(descriptor)
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/v1/' + (context === 'admin' ? 'admin/' : '') + 'short-link/export/selected', {
      method: 'POST', body: JSON.stringify({ ids: [id] }), credentials: 'include', signal: controller.signal,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-MoeURL-Expected-User-ID': actor },
    })
  })
  it('accepts exactly 100 distinct canonical IDs without requiring an AbortSignal', async () => {
    const ids = Array.from({ length: 100 }, (_, index) => '00000000-0000-0000-0000-' + String(index + 1).padStart(12, '0'))
    const fetcher = respond(file)
    await expect(exportSelectedShortLinkList({ ids }, 'own', actor)).resolves.toEqual(file)
    expect(fetcher.mock.calls[0]?.[1]?.body).toBe(JSON.stringify({ ids }))
  })
  it.each([
    null, {}, { ids: null }, { ids: [] }, { ids: [id, id] }, { ids: Array(101).fill(id) }, { ids: [null] },
    { ids: [id.toUpperCase()] }, { ids: [' ' + id] }, { ids: ['00000000-0000-0000-0000-000000000000'] },
    { ids: [id], noteQuery: 'private' }, { ids: [id], scope: 'all' }, { ids: [1] },
  ])('rejects the whole malformed request before transport %#', async input => {
    const fetcher = respond(file)
    await expect(exportSelectedShortLinkList(input as never, 'own', actor)).rejects.toMatchObject({ code: 100001 })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each(['', 'actor', actor + ' ', '00000000-0000-0000-0000-000000000000'])('rejects invalid actor %s before transport', async userId => {
    const fetcher = respond(file)
    await expect(exportSelectedShortLinkList({ ids: [id] }, 'own', userId)).rejects.toMatchObject({ code: 100001 })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('rejects an unknown runtime context instead of silently using the personal endpoint', async () => {
    const fetcher = respond(file)
    await expect(exportSelectedShortLinkList({ ids: [id] }, 'other' as never, actor)).rejects.toMatchObject({ code: 100001 })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([
    null, {}, { ...file, extra: true }, { ...file, contentType: 'text/html' }, { ...file, fileName: 'moeurl-links-own.csv' },
    { ...file, fileName: 'moeurl-links-all-selected.csv' }, { ...file, fileName: '../links.csv' },
    { ...file, content: header.slice(1) }, { ...file, content: header.replace('\r\n', '\n') },
    { ...file, content: header + 'x'.repeat(8 * 1024 * 1024) }, { ...file, content: header + '界'.repeat(3 * 1024 * 1024) },
  ])('rejects malformed or cross-context descriptors %#', async data => {
    respond(data)
    await expect(exportSelectedShortLinkList({ ids: [id] }, 'own', actor)).rejects.toEqual(new ApiClientError(100001, 'Invalid selected short-link export response'))
  })
  it('accepts the exact UTF-8 limit while the legacy endpoint still rejects selected filenames', async () => {
    const descriptor = { ...file, content: header + 'x'.repeat(8 * 1024 * 1024 - new TextEncoder().encode(header).length) }
    respond(descriptor)
    await expect(exportSelectedShortLinkList({ ids: [id] }, 'own', actor)).resolves.toEqual(descriptor)
    await expect(exportShortLinkList({}, 'own')).rejects.toMatchObject({ code: 100001 })
  })
  it.each([[120001, 200, 120001], [200118, 200, 200118], [900000, 500, 500], [0, 401, 401]])('preserves transport or business failure %s/%s', async (code, status, expected) => {
    respond(null, code, status)
    await expect(exportSelectedShortLinkList({ ids: [id] }, 'own', actor)).rejects.toMatchObject({ code: expected })
  })
})
