<template>
  <section class="user-groups-page" data-testid="console-page-user-groups">
    <header class="user-groups-page__header">
      <div>
        <h1>{{ t('userGroups.title') }}</h1>
        <p>{{ t('userGroups.description') }}</p>
      </div>
      <strong>{{ t('userGroups.total', { total: displayedGroups.length }) }}</strong>
    </header>

    <v-progress-linear v-if="query.isPending.value" indeterminate />
    <v-alert v-else-if="query.isError.value && !query.data.value" type="error" variant="tonal">
      {{ t('userGroups.loadFailed') }}
      <template #append>
        <v-btn variant="text" @click="query.refetch()">{{ t('userGroups.retry') }}</v-btn>
      </template>
    </v-alert>
    <div v-else-if="displayedGroups.length === 0" class="user-groups-page__empty">
      <h2>{{ t('userGroups.empty') }}</h2>
      <p>{{ t('userGroups.emptyDescription') }}</p>
    </div>
    <template v-else>
      <v-tabs v-model="activeGroupKey" class="user-groups-page__tabs" show-arrows>
        <v-tab v-for="group in displayedGroups" :key="group.key" :value="group.key">{{ group.name }}</v-tab>
      </v-tabs>

      <v-alert v-if="feedback === 'success'" type="success" variant="tonal">{{ t('userGroups.saveSuccess') }}</v-alert>
      <v-alert v-else-if="feedback === 'conflict'" type="warning" variant="tonal">{{ t('userGroups.conflict') }}</v-alert>
      <v-alert v-else-if="feedback === 'reload-error'" type="error" variant="tonal">{{ t('userGroups.conflictReloadFailed') }}</v-alert>
      <v-alert v-else-if="feedback === 'error'" type="error" variant="tonal">{{ t('userGroups.saveFailed') }}</v-alert>

      <UserGroupPermissionEditor
        v-if="activeGroup && catalog"
        :data-valid="!staleGroupKeys.has(activeGroup.key)"
        :definitions="catalog.permissions"
        :dirty="draft.isDirty(activeGroup)"
        :draft-permissions="draft.permissionsFor(activeGroup.key)"
        :group="activeGroup"
        :pending="mutation.isPending.value"
        :presets="catalog.presets"
        @apply-preset="applyPreset(activeGroup, $event)"
        @save="saveCurrentGroup(activeGroup)"
        @set-permission="(permissionKey, selected) => activeGroup && setPermission(activeGroup, permissionKey, selected)"
      />
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'

import {
  listUserGroups,
  updateUserGroupPermissions,
  userGroupQueryKey,
  type PermissionPresetKey,
  type UserGroup,
  type UserGroupKey,
  type UserGroupListResponse,
} from '@/entities/user-group/api'
import UserGroupPermissionEditor from '@/features/user-group-permissions/UserGroupPermissionEditor.vue'
import { useUserGroupPermissionDraft } from '@/features/user-group-permissions/useUserGroupPermissionDraft'
import { ApiClientError } from '@/shared/api/client'
import { USER_GROUP_PERMISSION_CONFLICT_CODE } from '@/shared/api/error-codes'

type Feedback = '' | 'success' | 'conflict' | 'reload-error' | 'error'

const { t } = useI18n()
const queryClient = useQueryClient()
const query = useQuery({ queryKey: userGroupQueryKey, queryFn: listUserGroups })
const draft = useUserGroupPermissionDraft()
const displayedGroups = ref<UserGroup[]>([])
const activeGroupKey = ref<UserGroupKey>('guest')
const feedback = ref<Feedback>('')
const knownVersions = new Map<UserGroupKey, string>()
const staleGroupKeys = reactive(new Set<UserGroupKey>())
let automaticGroupSyncSuspended = false
/** Exposes the validated catalog while preserving its initial absent state. */
const catalog = computed<UserGroupListResponse | undefined>(() => query.data.value)
/** Resolves the active visible group without asserting that it exists. */
const activeGroup = computed<UserGroup | undefined>(() => displayedGroups.value.find(({ key }) => key === activeGroupKey.value))

watch(
  () => query.data.value,
  (result) => {
    if (automaticGroupSyncSuspended) {
      return
    }
    if (!result) {
      displayedGroups.value = []
      return
    }
    syncServerGroups(result)
  },
  { immediate: true },
)

watch(activeGroupKey, () => {
  feedback.value = ''
})

