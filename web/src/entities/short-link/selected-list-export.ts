import { z } from 'zod'
import { apiPost, ApiClientError } from '@/shared/api/client'
import { noteIdSchema } from './note'
import { noteSearchHeaders } from './note-search'
import { listExportContentSchema, type ShortLinkListExport, type ShortLinkListExportContext } from './list-export'

const inputSchema = z.strictObject({ ids: z.array(noteIdSchema).min(1).max(100).refine(ids => new Set(ids).size === ids.length) })

/** Requests one complete selected snapshot without sending filters or accepting partial results. */
export async function exportSelectedShortLinkList(input: { ids: readonly string[] }, context: ShortLinkListExportContext, userId: string, signal?: AbortSignal): Promise<ShortLinkListExport> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success || (context !== 'own' && context !== 'admin')) throw new ApiClientError(100001, 'Invalid selected short-link export request')
  const response = await apiPost<unknown>(`${context === 'admin' ? '/admin' : ''}/short-link/export/selected`, parsed.data, signal, noteSearchHeaders(userId))
  const descriptor = z.strictObject({
    fileName: z.literal(context === 'admin' ? 'moeurl-links-all-selected.csv' : 'moeurl-links-own-selected.csv'),
    contentType: z.literal('text/csv;charset=utf-8'), content: listExportContentSchema,
  }).safeParse(response.data)
  if (!descriptor.success) throw new ApiClientError(100001, 'Invalid selected short-link export response')
  return descriptor.data
}
