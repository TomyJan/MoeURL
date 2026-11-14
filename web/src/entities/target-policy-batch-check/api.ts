import { z } from 'zod'
import { apiPost } from '@/shared/api/client'
import { TargetPolicyCheckInputSchema, TargetPolicyCheckResultSchema } from '@/entities/target-policy-check/api'

export const TargetPolicyBatchCheckInputSchema = z.strictObject({
  targetUrls: z.array(TargetPolicyCheckInputSchema.shape.targetUrl).min(1).max(20),
})
export const TargetPolicyBatchCheckResultSchema = z.strictObject({
  items: z.array(z.strictObject({
    index: z.number().int().min(1).max(20),
    outcome: TargetPolicyCheckResultSchema.shape.outcome,
  })).min(1).max(20).refine(items => items.every((item, index) => item.index === index + 1)),
})
export type TargetPolicyBatchCheckInput = z.infer<typeof TargetPolicyBatchCheckInputSchema>
export type TargetPolicyBatchCheckResult = z.infer<typeof TargetPolicyBatchCheckResultSchema>

/** Checks every original position once and rejects incomplete or reordered decisions. */
export async function checkTargetPolicyBatch(input: TargetPolicyBatchCheckInput): Promise<TargetPolicyBatchCheckResult> {
  const request = TargetPolicyBatchCheckInputSchema.parse(input)
  const response = await apiPost<unknown>('/admin/system/target-policy/check-batch', request)
  const result = TargetPolicyBatchCheckResultSchema.parse(response.data)
  if (result.items.length !== request.targetUrls.length) throw new Error('Invalid batch target policy result')
  return result
}
