import { z } from 'zod'
import { apiGet, apiPost } from '@/shared/api/client'

export const adminAccountDailyCreateQuotaKey = ['account-daily-create-quota', 'admin'] as const
const limit = z.number().int().min(0).max(1000000).nullable()
const revision = z.iso.datetime({ offset: true }).refine(value => {
  const fraction = value.match(/[.]([0-9]+)/)?.[1] ?? ''
  return !value.startsWith('0000-') && !/[1-9]/.test(fraction.slice(6))
    && (Date.parse(value) !== -62135596800000 || /[1-9]/.test(fraction))
})
export const AccountDailyCreateQuotaSchema = z.strictObject({ dailyLimit: limit, updatedAt: revision })
export const UpdateAccountDailyCreateQuotaSchema = z.strictObject({ dailyLimit: limit, expectedUpdatedAt: revision })
export type AccountDailyCreateQuota = z.infer<typeof AccountDailyCreateQuotaSchema>
export type UpdateAccountDailyCreateQuota = z.input<typeof UpdateAccountDailyCreateQuotaSchema>

/** Reads the independent policy without coercing null or shortening its revision. */
export async function getAccountDailyCreateQuota(): Promise<AccountDailyCreateQuota> {
  return AccountDailyCreateQuotaSchema.parse((await apiGet<unknown>('/admin/system/account-daily-create-quota')).data)
}
/** Sends one complete replacement; only the confirmed response supplies saved values. */
export async function updateAccountDailyCreateQuota(input: UpdateAccountDailyCreateQuota): Promise<AccountDailyCreateQuota> {
  return AccountDailyCreateQuotaSchema.parse((await apiPost<unknown>('/admin/system/account-daily-create-quota/update', UpdateAccountDailyCreateQuotaSchema.parse(input))).data)
}
