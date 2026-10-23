import { z } from 'zod'
import { ApiClientError, apiPost } from '@/shared/api/client'

export const transferUsernameSchema = z.string().min(1)
const id = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/).refine(value => value !== '00000000-0000-0000-0000-000000000000')
const requestSchema = z.strictObject({ id, newOwnerUsername: transferUsernameSchema, expectedUpdatedAt: z.iso.datetime({ offset: true }) })
const resultSchema = z.strictObject({ id, ownerId: id, updatedAt: z.iso.datetime({ offset: true }) })
export type TransferInput = z.infer<typeof requestSchema>

/** Transfers one captured link version to an exact account, without retrying writes. */
export async function transferShortLink(input: TransferInput) {
  const request = requestSchema.safeParse(input)
  if (!request.success) throw new ApiClientError(100001, 'Invalid ownership transfer request')
  const response = await apiPost<unknown>('/admin/short-link/transfer', request.data)
  const result = resultSchema.safeParse(response.data)
  if (!result.success || result.data.id !== input.id) throw new ApiClientError(100001, 'Invalid ownership transfer response')
  return result.data
}
