import { z } from 'zod'
import { apiGet, ApiClientError } from '@/shared/api/client'
import { statisticsDateRangeSchema } from '@/entities/short-link/schema'
import { deviceTypes } from './api'

export type VisitExportContext = 'own' | 'admin' | 'site'
export interface VisitExportRange { startDate: string; endDate: string }
export interface VisitExportFilters { deviceType?: string; countryCode?: string }
export interface VisitExport { fileName: string; contentType: 'text/csv;charset=utf-8'; content: string }
const header = '\uFEFFshort_link_id,start_date,end_date,time_zone,event_id,occurred_at,referrer_host,device_type,browser_family,os_family,country_code\r\n'
const inputSchema = z.strictObject({
  id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/).refine(value => value !== '00000000-0000-0000-0000-000000000000'),
  context: z.enum(['own', 'admin']),
  // Dates come from the loaded server range; only the server decides its current UTC day.
  range: statisticsDateRangeSchema,
  filters: z.strictObject({ deviceType: z.union([z.enum(deviceTypes), z.literal('')]).optional(), countryCode: z.string().regex(/^(?:[A-Z]{2}|unknown)?$/).optional() }),
})
const siteInputSchema = z.strictObject({
  id: z.literal('site'), context: z.literal('site'), range: statisticsDateRangeSchema,
  filters: z.strictObject({}),
})
const contentSchema = z.string().startsWith(header).max(8 * 1024 * 1024)
  .refine(content => new TextEncoder().encode(content).length <= 8 * 1024 * 1024)

/** Requests a fresh bounded server snapshot for the displayed UTC dates, never a page. */
export async function exportVisitRecords(id: string, context: VisitExportContext, range: VisitExportRange, filters: VisitExportFilters = {}): Promise<VisitExport> {
  const input = { id, context, range, filters }
  if (!(context === 'site' ? siteInputSchema : inputSchema).safeParse(input).success) throw new ApiClientError(100001, 'Invalid visit export input')
  const dates = { startDate: range.startDate, endDate: range.endDate }
  const search = context === 'site' ? new URLSearchParams(dates) : new URLSearchParams({ id, ...dates })
  if (context !== 'site') {
    if (filters.deviceType) search.set('deviceType', filters.deviceType)
    if (filters.countryCode) search.set('countryCode', filters.countryCode)
  }
  const path = context === 'site' ? 'admin/dashboard' : `${context === 'admin' ? 'admin/' : ''}short-link`
  const response = await apiGet<unknown>(`/${path}/visits/export?${search}`)
  const parsed = z.strictObject({
    fileName: z.literal(context === 'site' ? `moeurl-site-visits-${range.startDate}-${range.endDate}.csv` : `moeurl-visits-${id}-${range.startDate}-${range.endDate}.csv`),
    contentType: z.literal('text/csv;charset=utf-8'), content: contentSchema,
  }).safeParse(response.data)
  if (!parsed.success) throw new ApiClientError(100001, 'Invalid visit export response')
  return parsed.data
}
