import { z } from 'zod'
import { ApiClientError, apiGet } from '@/shared/api/client'
import type { AuditFilters, AuditResult, DashboardResult, InsightRangeInput, VisitFilters, VisitResult } from './model'

export const auditResourceTypes = ['short_link', 'user', 'user_group', 'domain', 'system_setting', 'oidc_provider'] as const
export const auditActions = ['create', 'update', 'enable', 'disable', 'delete', 'credential_change', 'permissions_change', 'assignment_change', 'settings_change'] as const
export const deviceTypes = ['desktop', 'mobile', 'tablet', 'bot', 'other', 'unknown'] as const
const count = z.number().int().nonnegative()
const timestamp = z.iso.datetime()
const rangeSchema = z.object({ startDate: z.iso.date(), endDate: z.iso.date(), timeZone: z.literal('UTC') })
const pageShape = { range: rangeSchema, pageSize: z.number().int().min(1).max(100), hasMore: z.boolean(), nextCursor: z.string().max(512) }
const dashboardSchema = z.object({
  summary: z.object({ userCount: count, activeUserCount: count, linkCount: count, activeLinkCount: count, todayCreatedLinkCount: count, todayVisitCount: count, rangeVisitCount: count }),
  range: rangeSchema, trend: z.array(z.object({ date: z.iso.date(), visitCount: count })),
  topLinks: z.array(z.object({ id: z.guid(), slug: z.string(), url: z.string(), title: z.string(), deleted: z.boolean(), visitCount: count })).max(10), generatedAt: timestamp,
})
const visitSchema = z.object({ ...pageShape, items: z.array(z.object({ id: z.guid(), occurredAt: timestamp, referrerHost: z.string().nullable(), deviceType: z.enum(deviceTypes).nullable(), browserFamily: z.enum(['chrome', 'edge', 'firefox', 'safari', 'opera', 'samsung', 'bot', 'other']).nullable(), osFamily: z.enum(['windows', 'macos', 'ios', 'android', 'linux', 'chromeos', 'other']).nullable(), countryCode: z.string().regex(/^[A-Z]{2}$/).nullable() })) }).refine(validPage)
const auditSchema = z.object({ ...pageShape, retentionDays: z.literal(180), items: z.array(z.object({ id: z.string().regex(/^[1-9][0-9]*$/).refine((id) => BigInt(id) <= 9223372036854775807n), actorId: z.guid().nullable(), actorUsername: z.string().nullable(), resourceType: z.enum(auditResourceTypes), resourceId: z.string(), action: z.enum(auditActions), changedFields: z.array(z.string()), occurredAt: timestamp })) }).refine(validPage)

/** Requires a usable continuation token exactly when the server advertises another page. */
function validPage(page: { hasMore: boolean; nextCursor: string }) { return page.hasMore === (page.nextCursor !== '') }

/** Encodes only applied ranges and nonempty filters, preserving server defaults. */
function search(range?: InsightRangeInput, filters: Record<string, string | undefined> = {}) {
  const params = new URLSearchParams()
  if (range?.days !== undefined) params.set('days', String(range.days))
  else if (range) { params.set('startDate', range.startDate); params.set('endDate', range.endDate) }
  for (const [key, value] of Object.entries(filters)) if (value) params.set(key, value)
  return params.toString()
}

/** Enforces the actual server DTO and reports invalid data through the shared error contract. */
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new ApiClientError(100001, 'Invalid insight response')
  return result.data
}

/** Reads the authorized global snapshot for an applied UTC range. */
export async function getDashboard(range?: InsightRangeInput): Promise<DashboardResult> {
  return parse(dashboardSchema, (await apiGet<unknown>(`/admin/dashboard?${search(range)}`)).data)
}

/** Reads anonymous successful redirects using the correct owner or administrative endpoint. */
export async function getVisits(id: string, context: 'own' | 'admin', range?: InsightRangeInput, filters: VisitFilters = {}): Promise<VisitResult> {
  return parse(visitSchema, (await apiGet<unknown>(`/${context === 'admin' ? 'admin/' : ''}short-link/visits?${search(range, { id, ...filters })}`)).data)
}

/** Reads immutable audit metadata while preserving decimal IDs and timestamp precision. */
export async function getAudit(range?: InsightRangeInput, filters: AuditFilters = {}): Promise<AuditResult> {
  return parse(auditSchema, (await apiGet<unknown>(`/admin/audit/list?${search(range, { ...filters })}`)).data)
}
