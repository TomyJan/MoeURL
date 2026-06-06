import { apiGet, apiPost } from '@/shared/api/client'

import type { AdminShortLink, CreateShortLinkInput, ShortLink, UpdateShortLinkInput } from './model'

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

export async function listShortLinks(page = 1, pageSize = 20): Promise<ShortLinkListResponse> {
  const response = await apiGet<ShortLinkItemsResponse>(`/short-link/list?page=${page}&pageSize=${pageSize}`)
  return {
    items: response.data.items,
    meta: {
      page: Number(response.meta.page ?? page),
      pageSize: Number(response.meta.pageSize ?? pageSize),
      total: Number(response.meta.total ?? 0),
    },
  }
}

export async function updateShortLink(input: UpdateShortLinkInput): Promise<ShortLinkResponse> {
  const response = await apiPost<ShortLinkResponse>('/short-link/update', input)
  return response.data
}

export async function deleteShortLink(id: string): Promise<void> {
  await apiPost('/short-link/delete', { id })
}

export async function listAdminShortLinks(page = 1, pageSize = 20): Promise<{
  items: AdminShortLink[]
  meta: ShortLinkListResponse['meta']
}> {
  const response = await apiGet<AdminShortLinkItemsResponse>(`/admin/short-link/list?page=${page}&pageSize=${pageSize}`)
  return {
    items: response.data.items,
    meta: {
      page: Number(response.meta.page ?? page),
      pageSize: Number(response.meta.pageSize ?? pageSize),
      total: Number(response.meta.total ?? 0),
    },
  }
}

export async function updateAdminShortLink(input: UpdateShortLinkInput): Promise<ShortLinkResponse> {
  const response = await apiPost<ShortLinkResponse>('/admin/short-link/update', input)
  return response.data
}

export async function deleteAdminShortLink(id: string): Promise<void> {
  await apiPost('/admin/short-link/delete', { id })
}
