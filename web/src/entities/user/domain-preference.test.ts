import { afterEach, describe, expect, it, vi } from 'vitest'
import { getDomainPreference, updateDomainPreference } from './domain-preference'

const id = '22222222-2222-4222-8222-222222222222'
/** Supplies an untrusted HTTP response without replacing validation or transport. */
function respond(data: unknown, code = 0) {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ code, message: '', data, meta: {} })))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
afterEach(() => vi.unstubAllGlobals())
describe('domain preference API contract', () => {
  it.each([null, '2026-10-27T01:02:03.123456789Z', '2026-10-27T01:02:03+08:00'])('preserves the original version %s', async (updatedAt) => {
    const value = { domainId: updatedAt ? id : null, updatedAt }
    const fetcher = respond({ preference: value })
    expect(await getDomainPreference()).toEqual(value)
    expect(await updateDomainPreference({ domainId: id, expectedUpdatedAt: updatedAt })).toEqual(value)
    expect(fetcher).toHaveBeenLastCalledWith('/api/v1/user/domain-preference/update', expect.objectContaining({ body: JSON.stringify({ domainId: id, expectedUpdatedAt: updatedAt }) }))
  })
  it.each([null, {}, { preference: {} }, { preference: { domainId: id } },
    { preference: { domainId: '00000000-0000-0000-0000-000000000000', updatedAt: null } },
    { preference: { domainId: id.toUpperCase().replace('22222222', 'AAAAAAAA'), updatedAt: null } },
    { preference: { domainId: id, updatedAt: 'invalid' } },
    { preference: { domainId: id, updatedAt: '2026-10-27T01:02:03.1234567890Z' } },
    { preference: { domainId: null, updatedAt: null, userId: 'secret' } },
    { preference: { domainId: null, updatedAt: null }, extra: true },
  ])('rejects malformed data without exposing it %j', async (data) => {
    respond(data)
    await expect(getDomainPreference()).rejects.toMatchObject({ code: 100001, message: 'Invalid domain preference response' })
    await expect(updateDomainPreference({ domainId: null, expectedUpdatedAt: null })).rejects.toMatchObject({ code: 100001 })
  })
  it.each([300104, 120001])('retains business error %s', async (code) => {
    respond(null, code)
    await expect(getDomainPreference()).rejects.toMatchObject({ code })
  })
})
