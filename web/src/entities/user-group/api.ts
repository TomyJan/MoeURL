import { z } from 'zod'

import { ApiClientError, apiGet, apiPost } from '@/shared/api/client'
import { INVALID_REQUEST_CODE } from '@/shared/api/error-codes'

export type UserGroupKey = string
export type BuiltinUserGroupKey = 'guest' | 'user' | 'admin'
export type EditableUserGroupKey = Exclude<BuiltinUserGroupKey, 'guest'>
export type PermissionCategory = 'short_link_basic' | 'short_link_access' | 'domain' | 'administration'
export type PermissionPresetKey = 'restricted' | 'basic' | 'standard'

export interface UserGroup {
  /** Opaque stable key. Custom group keys are server generated and must not be parsed as names. */
  key: UserGroupKey
  name: string
  description: string
  builtin: boolean
  editable: boolean
  memberCount: number
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
  groupKey: UserGroupKey
  permissions: string[]
  expectedUpdatedAt: string
}

export interface CreateCustomUserGroupInput {
  name: string
  description: string
}

export interface UpdateCustomUserGroupInput extends CreateCustomUserGroupInput {
  groupKey: UserGroupKey
  expectedUpdatedAt: string
}

export interface DeleteCustomUserGroupInput {
  groupKey: UserGroupKey
  expectedUpdatedAt: string
}

export interface DeleteCustomUserGroupResponse {
  groupKey: UserGroupKey
  name: string
}

export interface UpdateUserGroupPermissionsResponse {
  group: UserGroup
}

export const userGroupQueryKey = ['admin-user-groups'] as const

const userGroupSchema: z.ZodType<UserGroup> = z.strictObject({
  key: z.string().min(1),
  name: z.string(),
  description: z.string(),
  builtin: z.boolean(),
  editable: z.boolean(),
  memberCount: z.number().int().nonnegative(),
  permissions: z.array(z.string()).refine(isUnique),
  updatedAt: z.iso.datetime({ offset: true }),
}).superRefine((group, context) => {
  const builtinKey = isBuiltinKey(group.key)
  if (group.builtin !== builtinKey || group.editable !== (group.key !== 'guest')) {
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
  applicableGroups: z.array(z.enum(['user', 'admin'])).min(1).refine(isUnique),
  permissions: z.array(z.string()).refine(isUnique),
})

const userGroupListSchema: z.ZodType<UserGroupListResponse> = z.strictObject({
  groups: z.array(userGroupSchema).refine((groups) => isUnique(groups.map(({ key }) => key)) && (groups.length === 0 || hasExactKeys(groups.filter(({ builtin }) => builtin), ['guest', 'user', 'admin']))),
  permissions: z.array(permissionDefinitionSchema).refine((permissions) => isUnique(permissions.map(({ key }) => key))),
  presets: z.array(permissionPresetSchema).refine((presets) => hasExactKeys(presets, ['restricted', 'basic', 'standard'])),
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
const deleteResponseSchema: z.ZodType<DeleteCustomUserGroupResponse> = z.strictObject({
  groupKey: z.string().min(1),
  name: z.string(),
})

/** Loads and validates the current built-in and custom groups, permission catalog, and presets. */
export async function listUserGroups(): Promise<UserGroupListResponse> {
  const response = await apiGet<unknown>('/admin/user-group/list')
  return parseResponse(userGroupListSchema, response.data)
}

/** Updates one editable group with an optimistic concurrency value. */
export async function updateUserGroupPermissions(input: UpdateUserGroupPermissionsInput): Promise<UpdateUserGroupPermissionsResponse> {
  const path = isBuiltinKey(input.groupKey) ? '/admin/user-group/update-permissions' : '/admin/user-group/update-custom-permissions'
  const response = await apiPost<unknown>(path, input)
  return parseResponse(updateResponseSchema, response.data)
}

/** Creates an empty custom group; its immutable key is assigned by the server. */
export async function createCustomUserGroup(input: CreateCustomUserGroupInput): Promise<UpdateUserGroupPermissionsResponse> {
  const response = await apiPost<unknown>('/admin/user-group/create', input)
  return parseResponse(updateResponseSchema, response.data)
}

/** Updates custom group details against the exact revision captured from the server. */
export async function updateCustomUserGroup(input: UpdateCustomUserGroupInput): Promise<UpdateUserGroupPermissionsResponse> {
  const response = await apiPost<unknown>('/admin/user-group/update', input)
  return parseResponse(updateResponseSchema, response.data)
}

/** Deletes an empty custom group only if its captured server revision is still current. */
export async function deleteCustomUserGroup(input: DeleteCustomUserGroupInput): Promise<DeleteCustomUserGroupResponse> {
  const response = await apiPost<unknown>('/admin/user-group/delete', input)
  return parseResponse(deleteResponseSchema, response.data)
}

/** Converts schema failures into the shared error contract with development-only diagnostics. */
function parseResponse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) {
    const issuePath = result.error.issues[0]?.path.map(String).join('.') || '<root>'
    const message = import.meta.env.DEV
      ? `Invalid user group response (schema path: ${issuePath})`
      : 'Invalid user group response'
    throw new ApiClientError(INVALID_REQUEST_CODE, message)
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

/** Identifies only the reserved stable builtin keys, never arbitrary custom identifiers. */
function isBuiltinKey(key: string): key is BuiltinUserGroupKey {
  return key === 'guest' || key === 'user' || key === 'admin'
}