const mutation = useMutation({
  mutationFn: updateUserGroupPermissions,
  retry: false,
  /** Replaces current state from the response, then awaits both required cache refreshes. */
  async onSuccess(result) {
    replaceDisplayedGroup(result.group)
    draft.resetGroup(result.group)
    knownVersions.set(result.group.key, result.group.updatedAt)
    staleGroupKeys.delete(result.group.key)
    queryClient.setQueryData<UserGroupListResponse | undefined>(userGroupQueryKey, (current) => current ? {
      ...current,
      groups: current.groups.map((group) => group.key === result.group.key ? { ...result.group, permissions: [...result.group.permissions] } : group),
    } : current)
    if (result.group.key === activeGroupKey.value) {
      feedback.value = 'success'
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: userGroupQueryKey }),
      queryClient.invalidateQueries({ queryKey: ['auth', 'me'] }),
    ])
  },
  /** Reloads a conflicting group once without retrying the rejected write. */
  async onError(error, input) {
    if (error instanceof ApiClientError && error.code === USER_GROUP_PERMISSION_CONFLICT_CODE) {
      automaticGroupSyncSuspended = true
      let refreshFailed = false
      try {
        await query.refetch({ throwOnError: true })
      } catch {
        refreshFailed = true
        staleGroupKeys.add(input.groupKey)
      } finally {
        await nextTick()
        const result = query.data.value
        if (result) {
          syncServerGroups(result, input.groupKey)
          await nextTick()
        }
        automaticGroupSyncSuspended = false
      }
      if (input.groupKey === activeGroupKey.value) {
        feedback.value = refreshFailed ? 'reload-error' : 'conflict'
      }
      return
    }
    if (input.groupKey === activeGroupKey.value) {
      feedback.value = 'error'
    }
  },
})

/** Copies refreshed groups and preserves unrelated drafts during a conflict refresh. */
function syncServerGroups(result: UserGroupListResponse, conflictGroupKey?: UserGroupKey) {
  displayedGroups.value = result.groups.map((group) => ({ ...group, permissions: [...group.permissions] }))
  for (const group of displayedGroups.value) {
    if (knownVersions.get(group.key) === group.updatedAt) {
      continue
    }
    if (conflictGroupKey && group.key !== conflictGroupKey) {
      staleGroupKeys.add(group.key)
      continue
    }
    draft.resetGroup(group)
    knownVersions.set(group.key, group.updatedAt)
    staleGroupKeys.delete(group.key)
  }
}

/** Replaces one visible group without mutating query response objects. */
function replaceDisplayedGroup(group: UserGroup) {
  displayedGroups.value = displayedGroups.value.map((current) => current.key === group.key
    ? { ...group, permissions: [...group.permissions] }
    : current)
}

/** Applies a server-defined preset to the current local draft. */
function applyPreset(group: UserGroup, presetKey: PermissionPresetKey) {
  const currentCatalog = catalog.value
  const preset = currentCatalog?.presets.find(({ key }) => key === presetKey)
  if (!currentCatalog || !preset) {
    feedback.value = 'error'
    return
  }
  feedback.value = ''
  draft.applyPreset(group, preset, currentCatalog.permissions)
}

/** Updates one configurable permission in the current local draft. */
function setPermission(group: UserGroup, permissionKey: string, selected: boolean) {
  const definition = catalog.value?.permissions.find(({ key }) => key === permissionKey)
  if (!definition) {
    feedback.value = 'error'
    return
  }
  feedback.value = ''
  draft.setPermission(group, definition, selected)
}

/** Starts one complete optimistic update for the active editable group. */
function saveCurrentGroup(group: UserGroup) {
  const input = draft.toUpdateInput(group)
  if (!input) {
    feedback.value = 'error'
    return
  }
  feedback.value = ''
  mutation.mutate(input)
}
</script>

<style scoped>
.user-groups-page {
  display: grid;
  gap: 22px;
  min-width: 0;
}

.user-groups-page__header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 20px;
}

.user-groups-page__header h1,
.user-groups-page__header p,
.user-groups-page__empty h2,
.user-groups-page__empty p {
  margin: 0;
}

.user-groups-page__header h1 {
  font-size: clamp(1.65rem, 2.4vw, 2.35rem);
  letter-spacing: 0;
}

.user-groups-page__header p,
.user-groups-page__empty p {
  margin-top: 8px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.user-groups-page__tabs {
  max-width: 100%;
  border-bottom: 1px solid var(--moeurl-outline);
}

.user-groups-page__empty {
  padding: 36px 0;
}

@media (max-width: 700px) {
  .user-groups-page__header {
    align-items: start;
    flex-direction: column;
  }
}
</style>
