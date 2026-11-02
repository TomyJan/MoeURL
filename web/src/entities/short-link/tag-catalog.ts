import { z } from 'zod'
import { apiGet, ApiClientError } from '@/shared/api/client'
import { trimGoSpace } from '@/shared/validation/shortLinkMetadata'

const plainUnicode = (value: string) => !/\p{Cc}|[\uD800-\uDFFF]/u.test(value)
export const tagCatalogQuerySchema = z.string().refine(plainUnicode).transform(trimGoSpace).refine(value => [...value].length <= 32)
const tag = z.string().refine(value => plainUnicode(value) && value === trimGoSpace(value) && [...value].length > 0 && [...value].length <= 32)
const resultSchema = z.strictObject({
  items: z.array(z.strictObject({ tag, linkCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) })).max(50).refine(items => new Set(items.map(item => item.tag)).size === items.length),
  hasMore: z.boolean(),
}).refine(value => !value.hasMore || value.items.length === 50)
export type TagCatalogResult = z.infer<typeof resultSchema>

/** Reads a bounded personal directory without interpreting search text as wildcard syntax. */
export async function listPersonalTags(query = ''): Promise<TagCatalogResult> {
  const request = tagCatalogQuerySchema.safeParse(query)
  if (!request.success) throw new ApiClientError(100001, 'Invalid tag search')
  const response = await apiGet<unknown>('/short-link/tags?q=' + encodeURIComponent(request.data))
  const result = resultSchema.safeParse(response.data)
  if (!result.success) throw new ApiClientError(100001, 'Invalid tag catalog response')
  return result.data
}
