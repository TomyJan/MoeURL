import { z } from 'zod'
import { apiPost } from '@/shared/api/client'

export const TargetPolicyCheckInputSchema = z.strictObject({
  targetUrl: z.string().min(1).refine(value => new TextEncoder().encode(value).byteLength <= 2048 && !/[\p{Cc}\p{Cs}]/u.test(value)),
})
export const TargetPolicyCheckResultSchema = z.strictObject({
  outcome: z.enum(['allowed', 'invalid_target', 'restricted']),
})
export type TargetPolicyCheckInput = z.infer<typeof TargetPolicyCheckInputSchema>
export type TargetPolicyCheckResult = z.infer<typeof TargetPolicyCheckResultSchema>

/** Checks the original input once without caching its private URL or decision. */
export async function checkTargetPolicy(input: TargetPolicyCheckInput): Promise<TargetPolicyCheckResult> {
  const response = await apiPost<unknown>('/admin/system/target-policy/check', TargetPolicyCheckInputSchema.parse(input))
  return TargetPolicyCheckResultSchema.parse(response.data)
}
