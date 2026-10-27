import { afterEach, expect, it, vi } from 'vitest'
import { getCurrentGroupDefaultDomain, getUserGroupDomainDefault, setUserGroupDomainDefault } from './domain-default'

const id = 'aaaaaaaa-1111-4111-8111-111111111111'
const updatedAt = '2026-10-27T01:02:03.123456789+08:00'
const valid = { setting: { groupKey: 'user', domainId: id, updatedAt, editable: true }, candidates: [{ id, host: 'domain.example', displayName: 'Domain', isDefault: false }] }
/** Supplies untrusted HTTP data to the real strict response parser. */
function respond(data: unknown, code = 0) {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ code, message: '', data, meta: {} })))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
afterEach(() => vi.unstubAllGlobals())
it('preserves the exact shared revision and target in independent GET and POST', async () => {
  const fetcher = respond(valid)
  expect(await getUserGroupDomainDefault('user')).toEqual(valid)
  expect(fetcher).toHaveBeenLastCalledWith('/api/v1/admin/user-group/domain-default?groupKey=user', expect.anything())
  const input = { groupKey: 'user' as const, domainId: id, expectedUpdatedAt: updatedAt }
  expect(await setUserGroupDomainDefault(input)).toEqual(valid)
  expect(fetcher).toHaveBeenLastCalledWith('/api/v1/admin/user-group/set-domain-default', expect.objectContaining({ body: JSON.stringify(input) }))
})
it.each([
  null, {}, { ...valid, extra: true }, { ...valid, setting: { ...valid.setting, extra: true } },
  { ...valid, setting: { ...valid.setting, groupKey: 'admin' } },
  { ...valid, setting: { ...valid.setting, domainId: id.toUpperCase() } },
  { ...valid, setting: { ...valid.setting, domainId: '00000000-0000-0000-0000-000000000000' } },
  { ...valid, setting: { ...valid.setting, updatedAt: null } },
  { ...valid, setting: { ...valid.setting, updatedAt: '2026-10-27T01:02:03.1234567890Z' } },
  { ...valid, setting: { ...valid.setting, updatedAt: '0001-01-01T00:00:00Z' } },
  { ...valid, setting: { ...valid.setting, updatedAt: '2026-10-27' } },
  { ...valid, setting: { ...valid.setting, editable: false } },
  { ...valid, candidates: [...valid.candidates, ...valid.candidates] },
  { ...valid, candidates: [{ ...valid.candidates[0], private: true }] },
  { ...valid, candidates: [{ ...valid.candidates[0], isDefault: true }, { ...valid.candidates[0], id: 'bbbbbbbb-1111-4111-8111-111111111111', isDefault: true }] },
])('rejects malformed management data without exposing private values: %j', async (data) => {
  respond(data)
  await expect(getUserGroupDomainDefault('user')).rejects.toMatchObject({ code: 100001, message: 'Invalid group default domain response' })
  await expect(setUserGroupDomainDefault({ groupKey: 'user', domainId: null, expectedUpdatedAt: updatedAt })).rejects.toMatchObject({ code: 100001 })
})
it('accepts a masked unavailable saved choice for management and the read-only guest boundary', async () => {
  respond({ ...valid, candidates: [] })
  expect((await getUserGroupDomainDefault('user')).setting.domainId).toBe(id)
  const guest = { setting: { groupKey: 'guest', domainId: null, updatedAt, editable: false }, candidates: [] }
  respond(guest)
  expect(await getUserGroupDomainDefault('guest')).toEqual(guest)
  respond({ ...guest, setting: { ...guest.setting, domainId: id } })
  await expect(getUserGroupDomainDefault('guest')).rejects.toMatchObject({ code: 100001 })
})
it.each(['available', 'not_set', 'unavailable'] as const)('reads only the Cookie owner selection %s', async (status) => {
  const selection = { status, domainId: status === 'available' ? id : null }
  const fetcher = respond({ selection })
  expect(await getCurrentGroupDefaultDomain()).toEqual(selection)
  expect(fetcher).toHaveBeenCalledWith('/api/v1/domain/group-default', expect.anything())
})
it.each([{}, null, { selection: { status: 'available', domainId: null } }, { selection: { status: 'unavailable', domainId: id } },
  { selection: { status: 'not_set', domainId: id } }, { selection: { status: 'missing', domainId: null } },
  { selection: { status: 'available', domainId: id, host: 'private' } }, { selection: { status: 'not_set', domainId: null }, extra: true },
])('rejects contradictory or unmasked self results: %j', async (data) => {
  respond(data)
  await expect(getCurrentGroupDefaultDomain()).rejects.toMatchObject({ code: 100001 })
})
it('retains actual business failures without treating them as empty settings', async () => {
  respond(null, 120001)
  await expect(getUserGroupDomainDefault('user')).rejects.toMatchObject({ code: 120001 })
  await expect(getCurrentGroupDefaultDomain()).rejects.toMatchObject({ code: 120001 })
})
