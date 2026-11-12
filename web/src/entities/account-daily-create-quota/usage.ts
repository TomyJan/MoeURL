import { z } from 'zod'
import { apiGet } from '@/shared/api/client'

export const OwnDailyCreateUsageOwnerSchema = z.string().length(36)
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  .refine(value => value !== '00000000-0000-0000-0000-000000000000')
const used = z.string().refine(value => value.length <= 19 && /^[0-9]+$/.test(value)
  && BigInt(value).toString() === value && BigInt(value) <= 9223372036854775807n)
const limit = z.number().int().min(0).max(1000000).nullable()
export const OwnDailyCreateUsageSchema = z.strictObject({
  usageDay: z.iso.date().refine(value => !value.startsWith('0000-')),
  used,
  dailyLimit: limit,
  remaining: limit,
}).refine(value => {
  // Object refinements can also run after a child refinement failed.
  if (!used.safeParse(value.used).success) return false
  if (value.dailyLimit === null) return value.remaining === null
  if (value.remaining === null) return false
  const remaining = BigInt(value.dailyLimit) - BigInt(value.used)
  return BigInt(value.remaining) === (remaining > 0n ? remaining : 0n)
})
export type OwnDailyCreateUsage = z.infer<typeof OwnDailyCreateUsageSchema>

/** Reads only the Cookie owner and rejects replies that lose precision or consistency. */
export async function getOwnDailyCreateUsage(expectedUserId: string): Promise<OwnDailyCreateUsage> {
  const owner = OwnDailyCreateUsageOwnerSchema.parse(expectedUserId)
  return OwnDailyCreateUsageSchema.parse((await apiGet<unknown>('/account/daily-create-usage', {
    'X-MoeURL-Expected-User-ID': owner,
  })).data)
}
