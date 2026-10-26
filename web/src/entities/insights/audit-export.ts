import { z } from 'zod'
import { apiGet, ApiClientError } from '@/shared/api/client'
import { statisticsDateRangeSchema } from '@/entities/short-link/schema'
import { auditActions, auditResourceTypes } from './api'

export interface AuditExportRange { startDate: string; endDate: string }
export interface AuditExportFilters { actorId?: string; resourceType?: string; action?: string }
export interface AuditExport { fileName: string; contentType: 'text/csv;charset=utf-8'; content: string }

const header = '\uFEFFstart_date,end_date,time_zone,audit_id,occurred_at,actor_id,actor_username,resource_type,resource_id,action,changed_fields\r\n'
const inputSchema = z.strictObject({
  // The loaded server range is authoritative even when the browser clock is behind UTC.
  range: statisticsDateRangeSchema,
  filters: z.strictObject({
    actorId: z.string().regex(/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/).refine(value => value !== '00000000-0000-0000-0000-000000000000').optional(),
    resourceType: z.union([z.enum(auditResourceTypes), z.literal('')]).optional(),
    action: z.union([z.enum(auditActions), z.literal('')]).optional(),
  }),
})
const contentSchema = z.string().startsWith(header).max(8 * 1024 * 1024)
  .refine(content => new TextEncoder().encode(content).length <= 8 * 1024 * 1024)

/** Requests one bounded snapshot of the displayed UTC dates and applied filters, never a page. */
export async function exportAuditRecords(range: AuditExportRange, filters: AuditExportFilters = {}): Promise<AuditExport> {
  if (!inputSchema.safeParse({ range, filters }).success) throw new ApiClientError(100001, 'Invalid audit export input')
  const search = new URLSearchParams({ startDate: range.startDate, endDate: range.endDate })
  if (filters.actorId) search.set('actorId', filters.actorId)
  if (filters.resourceType) search.set('resourceType', filters.resourceType)
  if (filters.action) search.set('action', filters.action)
  const response = await apiGet<unknown>(`/admin/audit/export?${search}`)
  const parsed = z.strictObject({
    fileName: z.literal(`moeurl-audit-${range.startDate}-${range.endDate}.csv`),
    contentType: z.literal('text/csv;charset=utf-8'), content: contentSchema,
  }).safeParse(response.data)
  if (!parsed.success) throw new ApiClientError(100001, 'Invalid audit export response')
  return parsed.data
}
