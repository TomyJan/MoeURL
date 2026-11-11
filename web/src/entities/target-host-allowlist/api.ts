import { z } from 'zod'
import { apiGet, apiPost } from '@/shared/api/client'
import { TargetHostDenylistSchema, UpdateTargetHostDenylistSchema } from '@/entities/target-host-denylist/api'

export const adminTargetHostAllowlistKey = ['target-host-allowlist', 'admin'] as const

export const TargetHostAllowlistSchema = z.strictObject({
  enabled: z.boolean(),
  hosts: TargetHostDenylistSchema.shape.hosts,
  updatedAt: TargetHostDenylistSchema.shape.updatedAt,
}).refine(value => !value.enabled || value.hosts.length > 0, { path: ['hosts'], message: 'Enabled allowlist requires a host' })

export const UpdateTargetHostAllowlistSchema = z.strictObject({
  enabled: z.boolean(),
  hosts: UpdateTargetHostDenylistSchema.shape.hosts,
  expectedUpdatedAt: UpdateTargetHostDenylistSchema.shape.expectedUpdatedAt,
}).refine(value => !value.enabled || value.hosts.length > 0, { path: ['hosts'], message: 'Enabled allowlist requires a host' })

export type TargetHostAllowlist = z.infer<typeof TargetHostAllowlistSchema>
export type UpdateTargetHostAllowlist = z.input<typeof UpdateTargetHostAllowlistSchema>

/** Reads the independently authorized resource and preserves the full revision. */
export async function getTargetHostAllowlist(): Promise<TargetHostAllowlist> {
  return TargetHostAllowlistSchema.parse((await apiGet<unknown>('/admin/system/target-host-allowlist')).data)
}
/** Sends the complete raw draft once; only the response supplies canonical values. */
export async function updateTargetHostAllowlist(input: UpdateTargetHostAllowlist): Promise<TargetHostAllowlist> {
  return TargetHostAllowlistSchema.parse((await apiPost<unknown>('/admin/system/target-host-allowlist/update', UpdateTargetHostAllowlistSchema.parse(input))).data)
}
