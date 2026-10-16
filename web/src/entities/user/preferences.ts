import { z } from 'zod'
import { apiGet, apiPost, ApiClientError } from '@/shared/api/client'

const preferencesSchema = z.strictObject({
  language: z.enum(['zh-CN', 'en']).nullable(),
  theme: z.enum(['system', 'light', 'dark']).nullable(),
  updatedAt: z.iso.datetime({ offset: true }).refine((value) => !/\.\d{10}/.test(value)).nullable(),
})
export type AccountPreferences = z.infer<typeof preferencesSchema>
export interface UpdateAccountPreferencesInput {
  language: AccountPreferences['language']
  theme: AccountPreferences['theme']
  expectedUpdatedAt: string | null
}
/** Partitions account preferences by user while allowing removal of every prior login epoch. */
export const accountPreferencesKey = (userId: string) => ['user', 'preferences', userId] as const

/** Reads only the preferences belonging to the authenticated Cookie identity. */
export async function getAccountPreferences(): Promise<AccountPreferences> {
  const response = await apiGet<unknown>('/user/preferences')
  return parsePreferences(response.data)
}
/** Replaces both account overrides using the original optimistic version. */
export async function updateAccountPreferences(input: UpdateAccountPreferencesInput): Promise<AccountPreferences> {
  const response = await apiPost<unknown>('/user/preferences/update', input)
  return parsePreferences(response.data)
}
/** Keeps untrusted response details outside the friendly API error contract. */
function parsePreferences(data: unknown): AccountPreferences {
  const result = z.strictObject({ preferences: preferencesSchema }).safeParse(data)
  if (!result.success) throw new ApiClientError(100001, 'Invalid account preferences response')
  return result.data.preferences
}
