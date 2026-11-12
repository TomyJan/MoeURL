import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportVisitRecords, type VisitExportContext, type VisitExportFilters } from './visit-export'

const context = 'site' as VisitExportContext
const range = { startDate: '2026-10-16', endDate: '2026-10-22' }
const header = '\uFEFFshort_link_id,start_date,end_date,time_zone,event_id,occurred_at,referrer_host,device_type,browser_family,os_family,country_code\r\n'
const file = { fileName: 'moeurl-site-visits-2026-10-16-2026-10-22.csv', contentType: 'text/csv;charset=utf-8', content: header }
/** Uses the complete real client envelope at the HTTP boundary. */
function response(data: unknown = file, code = 0) { return new Response(JSON.stringify({ code, message: 'OK', data, meta: {} })) }
afterEach(() => vi.unstubAllGlobals())

describe('site visit CSV contract', () => {
  it('sends only the actual UTC dates to the site endpoint and accepts an empty CSV', async () => {
    const requests: { path: string; options?: RequestInit }[] = []
    vi.stubGlobal('fetch', async (path: string, options?: RequestInit) => { requests.push({ path, options }); return response() })
    expect(await exportVisitRecords('site', context, range)).toEqual(file)
    expect(requests).toEqual([{ path: '/api/v1/admin/dashboard/visits/export?startDate=2026-10-16&endDate=2026-10-22', options: { method: 'GET', credentials: 'include', headers: { Accept: 'application/json' } } }])
  })
  it.each([
    { id: '00000000-0000-0000-0000-000000000001' }, { id: '' },
    { filters: { deviceType: 'desktop' } }, { filters: { countryCode: 'US' } }, { filters: { deviceType: '' } },
    { filters: { id: 'site' } }, { filters: { cursor: 'next' } }, { filters: { pageSize: 25 } },
    { range: { ...range, days: 7 } }, { range: { ...range, timeZone: 'UTC' } },
    { range: { startDate: '2026-02-30', endDate: range.endDate } },
    { range: { startDate: range.endDate, endDate: range.startDate } },
    { range: { startDate: '2026-01-01', endDate: range.endDate } },
  ])('rejects a link identity, filters or invalid dates before network %#', async changes => {
    const fetcher = vi.fn(async () => response())
    vi.stubGlobal('fetch', fetcher)
    const input = { id: 'site', range, filters: {}, ...changes }
    await expect(exportVisitRecords(input.id, context, input.range, input.filters as VisitExportFilters)).rejects.toMatchObject({ code: 100001 })
    expect(fetcher).not.toHaveBeenCalled()
  })
  it.each([
    { ...file, fileName: 'moeurl-visits-site-2026-10-16-2026-10-22.csv' },
    { ...file, fileName: '../private.csv' }, { ...file, fileName: file.fileName.replace('10-16', '10-15') },
    { ...file, contentType: 'text/csv' }, { ...file, content: header.slice(1) },
    { ...file, content: header.replace('\r\n', '\n') }, { ...file, extra: true }, null,
    { ...file, content: header + '界'.repeat(Math.ceil(8 * 1024 * 1024 / 3)) },
  ])('rejects an unsafe site descriptor %#', async data => {
    vi.stubGlobal('fetch', async () => response(data))
    await expect(exportVisitRecords('site', context, range)).rejects.toMatchObject({ code: 100001 })
  })
  it('accepts the exact site CSV UTF-8 byte limit', async () => {
    const content = header + 'x'.repeat(8 * 1024 * 1024 - new TextEncoder().encode(header).length)
    vi.stubGlobal('fetch', async () => response({ ...file, content }))
    expect((await exportVisitRecords('site', context, range)).content).toBe(content)
  })
  it.each([100001, 120001, 200120, 900000])('preserves site business failure %s', async code => {
    vi.stubGlobal('fetch', async () => response(null, code))
    await expect(exportVisitRecords('site', context, range)).rejects.toMatchObject({ code })
  })
})
