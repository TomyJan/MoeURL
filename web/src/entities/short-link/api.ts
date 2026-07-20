import { apiGet, apiPost } from '@/shared/api/client'

import type { AdminShortLink, CreateShortLinkInput, ShortLink, ShortLinkStatisticsResponse, UpdateShortLinkInput } from './model'

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

export async function createShortLink(input: CreateShortLinkInput): Promise<ShortLinkResponse> {
  const response = await apiPost<ShortLinkResponse>('/short-link/create', input)
  return response.data
}

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

export async function updateShortLink(input: UpdateShortLinkInput): Promise<ShortLinkResponse> {
  const response = await apiPost<ShortLinkResponse>('/short-link/update', input)
  return response.data
}

export async function deleteShortLink(id: string): Promise<void> {
  await apiPost('/short-link/delete', { id })
}

export async function getShortLinkStatistics(id: string): Promise<ShortLinkStatisticsResponse> {
	const response = await apiGet<ShortLinkStatisticsResponse>(`/short-link/statistics?id=${encodeURIComponent(id)}`)
	return response.data
}

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

export async function updateAdminShortLink(input: UpdateShortLinkInput): Promise<ShortLinkResponse> {
  const response = await apiPost<ShortLinkResponse>('/admin/short-link/update', input)
  return response.data
}

export async function deleteAdminShortLink(id: string): Promise<void> {
  await apiPost('/admin/short-link/delete', { id })
}

export async function getAdminShortLinkStatistics(id: string): Promise<ShortLinkStatisticsResponse> {
	const response = await apiGet<ShortLinkStatisticsResponse>(`/admin/short-link/statistics?id=${encodeURIComponent(id)}`)
	return response.data
}

function normalizeListMeta(meta: Record<string, unknown>, page: number, pageSize: number): ShortLinkListResponse['meta'] {
  return {
    page: Number(meta.page ?? page),
    pageSize: Number(meta.pageSize ?? pageSize),
    total: Number(meta.total ?? 0),
  }
}
