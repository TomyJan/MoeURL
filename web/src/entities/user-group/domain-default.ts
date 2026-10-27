import { z } from 'zod'
import { apiGet, apiPost, ApiClientError } from '@/shared/api/client'
import type { EditableUserGroupKey, UserGroupKey } from './api'

export const groupDefaultDomainQueryKey = ['group-default-domain'] as const
export const adminGroupDefaultDomainQueryKey = ['admin-user-group-domain-default'] as const
const id = z.uuid().refine((value) => value === value.toLowerCase() && value !== '00000000-0000-0000-0000-000000000000')
const revision = z.iso.datetime({ offset: true }).refine((value) => !/\.\d{10}/.test(value) && Date.parse(value) !== Date.parse('0001-01-01T00:00:00Z'))
const settingSchema = z.strictObject({ groupKey: z.enum(['guest', 'user', 'admin']), domainId: id.nullable(), updatedAt: revision, editable: z.boolean() })
const candidateSchema = z.strictObject({ id, host: z.string().min(1), displayName: z.string(), isDefault: z.boolean() })
const managementSchema = z.strictObject({ setting: settingSchema, candidates: z.array(candidateSchema) }).refine(({ setting, candidates }) =>
  setting.editable === (setting.groupKey !== 'guest') &&
  (setting.groupKey !== 'guest' || (setting.domainId === null && candidates.length === 0)) &&
  new Set(candidates.map(({ id }) => id)).size === candidates.length && candidates.filter(({ isDefault }) => isDefault).length <= 1)
const selectionSchema = z.strictObject({ domainId: id.nullable(), status: z.enum(['available', 'not_set', 'unavailable']) })
  .refine((value) => (value.status === 'available') === (value.domainId !== null))
export type UserGroupDomainDefault = z.infer<typeof managementSchema>
export type GroupDefaultDomainSelection = z.infer<typeof selectionSchema>
export interface SetUserGroupDomainDefaultInput { groupKey: EditableUserGroupKey; domainId: string | null; expectedUpdatedAt: string }

/** Reads a target group's own candidates and preserves its full shared revision. */
export async function getUserGroupDomainDefault(groupKey: UserGroupKey): Promise<UserGroupDomainDefault> {
  return parseManagement((await apiGet<unknown>(`/admin/user-group/domain-default?groupKey=${encodeURIComponent(groupKey)}`)).data, groupKey)
}
/** Saves one independent setting without writing permissions or retrying the write. */
export async function setUserGroupDomainDefault(input: SetUserGroupDomainDefaultInput): Promise<UserGroupDomainDefault> {
  return parseManagement((await apiPost<unknown>('/admin/user-group/set-domain-default', input)).data, input.groupKey)
}
/** Reads the Cookie owner's masked selection without exposing hidden domain metadata. */
export async function getCurrentGroupDefaultDomain(): Promise<GroupDefaultDomainSelection> {
  const result = z.strictObject({ selection: selectionSchema }).safeParse((await apiGet<unknown>('/domain/group-default')).data)
  if (!result.success) throw invalidResponse()
  return result.data.selection
}
/** Rejects cross-target and malformed responses before they enter a draft or query. */
function parseManagement(value: unknown, groupKey: UserGroupKey): UserGroupDomainDefault {
  const result = managementSchema.safeParse(value)
  if (!result.success || result.data.setting.groupKey !== groupKey) throw invalidResponse()
  return result.data
}
/** Keeps invalid private server values out of user-visible diagnostics. */
function invalidResponse() { return new ApiClientError(100001, 'Invalid group default domain response') }
