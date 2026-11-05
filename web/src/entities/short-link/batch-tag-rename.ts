import { z } from 'zod'
import { ApiClientError, apiPost } from '@/shared/api/client'
import { trimGoSpace } from '@/shared/validation/shortLinkMetadata'
import { noteIdSchema, noteVersionSchema } from './note'

export const renameTagSchema = z.string()
  .refine(value => !/[\uD800-\uDFFF]/u.test(value) && !/\p{Cc}/u.test(value))
  .transform(trimGoSpace).refine(value => [...value].length > 0 && [...value].length <= 32)
const itemSchema = z.strictObject({ id: noteIdSchema, expectedUpdatedAt: noteVersionSchema })
const inputSchema = z.strictObject({
  items: z.array(itemSchema).min(1).max(100).refine(items => new Set(items.map(item => item.id)).size === items.length),
  fromTag: renameTagSchema, toTag: renameTagSchema,
}).refine(value => value.fromTag !== value.toTag)
const countSchema = z.int().min(0).max(100)
const resultSchema = z.strictObject({ changedCount: countSchema, unchangedCount: countSchema })
export type BatchTagRenameInput = z.infer<typeof inputSchema>
export type BatchTagRenameResult = z.infer<typeof resultSchema>

/** Makes one explicit, identity-pinned request and discards sensitive error bodies. */
async function rename(path: string, input: BatchTagRenameInput, userId: string): Promise<BatchTagRenameResult> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success || !noteIdSchema.safeParse(userId).success) throw new ApiClientError(100001, 'Invalid tag rename request')
  let data: unknown
  try {
    data = (await apiPost<unknown>(path, parsed.data, undefined, { 'X-MoeURL-Expected-User-ID': userId })).data
  } catch (cause) {
    if (cause instanceof ApiClientError) {
      const status = cause.meta.status
      throw new ApiClientError(cause.code, 'Tag rename failed', typeof status === 'number' ? { status } : {})
    }
    throw new ApiClientError(900000, 'Tag rename result unavailable')
  }
  const result = resultSchema.safeParse(data)
  if (!result.success || result.data.changedCount + result.data.unchangedCount !== parsed.data.items.length) {
    throw new ApiClientError(100001, 'Invalid tag rename response', { invalidBatchTagRenameResponse: true })
  }
  return result.data
}
/** Uses personal ownership authorization without putting tags into a URL. */
export const renameOwnTags = (input: BatchTagRenameInput, userId: string) => rename('/short-link/batch-tag-rename', input, userId)
/** Uses the separate administrative authorization boundary. */
export const renameAdminTags = (input: BatchTagRenameInput, userId: string) => rename('/admin/short-link/batch-tag-rename', input, userId)
