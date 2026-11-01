import { afterEach, describe, expect, it, vi } from 'vitest'
import { getTimeZonePreference, updateTimeZonePreference, timeZonePresets } from './api'

function respond(data: unknown, code = 0) {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ code, message: '', data, meta: {} })))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
afterEach(() => vi.unstubAllGlobals())
describe('strict personal time-zone API', () => {
  it.each([null, '2026-11-01T00:00:00.123456789Z', '2026-11-01T08:00:00+08:00'])('preserves the complete version %s', async updatedAt => {
    const preference = { timeZone: updatedAt ? 'UTC' : null, updatedAt }
    const fetcher = respond({ preference })
    expect(await getTimeZonePreference()).toEqual(preference)
    const input = { timeZone: preference.timeZone, expectedUpdatedAt: updatedAt }
    expect(await updateTimeZonePreference(input)).toEqual(preference)
    expect(fetcher).toHaveBeenLastCalledWith('/api/v1/user/time-zone-preference/update', expect.objectContaining({ method: 'POST', credentials: 'include', body: JSON.stringify(input) }))
  })
  it.each(timeZonePresets)('accepts the exact supported zone %s', async timeZone => {
    const preference = { timeZone, updatedAt: '2026-11-01T00:00:00Z' }
    respond({ preference })
    expect(await getTimeZonePreference()).toEqual(preference)
  })
  it.each([
    null, {}, { preference: {} }, { preference: { timeZone: null } },
    { preference: { timeZone: 'UTC', updatedAt: null } },
    { preference: { timeZone: 'utc', updatedAt: '2026-11-01T00:00:00Z' } },
    { preference: { timeZone: ' UTC ', updatedAt: '2026-11-01T00:00:00Z' } },
    { preference: { timeZone: 'Europe/Berlin', updatedAt: '2026-11-01T00:00:00Z' } },
    { preference: { timeZone: null, updatedAt: '2026-02-30T00:00:00Z' } },
    { preference: { timeZone: null, updatedAt: '2026-11-01T00:00:00.1234567890Z' } },
    { preference: { timeZone: null, updatedAt: null, userId: 'private' } },
    { preference: { timeZone: null, updatedAt: null }, extra: true },
  ])('rejects malformed or private response fields %j', async data => {
    respond(data)
    await expect(getTimeZonePreference()).rejects.toMatchObject({ code: 100001, message: 'Invalid time-zone preference response' })
    await expect(updateTimeZonePreference({ timeZone: null, expectedUpdatedAt: null })).rejects.toMatchObject({ code: 100001 })
  })
  it.each([300104, 120001, 900000])('does not retry a rejected write %s', async code => {
    const fetcher = respond(null, code)
    await expect(updateTimeZonePreference({ timeZone: null, expectedUpdatedAt: null })).rejects.toMatchObject({ code })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
