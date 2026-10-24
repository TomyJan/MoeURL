import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '@/shared/api/client'
import { exportShortLinkList } from './list-export'

const header = '\uFEFFid,short_url,slug,target_url,title,tags,status,redirect_mode,intermediate_delay_seconds,expires_at,password_enabled,max_visits,visits_used,created_at,updated_at,owner_id,owner_username\r\n'
const descriptor = { fileName: 'moeurl-links-own.csv', contentType: 'text/csv;charset=utf-8', content: header }
/** Supplies server envelopes at the real transport boundary. */
function respond(data: unknown, code = 0, status = 200) {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ code, message: 'private', data, meta: {} }), { status }))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
afterEach(() => vi.unstubAllGlobals())
describe('short-link list export API', () => {
  it.each(['own', 'admin'] as const)('exports only applied filters through %s without pagination', async (context) => {
    const file = { ...descriptor, fileName: context === 'admin' ? 'moeurl-links-all.csv' : descriptor.fileName }
    const fetcher = respond(file)
    await expect(exportShortLinkList({ status: 'disabled', q: 'title &?', tag: '精确' }, context)).resolves.toEqual(file)
    expect(fetcher).toHaveBeenCalledWith(`/api/v1/${context === 'admin' ? 'admin/' : ''}short-link/export?status=disabled&q=title+%26%3F&tag=%E7%B2%BE%E7%A1%AE`, expect.objectContaining({ method: 'GET', credentials: 'include' }))
  })
  it('omits empty filters and permits an empty header-only export', async () => {
    const fetcher = respond(descriptor)
    await expect(exportShortLinkList({ status: '', q: '', tag: '' }, 'own')).resolves.toEqual(descriptor)
    expect(fetcher).toHaveBeenCalledWith('/api/v1/short-link/export', expect.anything())
  })
  it.each([
    null, {}, { ...descriptor, extra: true }, { ...descriptor, contentType: 'text/html' },
    { ...descriptor, fileName: '../links.csv' }, { ...descriptor, fileName: 'moeurl-links-all.csv' },
    { ...descriptor, fileName: 'moeurl-links-own.csv\n' }, { ...descriptor, content: header.slice(1) },
    { ...descriptor, content: header.replace('\r\n', '\n') },
    { ...descriptor, content: header + 'a'.repeat(8 * 1024 * 1024) },
    { ...descriptor, content: header + '界'.repeat(3 * 1024 * 1024) },
  ])('rejects malformed, unsafe or oversized descriptors %#', async (data) => {
    respond(data)
    await expect(exportShortLinkList({}, 'own')).rejects.toEqual(new ApiClientError(100001, 'Invalid short-link list export response'))
  })
  it('accepts the exact UTF-8 byte limit', async () => {
    const file = { ...descriptor, content: header + 'a'.repeat(8 * 1024 * 1024 - new TextEncoder().encode(header).length) }
    respond(file)
    await expect(exportShortLinkList({}, 'own')).resolves.toEqual(file)
  })
  it.each([[120001, 200, 120001], [200118, 200, 200118], [900000, 500, 500], [0, 401, 401]])('preserves transport errors %s/%s', async (code, status, expected) => {
    respond(null, code, status)
    await expect(exportShortLinkList({}, 'own')).rejects.toMatchObject({ code: expected })
  })
})
