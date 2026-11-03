import { z } from 'zod'
import { apiPost, ApiClientError } from '@/shared/api/client'
import { noteQuerySchema } from '@/shared/validation/noteSearch'
import { shortLinkKeywordSchema, shortLinkTagFilterSchema } from '@/shared/validation/shortLinkMetadata'
import { adminShortLinkListSchema, shortLinkListSchema } from './schema'
import { noteIdSchema } from './note'

export const noteSearchFiltersSchema = z.strictObject({
  status: z.enum(['', 'active', 'disabled']), q: shortLinkKeywordSchema, tag: shortLinkTagFilterSchema,
  noteStatus: z.enum(['', 'present', 'absent']), noteQuery: noteQuerySchema,
})
const inputSchema = noteSearchFiltersSchema.extend({ page: z.number().int().min(1).max(2147483647), pageSize: z.number().int().min(1).max(100) })
  .refine(value => (value.page - 1) * value.pageSize <= 2147483647)
export type NoteSearchInput = z.infer<typeof inputSchema>
const metaSchema = z.strictObject({ page: z.number().int().min(1), pageSize: z.number().int().min(1).max(100), total: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER) })

/** Pins a private request to a validated captured identity without granting authority. */
export function noteSearchHeaders(userId: string) {
  if (!noteIdSchema.safeParse(userId).success) throw new ApiClientError(100001, 'Invalid note search actor')
  return { 'X-MoeURL-Expected-User-ID': userId }
}

/** Validates both list items and the separate pagination envelope without echoing private data. */
async function search<T>(path: string, schema: z.ZodType<{ items: T[] }>, input: NoteSearchInput, userId: string, signal?: AbortSignal) {
  const request = inputSchema.safeParse(input)
  if (!request.success) throw new ApiClientError(100001, 'Invalid note search request')
  const response = await apiPost<unknown>(path, request.data, signal, noteSearchHeaders(userId))
  const data = schema.safeParse(response.data), meta = metaSchema.safeParse(response.meta)
  if (!data.success || !meta.success || meta.data.page !== request.data.page || meta.data.pageSize !== request.data.pageSize) throw new ApiClientError(100001, 'Invalid note search response')
  return { items: data.data.items, meta: meta.data }
}

/** Searches owned metadata using a fixed POST endpoint and no URL search term. */
export const searchOwnNotes = (input: NoteSearchInput, userId: string, signal?: AbortSignal) => search('/short-link/note/search', shortLinkListSchema, input, userId, signal)
/** Searches administrative metadata using the complete current server authorization boundary. */
export const searchAdminNotes = (input: NoteSearchInput, userId: string, signal?: AbortSignal) => search('/admin/short-link/note/search', adminShortLinkListSchema, input, userId, signal)
