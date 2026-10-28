import { afterEach, expect, it, vi } from 'vitest'
import { getDomainRedirectDefault, listDomainRedirectDefaults, setDomainRedirectDefault } from './redirect-default'

const id = 'aaaaaaaa-1111-4111-8111-111111111111'
const other = 'bbbbbbbb-2222-4222-8222-222222222222'
const updatedAt = '2026-10-28T01:02:03.123456789+08:00'
const valid = { setting: { domainId: id, redirectMode: 'confirmation', updatedAt } }

/** Feeds actual serialized HTTP data through the real API client and parser. */
function respond(data: unknown, code = 0) {
  const fetcher = vi.fn(async () => new Response(JSON.stringify({ code, message: '', data, meta: {} })))
  vi.stubGlobal('fetch', fetcher)
  return fetcher
}
afterEach(() => vi.unstubAllGlobals())

it('keeps exact independent targets, modes and nanosecond revisions in GET and POST', async () => {
  const fetcher = respond(valid)
  expect(await getDomainRedirectDefault(id)).toEqual(valid)
  expect(fetcher).toHaveBeenLastCalledWith('/api/v1/admin/domain/redirect-default?id=' + id, expect.anything())
  const input = { id, redirectMode: 'confirmation' as const, expectedUpdatedAt: updatedAt }
  expect(await setDomainRedirectDefault(input)).toEqual(valid)
  expect(fetcher).toHaveBeenLastCalledWith('/api/v1/admin/domain/set-redirect-default', expect.objectContaining({ body: JSON.stringify(input) }))
})

it.each([null, {}, { ...valid, private: 'secret' }, { setting: { ...valid.setting, extra: 'secret' } },
  { setting: { ...valid.setting, domainId: other } }, { setting: { ...valid.setting, domainId: id.toUpperCase() } },
  { setting: { ...valid.setting, domainId: '00000000-0000-0000-0000-000000000000' } },
  { setting: { ...valid.setting, redirectMode: 'inherit' } }, { setting: { ...valid.setting, redirectMode: null } },
  { setting: { ...valid.setting, updatedAt: null } }, { setting: { ...valid.setting, updatedAt: '2026-10-28' } },
  { setting: { ...valid.setting, updatedAt: '2026-10-28T01:02:03.1234567890Z' } },
  { setting: { ...valid.setting, updatedAt: '0001-01-01T00:00:00Z' } },
])('rejects malformed or cross-target management data without private diagnostics: %j', async (data) => {
  respond(data)
  await expect(getDomainRedirectDefault(id)).rejects.toMatchObject({ code: 100001, message: 'Invalid domain redirect default response' })
  await expect(setDomainRedirectDefault({ id, redirectMode: 'direct', expectedUpdatedAt: updatedAt })).rejects.toMatchObject({ code: 100001 })
})

it('accepts all three effective modes without management metadata or a new domain DTO', async () => {
  const data = { items: [{ domainId: id, redirectMode: 'direct' }, { domainId: other, redirectMode: 'intermediate' }, { domainId: 'cccccccc-3333-4333-8333-333333333333', redirectMode: 'confirmation' }] }
  const fetcher = respond(data)
  expect(await listDomainRedirectDefaults()).toEqual(data)
  expect(fetcher).toHaveBeenCalledWith('/api/v1/domain/redirect-defaults', expect.anything())
  respond({ items: [] })
  expect(await listDomainRedirectDefaults()).toEqual({ items: [] })
})

it.each([null, {}, { items: null }, { items: [], extra: true },
  { items: [{ domainId: id, redirectMode: 'confirmation', host: 'private.example' }] },
  { items: [{ domainId: id, redirectMode: 'bogus' }] }, { items: [{ domainId: id.toUpperCase(), redirectMode: 'direct' }] },
  { items: [{ domainId: '00000000-0000-0000-0000-000000000000', redirectMode: 'direct' }] },
  { items: [{ domainId: id, redirectMode: 'direct' }, { domainId: id, redirectMode: 'confirmation' }] },
])('rejects ambiguous or unmasked effective defaults: %j', async (data) => {
  respond(data)
  await expect(listDomainRedirectDefaults()).rejects.toMatchObject({ code: 100001, message: 'Invalid domain redirect default response' })
})

it('retains actual business denial instead of inventing a direct default', async () => {
  respond(null, 120001)
  await expect(listDomainRedirectDefaults()).rejects.toMatchObject({ code: 120001 })
  await expect(getDomainRedirectDefault(id)).rejects.toMatchObject({ code: 120001 })
  await expect(setDomainRedirectDefault({ id, redirectMode: 'direct', expectedUpdatedAt: updatedAt })).rejects.toMatchObject({ code: 120001 })
})
