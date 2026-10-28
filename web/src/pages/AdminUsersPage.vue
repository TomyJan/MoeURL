<template>
  <section class="console-page" data-testid="console-page-admin-users">
    <div class="console-page__header">
      <div>
        <h1>{{ t('page.adminUsers') }}</h1>
      </div>
      <span class="console-page__total">{{ t('adminUsers.total', { total }) }}</span>
    </div>
    <div class="console-page__tools">
      <p class="console-page__muted">{{ t('adminUsers.manageHint') }}</p>
      <div class="console-page__actions-bar">
        <v-btn color="primary" to="/admin/user/new" variant="flat" :disabled="writeLocked" :aria-disabled="writeLocked" :tabindex="writeLocked ? -1 : undefined">{{ t('adminUsers.createUser') }}</v-btn>
      </div>
    </div>
    <div class="console-data-panel" data-testid="console-data-panel">
      <div class="console-page__actions-bar">
        <span v-if="batch.selected.value.length">{{ t('batchMembership.selected', { count: batch.selected.value.length }) }}</span>
        <v-btn v-if="batch.selected.value.length" :disabled="batch.pending.value || batch.barrier.value || !!batch.snapshot.value" @click="batch.clear">{{ t('batchMembership.clear') }}</v-btn>
        <v-btn :disabled="batch.unavailable.value || !batch.selected.value.length || !!batch.snapshot.value" @click="batch.open">{{ t('batchMembership.open') }}</v-btn>
      </div>
      <p v-if="canChangeGroup && users.length > 0 && !batch.eligible.value.length" class="console-page__muted">{{ t('batchMembership.noEligible') }}</p>
      <v-alert v-if="batch.barrier.value && !query.isPending.value" type="warning" variant="tonal">
        {{ t('batchMembership.readRequired') }}
        <v-btn :loading="query.isFetching.value" @click="batch.reload">{{ t('batchMembership.retryRead') }}</v-btn>
      </v-alert>
      <v-alert v-if="query.isError.value" type="error" variant="tonal">
        {{ t('adminUsers.loadFailed') }}
        <v-btn v-if="!batch.barrier.value" :loading="query.isFetching.value" @click="batch.reload">{{ t('batchMembership.retryRead') }}</v-btn>
      </v-alert>
      <v-progress-linear v-if="query.isPending.value" indeterminate />
      <div v-else-if="users.length === 0 && !query.isError.value" class="console-page__empty">
        <div>
          <h2>{{ t('adminUsers.noUsers') }}</h2>
          <p>{{ t('adminUsers.emptyDescription') }}</p>
        </div>
      </div>
      <v-table v-else-if="users.length > 0" class="moe-data-table user-table" density="comfortable">
        <colgroup>
          <col class="user-table__identity-column" />
          <col class="user-table__select-column" />
          <col class="user-table__group-column" />
          <col class="user-table__status-column" />
          <col class="user-table__date-column" />
          <col class="user-table__actions-column" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">{{ t('adminUsers.headers.username') }}</th>
            <th scope="col"><v-checkbox-btn :aria-label="t('batchMembership.selectAll')" :model-value="batch.allSelected.value" :indeterminate="batch.indeterminate.value" :disabled="batch.unavailable.value || !batch.eligible.value.length || !!batch.snapshot.value" @update:model-value="batch.toggleAll(!!$event)" /></th>
            <th scope="col">{{ t('adminUsers.headers.group') }}</th>
            <th scope="col">{{ t('adminUsers.headers.status') }}</th>
            <th scope="col">{{ t('adminUsers.headers.createdAt') }}</th>
            <th scope="col">{{ t('adminUsers.headers.actions') }}</th>
          </tr>
        </thead>
        <tbody>
          <template v-for="item in users" :key="item.id">
            <tr data-testid="console-user-row">
              <td>
                <div class="user-table__identity">
                  <span class="user-table__avatar"><UserAvatarText :username="item.username" /></span>
                  <div class="user-table__stack">
                    <strong>{{ item.username }}</strong>
                    <small v-if="item.nickname">{{ item.nickname }}</small>
                    <span class="console-page__type">{{ t(item.builtin ? 'adminUsers.type.builtin' : 'adminUsers.type.normal') }}</span>
                  </div>
                </div>
              </td>
              <td><v-checkbox-btn v-if="batch.eligible.value.some(user => user.id === item.id)" :aria-label="t('batchMembership.selectAccount', { username: item.username })" :model-value="batch.selected.value.includes(item.id)" :disabled="batch.unavailable.value || !!batch.snapshot.value" @update:model-value="batch.toggle(item.id, !!$event)" /></td>
              <td>{{ item.group }}</td>
              <td><v-chip size="small" variant="tonal" :color="item.status === 'active' ? 'success' : undefined">{{ t(`adminUsers.status.${item.status}`) }}</v-chip></td>
              <td class="user-table__date">{{ formatDate(item.createdAt) }}</td>
              <td>
                <div class="user-table__summary-actions" data-testid="console-user-summary-actions">
                  <v-btn
                    size="small"
                    variant="text"
                    :disabled="item.builtin || rowLocked"
                    :aria-controls="userEditPanelId(item.id)"
                    :aria-expanded="editingUserId === item.id"
                    @click="toggleEdit(item.id)"
                  >
                    {{ t('adminUsers.actions.edit') }}
                  </v-btn>
                  <v-btn
                    size="small"
                    variant="text"
                    :disabled="item.builtin || rowLocked"
                    :aria-controls="userMorePanelId(item.id)"
                    :aria-expanded="moreUserId === item.id"
                    @click="toggleMore(item.id)"
                  >
                    {{ t('adminUsers.actions.more') }}
                  </v-btn>
                </div>
              </td>
            </tr>
            <tr v-if="editingUserId === item.id" class="user-table__expanded-row">
              <td colspan="6">
                <div :id="userEditPanelId(item.id)" class="user-table__panel" data-testid="console-user-edit-panel">
                  <p class="user-table__panel-title">{{ t('adminUsers.editTitle') }}</p>
                  <div class="user-table__form">
                    <v-text-field
                      v-model="draftNicknames[item.id]"
                      density="compact"
                      hide-details
                      :label="t('adminUsers.labels.nickname')"
                      :disabled="item.builtin || writeLocked"
                      variant="outlined"
                    />
                    <v-btn size="small" variant="text" :disabled="item.builtin || writeLocked" :loading="isUpdatingUser(item.id)" @click="saveNickname(item)">
                      {{ t('adminUsers.saveNickname') }}
                    </v-btn>
                  </div>
                </div>
              </td>
            </tr>
            <tr v-if="moreUserId === item.id" class="user-table__expanded-row">
              <td colspan="6">
                <div :id="userMorePanelId(item.id)" class="user-table__panel" data-testid="console-user-actions">
                  <p class="user-table__panel-title">{{ t('adminUsers.moreTitle') }}</p>
                  <v-btn v-if="!item.builtin && item.id !== currentUserId" :disabled="writeLocked" size="small" variant="text" @click="beginGroupChange(item)">{{ t('membership.title') }}</v-btn>
                  <v-btn size="small" variant="text" :disabled="item.builtin || writeLocked" :loading="isUpdatingUser(item.id)" @click="toggleStatus(item)">
                    {{ t(item.status === 'active' ? 'adminUsers.actions.disable' : 'adminUsers.actions.enable') }}
                  </v-btn>
                  <div class="user-table__form">
                    <v-text-field
                      v-model="draftPasswords[item.id]"
                      density="compact"
                      :error-messages="resetPasswordErrors[item.id]"
                      :label="t('adminUsers.labels.newPassword')"
                      :disabled="item.builtin || writeLocked"
                      type="password"
                      variant="outlined"
                    />
                    <v-btn size="small" variant="text" :disabled="item.builtin || writeLocked" :loading="isResettingUser(item.id)" @click="resetPassword(item)">
                      {{ t('adminUsers.resetPassword') }}
                    </v-btn>
                  </div>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </v-table>
      <p v-if="users.length > 0" class="console-page__notice">{{ t('adminUsers.paginationNotice') }}</p>
    </div>
    <UserGroupChangeDialog v-if="groupTarget" :target="groupTarget" managed @close="groupTarget = undefined" @pending="groupPending = $event" @refresh="batch.reload" />
    <UserBatchGroupChangeDialog v-if="batch.snapshot.value" :snapshot="batch.snapshot.value" :pending="batch.pending.value" @close="batch.close" @submit="batch.submit" />
  </section>
