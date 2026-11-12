import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '@/shared/api/client'
import { getOwnDailyCreateUsage, OwnDailyCreateUsageSchema } from './usage'

const actor = '55ac4abf-b6fe-4e7d-ae50-aa2965fe276e'
const finite = { usageDay: '2026-11-12', used: '7', dailyLimit: 10, remaining: 3 }
afterEach(() => vi.unstubAllGlobals())

describe('strict own daily usage snapshot', () => {
  it.each([
    finite,
    { usageDay: '0001-01-01', used: '0', dailyLimit: 0, remaining: 0 },
    { usageDay: '9999-12-31', used: '9223372036854775807', dailyLimit: null, remaining: null },
    { usageDay: '2024-02-29', used: '9007199254740993', dailyLimit: 1000000, remaining: 0 },
    { ...finite, used: '10', remaining: 0 },
  ])('preserves exact validated values: %j', value => {
    expect(OwnDailyCreateUsageSchema.parse(value)).toEqual(value)
  })
  it.each([
    { ...finite, extra: true }, { ...finite, used: 7 },
    ...['', '-1', '+1', '01', '1.0', '1e3', ' 7', '7\n', '9223372036854775808', '9999999999999999999999999999999999999999'].map(used => ({ ...finite, used })),
    ...['0000-01-01', '10000-01-01', '2026-02-29', '2026-04-31', '2026-00-12', '2026-11-00', '2026-13-01', '2026-1-01', '2026-11-12T00:00:00Z', 'garbage'].map(usageDay => ({ ...finite, usageDay })),
    ...[-1, 1000001, 0.5, '10'].map(dailyLimit => ({ ...finite, dailyLimit })),
    ...[-1, 1000001, 0.5, '3', null, 2].map(remaining => ({ ...finite, remaining })),
    { ...finite, dailyLimit: null }, { ...finite, dailyLimit: 0, remaining: 3 },
  ])('rejects malformed or inconsistent data without coercion: %j', value => {
    expect(OwnDailyCreateUsageSchema.safeParse(value).success).toBe(false)
  })
  it('reads the authenticated resource with a captured owner header and unchanged int64 text', async () => {
    const data = { ...finite, used: '9223372036854775807', remaining: 0 }
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} })))
    vi.stubGlobal('fetch', fetcher)
    expect(await getOwnDailyCreateUsage(actor)).toEqual(data)
    expect(fetcher).toHaveBeenCalledWith('/api/v1/account/daily-create-usage', { method: 'GET', credentials: 'include', headers: { Accept: 'application/json', 'X-MoeURL-Expected-User-ID': actor } })
  })
  it.each(['', actor.toUpperCase(), '00000000-0000-0000-0000-000000000000', 'not-a-uuid'])('rejects an invalid owner before transport: %s', async owner => {
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    await expect(getOwnDailyCreateUsage(owner)).rejects.toThrow()
    expect(fetcher).not.toHaveBeenCalled()
  })
  it('keeps business denial instead of returning a zero snapshot', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ code: 120001, message: 'Denied', data: null, meta: {} })))
    await expect(getOwnDailyCreateUsage(actor)).rejects.toBeInstanceOf(ApiClientError)
  })
  it('rejects a successful envelope containing damaged usage', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ code: 0, message: 'OK', data: { ...finite, used: '-1' }, meta: {} })))
    await expect(getOwnDailyCreateUsage(actor)).rejects.toThrow()
  })
})
