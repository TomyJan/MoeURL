<template>
  <v-container class="py-10">
    <div class="d-flex align-center justify-space-between mb-4">
      <h1 class="text-h4">{{ t('page.adminUsers') }}</h1>
      <span class="text-body-2 text-medium-emphasis">{{ t('adminUsers.total', { total }) }}</span>
    </div>
    <div class="mb-4">
      <v-btn color="primary" to="/admin/user/new" variant="flat">{{ t('adminUsers.createUser') }}</v-btn>
    </div>
    <v-alert v-if="query.isError.value" type="error" variant="tonal">{{ t('adminUsers.loadFailed') }}</v-alert>
    <v-progress-linear v-if="query.isPending.value" indeterminate />
    <v-alert v-else-if="users.length === 0" type="info" variant="tonal">{{ t('adminUsers.noUsers') }}</v-alert>
    <v-table v-else>
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
          </td>
        </tr>
      </tbody>
    </v-table>
    <p v-if="users.length > 0" class="mt-3 text-caption text-medium-emphasis">{{ t('adminUsers.paginationNotice') }}</p>
  </v-container>
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
  display: inline-block;
  max-width: 160px;
  vertical-align: middle;
}
</style>