</template>

<script setup lang="ts">
import { toast } from 'vue-sonner'
import { computed, defineComponent, onBeforeUnmount, reactive, ref, toRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useQuery, useQueryClient } from '@tanstack/vue-query'

import { listUsers, resetUserPassword, updateUser } from '@/entities/user/api'
import { me } from '@/entities/auth/api'
import type { UserSummary } from '@/entities/user/api'
import { useAvatarText } from '@/shared/user/useAvatarText'
import { useAccountIdentity } from '@/shared/preferences/useAccountPreferences'
import UserGroupChangeDialog from '@/features/user-group-change/UserGroupChangeDialog.vue'
import UserBatchGroupChangeDialog from '@/features/user-batch-group-change/UserBatchGroupChangeDialog.vue'
import { useUserBatchGroupChange } from '@/features/user-batch-group-change/useUserBatchGroupChange'

const { t } = useI18n()
const queryClient = useQueryClient()
const identity = useAccountIdentity()
const currentUserId = computed(() => identity.scope.value.userId)
const currentUserQuery = useQuery({ queryKey: ['auth', 'me'], queryFn: me, staleTime: Infinity, retry: false })
const canChangeGroup = computed(() => currentUserQuery.isSuccess.value && !!currentUserId.value && currentUserQuery.data.value?.user.id === currentUserId.value && currentUserQuery.data.value.user.permissions.includes('admin:access'))
const groupTarget = ref<UserSummary>()
const groupPending = ref(false)
const singlePending = ref('')
let alive = true
let pageRevision = 0
onBeforeUnmount(() => { alive = false })

