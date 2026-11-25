<template>
  <section class="user-groups-page" data-testid="console-page-user-groups">
    <header class="user-groups-page__header">
      <div><h1>{{ t('userGroups.title') }}</h1><p>{{ t('userGroups.description') }}</p></div>
      <div class="user-groups-page__header-actions">
        <strong>{{ t('userGroups.total', { total: displayedGroups.length }) }}</strong>
        <v-btn v-if="canManage" color="primary" :disabled="pending || groupMutation.isPending.value" @click="openCreate">{{ t('userGroups.createCustom') }}</v-btn>
      </div>
    </header>
    <v-alert v-if="!canManage" type="warning">{{ t('groupDefault.accessDenied') }}</v-alert>
    <v-progress-linear v-else-if="query.isPending.value" indeterminate />
    <v-alert v-else-if="query.isError.value && !query.data.value" type="error" variant="tonal">
      {{ t('userGroups.loadFailed') }}
      <v-btn variant="text" @click="query.refetch()">{{ t('userGroups.retry') }}</v-btn>
    </v-alert>
    <div v-else-if="displayedGroups.length === 0" class="user-groups-page__empty">
      <h2>{{ t('userGroups.empty') }}</h2><p>{{ t('userGroups.emptyDescription') }}</p>
    </div>
    <template v-else>
      <v-tabs :model-value="activeGroupKey" class="user-groups-page__tabs" show-arrows @update:model-value="changeGroup">
        <v-tab v-for="group in displayedGroups" :key="group.key" :value="group.key" :disabled="pending || groupDialog !== ''">{{ group.name }}</v-tab>
      </v-tabs>
      <ActionToast v-if="feedback" :key="feedbackRevision + ':' + feedback" :type="feedback === 'success' ? 'success' : feedback === 'conflict' ? 'warning' : 'error'">{{ t(feedbackKey) }}</ActionToast>
      <ActionToast v-if="groupConflict" type="warning">{{ t('userGroups.conflict') }}</ActionToast>
      <v-alert v-if="refreshBroken" type="warning">
        {{ t('groupDefault.refreshRequired') }}
        <v-btn :disabled="pending" @click="recoverAfterRefreshFailure()">{{ t('groupDefault.reload') }}</v-btn>
      </v-alert>
      <!-- The nonempty catalog branch guarantees an active group; capture its rendered target for event guards. -->
      <template v-for="group in displayedGroups.filter((candidate) => candidate.key === activeGroupKey)" :key="identity.scope.value.epoch + ':' + group.key + ':' + group.updatedAt + ':' + feedbackRevision">
        <div v-if="!group.builtin" class="user-groups-page__custom-actions">
          <v-btn :disabled="pending || groupMutation.isPending.value || draft.isDirty(group) || defaultDirty(group.key)" variant="outlined" @click="openEdit(group)">{{ t('userGroups.editDetails') }}</v-btn>
          <v-btn :disabled="pending || groupMutation.isPending.value" color="error" variant="text" @click="openDelete(group)">{{ t('userGroups.deleteCustom') }}</v-btn>
          <v-alert v-if="draft.isDirty(group) || defaultDirty(group.key)" type="warning" variant="tonal">{{ t('userGroups.detailsEditBlockedByDraft') }}</v-alert>
        </div>
        <v-alert v-if="groupFeedback" type="error" variant="tonal">{{ t('userGroups.managementFailed') }}</v-alert>
        <UserGroupPermissionEditor
          :data-valid="group.key === 'guest' || (groupReady(group) && !defaultDirty(group.key))"
          :definitions="query.data.value!.permissions"
          :dirty="draft.isDirty(group)"
          :draft-permissions="draft.permissionsFor(group.key)"
          :group="group"
          :pending="pending"
          :presets="query.data.value!.presets"
          @apply-preset="applyPreset(group, $event)"
          @save="savePermissions(group)"
          @set-permission="(key, selected) => setPermission(group, key, selected)"
        />
        <div v-if="group.editable">
          <v-btn :disabled="pending" variant="text" @click="cancelPermissions(group)">{{ t('groupDefault.cancelPermissions') }}</v-btn>
          <v-btn :disabled="pending" variant="text" @click="reload(group.key, undefined, 'permission')">{{ t('groupDefault.reloadPermissions') }}</v-btn>
        </div>
        <template v-if="canManageDefault">
          <v-progress-linear v-if="settingQuery.isPending.value" indeterminate />
          <v-alert v-if="settingQuery.isError.value" type="error">
            {{ t('groupDefault.loadFailed') }}
            <v-btn :disabled="pending" @click="reload(group.key, undefined, 'default')">{{ t('groupDefault.retry') }}</v-btn>
          </v-alert>
          <UserGroupDomainDefaultEditor
            v-if="currentDefault"
            :result="currentDefault.result"
            :value="currentDefault.value"
            :disabled="!settingReady(currentDefault.result.setting)"
            :dirty="defaultDirty(group.key)"
            :pending="pending"
            :stale="stale.has(group.key)"
            @select="selectDefault"
            @save="saveDefault"
            @cancel="cancelDefault"
            @reload="(target) => reload(target.groupKey, undefined, 'default')"
          />
        </template>
      </template>
    </template>
    <v-dialog :model-value="groupDialog !== ''" :persistent="groupMutation.isPending.value" max-width="520" @update:model-value="!$event && closeGroupDialog()">
      <v-card>
        <v-card-title>{{ t(groupDialog === 'create' ? 'userGroups.createTitle' : 'userGroups.editTitle') }}</v-card-title>
        <v-card-text>
          <v-text-field v-model="groupName" :label="t('userGroups.name')" :disabled="groupMutation.isPending.value" maxlength="64" />
          <v-textarea v-model="groupDescription" :label="t('userGroups.descriptionField')" :disabled="groupMutation.isPending.value" />
          <ActionToast v-if="groupConflict" type="warning">{{ t('userGroups.conflict') }}</ActionToast>
          <ActionToast v-else-if="groupFeedback" type="error">{{ t('userGroups.managementFailed') }}</ActionToast>
        </v-card-text>
        <v-card-actions>
          <v-btn :disabled="groupMutation.isPending.value" variant="text" @click="closeGroupDialog">{{ t('userGroups.cancel') }}</v-btn>
          <v-btn :disabled="!groupName.trim() || groupMutation.isPending.value" :loading="groupMutation.isPending.value" color="primary" variant="flat" @click="saveGroupDetails">
            {{ t(groupDialog === 'create' ? 'userGroups.create' : 'userGroups.saveDetails') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <v-dialog :model-value="deleteDialog" :persistent="groupMutation.isPending.value" max-width="520" @update:model-value="!$event && closeDeleteDialog()">
      <v-card v-if="activeGroup && !activeGroup.builtin && deleteSnapshot?.key === activeGroup.key">
        <v-card-title>{{ t('userGroups.deleteTitle') }}</v-card-title>
        <v-card-text>
          <p>{{ t('userGroups.deleteConfirmation', { name: activeGroup.name, count: activeGroup.memberCount }) }}</p>
          <p>{{ t('userGroups.deleteDomainGrants') }}</p>
          <v-alert v-if="activeGroup.memberCount > 0" type="warning">{{ t('userGroups.deleteMembersBlocked', { count: activeGroup.memberCount }) }}</v-alert>
          <ActionToast v-if="groupFeedback" type="error">{{ t('userGroups.managementFailed') }}</ActionToast>
        </v-card-text>
        <v-card-actions>
          <v-btn :disabled="groupMutation.isPending.value" variant="text" @click="closeDeleteDialog">{{ t('userGroups.cancel') }}</v-btn>
          <v-btn :disabled="activeGroup.memberCount > 0 || groupMutation.isPending.value" :loading="groupMutation.isPending.value" color="error" variant="flat" @click="deleteGroup">
            {{ t('userGroups.confirmDelete') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMutation, useQueryClient } from '@tanstack/vue-query'
import ActionToast from '@/shared/feedback/ActionToast.vue'
import UserGroupPermissionEditor from '@/features/user-group-permissions/UserGroupPermissionEditor.vue'
import UserGroupDomainDefaultEditor from '@/features/user-group-domain-default/UserGroupDomainDefaultEditor.vue'
import { useGroupDefaultManagement } from '@/features/user-group-domain-default/useGroupDefaultManagement'
import { createCustomUserGroup, deleteCustomUserGroup, updateCustomUserGroup, type UserGroup } from '@/entities/user-group/api'
import { ApiClientError } from '@/shared/api/client'
import { useAccountIdentity } from '@/shared/preferences/useAccountPreferences'
import { adminGroupDefaultDomainQueryKey } from '@/entities/user-group/domain-default'

const { t } = useI18n()
const queryClient = useQueryClient()
const groupIdentity = useAccountIdentity()
const { identity, query, settingQuery, canManage, canManageDefault, activeGroupKey, activeGroup, displayedGroups, currentDefault, draft, stale, feedback, feedbackKind, feedbackRevision, refreshBroken, pending, groupReady, settingReady, defaultDirty, applyPreset, setPermission, savePermissions, selectDefault, saveDefault, cancelDefault, cancelPermissions, reload: reloadManagement, recover, changeGroup } = useGroupDefaultManagement()
const groupDialog = ref<'' | 'create' | 'edit'>('')
const groupEditSnapshot = ref<Pick<UserGroup, 'key' | 'updatedAt'> | null>(null)
const deleteSnapshot = ref<Pick<UserGroup, 'key' | 'updatedAt'> | null>(null)
const deleteDialog = ref(false)
const groupName = ref('')
const groupDescription = ref('')
const groupFeedback = ref(false)
const groupConflict = ref(false)
const preserveRecoveryDrafts = ref(false)
watch(groupIdentity.scope, () => {
  groupDialog.value = ''
  groupEditSnapshot.value = null
  deleteSnapshot.value = null
  deleteDialog.value = false
  groupName.value = ''
  groupDescription.value = ''
  groupFeedback.value = false
  groupConflict.value = false
  preserveRecoveryDrafts.value = false
}, { flush: 'sync' })
const groupMutation = useMutation({
  retry: false,
  mutationFn: async (command: { kind: 'create'; scope: typeof groupIdentity.scope.value } | { kind: 'edit' | 'delete'; group: Pick<UserGroup, 'key' | 'updatedAt'>; scope: typeof groupIdentity.scope.value }) => {
    if (!groupIdentity.isCurrent(command.scope) || !canManage.value) throw new Error('Inactive group manager')
    if (command.kind === 'create') return { kind: 'saved' as const, result: await createCustomUserGroup({ name: groupName.value.trim(), description: groupDescription.value }) }
    if (command.kind === 'edit') return { kind: 'saved' as const, result: await updateCustomUserGroup({ groupKey: command.group.key, name: groupName.value.trim(), description: groupDescription.value, expectedUpdatedAt: command.group.updatedAt }) }
    const result = await deleteCustomUserGroup({ groupKey: command.group.key, expectedUpdatedAt: command.group.updatedAt })
    return { kind: 'deleted' as const, result }
  },
  async onSuccess(result, command) {
    if (!groupIdentity.isCurrent(command.scope)) return
    groupFeedback.value = false
    groupDialog.value = ''
    groupEditSnapshot.value = null
    deleteDialog.value = false
    deleteSnapshot.value = null
    groupConflict.value = false
    if (result.kind === 'deleted') {
      queryClient.removeQueries({ queryKey: adminGroupDefaultDomainQueryKey })
      activeGroupKey.value = 'user'
      const refreshed = await query.refetch()
      if (!groupIdentity.isCurrent(command.scope)) return
      if (refreshed.isError) {
        refreshBroken.value = true
        preserveRecoveryDrafts.value = true
      } else preserveRecoveryDrafts.value = false
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['user-group-domain-default'] }),
        queryClient.invalidateQueries({ queryKey: ['domain', 'available'] }),
      ])
      return
    }
    activeGroupKey.value = result.result.group.key
    await reload(result.result.group.key)
  },
  async onError(error, command) {
    if (!groupIdentity.isCurrent(command.scope)) return
    if (command.kind !== 'create' && error instanceof ApiClientError && error.code === 300202) {
      if (command.kind === 'edit') { groupDialog.value = ''; groupEditSnapshot.value = null }
      else { deleteDialog.value = false; deleteSnapshot.value = null }
      const refreshed = await query.refetch()
      if (!groupIdentity.isCurrent(command.scope)) return
      if (refreshed.isError) groupFeedback.value = true
      else if (command.kind === 'edit') {
        await nextTick()
        if (!groupIdentity.isCurrent(command.scope)) return
        if (activeGroupKey.value !== command.group.key) {
          groupConflict.value = true
          return
        }
        const latest = query.data.value?.groups.find(({ key }) => key === command.group.key)
        if (latest && !latest.builtin) openEdit(latest)
        groupConflict.value = true
      } else groupConflict.value = true
      return
    }
    groupFeedback.value = true
  },
})
const feedbackKey = computed(() => (feedbackKind.value === 'default'
  ? { success: 'groupDefault.saved', conflict: 'groupDefault.conflict', 'reload-error': 'groupDefault.reloadFailed', 'conflict-reload-error': 'groupDefault.reloadFailed', error: 'groupDefault.saveFailed' }
  : { success: 'userGroups.saveSuccess', conflict: 'userGroups.conflict', 'reload-error': 'groupDefault.reloadFailed', 'conflict-reload-error': 'userGroups.conflictReloadFailed', error: 'userGroups.saveFailed' })[feedback.value as 'success' | 'conflict' | 'reload-error' | 'conflict-reload-error' | 'error'])
