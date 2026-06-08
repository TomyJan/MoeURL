<template>
  <section class="console-page" data-testid="console-page-admin-users">
    <div class="console-page__header">
      <h1>{{ t('page.adminUsers') }}</h1>
      <span>{{ t('adminUsers.total', { total }) }}</span>
    </div>
    <div class="console-page__actions-bar">
      <v-btn color="primary" to="/admin/user/new" variant="flat">{{ t('adminUsers.createUser') }}</v-btn>
    </div>
    <div class="console-page__panel" data-testid="console-page-panel">
      <v-alert v-if="query.isError.value" type="error" variant="tonal">{{ t('adminUsers.loadFailed') }}</v-alert>
      <v-progress-linear v-if="query.isPending.value" indeterminate />
      <v-alert v-else-if="users.length === 0" type="info" variant="tonal">{{ t('adminUsers.noUsers') }}</v-alert>
      <div v-else class="console-page__table">
        <v-table>
          <thead>
            <tr>
              <th>{{ t('adminUsers.headers.username') }}</th>
              <th>{{ t('adminUsers.headers.nickname') }}</th>
              <th>{{ t('adminUsers.headers.group') }}</th>
              <th>{{ t('adminUsers.headers.status') }}</th>
              <th>{{ t('adminUsers.headers.type') }}</th>
              <th>{{ t('adminUsers.headers.createdAt') }}</th>
              <th>{{ t('adminUsers.headers.actions') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in users" :key="item.id">
              <td>{{ item.username }}</td>
              <td>
                <v-text-field
                  v-model="draftNicknames[item.id]"
                  density="compact"
                  hide-details
                  :label="t('adminUsers.labels.nickname')"
                  :disabled="item.builtin"
                  variant="outlined"
                />
              </td>
              <td>{{ item.group }}</td>
              <td>{{ t(`adminUsers.status.${item.status}`) }}</td>
              <td>{{ t(item.builtin ? 'adminUsers.type.builtin' : 'adminUsers.type.normal') }}</td>
              <td>{{ item.createdAt }}</td>
              <td>
                <div class="console-page__row-actions">
                  <v-btn size="small" variant="text" :disabled="item.builtin" :loading="updateMutation.isPending.value" @click="toggleStatus(item)">
                    {{ t(item.status === 'active' ? 'adminUsers.actions.disable' : 'adminUsers.actions.enable') }}
                  </v-btn>
                  <v-btn size="small" variant="text" :disabled="item.builtin" :loading="updateMutation.isPending.value" @click="saveNickname(item)">
                    {{ t('adminUsers.saveNickname') }}
                  </v-btn>
                  <v-text-field
                    v-model="draftPasswords[item.id]"
                    class="password-input"
                    density="compact"
                    :error-messages="resetPasswordErrors[item.id]"
                    :label="t('adminUsers.labels.newPassword')"
                    :disabled="item.builtin"
                    type="password"
                    variant="outlined"
                  />
                  <v-btn size="small" variant="text" :disabled="item.builtin" :loading="resetMutation.isPending.value" @click="resetPassword(item)">
                    {{ t('adminUsers.resetPassword') }}
                  </v-btn>
                </div>
              </td>
            </tr>
          </tbody>
        </v-table>
      </div>
      <p v-if="users.length > 0" class="console-page__notice">{{ t('adminUsers.paginationNotice') }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'

import { listUsers, resetUserPassword, updateUser } from '@/entities/user/api'
import type { UserSummary } from '@/entities/user/api'

const { t } = useI18n()
const queryClient = useQueryClient()
const draftNicknames = reactive<Record<string, string>>({})
const draftPasswords = reactive<Record<string, string>>({})
const resetPasswordErrors = reactive<Record<string, string>>({})
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

function invalidateUsers() {
  void queryClient.invalidateQueries({ queryKey: ['admin-user'] })
}
</script>

<style scoped>
.console-page {
  display: grid;
  gap: 18px;
}

.console-page__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.console-page__header h1 {
  margin: 0;
  font-size: 1.9rem;
  line-height: 1.2;
}

.console-page__header span,
.console-page__notice {
  color: rgb(var(--v-theme-on-surface-variant));
}

.console-page__actions-bar {
  display: flex;
  justify-content: flex-end;
}

.console-page__panel {
  overflow: hidden;
  padding: 18px;
  border: 1px solid var(--moeurl-outline);
  border-radius: var(--moeurl-radius-panel);
  background: rgb(var(--v-theme-surface));
}

.console-page__table {
  overflow-x: auto;
}

.console-page__row-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 360px;
}

.password-input {
  width: min(180px, 100%);
}

.console-page__notice {
  margin: 14px 0 0;
  font-size: 0.86rem;
}
</style>
