import { z } from 'zod'

import { ApiClientError, apiGet, apiGetPath, apiPost, apiPostPath } from '@/shared/api/client'

import type { AdminShortLink, CreateShortLinkInput, PublicShortLinkPreview, ShortLink, ShortLinkOverview, ShortLinkStatisticsResponse, UnlockShortLinkInput, UnlockShortLinkResponse, UpdateShortLinkInput } from './model'

export interface ShortLinkResponse {
  shortLink: ShortLink
}

export interface ShortLinkListResponse {
  items: ShortLink[]
  meta: {
    page: number
    pageSize: number
    total: number
  }
}

export interface ShortLinkListInput {
  page?: number
  pageSize?: number
  status?: ShortLink['status'] | ''
}

export interface AdminShortLinkListInput extends ShortLinkListInput {
  q?: string
}

interface ShortLinkItemsResponse {
  items: ShortLink[]
}

interface AdminShortLinkItemsResponse {
  items: AdminShortLink[]
}

const publicShortLinkPreviewBaseSchema = {
  slug: z.string(),
  targetHost: z.string(),
  expiresAt: z.string().nullable(),
}

const publicShortLinkPreviewSchema: z.ZodType<PublicShortLinkPreview> = z.discriminatedUnion('redirectMode', [
  z.strictObject({ ...publicShortLinkPreviewBaseSchema, redirectMode: z.literal('direct'), intermediateDelaySeconds: z.null() }),
  z.strictObject({
    ...publicShortLinkPreviewBaseSchema,
    redirectMode: z.literal('intermediate'),
    intermediateDelaySeconds: z.number().int().min(3).max(10),
  }),
  z.strictObject({ ...publicShortLinkPreviewBaseSchema, redirectMode: z.literal('confirmation'), intermediateDelaySeconds: z.null() }),
])

const unlockShortLinkResponseSchema: z.ZodType<UnlockShortLinkResponse> = z.strictObject({
  unlocked: z.literal(true),
})

/** Creates a short link using access settings allowed by the current user. */
export async function createShortLink(input: CreateShortLinkInput): Promise<ShortLinkResponse> {
  const response = await apiPost<ShortLinkResponse>('/short-link/create', input)
  return response.data
}

/** Loads and validates the minimal public metadata required by the redirect page. */
export async function getPublicShortLinkPreview(slug: string): Promise<PublicShortLinkPreview> {
  const response = await apiGetPath<unknown>(`/go/${encodeURIComponent(slug)}/preview`)
  const result = publicShortLinkPreviewSchema.safeParse(response.data)
  if (!result.success) {
    throw new ApiClientError(100001, 'Invalid public preview response')
  }
  return result.data
}

/** Exchanges a valid short-link password for a scoped access grant. */
export async function unlockShortLink(input: UnlockShortLinkInput): Promise<UnlockShortLinkResponse> {
  const response = await apiPostPath<unknown>(`/go/${encodeURIComponent(input.slug)}/unlock`, {
    password: input.password,
  })
  const result = unlockShortLinkResponseSchema.safeParse(response.data)
  if (!result.success) {
    throw new ApiClientError(100001, 'Invalid public unlock response')
  }
  return result.data
}

/** Lists short links owned by the current user with normalized pagination metadata. */
export async function listShortLinks(input: ShortLinkListInput = {}): Promise<ShortLinkListResponse> {
  const page = input.page ?? 1
  const pageSize = input.pageSize ?? 20
  const search = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  })
  if (input.status) {
    search.set('status', input.status)
  }
  const response = await apiGet<ShortLinkItemsResponse>(`/short-link/list?${search.toString()}`)
  return {
    items: response.data.items,
    meta: normalizeListMeta(response.meta, page, pageSize),
  }
}

/** Loads aggregate counts for the current user's short links. */
export async function getShortLinkOverview(): Promise<ShortLinkOverview> {
  const response = await apiGet<ShortLinkOverview>('/short-link/overview')
  return response.data
}

/** Updates an owned short link without supplying omitted access settings. */
export async function updateShortLink(input: UpdateShortLinkInput): Promise<ShortLinkResponse> {
  const response = await apiPost<ShortLinkResponse>('/short-link/update', input)
  return response.data
}

/** Soft-deletes an owned short link by identifier. */
export async function deleteShortLink(id: string): Promise<void> {
  await apiPost('/short-link/delete', { id })
}

/** Loads visit statistics for an owned short link. */
export async function getShortLinkStatistics(id: string): Promise<ShortLinkStatisticsResponse> {
	const response = await apiGet<ShortLinkStatisticsResponse>(`/short-link/statistics?id=${encodeURIComponent(id)}`)
	return response.data
}

/** Lists all visible short links for administrators with optional filtering. */
export async function listAdminShortLinks(input: AdminShortLinkListInput = {}): Promise<{
  items: AdminShortLink[]
  meta: ShortLinkListResponse['meta']
}> {
  const page = input.page ?? 1
  const pageSize = input.pageSize ?? 20
  const search = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  })
  if (input.status) {
    search.set('status', input.status)
  }
  if (input.q) {
    search.set('q', input.q)
  }
  const response = await apiGet<AdminShortLinkItemsResponse>(`/admin/short-link/list?${search.toString()}`)
  return {
    items: response.data.items,
    meta: normalizeListMeta(response.meta, page, pageSize),
  }
}

/** Updates a short link through the administrative API. */
export async function updateAdminShortLink(input: UpdateShortLinkInput): Promise<ShortLinkResponse> {
  const response = await apiPost<ShortLinkResponse>('/admin/short-link/update', input)
  return response.data
}

/** Soft-deletes a short link through the administrative API. */
export async function deleteAdminShortLink(id: string): Promise<void> {
  await apiPost('/admin/short-link/delete', { id })
}

/** Loads visit statistics for a short link through the administrative API. */
export async function getAdminShortLinkStatistics(id: string): Promise<ShortLinkStatisticsResponse> {
	const response = await apiGet<ShortLinkStatisticsResponse>(`/admin/short-link/statistics?id=${encodeURIComponent(id)}`)
	return response.data
}

/** Coerces response metadata into stable numeric pagination fields. */
function normalizeListMeta(meta: Record<string, unknown>, page: number, pageSize: number): ShortLinkListResponse['meta'] {
  return {
    page: Number(meta.page ?? page),
    pageSize: Number(meta.pageSize ?? pageSize),
    total: Number(meta.total ?? 0),
  }
}
