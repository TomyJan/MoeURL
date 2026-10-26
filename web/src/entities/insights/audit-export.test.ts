import { afterEach, describe, expect, it, vi } from 'vitest'
import { exportAuditRecords } from './audit-export'

const actorId = '00000000-0000-0000-0000-00000000000a'
const range = { startDate: '2026-10-16', endDate: '2026-10-22' }
const header = '\uFEFFstart_date,end_date,time_zone,audit_id,occurred_at,actor_id,actor_username,resource_type,resource_id,action,changed_fields\r\n'
const file = { fileName: 'moeurl-audit-2026-10-16-2026-10-22.csv', contentType: 'text/csv;charset=utf-8', content: header }
/** Uses the shared client's complete JSON wire contract. */
function response(data: unknown = file) { return new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} })) }
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
describe('audit CSV snapshot contract', () => {
  it('requests actual dates and all applied filters with GET and no pagination', async () => {
    let request: unknown
    vi.stubGlobal('fetch', async (path: string, options: RequestInit) => { request = { path, options }; return response() })
    expect(await exportAuditRecords(range, { actorId, resourceType: 'user', action: 'update' })).toEqual(file)
    expect(request).toEqual({ path: `/api/v1/admin/audit/export?startDate=2026-10-16&endDate=2026-10-22&actorId=${actorId}&resourceType=user&action=update`, options: { credentials: 'include', headers: { Accept: 'application/json' }, method: 'GET' } })
  })
  it('accepts empty results and server-confirmed dates ahead of the local clock', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T00:00:00Z'))
    let path = ''
    vi.stubGlobal('fetch', async (value: string) => { path = value; return response() })
    expect((await exportAuditRecords(range, { actorId: '', resourceType: '', action: '' })).content).toBe(header)
    expect(path).toBe('/api/v1/admin/audit/export?startDate=2026-10-16&endDate=2026-10-22')
  })
  it.each([
    { actorId: '00000000-0000-0000-0000-000000000000' }, { actorId: actorId.toUpperCase() }, { actorId: 'invalid' },
    { resourceType: 'other' }, { action: 'read' }, { cursor: 'next' }, { pageSize: '25' },
  ])('rejects invalid filters before a request %#', async filters => {
    let requests = 0
    vi.stubGlobal('fetch', async () => { requests++; return response() })
    await expect(exportAuditRecords(range, filters)).rejects.toMatchObject({ code: 100001 })
    expect(requests).toBe(0)
  })
  it.each([
    { startDate: '', endDate: range.endDate }, { startDate: '2026-02-30', endDate: range.endDate },
    { startDate: range.endDate, endDate: range.startDate }, { startDate: '2026-01-01', endDate: range.endDate },
    { ...range, days: 7 },
  ])('rejects invalid dates before a request %#', async dates => {
    let requests = 0
    vi.stubGlobal('fetch', async () => { requests++; return response() })
    await expect(exportAuditRecords(dates)).rejects.toMatchObject({ code: 100001 })
    expect(requests).toBe(0)
  })
  it.each([
    { ...file, fileName: '../private.csv' }, { ...file, fileName: 'moeurl-audit-2026-10-15-2026-10-22.csv' },
    { ...file, contentType: 'text/csv' }, { ...file, content: header.slice(1) },
    { ...file, content: header.replace('\r\n', '\n') }, { ...file, content: '\uFEFFsection,key,value\r\n' },
    { ...file, unexpected: true }, null,
    { ...file, content: header + '界'.repeat(Math.ceil(8 * 1024 * 1024 / 3)) },
    { ...file, content: header + 'a'.repeat(8 * 1024 * 1024) },
  ])('rejects malformed or oversized descriptors %#', async data => {
    vi.stubGlobal('fetch', async () => response(data))
    await expect(exportAuditRecords(range)).rejects.toMatchObject({ code: 100001 })
  })
  it('accepts precisely 8 MiB of UTF-8 content', async () => {
    const content = header + 'a'.repeat(8 * 1024 * 1024 - new TextEncoder().encode(header).length)
    vi.stubGlobal('fetch', async () => response({ ...file, content }))
    expect((await exportAuditRecords(range)).content).toBe(content)
  })
  it.each(['invalid', '{"code":0,"message":"OK"}', '{"code":0,"message":"OK","data":{},"meta":null}'])('rejects invalid envelopes %s', async body => {
    vi.stubGlobal('fetch', async () => new Response(body))
    await expect(exportAuditRecords(range)).rejects.toMatchObject({ code: 100001 })
  })
  it.each([100001, 100002, 120001])('preserves business error %s', async code => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ code, message: 'denied', data: null })))
    await expect(exportAuditRecords(range)).rejects.toMatchObject({ code })
  })
})
