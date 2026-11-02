import { z } from 'zod'
import { apiGet, apiPost, ApiClientError } from '@/shared/api/client'
import type { RedirectMode } from '@/entities/short-link/model'

export const redirectModes = ['direct', 'intermediate', 'confirmation'] as const
const preferenceSchema = z.strictObject({
  redirectMode: z.enum(redirectModes).nullable(),
  updatedAt: z.iso.datetime({ offset: true }).refine(value => !/[.][0-9]{10}/.test(value)).nullable(),
}).refine(value => value.redirectMode === null || value.updatedAt !== null)
export type RedirectPreference = z.infer<typeof preferenceSchema>
export interface UpdateRedirectPreferenceInput { redirectMode: RedirectMode | null; expectedUpdatedAt: string | null }
export const redirectPreferenceKey = (userId: string) => ['user', 'redirect-preference', userId] as const

/** Keeps the personal document strict and preserves its complete server revision. */
function parse(data: unknown): RedirectPreference {
  const result = z.strictObject({ preference: preferenceSchema }).safeParse(data)
  if (!result.success) throw new ApiClientError(100001, 'Invalid redirect preference response')
  return result.data.preference
}
/** Reads the Cookie owner's strict document only when it matches the caller's captured account. */
export async function getRedirectPreference(expectedUserId: string): Promise<RedirectPreference> {
  return parse((await apiGet<unknown>('/user/redirect-preference', { 'X-MoeURL-Expected-User-ID': expectedUserId })).data)
}
/** Sends one CAS update with an ownership precondition; the header never chooses the resource target. */
export async function updateRedirectPreference(input: UpdateRedirectPreferenceInput, expectedUserId: string): Promise<RedirectPreference> {
  return parse((await apiPost<unknown>('/user/redirect-preference/update', input, undefined, { 'X-MoeURL-Expected-User-ID': expectedUserId })).data)
}
