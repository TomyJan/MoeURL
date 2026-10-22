import type { StatisticsRangeInput } from '@/entities/short-link/model'

export type InsightRangeInput = StatisticsRangeInput
export interface InsightRange { startDate: string; endDate: string; timeZone: 'UTC' }
export interface TrendPoint { date: string; visitCount: number }
export interface DashboardResult {
  summary: { userCount: number; activeUserCount: number; linkCount: number; activeLinkCount: number; todayCreatedLinkCount: number; todayVisitCount: number; rangeVisitCount: number }
  range: InsightRange
  trend: TrendPoint[]
  topLinks: { id: string; slug: string; url: string; title: string; deleted: boolean; visitCount: number }[]
  generatedAt: string
}
export interface PageResult<T> { items: T[]; range: InsightRange; pageSize: number; hasMore: boolean; nextCursor: string }
export interface VisitRecord { id: string; occurredAt: string; referrerHost: string | null; deviceType: string | null; browserFamily: string | null; osFamily: string | null; countryCode: string | null }
export interface VisitFilters { deviceType?: string; countryCode?: string; cursor?: string }
export type VisitResult = PageResult<VisitRecord>
export interface AuditItem { id: string; actorId: string | null; actorUsername: string | null; resourceType: string; resourceId: string; action: string; changedFields: string[]; occurredAt: string }
export interface AuditFilters { actorId?: string; resourceType?: string; action?: string; cursor?: string }
export interface AuditResult extends PageResult<AuditItem> { retentionDays: number }
