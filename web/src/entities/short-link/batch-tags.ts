import { z } from 'zod'
import { apiPost, ApiClientError } from '@/shared/api/client'
import { shortLinkMetadataSchema } from '@/shared/validation/shortLinkMetadata'

const id = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/).refine(value => value !== '00000000-0000-0000-0000-000000000000')
export const batchTagVersionSchema = z.iso.datetime({ offset: true }).refine(value => Date.parse(value.replace(/\.\d+/, '')) !== Date.parse('0001-01-01T00:00:00Z') || /\.\d*[1-9]/.test(value))
export const batchTagTagsSchema = shortLinkMetadataSchema.shape.tags.refine(tags => tags.every(tag => !/[\uD800-\uDFFF]/u.test(tag)))
const requestSchema = z.strictObject({
  items: z.array(z.strictObject({ id, expectedUpdatedAt: batchTagVersionSchema })).min(1).max(100).refine(items => new Set(items.map(item => item.id)).size === items.length),
  operation: z.enum(['add', 'remove', 'replace']),
  tags: batchTagTagsSchema,
}).refine(value => value.operation === 'replace' || value.tags.length > 0)
const resultSchema = z.strictObject({ changedCount: z.number().int().nonnegative(), unchangedCount: z.number().int().nonnegative() })
export type BatchTagInput = z.infer<typeof requestSchema>
export interface BatchTagTarget { id: string; updatedAt: string; url: string; tags: string[] }

/** Sends one explicit atomic tag edit and accepts only complete result counts. */
export async function batchTagShortLinks(input: BatchTagInput, context: 'own' | 'admin') {
  const request = requestSchema.safeParse(input)
  if (!request.success) throw new ApiClientError(100001, 'Invalid batch tag request')
  const response = await apiPost<unknown>(`${context === 'admin' ? '/admin' : ''}/short-link/batch-tags`, request.data)
  const result = resultSchema.safeParse(response.data)
  if (!result.success || result.data.changedCount + result.data.unchangedCount !== request.data.items.length) throw new ApiClientError(100001, 'Invalid batch tag response')
  return result.data
}
