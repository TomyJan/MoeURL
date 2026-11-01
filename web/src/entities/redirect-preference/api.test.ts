import { afterEach, expect, it, vi } from 'vitest'
import { getRedirectPreference, updateRedirectPreference } from './api'

function respond(data: unknown, code = 0) {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ code, message: '', data, meta: {} })))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
afterEach(() => vi.unstubAllGlobals())

it.each([null, '2026-11-02T00:00:00.123456789Z', '2026-11-02T08:00:00+08:00'])('preserves the complete independent revision %s', async updatedAt => {
  const preference = { redirectMode: updatedAt ? 'confirmation' as const : null, updatedAt }
  const fetcher = respond({ preference })
  expect(await getRedirectPreference()).toEqual(preference)
  const input = { redirectMode: preference.redirectMode, expectedUpdatedAt: updatedAt }
  expect(await updateRedirectPreference(input)).toEqual(preference)
  expect(fetcher).toHaveBeenLastCalledWith('/api/v1/user/redirect-preference/update', expect.objectContaining({ method: 'POST', credentials: 'include', body: JSON.stringify(input) }))
})
it.each(['direct', 'intermediate', 'confirmation', null])('accepts the exact nullable mode %s', async redirectMode => {
  const preference = { redirectMode, updatedAt: '2026-11-02T00:00:00Z' }
  respond({ preference })
  expect(await getRedirectPreference()).toEqual(preference)
})
it.each([
  null, {}, { preference: {} }, { preference: { redirectMode: null } },
  { preference: { redirectMode: 'direct', updatedAt: null } },
  { preference: { redirectMode: 'Direct', updatedAt: '2026-11-02T00:00:00Z' } },
  { preference: { redirectMode: '', updatedAt: '2026-11-02T00:00:00Z' } },
  { preference: { redirectMode: null, updatedAt: '2026-02-30T00:00:00Z' } },
  { preference: { redirectMode: null, updatedAt: '2026-11-02T00:00:00.1234567890Z' } },
  { preference: { redirectMode: null, updatedAt: null, userId: 'private' } },
  { preference: { redirectMode: null, updatedAt: null }, extra: true },
])('rejects malformed or private fields %j', async data => {
  respond(data)
  await expect(getRedirectPreference()).rejects.toMatchObject({ code: 100001, message: 'Invalid redirect preference response' })
  await expect(updateRedirectPreference({ redirectMode: null, expectedUpdatedAt: null })).rejects.toMatchObject({ code: 100001 })
})
it.each([300104, 120001, 900000])('returns a rejected write without retry %s', async code => {
  const fetcher = respond(null, code)
  await expect(updateRedirectPreference({ redirectMode: null, expectedUpdatedAt: null })).rejects.toMatchObject({ code })
  expect(fetcher).toHaveBeenCalledTimes(1)
})
