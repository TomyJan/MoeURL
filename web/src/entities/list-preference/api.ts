import { z } from 'zod'
import { apiGet, apiPost, ApiClientError } from '@/shared/api/client'
import { SHORT_LINK_PAGE_SIZES, type ShortLinkPageSize } from '@/features/short-link-pagination/pageSize'

const preferenceSchema = z.strictObject({
  pageSize: z.union(SHORT_LINK_PAGE_SIZES.map(size => z.literal(size))).nullable(),
  updatedAt: z.iso.datetime({ offset: true }).refine(value => !/[.][0-9]{10}/.test(value)).nullable(),
}).refine(value => value.pageSize === null || value.updatedAt !== null)
export type ListPreference = z.infer<typeof preferenceSchema>
export interface UpdateListPreferenceInput { pageSize: ShortLinkPageSize | null; expectedUpdatedAt: string | null }
export const listPreferenceKey = (userId: string) => ['user', 'list-preference', userId] as const

/** Rejects incomplete or expanded documents and preserves the complete server revision. */
function parse(data: unknown): ListPreference {
  const result = z.strictObject({ preference: preferenceSchema }).safeParse(data)
  if (!result.success) throw new ApiClientError(100001, 'Invalid list preference response')
  return result.data.preference
}
/** Reads only the Cookie owner whose identity the caller captured. */
export async function getListPreference(expectedUserId: string): Promise<ListPreference> {
  return parse((await apiGet<unknown>('/user/list-preference', { 'X-MoeURL-Expected-User-ID': expectedUserId })).data)
}
/** Sends one explicit CAS update without changing another preference resource. */
export async function updateListPreference(input: UpdateListPreferenceInput, expectedUserId: string): Promise<ListPreference> {
  return parse((await apiPost<unknown>('/user/list-preference/update', input, undefined, { 'X-MoeURL-Expected-User-ID': expectedUserId })).data)
}
