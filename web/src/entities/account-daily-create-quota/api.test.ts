import { afterEach, expect, it, vi } from 'vitest'
import { AccountDailyCreateQuotaSchema, UpdateAccountDailyCreateQuotaSchema, getAccountDailyCreateQuota, updateAccountDailyCreateQuota } from './api'

const revision = '2026-11-12T05:00:00.123456Z'
const envelope = (data: unknown) => new Response(JSON.stringify({ code: 0, message: 'OK', data, meta: {} }))
afterEach(() => vi.unstubAllGlobals())
it.each([null, 0, 1, 1000000])('preserves the explicit quota %j and the complete revision', dailyLimit => {
  expect(AccountDailyCreateQuotaSchema.parse({ dailyLimit, updatedAt: revision })).toEqual({ dailyLimit, updatedAt: revision })
  expect(UpdateAccountDailyCreateQuotaSchema.parse({ dailyLimit, expectedUpdatedAt: revision })).toEqual({ dailyLimit, expectedUpdatedAt: revision })
})
it.each([undefined, -1, 1000001, 0.5, '0', false, [], {}, NaN, Infinity])('rejects malformed quota %j in both directions', dailyLimit => {
  expect(AccountDailyCreateQuotaSchema.safeParse({ dailyLimit, updatedAt: revision }).success).toBe(false)
  expect(UpdateAccountDailyCreateQuotaSchema.safeParse({ dailyLimit, expectedUpdatedAt: revision }).success).toBe(false)
})
it.each(['', '0000-01-01T00:00:00Z', '0001-01-01T00:00:00Z', '2026-11-12T05:00:00.123456001Z', '2026-99-12T05:00:00Z', null])('rejects an unusable CAS revision %j', value => {
  expect(AccountDailyCreateQuotaSchema.safeParse({ dailyLimit: null, updatedAt: value }).success).toBe(false)
  expect(UpdateAccountDailyCreateQuotaSchema.safeParse({ dailyLimit: null, expectedUpdatedAt: value }).success).toBe(false)
})
it('accepts whole-second and microsecond timestamps without truncating or coercing them', () => {
  for (const updatedAt of ['2026-11-12T05:00:00Z', '0001-01-01T00:00:00.000001Z', revision]) {
    expect(AccountDailyCreateQuotaSchema.parse({ dailyLimit: null, updatedAt }).updatedAt).toBe(updatedAt)
  }
})
it('uses only its independent endpoints and rejects bad commands before transport', async () => {
  const requests: unknown[] = []
  vi.stubGlobal('fetch', async (path: string, init: RequestInit) => {
    requests.push({ path, method: init.method, credentials: init.credentials, body: init.body && JSON.parse(String(init.body)) })
    return envelope({ dailyLimit: 7, updatedAt: revision })
  })
  expect(await getAccountDailyCreateQuota()).toEqual({ dailyLimit: 7, updatedAt: revision })
  expect(await updateAccountDailyCreateQuota({ dailyLimit: null, expectedUpdatedAt: revision })).toEqual({ dailyLimit: 7, updatedAt: revision })
  await expect(updateAccountDailyCreateQuota({ dailyLimit: 1.5, expectedUpdatedAt: revision })).rejects.toThrow()
  expect(requests).toEqual([
    { path: '/api/v1/admin/system/account-daily-create-quota', method: 'GET', credentials: 'include', body: undefined },
    { path: '/api/v1/admin/system/account-daily-create-quota/update', method: 'POST', credentials: 'include', body: { dailyLimit: null, expectedUpdatedAt: revision } },
  ])
  expect(AccountDailyCreateQuotaSchema.safeParse({ dailyLimit: null, updatedAt: revision, extra: 1 }).success).toBe(false)
  expect(UpdateAccountDailyCreateQuotaSchema.safeParse({ dailyLimit: null, expectedUpdatedAt: revision, extra: 1 }).success).toBe(false)
  vi.stubGlobal('fetch', async () => envelope({ dailyLimit: 1, updatedAt: 'broken' }))
  await expect(getAccountDailyCreateQuota()).rejects.toThrow()
  await expect(updateAccountDailyCreateQuota({ dailyLimit: 0, expectedUpdatedAt: revision })).rejects.toThrow()
})
