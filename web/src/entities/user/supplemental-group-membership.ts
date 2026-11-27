import { z } from 'zod'

import { ApiClientError, apiPost } from '@/shared/api/client'
import { INVALID_REQUEST_CODE } from '@/shared/api/error-codes'
import type { UserGroupKey } from '@/entities/user-group/api'
import type { UserSummary } from './api'

export interface UpdateUserGroupMembershipsInput {
  id: string
  groupKeys: UserGroupKey[]
  expectedUpdatedAt: string
}

export interface UpdateUserGroupMembershipsResponse {
  user: UserSummary
}

const membershipSchema = z.strictObject({ key: z.string().min(1), name: z.string() })
const userSchema = z.strictObject({
  id: z.string().min(1),
  username: z.string(),
  nickname: z.string(),
  group: z.string().min(1),
  status: z.enum(['active', 'disabled']),
  builtin: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  supplementalGroups: z.array(membershipSchema).refine(isUniqueByKey),
}).superRefine((user, context) => {
  if (user.builtin) context.addIssue({ code: 'custom', path: ['builtin'], message: 'Builtin accounts cannot be membership targets' })
  if (user.supplementalGroups.some(({ key }) => isBuiltinKey(key) || key === user.group)) {
    context.addIssue({ code: 'custom', path: ['supplementalGroups'], message: 'Memberships must be distinct custom groups' })
  }
})

const responseSchema = z.strictObject({ user: userSchema })

/** Replaces a user's supplemental custom groups against the exact frozen account revision. */
export async function updateUserGroupMemberships(input: UpdateUserGroupMembershipsInput): Promise<UpdateUserGroupMembershipsResponse> {
  const response = await apiPost<unknown>('/admin/user/update-group-memberships', input)
  const result = responseSchema.safeParse(response.data)
  if (!result.success) throw new ApiClientError(INVALID_REQUEST_CODE, 'Invalid supplemental group membership response')
  return result.data
}

/** Reports whether a membership collection contains each stable key at most once. */
function isUniqueByKey(groups: readonly { key: string }[]): boolean {
  return new Set(groups.map(({ key }) => key)).size === groups.length
}

/** Identifies builtin groups by their stable reserved keys, never by display names. */
function isBuiltinKey(key: string): boolean {
  return key === 'guest' || key === 'user' || key === 'admin'
}
