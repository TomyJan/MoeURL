import { z } from 'zod'
import { apiGet, apiPost } from '@/shared/api/client'
import { TargetCIDRDenylistSchema, UpdateTargetCIDRDenylistSchema } from '@/entities/target-cidr-denylist/api'

export const adminTargetCIDRAllowlistKey = ['target-cidr-allowlist', 'admin'] as const

export const TargetCIDRAllowlistSchema = z.strictObject({
  enabled: z.boolean(),
  prefixes: TargetCIDRDenylistSchema.shape.prefixes,
  updatedAt: TargetCIDRDenylistSchema.shape.updatedAt,
}).refine(value => !value.enabled || value.prefixes.length > 0, { path: ['prefixes'], message: 'Enabled allowlist requires a CIDR' })

export const UpdateTargetCIDRAllowlistSchema = z.strictObject({
  enabled: z.boolean(),
  prefixes: UpdateTargetCIDRDenylistSchema.shape.prefixes,
  expectedUpdatedAt: UpdateTargetCIDRDenylistSchema.shape.expectedUpdatedAt,
}).refine(value => !value.enabled || value.prefixes.length > 0, { path: ['prefixes'], message: 'Enabled allowlist requires a CIDR' })

export type TargetCIDRAllowlist = z.infer<typeof TargetCIDRAllowlistSchema>
export type UpdateTargetCIDRAllowlist = z.input<typeof UpdateTargetCIDRAllowlistSchema>

/** Reads the independently authorized resource with its full revision. */
export async function getTargetCIDRAllowlist(): Promise<TargetCIDRAllowlist> {
  return TargetCIDRAllowlistSchema.parse((await apiGet<unknown>('/admin/system/target-cidr-allowlist')).data)
}
/** Sends raw editable CIDRs once; only the server response supplies canonical values. */
export async function updateTargetCIDRAllowlist(input: UpdateTargetCIDRAllowlist): Promise<TargetCIDRAllowlist> {
  return TargetCIDRAllowlistSchema.parse((await apiPost<unknown>('/admin/system/target-cidr-allowlist/update', UpdateTargetCIDRAllowlistSchema.parse(input))).data)
}
