import { z } from 'zod'
import { apiPost, ApiClientError } from '@/shared/api/client'

export type BatchAction = 'enable' | 'disable' | 'delete'
export interface BatchInput { ids: string[]; action: BatchAction }
const resultSchema = z.strictObject({ affectedCount: z.number().int().min(1).max(100) })

/** Submits one atomic batch and accepts only a complete matched-count response. */
export async function batchShortLinks(input: BatchInput, context: 'own' | 'admin'): Promise<{ affectedCount: number }> {
  const response = await apiPost<unknown>(`${context === 'admin' ? '/admin' : ''}/short-link/batch`, input)
  const result = resultSchema.safeParse(response.data)
  if (!result.success || result.data.affectedCount !== input.ids.length) throw new ApiClientError(100001, 'Invalid batch response')
  return result.data
}
