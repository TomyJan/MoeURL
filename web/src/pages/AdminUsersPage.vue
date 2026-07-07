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
        <v-btn color="primary" to="/admin/user/new" variant="flat">{{ t('adminUsers.createUser') }}</v-btn>
      </div>
    </div>
    <div class="console-data-panel" data-testid="console-data-panel">
      <v-alert v-if="query.isError.value" type="error" variant="tonal">{{ t('adminUsers.loadFailed') }}</v-alert>
      <v-progress-linear v-else-if="query.isPending.value" indeterminate />
      <div v-else-if="users.length === 0" class="console-page__empty">
        <div>
          <h2>{{ t('adminUsers.noUsers') }}</h2>
          <p>{{ t('adminUsers.emptyDescription') }}</p>
        </div>
      </div>
      <div v-else class="console-user-list">
        <article v-for="item in users" :key="item.id" class="console-user-row" data-testid="console-user-row">
          <div class="console-user-row__identity">
            <span class="console-user-row__avatar">{{ item.username.slice(0, 1).toUpperCase() }}</span>
            <div>
              <strong>{{ item.username }}</strong>
              <small>
                <span>{{ item.group }}</span>
                <span>{{ formatDate(item.createdAt) }}</span>
              </small>
            </div>
          </div>

          <div class="console-user-row__badges">
            <span class="console-page__status" :class="`console-page__status--${item.status}`">
              {{ t(`adminUsers.status.${item.status}`) }}
            </span>
            <span class="console-page__type">{{ t(item.builtin ? 'adminUsers.type.builtin' : 'adminUsers.type.normal') }}</span>
          </div>

          <div class="console-user-row__summary-actions" data-testid="console-user-summary-actions">
            <v-btn
              size="small"
              variant="text"
              :disabled="item.builtin"
              :aria-controls="userEditPanelId(item.id)"
              :aria-expanded="editingUserId === item.id"
              @click="toggleEdit(item.id)"
            >
              {{ t('adminUsers.actions.edit') }}
            </v-btn>
            <button
              class="console-user-row__more"
              type="button"
              :disabled="item.builtin"
              :aria-controls="userMorePanelId(item.id)"
              :aria-expanded="moreUserId === item.id"
              @click="toggleMore(item.id)"
            >
              {{ t('adminUsers.actions.more') }}
            </button>
          </div>

          <Transition name="moe-layout">
            <div v-if="editingUserId === item.id" :id="userEditPanelId(item.id)" class="console-user-row__actions" data-testid="console-user-edit-panel">
              <p class="console-user-row__panel-title">{{ t('adminUsers.editTitle') }}</p>
              <div class="console-user-row__nickname">
                <v-text-field
                  v-model="draftNicknames[item.id]"
                  density="compact"
                  hide-details
                  :label="t('adminUsers.labels.nickname')"
                  :disabled="item.builtin"
                  variant="outlined"
                />
                <v-btn size="small" variant="text" :disabled="item.builtin" :loading="isUpdatingUser(item.id)" @click="saveNickname(item)">
                  {{ t('adminUsers.saveNickname') }}
                </v-btn>
              </div>
            </div>
          </Transition>

          <Transition name="moe-layout">
            <div v-if="moreUserId === item.id" :id="userMorePanelId(item.id)" class="console-user-row__actions console-user-row__actions--more" data-testid="console-user-actions">
              <p class="console-user-row__panel-title">{{ t('adminUsers.moreTitle') }}</p>
              <v-btn size="small" variant="text" :disabled="item.builtin" :loading="isUpdatingUser(item.id)" @click="toggleStatus(item)">
                {{ t(item.status === 'active' ? 'adminUsers.actions.disable' : 'adminUsers.actions.enable') }}
              </v-btn>
              <div class="console-user-row__password">
                <v-text-field
                  v-model="draftPasswords[item.id]"
                  density="compact"
                  :error-messages="resetPasswordErrors[item.id]"
                  :label="t('adminUsers.labels.newPassword')"
                  :disabled="item.builtin"
                  type="password"
                  variant="outlined"
                />
                <v-btn size="small" variant="text" :disabled="item.builtin" :loading="isResettingUser(item.id)" @click="resetPassword(item)">
                  {{ t('adminUsers.resetPassword') }}
                </v-btn>
              </div>
            </div>
          </Transition>
        </article>
      </div>
      <p v-if="users.length > 0" class="console-page__notice">{{ t('adminUsers.paginationNotice') }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'

import { listUsers, resetUserPassword, updateUser } from '@/entities/user/api'
import type { UserSummary } from '@/entities/user/api'

const { t } = useI18n()
const queryClient = useQueryClient()
const draftNicknames = reactive<Record<string, string>>({})
const draftPasswords = reactive<Record<string, string>>({})
const resetPasswordErrors = reactive<Record<string, string>>({})
const editingUserId = ref('')
const moreUserId = ref('')
const query = useQuery({
  queryKey: ['admin-user'],
  queryFn: () => listUsers({ page: 1, pageSize: 20 }),
})
const users = computed(() => query.data.value?.items ?? [])
const total = computed(() => query.data.value?.meta.total ?? 0)

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

const updateMutation = useMutation({
  mutationFn: updateUser,
  onSuccess: invalidateUsers,
})
const resetMutation = useMutation({
  mutationFn: resetUserPassword,
  onSuccess: invalidateUsers,
})

function toggleStatus(item: UserSummary) {
  updateMutation.mutate({
    id: item.id,
    nickname: item.nickname,
    status: item.status === 'active' ? 'disabled' : 'active',
  })
}

function saveNickname(item: UserSummary) {
  updateMutation.mutate({
    id: item.id,
    nickname: draftNicknames[item.id] || item.nickname,
    status: item.status as UserSummary['status'],
  })
}

function resetPassword(item: UserSummary) {
  const password = draftPasswords[item.id]?.trim()
  if (!password) {
    resetPasswordErrors[item.id] = t('adminUsers.passwordRequired')
    return
  }
  if (password.length < 8) {
    resetPasswordErrors[item.id] = t('adminUsers.passwordMinLength')
    return
  }
  resetPasswordErrors[item.id] = ''
  resetMutation.mutate({
    id: item.id,
    password,
  })
}

function toggleEdit(id: string) {
  editingUserId.value = editingUserId.value === id ? '' : id
  if (editingUserId.value) {
    moreUserId.value = ''
  }
}

function toggleMore(id: string) {
  moreUserId.value = moreUserId.value === id ? '' : id
  if (moreUserId.value) {
    editingUserId.value = ''
  }
}

function invalidateUsers() {
  void queryClient.invalidateQueries({ queryKey: ['admin-user'] })
}

function isUpdatingUser(id: string) {
  return updateMutation.isPending.value && updateMutation.variables.value?.id === id
}

function isResettingUser(id: string) {
  return resetMutation.isPending.value && resetMutation.variables.value?.id === id
}

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

function userEditPanelId(id: string) {
  return `console-user-edit-${id}`
}

function userMorePanelId(id: string) {
  return `console-user-more-${id}`
}
</script>
