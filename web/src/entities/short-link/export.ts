import { z } from 'zod'
import { apiGet, ApiClientError } from '@/shared/api/client'
import { statisticsDateRangeSchema } from './schema'

const fileNameSchema = z.string().regex(/^moeurl-statistics-[a-z0-9]+-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.csv$/)
  .refine((name) => {
    const dates = name.slice(-25, -4)
    return statisticsDateRangeSchema.safeParse({ startDate: dates.slice(0, 10), endDate: dates.slice(11) }).success
  })
const exportSchema = z.strictObject({
  fileName: fileNameSchema,
  contentType: z.literal('text/csv;charset=utf-8'),
  content: z.string().startsWith('\uFEFFsection,key,value,visit_count\r\n'),
})
export type StatisticsExport = z.infer<typeof exportSchema>
export type AnalyticsContext = 'own' | 'admin'

/** Downloads a fresh server aggregate for the exact dates already displayed by the page. */
export async function exportShortLinkStatistics(id: string, range: { startDate: string; endDate: string }, context: AnalyticsContext): Promise<StatisticsExport> {
  const search = new URLSearchParams({ id, startDate: range.startDate, endDate: range.endDate })
  const response = await apiGet<unknown>(`${context === 'admin' ? '/admin' : ''}/short-link/statistics/export?${search}`)
  const parsed = exportSchema.safeParse(response.data)
  if (!parsed.success) throw new ApiClientError(100001, 'Invalid statistics export response')
  return parsed.data
}
