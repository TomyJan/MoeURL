import { apiGet, apiPost } from '@/shared/api/client'

export interface CreateUserInput {
  username: string
  password: string
  nickname: string
  groupKey: 'user' | 'admin'
  status: 'active' | 'disabled'
}

export interface CreatedUser {
  id: string
  username: string
  nickname: string
  group: string
  status: 'active' | 'disabled'
}

export interface UserSummary extends CreatedUser {
  builtin: boolean
  createdAt: string
  updatedAt: string
}

export interface CreateUserResponse {
  user: CreatedUser
}

export interface ListUsersInput {
  page?: number
  pageSize?: number
}

export interface ListUsersResponse {
  items: UserSummary[]
  meta: {
    page: number
    pageSize: number
    total: number
  }
}

export interface UpdateUserInput {
  id: string
  nickname: string
  status: 'active' | 'disabled'
}

export interface UpdateUserResponse {
  user: UserSummary
}

export interface ResetPasswordInput {
  id: string
  password: string
}

export interface ResetPasswordResponse {
  reset: boolean
}

export async function createUser(input: CreateUserInput): Promise<CreateUserResponse> {
  const response = await apiPost<CreateUserResponse>('/admin/user/create', input)
  return response.data
}

export async function listUsers(input: ListUsersInput = {}): Promise<ListUsersResponse> {
  const page = input.page ?? 1
  const pageSize = input.pageSize ?? 20
  const search = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  })
  const response = await apiGet<{ items: UserSummary[] }>(`/admin/user/list?${search.toString()}`)
  return {
    items: response.data.items,
    meta: {
      page: Number(response.meta.page ?? page),
      pageSize: Number(response.meta.pageSize ?? pageSize),
      total: Number(response.meta.total ?? response.data.items.length),
    },
  }
}

export async function updateUser(input: UpdateUserInput): Promise<UpdateUserResponse> {
  const response = await apiPost<UpdateUserResponse>('/admin/user/update', input)
  return response.data
}

export async function resetUserPassword(input: ResetPasswordInput): Promise<ResetPasswordResponse> {
  const response = await apiPost<ResetPasswordResponse>('/admin/user/reset-password', input)
  return response.data
}
