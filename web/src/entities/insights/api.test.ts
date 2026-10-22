import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '@/shared/api/client'
import { getDashboard, getVisits, getAudit } from './api'

const range = { startDate: '2026-10-16', endDate: '2026-10-22', timeZone: 'UTC' }
const page = { range, pageSize: 25, hasMore: false, nextCursor: '' }
const visit = { id: '00000000-0000-0000-0000-000000000001', occurredAt: '2026-10-22T01:02:03.123456Z', referrerHost: null, deviceType: null, browserFamily: null, osFamily: null, countryCode: null }
const audit = { id: '9223372036854775807', actorId: null, actorUsername: null, resourceType: 'short_link', resourceId: visit.id, action: 'create', changedFields: ['title'], occurredAt: visit.occurredAt }
/** Serves complete wire envelopes while retaining the actual API decoder. */
function serve(data: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }))))
}
afterEach(() => vi.unstubAllGlobals())

describe('insight wire contracts', () => {
  it('reads global counts, trend and deleted popular links without inventing metrics', async () => {
    serve({ range, summary: { userCount: 3, activeUserCount: 2, linkCount: 4, activeLinkCount: 1, todayCreatedLinkCount: 0, todayVisitCount: 5, rangeVisitCount: 7 }, trend: [{ date: range.endDate, visitCount: 7 }], topLinks: [{ id: visit.id, slug: 'abc', url: 'https://go.example/abc', title: '', deleted: true, visitCount: 7 }], generatedAt: visit.occurredAt })
    const result = await getDashboard({ days: 30 })
    expect(result.summary.rangeVisitCount).toBe(7)
    expect(result.topLinks[0]?.deleted).toBe(true)
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe('/api/v1/admin/dashboard?days=30')
  })
  it.each(['own', 'admin'] as const)('encodes %s records with explicit applied dates, filters and cursor', async (context) => {
    serve({ ...page, items: [visit] })
    const result = await getVisits(visit.id, context, { startDate: range.startDate, endDate: range.endDate }, { deviceType: 'unknown', countryCode: 'US', cursor: 'a+b' })
    expect(result.items[0]).toEqual(visit)
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(`/api/v1/${context === 'admin' ? 'admin/' : ''}short-link/visits?startDate=2026-10-16&endDate=2026-10-22&id=${visit.id}&deviceType=unknown&countryCode=US&cursor=a%2Bb`)
  })
  it('preserves bigint audit IDs and submillisecond timestamp text', async () => {
    serve({ ...page, items: [audit], retentionDays: 180 })
    const result = await getAudit(undefined, { actorId: visit.id, resourceType: 'short_link', action: 'create' })
    expect(result.items[0]).toEqual(audit)
    expect(vi.mocked(fetch).mock.calls[0]?.[0]).toBe(`/api/v1/admin/audit/list?actorId=${visit.id}&resourceType=short_link&action=create`)
  })
  it.each([
    { ...page, items: [{ ...visit, browserFamily: 1 }] },
    { ...page, items: [{ ...visit, occurredAt: 'yesterday' }] },
    { ...page, hasMore: true, nextCursor: '', items: [] },
  ])('rejects malformed visit data with the shared numeric error contract', async (data) => {
    serve(data)
    await expect(getVisits(visit.id, 'own')).rejects.toMatchObject({ name: 'ApiClientError', code: 100001, meta: {} })
  })
  it.each([{ ...audit, id: Number('9223372036854775807') }, { ...audit, action: 'destroy' }, { ...audit, resourceType: 'secret' }, { ...audit, id: '9223372036854775808' }])('rejects audit precision loss and unknown enums', async (item) => {
    serve({ ...page, items: [item], retentionDays: 180 })
    await expect(getAudit()).rejects.toBeInstanceOf(ApiClientError)
  })
  it('rejects incomplete dashboard data rather than manufacturing zero counts', async () => {
    serve({ range, summary: {}, trend: [], topLinks: [], generatedAt: visit.occurredAt })
    await expect(getDashboard()).rejects.toMatchObject({ code: 100001 })
  })
})
