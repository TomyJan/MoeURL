import { z } from 'zod'
import { apiGet, apiPost, ApiClientError } from '@/shared/api/client'

export interface ChangePasswordInput {
  currentPassword: string
  newPassword: string
}

/** Loads whether the current account can change its existing local password. */
export async function getPasswordStatus(): Promise<{ canChangePassword: boolean }> {
  const response = await apiGet<unknown>('/auth/password/status')
  const result = z.strictObject({ canChangePassword: z.boolean() }).safeParse(response.data)
  if (!result.success) throw new ApiClientError(100001, 'Invalid password status response')
  return result.data
}

/** Changes the current account's password and revokes all its existing sessions. */
export async function changePassword(input: ChangePasswordInput): Promise<{ changed: true }> {
  const response = await apiPost<unknown>('/auth/password/change', input)
  const result = z.strictObject({ changed: z.literal(true) }).safeParse(response.data)
  if (!result.success) throw new ApiClientError(100001, 'Invalid password change response')
  return result.data
}
