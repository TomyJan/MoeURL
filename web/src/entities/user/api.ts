import { apiPost } from '@/shared/api/client'

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
  status: string
}

export interface CreateUserResponse {
  user: CreatedUser
}

export async function createUser(input: CreateUserInput): Promise<CreateUserResponse> {
  const response = await apiPost<CreateUserResponse>('/admin/user/create', input)
  return response.data
}
