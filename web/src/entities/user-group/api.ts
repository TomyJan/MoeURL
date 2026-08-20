import { z } from 'zod'

import { ApiClientError, apiGet, apiPost } from '@/shared/api/client'

export type UserGroupKey = 'guest' | 'user' | 'admin'
export type EditableUserGroupKey = Exclude<UserGroupKey, 'guest'>
export type PermissionCategory = 'short_link_basic' | 'short_link_access' | 'domain' | 'administration'
export type PermissionPresetKey = 'restricted' | 'basic' | 'standard'

export interface UserGroup {
  key: UserGroupKey
  name: string
  description: string
  builtin: true
  editable: boolean
  permissions: string[]
  updatedAt: string
}

export interface PermissionDefinition {
  key: string
  category: PermissionCategory
  protected: boolean
}

export interface PermissionPreset {
  key: PermissionPresetKey
  applicableGroups: EditableUserGroupKey[]
  permissions: string[]
}

export interface UserGroupListResponse {
  groups: UserGroup[]
  permissions: PermissionDefinition[]
  presets: PermissionPreset[]
}

export interface UpdateUserGroupPermissionsInput {
  groupKey: EditableUserGroupKey
  permissions: string[]
  expectedUpdatedAt: string
}

export interface UpdateUserGroupPermissionsResponse {
  group: UserGroup
}

export const userGroupQueryKey = ['admin-user-groups'] as const

const userGroupSchema: z.ZodType<UserGroup> = z.strictObject({
  key: z.enum(['guest', 'user', 'admin']),
  name: z.string(),
  description: z.string(),
  builtin: z.literal(true),
  editable: z.boolean(),
  permissions: z.array(z.string()).refine(isUnique),
  updatedAt: z.iso.datetime({ offset: true }),
}).superRefine((group, context) => {
  if (group.editable !== (group.key !== 'guest')) {
    context.addIssue({ code: 'custom', message: 'Invalid editable state' })
  }
})

const permissionDefinitionSchema: z.ZodType<PermissionDefinition> = z.strictObject({
  key: z.string().min(1),
  category: z.enum(['short_link_basic', 'short_link_access', 'domain', 'administration']),
  protected: z.boolean(),
})

const permissionPresetSchema: z.ZodType<PermissionPreset> = z.strictObject({
  key: z.enum(['restricted', 'basic', 'standard']),
  applicableGroups: z.array(z.enum(['user', 'admin'])).length(2).refine(isUnique),
  permissions: z.array(z.string()).refine(isUnique),
})

const userGroupListSchema: z.ZodType<UserGroupListResponse> = z.strictObject({
  groups: z.array(userGroupSchema).length(3).refine((groups) => hasExactKeys(groups, ['guest', 'user', 'admin'])),
  permissions: z.array(permissionDefinitionSchema).refine((permissions) => isUnique(permissions.map(({ key }) => key))),
  presets: z.array(permissionPresetSchema).length(3).refine((presets) => hasExactKeys(presets, ['restricted', 'basic', 'standard'])),
}).superRefine((result, context) => {
  const permissionKeys = new Set(result.permissions.map(({ key }) => key))
  for (const group of result.groups) {
    if (group.permissions.some((permission) => !permissionKeys.has(permission))) {
      context.addIssue({ code: 'custom', message: 'Group contains unknown permission' })
    }
  }
  for (const preset of result.presets) {
    if (preset.permissions.some((permission) => !permissionKeys.has(permission))) {
      context.addIssue({ code: 'custom', message: 'Preset contains unknown permission' })
    }
  }
})

const updateResponseSchema: z.ZodType<UpdateUserGroupPermissionsResponse> = z.strictObject({
  group: userGroupSchema,
})

/** Loads and validates the built-in user groups, permission catalog, and presets. */
export async function listUserGroups(): Promise<UserGroupListResponse> {
  const response = await apiGet<unknown>('/admin/user-group/list')
  return parseResponse(userGroupListSchema, response.data)
}

/** Updates one editable built-in user group with an optimistic concurrency value. */
export async function updateUserGroupPermissions(input: UpdateUserGroupPermissionsInput): Promise<UpdateUserGroupPermissionsResponse> {
  const response = await apiPost<unknown>('/admin/user-group/update-permissions', input)
  return parseResponse(updateResponseSchema, response.data)
}

/** Converts schema failures into the shared invalid-response error contract. */
function parseResponse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new ApiClientError(100001, 'Invalid user group response')
  }
  return result.data
}

/** Reports whether a string collection contains no duplicate values. */
function isUnique(values: readonly string[]): boolean {
  return new Set(values).size === values.length
}

/** Reports whether keyed values contain each expected key exactly once. */
function hasExactKeys<T extends { key: string }>(values: readonly T[], expected: readonly string[]): boolean {
  return values.length === expected.length && expected.every((key) => values.some((value) => value.key === key))
}
