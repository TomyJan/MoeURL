<template>
  <v-container class="py-10">
    <div class="d-flex align-center justify-space-between mb-4">
      <h1 class="text-h4">{{ t('page.adminUsers') }}</h1>
      <span class="text-body-2 text-medium-emphasis">共 {{ total }} 个用户</span>
    </div>
    <div class="mb-4">
      <v-btn color="primary" to="/admin/users/new" variant="flat">创建用户</v-btn>
    </div>
    <v-alert v-if="query.isError.value" type="error" variant="tonal">加载失败</v-alert>
    <v-progress-linear v-if="query.isPending.value" indeterminate />
    <v-alert v-else-if="users.length === 0" type="info" variant="tonal">暂无用户</v-alert>
    <v-table v-else>
      <thead>
        <tr>
          <th>账号</th>
          <th>昵称</th>
          <th>用户组</th>
          <th>状态</th>
          <th>类型</th>
          <th>操作</th>
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
              label="昵称"
              :disabled="item.builtin"
              variant="outlined"
            />
          </td>
          <td>{{ item.group }}</td>
          <td>{{ item.status }}</td>
          <td>{{ item.builtin ? '内置' : '普通' }}</td>
          <td>
            <v-btn size="small" variant="text" :disabled="item.builtin" :loading="updateMutation.isPending.value" @click="toggleStatus(item)">
              {{ item.status === 'active' ? '禁用' : '启用' }}
            </v-btn>
            <v-btn size="small" variant="text" :disabled="item.builtin" :loading="updateMutation.isPending.value" @click="saveNickname(item)">
              保存昵称
            </v-btn>
            <v-text-field
              v-model="draftPasswords[item.id]"
              class="password-input"
              density="compact"
              hide-details
              label="新密码"
              :disabled="item.builtin"
              type="password"
              variant="outlined"
            />
            <v-btn size="small" variant="text" :disabled="item.builtin" :loading="resetMutation.isPending.value" @click="resetPassword(item)">
              重置密码
            </v-btn>
          </td>
        </tr>
      </tbody>
    </v-table>
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
const query = useQuery({
  queryKey: ['admin-users'],
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
  resetMutation.mutate({
    id: item.id,
    password: draftPasswords[item.id] || '',
  })
}

function invalidateUsers() {
  void queryClient.invalidateQueries({ queryKey: ['admin-users'] })
}
</script>

<style scoped>
.password-input {
  display: inline-block;
  max-width: 160px;
  vertical-align: middle;
}
</style>
