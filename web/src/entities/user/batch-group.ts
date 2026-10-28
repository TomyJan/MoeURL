import { z } from 'zod'
import { ApiClientError, apiPost } from '@/shared/api/client'

export interface BatchChangeUserGroupInput {
  items: { id: string; expectedUpdatedAt: string }[]
  groupKey: 'user' | 'admin'
}
export interface BatchChangeUserGroupResult { changedCount: number; unchangedCount: number }
const resultSchema = z.strictObject({ changedCount: z.number().int().nonnegative(), unchangedCount: z.number().int().nonnegative() })

/** Sends a single explicit batch attempt using the original full-precision snapshot. */
export async function batchChangeUserGroup(input: BatchChangeUserGroupInput): Promise<BatchChangeUserGroupResult> {
  const result = resultSchema.safeParse((await apiPost<unknown>('/admin/user/batch-change-group', input)).data)
  if (!result.success || result.data.changedCount + result.data.unchangedCount !== input.items.length) throw new ApiClientError(100001, 'Invalid batch membership response', { invalidBatchResponse: true })
  return result.data
}
