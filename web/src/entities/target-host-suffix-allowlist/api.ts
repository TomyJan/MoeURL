import { z } from 'zod'
import { apiGet, apiPost } from '@/shared/api/client'
import { TargetHostSuffixDenylistSchema, UpdateTargetHostSuffixDenylistSchema } from '@/entities/target-host-suffix-denylist/api'

export const adminTargetHostSuffixAllowlistKey = ['target-host-suffix-allowlist', 'admin'] as const

export const TargetHostSuffixAllowlistSchema = z.strictObject({
  enabled: z.boolean(),
  suffixes: TargetHostSuffixDenylistSchema.shape.suffixes,
  updatedAt: TargetHostSuffixDenylistSchema.shape.updatedAt,
}).refine(value => !value.enabled || value.suffixes.length > 0, { path: ['suffixes'], message: 'Enabled allowlist requires a suffix' })

export const UpdateTargetHostSuffixAllowlistSchema = z.strictObject({
  enabled: z.boolean(),
  suffixes: UpdateTargetHostSuffixDenylistSchema.shape.suffixes,
  expectedUpdatedAt: UpdateTargetHostSuffixDenylistSchema.shape.expectedUpdatedAt,
}).refine(value => !value.enabled || value.suffixes.length > 0, { path: ['suffixes'], message: 'Enabled allowlist requires a suffix' })

export type TargetHostSuffixAllowlist = z.infer<typeof TargetHostSuffixAllowlistSchema>
export type UpdateTargetHostSuffixAllowlist = z.input<typeof UpdateTargetHostSuffixAllowlistSchema>

/** Reads the independently authorized resource and preserves the full revision. */
export async function getTargetHostSuffixAllowlist(): Promise<TargetHostSuffixAllowlist> {
  return TargetHostSuffixAllowlistSchema.parse((await apiGet<unknown>('/admin/system/target-host-suffix-allowlist')).data)
}
/** Sends the complete raw draft once; only the response supplies canonical values. */
export async function updateTargetHostSuffixAllowlist(input: UpdateTargetHostSuffixAllowlist): Promise<TargetHostSuffixAllowlist> {
  return TargetHostSuffixAllowlistSchema.parse((await apiPost<unknown>('/admin/system/target-host-suffix-allowlist/update', UpdateTargetHostSuffixAllowlistSchema.parse(input))).data)
}
