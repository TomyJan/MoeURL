import { z } from 'zod'

export const visitLimitIntegerSchema = z.number().int().min(1).max(2147483647)
export const visitLimitInputSchema = z.string().trim().regex(/^[0-9]+$/).transform(Number).pipe(visitLimitIntegerSchema)
const quotaCountSchema = z.number().int().min(0).max(2147483647)
const countSchema = z.number().int().min(0)
const timestampSchema = z.iso.datetime({ offset: true })
const statsSchema = z.strictObject({
  visitCount: countSchema, todayVisitCount: countSchema, lastVisitedAt: timestampSchema.nullable(),
})

export const shortLinkSchema = z.strictObject({
  id: z.string().min(1), url: z.url(), slug: z.string().min(1), targetUrl: z.url(),
  status: z.enum(['active', 'disabled']), redirectMode: z.enum(['direct', 'intermediate', 'confirmation']),
  intermediateDelaySeconds: z.number().int().min(3).max(10),
  expiresAt: timestampSchema.nullable(), expired: z.boolean(), passwordEnabled: z.boolean(),
  maxVisits: visitLimitIntegerSchema.nullable(), visitsUsed: quotaCountSchema,
  visitsRemaining: quotaCountSchema.nullable(), exhausted: z.boolean(),
  createdAt: timestampSchema, stats: statsSchema.optional(),
}).refine(consistentVisitLimit, 'Inconsistent visit quota')

export const adminShortLinkSchema = shortLinkSchema.safeExtend({
  owner: z.strictObject({ id: z.string().min(1), username: z.string(), nickname: z.string() }),
})
export const shortLinkResponseSchema = z.strictObject({ shortLink: shortLinkSchema })
export const shortLinkListSchema = z.strictObject({ items: z.array(shortLinkSchema) })
export const adminShortLinkListSchema = z.strictObject({ items: z.array(adminShortLinkSchema) })
const dimensionSchema = z.strictObject({ value: z.string(), visitCount: countSchema })
export const shortLinkStatisticsSchema = z.strictObject({
  shortLink: shortLinkSchema,
  stats: statsSchema.extend({
    trend: z.array(z.strictObject({ date: z.iso.date(), visitCount: countSchema })),
    referrers: z.array(dimensionSchema), devices: z.array(dimensionSchema), countries: z.array(dimensionSchema),
  }),
})

/** Rejects contradictory quota state, including nonzero usage on an unlimited link. */
function consistentVisitLimit(limit: { maxVisits: number | null; visitsUsed: number; visitsRemaining: number | null; exhausted: boolean }): boolean {
  if (limit.maxVisits === null) {
    return limit.visitsUsed === 0 && limit.visitsRemaining === null && !limit.exhausted
  }
  return limit.visitsRemaining === Math.max(0, limit.maxVisits - limit.visitsUsed)
    && limit.exhausted === (limit.visitsUsed >= limit.maxVisits)
}
