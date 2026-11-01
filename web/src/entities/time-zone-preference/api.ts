import { z } from 'zod'
import { apiGet, apiPost, ApiClientError } from '@/shared/api/client'

export const timeZonePresets = ['UTC', 'Asia/Shanghai', 'Asia/Singapore', 'Asia/Tokyo', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'Australia/Sydney'] as const
const preferenceSchema = z.strictObject({
  timeZone: z.enum(timeZonePresets).nullable(),
  updatedAt: z.iso.datetime({ offset: true }).refine(value => !/[.][0-9]{10}/.test(value)).nullable(),
}).refine(value => value.timeZone === null || value.updatedAt !== null)
export type TimeZonePreference = z.infer<typeof preferenceSchema>
export interface UpdateTimeZonePreferenceInput { timeZone: string | null; expectedUpdatedAt: string | null }
export const timeZonePreferenceKey = (userId: string) => ['user', 'time-zone-preference', userId] as const

/** Rejects unexpected private fields and impossible unset versions without rounding precision. */
function parse(data: unknown): TimeZonePreference {
  const result = z.strictObject({ preference: preferenceSchema }).safeParse(data)
  if (!result.success) throw new ApiClientError(100001, 'Invalid time-zone preference response')
  return result.data.preference
}
/** Reads only the Cookie owner's independent preference. */
export async function getTimeZonePreference(): Promise<TimeZonePreference> {
  return parse((await apiGet<unknown>('/user/time-zone-preference')).data)
}
/** Performs one explicit CAS write, without automatic retry. */
export async function updateTimeZonePreference(input: UpdateTimeZonePreferenceInput): Promise<TimeZonePreference> {
  return parse((await apiPost<unknown>('/user/time-zone-preference/update', input)).data)
}
