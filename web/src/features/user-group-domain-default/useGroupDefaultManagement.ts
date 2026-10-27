import { computed, onBeforeUnmount, reactive, ref, toRaw, watch } from 'vue'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import { me } from '@/entities/auth/api'
import { listUserGroups, updateUserGroupPermissions, userGroupQueryKey, type UserGroup, type UserGroupKey, type PermissionPresetKey, type UpdateUserGroupPermissionsInput } from '@/entities/user-group/api'
import { adminGroupDefaultDomainQueryKey, groupDefaultDomainQueryKey, getUserGroupDomainDefault, setUserGroupDomainDefault, type UserGroupDomainDefault, type SetUserGroupDomainDefaultInput } from '@/entities/user-group/domain-default'
import { availableDomainQueryKey } from '@/entities/domain/api'
import { useAccountIdentity } from '@/shared/preferences/useAccountPreferences'
import { useUserGroupPermissionDraft } from '@/features/user-group-permissions/useUserGroupPermissionDraft'
import { ApiClientError } from '@/shared/api/client'

type Setting = UserGroupDomainDefault['setting']
interface DefaultDraft { result: UserGroupDomainDefault; value: string | null }

/** Coordinates two independent drafts on one shared group revision and login epoch. */
export function useGroupDefaultManagement() {
  const client = useQueryClient()
  const identity = useAccountIdentity()
  const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: me, enabled: false })
  const actor = computed(() => auth.data.value?.user)
  const canManage = computed(() => !!identity.scope.value.userId && actor.value?.group === 'admin' && !!actor.value.permissions.includes('admin:access'))
  const canManageDefault = computed(() => canManage.value && !!actor.value?.permissions.includes('domain:manage'))
  const queryKey = computed(() => [...userGroupQueryKey, identity.scope.value.userId, identity.scope.value.epoch])
  const query = useQuery({ queryKey, queryFn: listUserGroups, enabled: canManage, retry: false })
  const activeGroupKey = ref<UserGroupKey>('guest')
  const settingKey = computed(() => [...adminGroupDefaultDomainQueryKey, identity.scope.value.userId, identity.scope.value.epoch, activeGroupKey.value])
  const settingQuery = useQuery({ queryKey: settingKey, queryFn: ({ queryKey }) => getUserGroupDomainDefault(queryKey[3] as UserGroupKey), enabled: canManageDefault, retry: false })
  const draft = useUserGroupPermissionDraft()
  const displayedGroups = ref<UserGroup[]>([])
  const defaults = reactive<Partial<Record<UserGroupKey, DefaultDraft>>>({})
  const stale = reactive(new Set<UserGroupKey>())
  const feedback = ref('')
  const feedbackKind = ref<'permission' | 'default'>('permission')
  const feedbackRevision = ref(0)
  const refreshBroken = ref(false)
  const refreshing = ref(false)
  let mounted = true
  onBeforeUnmount(() => { mounted = false })
  const activeGroup = computed(() => displayedGroups.value.find(({ key }) => key === activeGroupKey.value))
  const currentDefault = computed(() => defaults[activeGroupKey.value])

  /** Tests exact identity object equality so A→B→A cannot accept an earlier response. */
  function current(scope: typeof identity.scope.value) { return mounted && identity.isCurrent(scope) }
  /** Keeps changed server versions visible as stale without destroying unsaved edits. */
  function syncGroups(groups: UserGroup[], replace?: UserGroupKey) {
    displayedGroups.value = groups.map((group) => {
      const previous = displayedGroups.value.find(({ key }) => key === group.key)
      if (previous && replace !== group.key && previous.updatedAt !== group.updatedAt && (draft.isDirty(previous) || defaultDirty(group.key))) {
        stale.add(group.key)
        return previous
      }
      if (!previous || previous.updatedAt !== group.updatedAt || replace === group.key) draft.resetGroup(group)
      return group
    })
    if (!displayedGroups.value.some(({ key }) => key === activeGroupKey.value)) activeGroupKey.value = displayedGroups.value[0]?.key ?? 'guest'
    for (const group of displayedGroups.value) align(group.key)
  }
  /** Requires both reads to represent the same shared resource before either editor writes. */
  function align(key: UserGroupKey) {
    const group = displayedGroups.value.find((group) => group.key === key)
    const setting = defaults[key]
    if (canManageDefault.value && group && setting && group.updatedAt !== setting.result.setting.updatedAt) stale.add(key)
  }
  watch(() => query.data.value, (result) => { if (result && !refreshing.value) syncGroups(result.groups) }, { immediate: true })
  watch(() => settingQuery.data.value, (result) => {
    if (!result || refreshing.value || result.setting.groupKey !== activeGroupKey.value) return
    const key = result.setting.groupKey
    const previous = defaults[key]
    if (previous && previous.result.setting.updatedAt !== result.setting.updatedAt && (defaultDirty(key) || (activeGroup.value && draft.isDirty(activeGroup.value)))) stale.add(key)
    else defaults[key] = { result, value: previous && defaultDirty(key) ? previous.value : result.setting.domainId }
    align(key)
  }, { immediate: true })
  watch(identity.scope, () => {
    displayedGroups.value = []; draft.reset([])
    for (const key of ['guest', 'user', 'admin'] as const) delete defaults[key]
    stale.clear(); feedback.value = ''; feedbackKind.value = 'permission'; refreshBroken.value = false; refreshing.value = false; activeGroupKey.value = 'guest'
  }, { flush: 'sync' })
  watch(activeGroupKey, () => { feedback.value = '' })

  /** Compares only the domain editor's own snapshot, independently of permission changes. */
  function defaultDirty(key: UserGroupKey) { const value = defaults[key]; return !!value && value.value !== value.result.setting.domainId }
  const pending = computed(() => (mutation.isPending.value && !!mutation.variables.value && identity.isCurrent(toRaw(mutation.variables.value.scope))) || refreshing.value)
  /** Rejects stale child events and all writes after permission or refresh failures. */
  function groupReady(group: UserGroup) {
    return mounted && canManage.value && !pending.value && !refreshBroken.value && !query.isError.value &&
      activeGroupKey.value === group.key && displayedGroups.value.includes(group) && group.editable && !stale.has(group.key) &&
      (!canManageDefault.value || (!settingQuery.isError.value && defaults[group.key]?.result.setting.updatedAt === group.updatedAt))
  }
  /** Checks the default snapshot against the visible target and original revision. */
  function settingReady(target: Setting) {
    const group = activeGroup.value
    return !!group && groupReady(group) && canManageDefault.value && !settingQuery.isError.value &&
      defaults[group.key]?.result.setting === target && target.groupKey === group.key && target.updatedAt === group.updatedAt && target.editable && !draft.isDirty(group)
  }

  /** Refreshes auth outside the global cache and checks identity before publishing it. */
  async function reload(key: UserGroupKey, scope = identity.scope.value, kind = feedbackKind.value) {
    if (!current(scope) || refreshing.value) return false
    feedbackKind.value = kind
    refreshing.value = true
    try {
      const user = await me()
      if (!current(scope)) return false
      // A stale Cookie response must never replace a newer login's auth cache.
      if (user.user.id !== scope.userId) throw new Error('Identity changed')
      client.setQueryData(['auth', 'me'], user)
      if (!current(scope) || !canManage.value) throw new Error('Access changed')
      const groups = await listUserGroups()
      const setting = canManageDefault.value ? await getUserGroupDomainDefault(key) : undefined
      if (!current(scope)) return false
      client.setQueryData(queryKey.value, groups)
      syncGroups(groups.groups, key)
      if (setting) {
        client.setQueryData([...adminGroupDefaultDomainQueryKey, scope.userId, scope.epoch, key], setting)
        defaults[key] = { result: setting, value: setting.setting.domainId }
      }
      stale.delete(key); align(key)
      if (stale.has(key)) throw new Error('Shared revision changed')
      await Promise.all([
        client.invalidateQueries({ queryKey: groupDefaultDomainQueryKey }, { throwOnError: true }),
        client.invalidateQueries({ queryKey: availableDomainQueryKey }, { throwOnError: true }),
      ])
      if (!current(scope)) return false
      refreshBroken.value = false
      feedbackRevision.value++
      return true
    } catch {
      if (current(scope)) { refreshBroken.value = true; feedback.value = 'reload-error' }
      return false
    } finally { if (current(scope)) refreshing.value = false }
  }

  type Write = { scope: typeof identity.scope.value; key: UserGroupKey } & ({ kind: 'permission'; input: UpdateUserGroupPermissionsInput } | { kind: 'default'; input: SetUserGroupDomainDefaultInput })
  const mutation = useMutation({
    retry: false,
    /** Rechecks scope immediately before dispatching an independently versioned request. */
    mutationFn: async (write: Write) => {
      if (!current(write.scope) || !canManage.value || (write.kind === 'default' && !canManageDefault.value)) throw new Error('Inactive editor')
      if (write.kind === 'permission') await updateUserGroupPermissions(write.input)
      else await setUserGroupDomainDefault(write.input)
    },
    /** Treats the server write and required refresh as separate outcomes. */
    async onSuccess(_result, write) {
      if (!current(write.scope)) return
      // Mark other cached targets stale; their own reads will validate shared versions.
      await client.invalidateQueries({ queryKey: adminGroupDefaultDomainQueryKey, refetchType: 'none' })
      await client.invalidateQueries({ queryKey: userGroupQueryKey, refetchType: 'none' })
      if (!current(write.scope)) return
      const ok = await reload(write.key, write.scope)
      if (ok && current(write.scope) && activeGroupKey.value === write.key) feedback.value = 'success'
    },
    /** Never retries writes; old permission conflicts retain their explicit reload contract. */
    async onError(error, write) {
      if (!current(write.scope)) return
      if (error instanceof ApiClientError && error.code === 300202) {
        stale.add(write.key)
        if (write.kind === 'permission') await reload(write.key, write.scope)
        if (current(write.scope)) feedback.value = refreshBroken.value ? 'conflict-reload-error' : 'conflict'
      } else { refreshBroken.value = true; feedback.value = 'error' }
    },
  })

  /** Applies only catalog-backed presets to a current unlocked permission draft. */
  function applyPreset(group: UserGroup, key: PermissionPresetKey) {
    if (!groupReady(group) || defaultDirty(group.key)) return
    const catalog = query.data.value
    const preset = catalog?.presets.find((preset) => preset.key === key)
    if (!catalog || !preset) { feedback.value = 'error'; return }
    draft.applyPreset(group, preset, catalog.permissions)
  }
  /** Ignores a stale checkbox event after another editor acquires the draft lock. */
  function setPermission(group: UserGroup, key: string, selected: boolean) {
    if (!groupReady(group) || defaultDirty(group.key)) return
    const definition = query.data.value?.permissions.find((item) => item.key === key)
    if (!definition) { feedback.value = 'error'; return }
    draft.setPermission(group, definition, selected)
  }
  /** Captures the permission draft's original revision without deriving it from a later read. */
  function savePermissions(group: UserGroup) {
    if (!groupReady(group) || defaultDirty(group.key) || !draft.isDirty(group)) return
    // groupReady already established an editable non-guest target.
    const input = draft.toUpdateInput(group)!
    feedbackKind.value = 'permission'
    feedbackRevision.value++; feedback.value = ''
    mutation.mutate({ kind: 'permission', input, key: group.key, scope: identity.scope.value })
  }
  /** Updates one default draft only from its own current editor. */
  function selectDefault(target: Setting, value: string | null) {
    if (!settingReady(target)) return
    if (value !== null && !defaults[target.groupKey]!.result.candidates.some(({ id }) => id === value)) return
    defaults[target.groupKey]!.value = value
  }
  /** Dispatches only a changed available default using its captured shared revision. */
  function saveDefault(target: Setting) {
    if (!settingReady(target) || target.groupKey === 'guest' || !defaultDirty(target.groupKey)) return
    const value = defaults[target.groupKey]!
    if (value.value !== null && !value.result.candidates.some(({ id }) => id === value.value)) return
    feedbackKind.value = 'default'
    feedbackRevision.value++; feedback.value = ''
    mutation.mutate({ kind: 'default', key: target.groupKey, scope: identity.scope.value, input: { groupKey: target.groupKey, domainId: value.value, expectedUpdatedAt: target.updatedAt } })
  }
  /** Cancels only one local draft; stale shared snapshots still require an explicit reload. */
  function cancelDefault(target: Setting) {
    if (pending.value || defaults[target.groupKey]?.result.setting !== target) return
    defaults[target.groupKey]!.value = target.domainId
  }
  /** Discards a permission draft without discarding another group's independent work. */
  function cancelPermissions(group: UserGroup) {
    if (!pending.value && displayedGroups.value.includes(group)) { draft.resetGroup(group); feedbackRevision.value++ }
  }
  /** Guards keyboard and delayed tab events as well as the disabled tab buttons. */
  function changeGroup(key: UserGroupKey) { if (!pending.value && displayedGroups.value.some((group) => group.key === key)) activeGroupKey.value = key }

  return { identity, query, settingQuery, canManage, canManageDefault, activeGroupKey, activeGroup, displayedGroups, currentDefault, draft, stale, feedback, feedbackKind, feedbackRevision, refreshBroken, pending, groupReady, settingReady, defaultDirty, applyPreset, setPermission, savePermissions, selectDefault, saveDefault, cancelDefault, cancelPermissions, reload, changeGroup }
}