/** Freezes the version shown when the administrator opens the confirmation dialog. */
function beginGroupChange(item: UserSummary) {
  if (writeLocked.value || groupTarget.value || item.builtin || item.id === currentUserId.value) return
  groupTarget.value = { ...item }
}
const draftNicknames = reactive<Record<string, string>>({})
const draftPasswords = reactive<Record<string, string>>({})
const resetPasswordErrors = reactive<Record<string, string>>({})
const editingUserId = ref('')
const moreUserId = ref('')
const query = useQuery({
  queryKey: computed(() => ['admin-user', currentUserId.value, identity.scope.value.epoch]),
  enabled: canChangeGroup,
  retry: false,
  queryFn: () => listUsers({ page: 1, pageSize: 20 }),
})
const users = computed(() => canChangeGroup.value ? query.data.value?.items ?? [] : [])
const total = computed(() => canChangeGroup.value ? query.data.value?.meta.total ?? 0 : 0)
const batch = useUserBatchGroupChange({ users, allowed: canChangeGroup, blocked: computed(() => !!singlePending.value || !!groupTarget.value), onSelect: () => { editingUserId.value = ''; moreUserId.value = '' }, read: () => query.refetch({ throwOnError: true }) })
const writeLocked = computed(() => !canChangeGroup.value || !!singlePending.value || groupPending.value || batch.pending.value || batch.barrier.value || !!batch.snapshot.value || batch.selected.value.length > 0)
const rowLocked = computed(() => writeLocked.value || !!groupTarget.value)
watch([identity.scope, canChangeGroup], (_value, [previous]) => {
  pageRevision++
  groupTarget.value = undefined
  groupPending.value = false
  singlePending.value = ''
  editingUserId.value = ''; moreUserId.value = ''
  for (const drafts of [draftNicknames, draftPasswords, resetPasswordErrors]) for (const key of Object.keys(drafts)) delete drafts[key]
  void queryClient.cancelQueries({ queryKey: ['admin-user', previous.userId, previous.epoch] })
  queryClient.removeQueries({ queryKey: ['admin-user', previous.userId, previous.epoch] })
}, { flush: 'sync' })
const UserAvatarText = defineComponent({
  name: 'UserAvatarText',
  props: {
    username: {
      type: String,
      required: true,
    },
  },
  /** Provides a reactive one-character avatar label for the supplied username. */
  setup(props) {
    const avatarText = useAvatarText(toRef(props, 'username'))
    return () => avatarText.value
  },
})

watch(
  users,
  (items) => {
    for (const item of items) {
      draftNicknames[item.id] ??= item.nickname
      draftPasswords[item.id] ??= ''
    }
  },
  { immediate: true },
)

