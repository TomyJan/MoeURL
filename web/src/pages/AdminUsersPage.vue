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
.console-page {
  display: grid;
  gap: 16px;
}

.console-page__header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
}

.console-page__eyebrow {
  margin: 0 0 6px;
  color: rgb(var(--v-theme-secondary));
  font-size: 0.8rem;
  font-weight: 900;
  text-transform: uppercase;
}

.console-page__header h1 {
  margin: 0;
  font-size: clamp(1.8rem, 3vw, 2.35rem);
  line-height: 1.2;
}

.console-page__total,
.console-page__notice {
  color: rgb(var(--v-theme-on-surface-variant));
}

.console-page__actions-bar {
  display: flex;
  justify-content: flex-end;
  width: fit-content;
  justify-self: end;
  padding: 6px;
  border: 1px solid var(--moeurl-outline);
  border-radius: var(--moeurl-radius-control);
  background: color-mix(in srgb, var(--moeurl-surface-elevated) 52%, transparent);
}

.console-page__panel {
  overflow: hidden;
  padding: 10px;
  border: 1px solid var(--moeurl-outline);
  border-radius: var(--moeurl-radius-panel);
  background: var(--moeurl-surface-glass);
  box-shadow: 0 18px 48px color-mix(in srgb, rgb(var(--v-theme-primary)) 8%, transparent);
  backdrop-filter: blur(18px);
}

.console-page__table {
  overflow-x: auto;
}

.console-page__empty {
  display: flex;
  align-items: center;
  gap: 18px;
  min-height: 168px;
  padding: 26px;
  border: 1px solid color-mix(in srgb, var(--moeurl-outline) 70%, transparent);
  border-radius: calc(var(--moeurl-radius-panel) - 10px);
  background:
    radial-gradient(circle at 12% 12%, color-mix(in srgb, rgb(var(--v-theme-primary)) 13%, transparent), transparent 18rem),
    color-mix(in srgb, var(--moeurl-surface-elevated) 74%, transparent);
}

.console-page__empty-mark {
  display: grid;
  flex: 0 0 54px;
  width: 54px;
  height: 54px;
  place-items: center;
  border-radius: 20px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  font-weight: 900;
}

.console-page__empty h2 {
  margin: 0 0 6px;
  font-size: 1.1rem;
}

.console-page__empty p {
  max-width: 36rem;
  margin: 0;
  color: rgb(var(--v-theme-on-surface-variant));
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

.console-page__status,
.console-page__type {
  display: inline-flex;
  padding: 5px 10px;
  border-radius: var(--moeurl-radius-control);
  background: color-mix(in srgb, rgb(var(--v-theme-on-surface-variant)) 10%, transparent);
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.78rem;
  font-weight: 800;
}

.console-page__status--active {
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 13%, transparent);
  color: rgb(var(--v-theme-primary));
}

.console-page__status--disabled {
  background: color-mix(in srgb, rgb(var(--v-theme-secondary)) 16%, transparent);
  color: rgb(var(--v-theme-secondary));
}

@media (max-width: 720px) {
  .console-page__header {
    display: grid;
    align-items: start;
  }

  .console-page__actions-bar {
    width: 100%;
    justify-content: stretch;
  }

  .console-page__empty {
    display: grid;
    justify-items: center;
    text-align: center;
  }
}
</style>
