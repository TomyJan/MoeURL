<template>
  <section class="console-page" data-testid="console-page-admin-users">
    <div class="console-page__header">
      <div>
        <p class="console-page__eyebrow">Users</p>
        <h1>{{ t('page.adminUsers') }}</h1>
      </div>
      <span class="console-page__total">{{ t('adminUsers.total', { total }) }}</span>
    </div>
    <div class="console-page__actions-bar">
      <v-btn color="primary" to="/admin/user/new" variant="flat">{{ t('adminUsers.createUser') }}</v-btn>
    </div>
    <div class="console-page__panel" data-testid="console-page-panel">
      <v-alert v-if="query.isError.value" type="error" variant="tonal">{{ t('adminUsers.loadFailed') }}</v-alert>
      <v-progress-linear v-if="query.isPending.value" indeterminate />
      <div v-else-if="users.length === 0" class="console-page__empty">
        <span class="console-page__empty-mark">U</span>
        <div>
          <h2>{{ t('adminUsers.noUsers') }}</h2>
          <p>创建第一个普通用户后，可以在这里维护状态、昵称和密码。</p>
        </div>
      </div>
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
              <td>
                <span class="console-page__status" :class="`console-page__status--${item.status}`">
                  {{ t(`adminUsers.status.${item.status}`) }}
                </span>
              </td>
              <td>
                <span class="console-page__type">{{ t(item.builtin ? 'adminUsers.type.builtin' : 'adminUsers.type.normal') }}</span>
              </td>
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
.password-input {
  width: min(180px, 100%);
}
</style>
