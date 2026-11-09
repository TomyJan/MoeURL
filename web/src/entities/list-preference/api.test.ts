import { afterEach, expect, it, vi } from 'vitest'
import { getListPreference, updateListPreference } from './api'

function respond(data: unknown, code = 0) {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ code, message: '', data })))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
afterEach(() => vi.unstubAllGlobals())

it.each([null, 20, 50, 100] as const)('reads and explicitly saves the independent size %s with the captured identity', async pageSize => {
  const updatedAt = '2026-11-09T00:00:00.123456789Z'
  const preference = { pageSize, updatedAt }
  const fetcher = respond({ preference })
  expect(await getListPreference('A')).toEqual(preference)
  expect(fetcher).toHaveBeenLastCalledWith('/api/v1/user/list-preference', expect.objectContaining({
    credentials: 'include', headers: expect.objectContaining({ 'X-MoeURL-Expected-User-ID': 'A' }),
  }))
  const input = { pageSize, expectedUpdatedAt: updatedAt }
  expect(await updateListPreference(input, 'A')).toEqual(preference)
  expect(fetcher).toHaveBeenLastCalledWith('/api/v1/user/list-preference/update', expect.objectContaining({
    method: 'POST', credentials: 'include', body: JSON.stringify(input), headers: expect.objectContaining({ 'X-MoeURL-Expected-User-ID': 'A' }),
  }))
})

it.each([null, '2026-11-09T08:00:00+08:00'])('preserves the unset or offset revision %s', async updatedAt => {
  const preference = { pageSize: null, updatedAt }
  respond({ preference })
  expect(await getListPreference('A')).toEqual(preference)
})

it.each([
  null, {}, { preference: {} }, { preference: { pageSize: null } },
  { preference: { pageSize: 20, updatedAt: null } },
  ...[0, 21, 20.5, '20', true, [], {}].map(pageSize => ({ preference: { pageSize, updatedAt: '2026-11-09T00:00:00Z' } })),
  { preference: { pageSize: null, updatedAt: '2026-02-30T00:00:00Z' } },
  { preference: { pageSize: null, updatedAt: '2026-11-09T00:00:00.1234567890Z' } },
  { preference: { pageSize: null, updatedAt: null, userId: 'private' } },
  { preference: { pageSize: null, updatedAt: null }, extra: true },
])('rejects incomplete, coerced or expanded documents %j', async data => {
  respond(data)
  await expect(getListPreference('A')).rejects.toMatchObject({ code: 100001, message: 'Invalid list preference response' })
  await expect(updateListPreference({ pageSize: null, expectedUpdatedAt: null }, 'A')).rejects.toMatchObject({ code: 100001 })
})

it.each([300104, 120001, 900000])('does not resend rejected CAS writes %s', async code => {
  const fetcher = respond(null, code)
  await expect(updateListPreference({ pageSize: null, expectedUpdatedAt: null }, 'A')).rejects.toMatchObject({ code })
  expect(fetcher).toHaveBeenCalledTimes(1)
})
