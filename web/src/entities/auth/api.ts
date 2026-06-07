import { apiGet, apiPost } from '@/shared/api/client'

export interface CurrentUser {
  id: string
  username: string
  nickname: string
  group: string
  permissions: string[]
}

export interface LoginInput {
  username: string
  password: string
}

export interface UserResponse {
  user: CurrentUser
}

export async function login(input: LoginInput): Promise<UserResponse> {
  const response = await apiPost<UserResponse>('/auth/login', input)
  return response.data
}

export async function logout(): Promise<void> {
  await apiPost('/auth/logout')
}

export async function me(): Promise<UserResponse> {
  const response = await apiGet<UserResponse>('/auth/me')
  return response.data
}
