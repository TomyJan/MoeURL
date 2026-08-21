import { reactive } from 'vue'

import type {
  PermissionDefinition,
  PermissionPreset,
  UpdateUserGroupPermissionsInput,
  UserGroup,
  UserGroupKey,
} from '@/entities/user-group/api'

interface PermissionDraft {
  permissions: string[]
  sourceUpdatedAt: string
}

/** Creates isolated local permission drafts without mutating query cache data. */
export function useUserGroupPermissionDraft() {
  const drafts = reactive<Partial<Record<UserGroupKey, PermissionDraft>>>({})

  /** Replaces every local draft with independent copies of current server state. */
  function reset(groups: readonly UserGroup[]) {
    for (const key of ['guest', 'user', 'admin'] as const) {
      delete drafts[key]
    }
    for (const group of groups) {
      resetGroup(group)
    }
  }

  /** Replaces one local draft after a save or a server refresh. */
  function resetGroup(group: UserGroup) {
    drafts[group.key] = {
      permissions: [...group.permissions],
      sourceUpdatedAt: group.updatedAt,
    }
  }

  /** Returns an independent view of one group's current draft permissions. */
  function permissionsFor(groupKey: UserGroupKey): string[] {
    return [...(drafts[groupKey]?.permissions ?? [])]
  }

  /** Returns the server version from which one draft was created. */
  function sourceUpdatedAtFor(groupKey: UserGroupKey): string {
    return drafts[groupKey]?.sourceUpdatedAt ?? ''
  }

  /** Adds or removes one configurable permission when the target group is editable. */
  function setPermission(group: UserGroup, definition: PermissionDefinition, selected: boolean): boolean {
    if (!group.editable || definition.protected) {
      return false
    }
    const draft = ensureDraft(group)
    const current = new Set(draft.permissions)
    if (selected) {
      current.add(definition.key)
    } else {
      current.delete(definition.key)
    }
    draft.permissions = [...current]
    return true
  }

  /** Replaces configurable permissions from a preset while preserving protected ownership. */
  function applyPreset(group: UserGroup, preset: PermissionPreset, definitions: readonly PermissionDefinition[]): boolean {
    if (!group.editable || !preset.applicableGroups.includes(group.key as 'user' | 'admin')) {
      return false
    }
    const draft = ensureDraft(group)
    const protectedKeys = new Set(definitions.filter(({ protected: fixed }) => fixed).map(({ key }) => key))
    const preserved = draft.permissions.filter((permission) => protectedKeys.has(permission))
    draft.permissions = [...new Set([...preset.permissions, ...preserved])]
    return true
  }

  /** Reports whether a draft differs from the supplied server group. */
  function isDirty(group: UserGroup): boolean {
    const draft = drafts[group.key]
    if (!draft) {
      return false
    }
    return !sameSet(draft.permissions, group.permissions)
  }

  /** Builds a complete optimistic update for an editable group. */
  function toUpdateInput(group: UserGroup): UpdateUserGroupPermissionsInput | null {
    if (group.key === 'guest' || !group.editable) {
      return null
    }
    const draft = ensureDraft(group)
    return {
      groupKey: group.key,
      permissions: [...draft.permissions],
      expectedUpdatedAt: draft.sourceUpdatedAt,
    }
  }

  /** Returns an existing draft or initializes it from an independent server copy. */
  function ensureDraft(group: UserGroup): PermissionDraft {
    const existing = drafts[group.key]
    if (existing) {
      return existing
    }
    resetGroup(group)
    return drafts[group.key] as PermissionDraft
  }

  return {
    applyPreset,
    isDirty,
    permissionsFor,
    reset,
    resetGroup,
    setPermission,
    sourceUpdatedAtFor,
    toUpdateInput,
  }
}

/** Reports set equality without relying on server or interaction ordering. */
function sameSet(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value) => right.includes(value))
}
