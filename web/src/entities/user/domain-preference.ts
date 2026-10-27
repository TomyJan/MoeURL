import { z } from 'zod'
import { apiGet, apiPost, ApiClientError } from '@/shared/api/client'

const preferenceSchema = z.strictObject({
  domainId: z.uuid().refine((value) => value === value.toLowerCase() && value !== '00000000-0000-0000-0000-000000000000').nullable(),
  updatedAt: z.iso.datetime({ offset: true }).refine((value) => !/\.\d{10}/.test(value)).nullable(),
})
export type DomainPreference = z.infer<typeof preferenceSchema>
export interface UpdateDomainPreferenceInput { domainId: string | null; expectedUpdatedAt: string | null }
export const domainPreferenceKey = (userId: string) => ['user', 'domain-preference', userId] as const

/** Reads the Cookie owner's independent domain preference without normalizing its version. */
export async function getDomainPreference(): Promise<DomainPreference> {
  return parse((await apiGet<unknown>('/user/domain-preference')).data)
}
/** Saves or clears only the domain choice using the original optimistic version. */
export async function updateDomainPreference(input: UpdateDomainPreferenceInput): Promise<DomainPreference> {
  return parse((await apiPost<unknown>('/user/domain-preference/update', input)).data)
}
/** Rejects unexpected private response fields and invalid identifiers with a safe error. */
function parse(data: unknown): DomainPreference {
  const parsed = z.strictObject({ preference: preferenceSchema }).safeParse(data)
  if (!parsed.success) throw new ApiClientError(100001, 'Invalid domain preference response')
  return parsed.data.preference
}
