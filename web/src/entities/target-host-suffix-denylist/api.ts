import { z } from 'zod'
import { apiGet, apiPost } from '@/shared/api/client'
import { TargetHostDenylistSchema, UpdateTargetHostDenylistSchema } from '@/entities/target-host-denylist/api'

export const adminTargetHostSuffixDenylistKey = ['target-host-suffix-denylist', 'admin'] as const

export const TargetHostSuffixDenylistSchema = z.strictObject({
  suffixes: TargetHostDenylistSchema.shape.hosts,
  updatedAt: TargetHostDenylistSchema.shape.updatedAt,
})
export const UpdateTargetHostSuffixDenylistSchema = z.strictObject({
  suffixes: UpdateTargetHostDenylistSchema.shape.hosts,
  expectedUpdatedAt: UpdateTargetHostDenylistSchema.shape.expectedUpdatedAt,
})
export type TargetHostSuffixDenylist = z.infer<typeof TargetHostSuffixDenylistSchema>
export type UpdateTargetHostSuffixDenylist = z.input<typeof UpdateTargetHostSuffixDenylistSchema>

/** Loads only the independent, complete administrator resource. */
export async function getTargetHostSuffixDenylist(): Promise<TargetHostSuffixDenylist> {
  return TargetHostSuffixDenylistSchema.parse((await apiGet<unknown>('/admin/system/target-host-suffix-denylist')).data)
}
/** Sends raw rows and the exact revision once; the server owns canonical values. */
export async function updateTargetHostSuffixDenylist(input: UpdateTargetHostSuffixDenylist): Promise<TargetHostSuffixDenylist> {
  return TargetHostSuffixDenylistSchema.parse((await apiPost<unknown>('/admin/system/target-host-suffix-denylist/update', UpdateTargetHostSuffixDenylistSchema.parse(input))).data)
}