function openCreate() { groupEditSnapshot.value = null; deleteSnapshot.value = null; groupName.value = ''; groupDescription.value = ''; groupFeedback.value = false; groupConflict.value = false; groupDialog.value = 'create' }
function openEdit(group: UserGroup) {
  if (group.builtin || draft.isDirty(group) || defaultDirty(group.key)) return
  groupConflict.value = false
  groupEditSnapshot.value = { key: group.key, updatedAt: group.updatedAt }
  groupName.value = group.name
  groupDescription.value = group.description
  groupFeedback.value = false
  groupDialog.value = 'edit'
}
function openDelete(group: UserGroup) {
  if (groupMutation.isPending.value) return
  groupConflict.value = false
  groupFeedback.value = false
  deleteSnapshot.value = { key: group.key, updatedAt: group.updatedAt }
  deleteDialog.value = true
}
function closeDeleteDialog() {
  if (!groupMutation.isPending.value) {
    deleteDialog.value = false
    deleteSnapshot.value = null
  }
}
function closeGroupDialog() { if (!groupMutation.isPending.value) { groupDialog.value = ''; groupEditSnapshot.value = null } }
async function recoverAfterRefreshFailure() {
  const scope = groupIdentity.scope.value
  const recovered = await recover(preserveRecoveryDrafts.value)
  if (recovered && groupIdentity.isCurrent(scope)) preserveRecoveryDrafts.value = false
}
async function reload(key: string, scope = groupIdentity.scope.value, kind: 'permission' | 'default' = 'permission', preserveDrafts = false) {
  const reloaded = await reloadManagement(key, scope, kind, preserveDrafts)
  if (reloaded && groupIdentity.isCurrent(scope)) preserveRecoveryDrafts.value = false
  return reloaded
}
function saveGroupDetails() {
  if (!canManage.value || !groupName.value.trim() || groupMutation.isPending.value) return
  groupFeedback.value = false
  if (groupDialog.value === 'create') groupMutation.mutate({ kind: 'create', scope: groupIdentity.scope.value })
  else if (groupDialog.value === 'edit' && groupEditSnapshot.value && activeGroup.value?.key === groupEditSnapshot.value.key && !activeGroup.value.builtin && !draft.isDirty(activeGroup.value) && !defaultDirty(activeGroup.value.key)) groupMutation.mutate({ kind: 'edit', group: groupEditSnapshot.value, scope: groupIdentity.scope.value })
}
function deleteGroup() {
  const group = activeGroup.value
  const snapshot = deleteSnapshot.value
  if (!canManage.value || !group || !snapshot || group.builtin || group.memberCount !== 0 || groupMutation.isPending.value || snapshot.key !== group.key) return
  if (snapshot.updatedAt !== group.updatedAt) {
    deleteDialog.value = false
    deleteSnapshot.value = null
    const scope = groupIdentity.scope.value
    void query.refetch().then((result) => {
      if (!groupIdentity.isCurrent(scope)) return
      if (result.isError) groupFeedback.value = true
      else groupConflict.value = true
    })
    return
  }
  groupConflict.value = false
  groupFeedback.value = false
  groupMutation.mutate({ kind: 'delete', group: snapshot, scope: groupIdentity.scope.value })
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

.user-groups-page__header-actions,
.user-groups-page__custom-actions {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
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

  .user-groups-page__header-actions {
    width: 100%;
    justify-content: space-between;
  }
}
</style>
