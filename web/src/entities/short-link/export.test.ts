import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '@/shared/api/client'
import { exportShortLinkStatistics } from './export'

const descriptor = {
  fileName: 'moeurl-statistics-abc123-2026-10-09-2026-10-15.csv',
  contentType: 'text/csv;charset=utf-8',
  content: '\uFEFFsection,key,value,visit_count\r\n',
}
/** Exercises validation through the real authenticated transport. */
function respond(data: unknown, code = 0, status = 200) {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ code, message: 'private', data, meta: {} }), { status }))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
afterEach(() => vi.unstubAllGlobals())
describe('statistics export API', () => {
  it.each(['own', 'admin'] as const)('requests exact dates through the %s endpoint', async (context) => {
    const fetcher = respond(descriptor)
    await expect(exportShortLinkStatistics('id &?', { startDate: '2026-10-09', endDate: '2026-10-15' }, context)).resolves.toEqual(descriptor)
    expect(fetcher).toHaveBeenCalledWith(`/api/v1/${context === 'admin' ? 'admin/' : ''}short-link/statistics/export?id=id+%26%3F&startDate=2026-10-09&endDate=2026-10-15`, expect.objectContaining({ method: 'GET', credentials: 'include' }))
  })
  it.each([
    null, {}, { ...descriptor, extra: true }, { ...descriptor, contentType: 'text/html' },
    { ...descriptor, fileName: '../abc.csv' }, { ...descriptor, fileName: 'moeurl-statistics-AbC-2026-10-09-2026-10-15.csv' },
    { ...descriptor, fileName: 'moeurl-statistics-abc-2026-02-30-2026-03-01.csv' },
    { ...descriptor, fileName: 'moeurl-statistics-abc-2026-10-15-2026-10-09.csv' },
    { ...descriptor, fileName: `${descriptor.fileName}\n` },
    { ...descriptor, content: 'section,key,value,visit_count\r\n' },
    { ...descriptor, content: '\uFEFFsection,key,value,visit_count\n' },
    { ...descriptor, content: '\uFEFFsection,key,value\r\n' },
  ])('rejects unsafe or malformed download metadata %#', async (data) => {
    respond(data)
    await expect(exportShortLinkStatistics('id', { startDate: '2026-10-09', endDate: '2026-10-15' }, 'own')).rejects.toEqual(new ApiClientError(100001, 'Invalid statistics export response'))
  })
  it.each([[120001, 200, 120001], [200104, 200, 200104], [900000, 500, 500], [0, 401, 401]])('preserves shared transport errors %s/%s', async (code, status, expected) => {
    respond(null, code, status)
    await expect(exportShortLinkStatistics('id', { startDate: '2026-10-09', endDate: '2026-10-15' }, 'own')).rejects.toMatchObject({ code: expected })
  })
})
