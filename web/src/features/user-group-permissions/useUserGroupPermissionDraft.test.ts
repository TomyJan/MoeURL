import { describe, expect, it } from 'vitest'

import type { PermissionDefinition, PermissionPreset, UserGroup } from '@/entities/user-group/api'

import { useUserGroupPermissionDraft } from './useUserGroupPermissionDraft'

const definitions: PermissionDefinition[] = [
  { key: 'short_link:create', category: 'short_link_basic', protected: false },
  { key: 'short_link:read_own', category: 'short_link_basic', protected: false },
  { key: 'admin:access', category: 'administration', protected: true },
]
const basic: PermissionPreset = {
  key: 'basic',
  applicableGroups: ['user', 'admin'],
  permissions: ['short_link:create'],
}
const groups: UserGroup[] = [
  { key: 'guest', name: 'Guest', description: '', builtin: true, editable: false, permissions: [], updatedAt: 'guest-v1' },
  { key: 'user', name: 'User', description: '', builtin: true, editable: true, permissions: ['short_link:read_own'], updatedAt: 'user-v1' },
  { key: 'admin', name: 'Admin', description: '', builtin: true, editable: true, permissions: ['short_link:read_own', 'admin:access'], updatedAt: 'admin-v1' },
]

describe('useUserGroupPermissionDraft', () => {
  it('keeps independent drafts without mutating query data', () => {
    const source = structuredClone(groups)
    const draft = useUserGroupPermissionDraft()
    draft.reset(groups)

    draft.setPermission(groups[1], definitions[0], true)

    expect(draft.permissionsFor('user')).toEqual(['short_link:read_own', 'short_link:create'])
    expect(draft.permissionsFor('admin')).toEqual(['short_link:read_own', 'admin:access'])
    expect(groups).toEqual(source)
    expect(draft.isDirty(groups[1])).toBe(true)
    expect(draft.isDirty(groups[2])).toBe(false)
  })

  it('applies a preset only to configurable permissions and preserves protected state', () => {
    const draft = useUserGroupPermissionDraft()
    draft.reset(groups)

    expect(draft.applyPreset(groups[2], basic, definitions)).toBe(true)
    expect(draft.permissionsFor('admin')).toEqual(['short_link:create', 'admin:access'])
    expect(draft.toUpdateInput(groups[2])).toEqual({
      groupKey: 'admin',
      permissions: ['short_link:create', 'admin:access'],
      expectedUpdatedAt: 'admin-v1',
    })
  })

  it('deduplicates permissions when a preset overlaps preserved protected state', () => {
    const draft = useUserGroupPermissionDraft()
    draft.reset(groups)
    const overlappingPreset: PermissionPreset = {
      ...basic,
      permissions: ['short_link:create', 'admin:access'],
    }

    expect(draft.applyPreset(groups[2], overlappingPreset, definitions)).toBe(true)
    expect(draft.permissionsFor('admin')).toEqual(['short_link:create', 'admin:access'])
  })

  it('keeps guest read-only and ignores protected permission toggles', () => {
    const draft = useUserGroupPermissionDraft()
    draft.reset(groups)

    expect(draft.setPermission(groups[0], definitions[0], true)).toBe(false)
    expect(draft.applyPreset(groups[0], basic, definitions)).toBe(false)
    expect(draft.setPermission(groups[2], definitions[2], false)).toBe(false)
    expect(draft.permissionsFor('guest')).toEqual([])
    expect(draft.permissionsFor('admin')).toContain('admin:access')
    expect(draft.toUpdateInput(groups[0])).toBeNull()
  })

  it('resets server-refreshed groups while retaining unrelated drafts', () => {
    const draft = useUserGroupPermissionDraft()
    draft.reset(groups)
    draft.setPermission(groups[1], definitions[0], true)
    draft.setPermission(groups[2], definitions[0], true)

    const refreshedUser = { ...groups[1], permissions: [], updatedAt: 'user-v2' }
    draft.resetGroup(refreshedUser)

    expect(draft.permissionsFor('user')).toEqual([])
    expect(draft.sourceUpdatedAtFor('user')).toBe('user-v2')
    expect(draft.permissionsFor('admin')).toEqual(['short_link:read_own', 'admin:access', 'short_link:create'])
    expect(draft.isDirty(refreshedUser)).toBe(false)
  })

  it('supports empty reads, lazy initialization, removal, and missing dirty state', () => {
    const draft = useUserGroupPermissionDraft()

    expect(draft.permissionsFor('user')).toEqual([])
    expect(draft.sourceUpdatedAtFor('user')).toBe('')
    expect(draft.isDirty(groups[1])).toBe(false)
    expect(draft.setPermission(groups[1], definitions[1], false)).toBe(true)
    expect(draft.permissionsFor('user')).toEqual([])
    expect(draft.sourceUpdatedAtFor('user')).toBe('user-v1')
  })
})
