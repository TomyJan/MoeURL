import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportVisitRecords } from './visit-export'

const id = '00000000-0000-0000-0000-000000000001'
const range = { startDate: '2026-10-16', endDate: '2026-10-22' }
const header = '\uFEFFshort_link_id,start_date,end_date,time_zone,event_id,occurred_at,referrer_host,device_type,browser_family,os_family,country_code\r\n'
const file = { fileName: `moeurl-visits-${id}-2026-10-16-2026-10-22.csv`, contentType: 'text/csv;charset=utf-8', content: header }
/** Supplies the real shared client's wire envelope. */
function response(data: unknown = file) { return new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} })) }
afterEach(() => vi.unstubAllGlobals())
describe('visit record CSV contract', () => {
  it.each(['own', 'admin'] as const)('sends the complete actual dates and filters without pagination in %s', async context => {
    let request: { path: string; options?: RequestInit } | undefined
    vi.stubGlobal('fetch', async (path: string, options?: RequestInit) => { request = { path, options }; return response() })
    expect(await exportVisitRecords(id, context, range, { deviceType: 'unknown', countryCode: 'unknown' })).toEqual(file)
    expect(request).toEqual({ path: `/api/v1/${context === 'admin' ? 'admin/' : ''}short-link/visits/export?id=${id}&startDate=2026-10-16&endDate=2026-10-22&deviceType=unknown&countryCode=unknown`, options: { credentials: 'include', headers: { Accept: 'application/json' }, method: 'GET' } })
  })
  it('omits unapplied empty UI filters and accepts an empty CSV result', async () => {
    let path = ''
    vi.stubGlobal('fetch', async (value: string) => { path = value; return response() })
    expect((await exportVisitRecords(id, 'own', range, { deviceType: '', countryCode: '' })).content).toBe(header)
    expect(path).toBe(`/api/v1/short-link/visits/export?id=${id}&startDate=2026-10-16&endDate=2026-10-22`)
  })
  it.each([
    { id: '00000000-0000-0000-0000-000000000000' }, { id: 'INVALID' }, { id: id.toUpperCase().replace('0001', '000A') },
    { context: 'other' }, { range: { startDate: '', endDate: range.endDate } },
    { range: { startDate: '2026-02-30', endDate: range.endDate } }, { range: { startDate: range.endDate, endDate: range.startDate } },
    { range: { startDate: '2026-01-01', endDate: '2026-10-22' } }, { range: { startDate: '2099-01-01', endDate: '2099-01-02' } },
    { range: { ...range, days: 7 } }, { filters: { deviceType: 'phone' } }, { filters: { countryCode: 'us' } },
    { filters: { cursor: 'page2' } }, { filters: { pageSize: '25' } },
  ])('rejects invalid input before any network request %#', async changes => {
    let requests = 0
    vi.stubGlobal('fetch', async () => { requests++; return response() })
    const input = { id, context: 'own', range, filters: {}, ...changes }
    await expect(exportVisitRecords(input.id, input.context as 'own', input.range, input.filters)).rejects.toMatchObject({ code: 100001 })
    expect(requests).toBe(0)
  })
  it.each([
    { ...file, fileName: '../private.csv' }, { ...file, fileName: file.fileName.replace('000001-', '000002-') },
    { ...file, fileName: file.fileName.replace('10-16', '10-15') }, { ...file, contentType: 'text/csv' },
    { ...file, content: header.slice(1) }, { ...file, content: header.replace('\r\n', '\n') },
    { ...file, content: '\uFEFFsection,key,value,visit_count\r\n' }, { ...file, unexpected: true }, null,
    { ...file, content: header + '界'.repeat(Math.ceil(8 * 1024 * 1024 / 3)) },
    { ...file, content: header + 'a'.repeat(8 * 1024 * 1024) },
  ])('rejects unsafe or oversized descriptors %#', async data => {
    vi.stubGlobal('fetch', async () => response(data))
    await expect(exportVisitRecords(id, 'own', range, {})).rejects.toMatchObject({ code: 100001 })
  })
  it('accepts the exact UTF-8 byte ceiling', async () => {
    const content = header + 'a'.repeat(8 * 1024 * 1024 - new TextEncoder().encode(header).length)
    vi.stubGlobal('fetch', async () => response({ ...file, content }))
    expect((await exportVisitRecords(id, 'own', range)).content).toBe(content)
  })
  it.each(['invalid', '{"code":0,"message":"OK"}', '{"code":0,"message":"OK","data":{},"meta":null}'])('rejects malformed envelopes %s', async body => {
    vi.stubGlobal('fetch', async () => new Response(body))
    await expect(exportVisitRecords(id, 'own', range)).rejects.toMatchObject({ code: 100001 })
  })
  it.each([100001, 120001, 200104, 200120])('preserves business error %s', async code => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ code, message: 'denied', data: null })))
    await expect(exportVisitRecords(id, 'own', range)).rejects.toMatchObject({ code })
  })
})
