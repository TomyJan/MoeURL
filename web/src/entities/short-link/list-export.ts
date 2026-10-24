import { z } from 'zod'
import { apiGet, ApiClientError } from '@/shared/api/client'
import type { ShortLinkListInput } from './api'

export type ShortLinkListExportContext = 'own' | 'admin'
export type ShortLinkListExportFilters = Pick<ShortLinkListInput, 'status' | 'q' | 'tag'>
const header = '\uFEFFid,short_url,slug,target_url,title,tags,status,redirect_mode,intermediate_delay_seconds,expires_at,password_enabled,max_visits,visits_used,created_at,updated_at,owner_id,owner_username\r\n'
const contentSchema = z.string().startsWith(header).max(8 * 1024 * 1024)
  .refine(content => new TextEncoder().encode(content).length <= 8 * 1024 * 1024)

/** Downloads one bounded server snapshot, excluding pagination and client selection. */
export async function exportShortLinkList(filters: ShortLinkListExportFilters, context: ShortLinkListExportContext): Promise<ShortLinkListExport> {
  const search = new URLSearchParams()
  if (filters.status) search.set('status', filters.status)
  if (filters.q) search.set('q', filters.q)
  if (filters.tag) search.set('tag', filters.tag)
  const query = search.size ? `?${search}` : ''
  const response = await apiGet<unknown>(`${context === 'admin' ? '/admin' : ''}/short-link/export${query}`)
  const schema = z.strictObject({
    fileName: z.literal(context === 'admin' ? 'moeurl-links-all.csv' : 'moeurl-links-own.csv'),
    contentType: z.literal('text/csv;charset=utf-8'),
    content: contentSchema,
  })
  const parsed = schema.safeParse(response.data)
  if (!parsed.success) throw new ApiClientError(100001, 'Invalid short-link list export response')
  return parsed.data
}

export interface ShortLinkListExport {
  fileName: string
  contentType: 'text/csv;charset=utf-8'
  content: string
}
