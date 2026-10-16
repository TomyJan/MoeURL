import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiClientError } from '@/shared/api/client'
import { getAccountPreferences, updateAccountPreferences } from './preferences'

/** Exercises response validation through the authenticated HTTP boundary. */
function respond(preferences: unknown, code = 0, status = 200) {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ code, message: 'private detail', data: { preferences }, meta: {} }), { status }))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
afterEach(() => vi.unstubAllGlobals())
describe('account preferences API', () => {
  it.each([
    { language: null, theme: null, updatedAt: null },
    { language: 'en', theme: 'dark', updatedAt: '2026-10-16T01:02:03.123456789Z' },
    { language: 'zh-CN', theme: 'system', updatedAt: '2026-10-16T01:02:03+08:00' },
    { language: null, theme: 'light', updatedAt: '2026-10-16T01:02:03Z' },
  ])('loads and preserves the exact nullable version %j', async (preferences) => {
    const fetcher = respond(preferences)
    await expect(getAccountPreferences()).resolves.toEqual(preferences)
    expect(fetcher).toHaveBeenCalledWith('/api/v1/user/preferences', expect.objectContaining({ method: 'GET', credentials: 'include' }))
  })
  it('posts a complete replacement without a client supplied identity', async () => {
    const preferences = { language: null, theme: 'light', updatedAt: '2026-10-16T01:02:03Z' }
    const fetcher = respond(preferences)
    const input = { language: null, theme: 'light' as const, expectedUpdatedAt: null }
    await expect(updateAccountPreferences(input)).resolves.toEqual(preferences)
    expect(fetcher).toHaveBeenCalledWith('/api/v1/user/preferences/update', expect.objectContaining({ method: 'POST', body: JSON.stringify(input) }))
  })
  it.each([null, {}, { language: 'fr', theme: null, updatedAt: null }, { language: null, theme: 'auto', updatedAt: null }, { language: null, theme: null, updatedAt: 'invalid' }, { language: null, theme: null, updatedAt: '2026-10-16T01:02:03.1234567890Z' }, { language: null, theme: null, updatedAt: '2026-10-16T01:02Z' }, { language: null, theme: null, updatedAt: '2026-10-16T01:02:03+24:00' }, { language: null, theme: null, updatedAt: null, userId: 'secret' }])('rejects malformed data with a friendly contract %j', async (value) => {
    respond(value)
    await expect(getAccountPreferences()).rejects.toEqual(new ApiClientError(100001, 'Invalid account preferences response'))
    await expect(updateAccountPreferences({ language: null, theme: null, expectedUpdatedAt: null })).rejects.toMatchObject({ code: 100001 })
  })
  it.each([[300104, 200, 300104], [120001, 200, 120001], [900000, 500, 500], [0, 401, 401]])('preserves shared error mapping %s/%s', async (code, status, expected) => {
    respond(null, code, status)
    await expect(getAccountPreferences()).rejects.toMatchObject({ code: expected })
  })
})
