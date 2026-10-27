<template>
  <section class="user-groups-page" data-testid="console-page-user-groups">
    <header class="user-groups-page__header">
      <div><h1>{{ t('userGroups.title') }}</h1><p>{{ t('userGroups.description') }}</p></div>
      <strong>{{ t('userGroups.total', { total: displayedGroups.length }) }}</strong>
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
        <v-tab v-for="group in displayedGroups" :key="group.key" :value="group.key" :disabled="pending">{{ group.name }}</v-tab>
      </v-tabs>
      <ActionToast v-if="feedback" :key="feedbackRevision + ':' + feedback" :type="feedback === 'success' ? 'success' : feedback === 'conflict' ? 'warning' : 'error'">{{ t(feedbackKey) }}</ActionToast>
      <v-alert v-if="refreshBroken" type="warning">
        {{ t('groupDefault.refreshRequired') }}
        <v-btn :disabled="pending" @click="reload(activeGroupKey)">{{ t('groupDefault.reload') }}</v-btn>
      </v-alert>
      <!-- The nonempty catalog branch guarantees an active group; capture its rendered target for event guards. -->
      <template v-for="group in [activeGroup!]" :key="identity.scope.value.epoch + ':' + group.key + ':' + group.updatedAt + ':' + feedbackRevision">
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
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ActionToast from '@/shared/feedback/ActionToast.vue'
import UserGroupPermissionEditor from '@/features/user-group-permissions/UserGroupPermissionEditor.vue'
import UserGroupDomainDefaultEditor from '@/features/user-group-domain-default/UserGroupDomainDefaultEditor.vue'
import { useGroupDefaultManagement } from '@/features/user-group-domain-default/useGroupDefaultManagement'

const { t } = useI18n()
const { identity, query, settingQuery, canManage, canManageDefault, activeGroupKey, activeGroup, displayedGroups, currentDefault, draft, stale, feedback, feedbackKind, feedbackRevision, refreshBroken, pending, groupReady, settingReady, defaultDirty, applyPreset, setPermission, savePermissions, selectDefault, saveDefault, cancelDefault, cancelPermissions, reload, changeGroup } = useGroupDefaultManagement()
const feedbackKey = computed(() => (feedbackKind.value === 'default'
  ? { success: 'groupDefault.saved', conflict: 'groupDefault.conflict', 'reload-error': 'groupDefault.reloadFailed', error: 'groupDefault.saveFailed' }
  : { success: 'userGroups.saveSuccess', conflict: 'userGroups.conflict', 'reload-error': 'userGroups.conflictReloadFailed', error: 'userGroups.saveFailed' })[feedback.value as 'success' | 'conflict' | 'reload-error' | 'error'])
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