/** Runs one legacy write with the same page mutex and login-epoch guard as batch operations. */
async function singleWrite(id: string, write: () => Promise<unknown>) {
  if (writeLocked.value) return
  const scope = identity.scope.value
  const revision = pageRevision
  singlePending.value = id
  try {
    await write()
    if (!alive || revision !== pageRevision || !identity.isCurrent(scope) || !canChangeGroup.value) return
    toast.success(t('feedback.saved'))
    await batch.reload()
  } catch {
    if (alive && revision === pageRevision && identity.isCurrent(scope) && canChangeGroup.value) toast.error(t('feedback.failed'))
  } finally {
    if (alive && revision === pageRevision && identity.isCurrent(scope)) singlePending.value = ''
  }
}

/** Toggles a managed user's active state while preserving their nickname. */
function toggleStatus(item: UserSummary) {
  void singleWrite(item.id, () => updateUser({
    id: item.id,
    nickname: item.nickname,
    status: item.status === 'active' ? 'disabled' : 'active',
  }))
}

/** Persists the edited nickname while preserving the user's current status. */
function saveNickname(item: UserSummary) {
  void singleWrite(item.id, () => updateUser({
    id: item.id,
    nickname: draftNicknames[item.id] || item.nickname,
    status: item.status as UserSummary['status'],
  }))
}

/** Validates and submits a replacement password for a managed user. */
function resetPassword(item: UserSummary) {
  if (writeLocked.value) return
  const password = draftPasswords[item.id]
  if (!password) {
    resetPasswordErrors[item.id] = t('adminUsers.passwordRequired')
    return
  }
  if (password.length < 8) {
    resetPasswordErrors[item.id] = t('adminUsers.passwordMinLength')
    return
  }
  resetPasswordErrors[item.id] = ''
  void singleWrite(item.id, () => resetUserPassword({
    id: item.id,
    password,
  }))
}

/** Toggles a user's edit panel and closes the competing actions panel. */
function toggleEdit(id: string) {
  if (rowLocked.value) return
  editingUserId.value = editingUserId.value === id ? '' : id
  if (editingUserId.value) {
    moreUserId.value = ''
  }
}

/** Toggles a user's actions panel and closes the competing edit panel. */
function toggleMore(id: string) {
  if (rowLocked.value) return
  moreUserId.value = moreUserId.value === id ? '' : id
  if (moreUserId.value) {
    editingUserId.value = ''
  }
}

/** Reports whether the update mutation currently targets a specific user. */
function isUpdatingUser(id: string) {
  return singlePending.value === id
}

/** Reports whether the password-reset mutation currently targets a specific user. */
function isResettingUser(id: string) {
  return singlePending.value === id
}

/** Formats a valid timestamp as a stable local calendar date. */
function formatDate(value: string) {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) {
    return value
  }
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Builds the stable DOM identifier for a user's edit panel. */
function userEditPanelId(id: string) {
  return `console-user-edit-${id}`
}

/** Builds the stable DOM identifier for a user's actions panel. */
function userMorePanelId(id: string) {
  return `console-user-more-${id}`
}
</script>

<style scoped>
.user-table { --moe-table-min-width: 780px; }
.user-table__identity-column { width: 32%; }
.user-table__group-column { width: 13%; }
.user-table__status-column { width: 13%; }
.user-table__date-column { width: 18%; }
.user-table__actions-column { width: 200px; }
.user-table__identity, .user-table__summary-actions { display: flex; align-items: center; gap: 12px; }
.user-table__identity { min-width: 0; }
.user-table__stack { display: grid; gap: 4px; min-width: 0; overflow-wrap: anywhere; }
.user-table__stack small { color: rgb(var(--v-theme-on-surface-variant)); }
.user-table__avatar { display: grid; flex: 0 0 36px; place-items: center; width: 36px; height: 36px; border-radius: 50%; background: color-mix(in srgb, rgb(var(--v-theme-primary)) 10%, transparent); color: rgb(var(--v-theme-primary)); font-weight: 600; }
.user-table__date { font-variant-numeric: tabular-nums; }
.user-table__summary-actions { gap: 2px; flex-wrap: wrap; }
.user-table__expanded-row { background: color-mix(in srgb, rgb(var(--v-theme-primary)) 3%, transparent); }
.user-table__panel { display: grid; justify-items: start; gap: 12px; max-width: 640px; padding: 8px 0; }
.user-table__panel-title { margin: 0; font-weight: 600; }
.user-table__form { display: flex; align-items: start; gap: 12px; width: 100%; }
.user-table__form :deep(.v-input) { min-width: 260px; }
.user-table__form > .v-btn { margin-top: 4px; }
</style>
