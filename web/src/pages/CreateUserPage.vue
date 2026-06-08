<template>
  <section class="console-page" data-testid="console-page-create-user">
    <header class="console-page__header">
      <p class="console-page__eyebrow">New user</p>
      <h1>{{ t('page.createUser') }}</h1>
    </header>
    <div class="console-form-panel" data-testid="console-form-panel">
      <div class="console-form-panel__intro">
        <span class="console-form-panel__mark">Account</span>
        <h2>创建可登录账号</h2>
        <p>为需要管理短链的成员创建账号，并在创建时确定用户组和启用状态。</p>
      </div>

      <form class="console-form-panel__body" @submit.prevent="submit">
        <fieldset class="console-form-panel__group" data-testid="console-form-group">
          <legend>账号信息</legend>
          <div class="console-form-panel__grid">
            <v-text-field v-model="username" label="Username" variant="outlined" />
            <v-text-field v-model="password" label="Password" type="password" variant="outlined" />
            <v-text-field v-model="nickname" label="Nickname" variant="outlined" />
          </div>
        </fieldset>

        <fieldset class="console-form-panel__group" data-testid="console-form-group">
          <legend>权限与状态</legend>
          <div class="console-form-panel__grid console-form-panel__grid--compact">
            <v-select v-model="groupKey" label="Group" :items="['user', 'admin']" variant="outlined" />
            <v-select v-model="status" label="Status" :items="['active', 'disabled']" variant="outlined" />
          </div>
        </fieldset>

        <div class="console-form-panel__actions">
          <v-btn class="console-form-panel__submit" color="primary" :loading="mutation.isPending.value" type="submit">
            创建用户
          </v-btn>
        </div>

        <v-alert v-if="createdUsername" class="mt-4" type="success" variant="tonal">
          {{ createdUsername }}
        </v-alert>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMutation } from '@tanstack/vue-query'

import { createUser } from '@/entities/user/api'
import type { CreateUserInput } from '@/entities/user/api'

const { t } = useI18n()
const username = ref('')
const password = ref('')
const nickname = ref('')
const groupKey = ref<CreateUserInput['groupKey']>('user')
const status = ref<CreateUserInput['status']>('active')
const createdUsername = ref('')

const mutation = useMutation({
  mutationFn: createUser,
  onSuccess(result) {
    createdUsername.value = result.user.username
  },
})

function submit() {
  createdUsername.value = ''
  mutation.mutate({
    username: username.value,
    password: password.value,
    nickname: nickname.value,
    groupKey: groupKey.value,
    status: status.value,
  })
}
</script>

<style scoped>
.console-page {
  display: grid;
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

.console-form-panel {
  display: grid;
  width: min(860px, 100%);
  gap: 18px;
  padding: clamp(18px, 3vw, 26px);
  border: 1px solid var(--moeurl-outline);
  border-radius: var(--moeurl-radius-panel);
  background:
    linear-gradient(135deg, color-mix(in srgb, rgb(var(--v-theme-secondary)) 8%, transparent), transparent 34%),
    var(--moeurl-surface-glass);
  box-shadow: 0 18px 48px color-mix(in srgb, rgb(var(--v-theme-primary)) 8%, transparent);
  backdrop-filter: blur(18px);
}

.console-form-panel__intro {
  display: grid;
  gap: 8px;
  max-width: 540px;
}

.console-form-panel__mark {
  width: fit-content;
  padding: 6px 12px;
  border-radius: var(--moeurl-radius-control);
  background: color-mix(in srgb, rgb(var(--v-theme-secondary)) 15%, transparent);
  color: rgb(var(--v-theme-secondary));
  font-size: 0.78rem;
  font-weight: 900;
  text-transform: uppercase;
}

.console-form-panel__intro h2 {
  margin: 0;
  font-size: clamp(1.3rem, 2.4vw, 1.7rem);
}

.console-form-panel__intro p {
  margin: 0;
  color: rgb(var(--v-theme-on-surface-variant));
  line-height: 1.7;
}

.console-form-panel__body {
  display: grid;
  gap: 14px;
}

.console-form-panel__group {
  min-width: 0;
  margin: 0;
  padding: 15px 15px 0;
  border: 1px solid color-mix(in srgb, var(--moeurl-outline) 76%, transparent);
  border-radius: 28px;
  background: color-mix(in srgb, var(--moeurl-surface-elevated) 58%, transparent);
}

.console-form-panel__group legend {
  padding: 0 8px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.82rem;
  font-weight: 900;
}

.console-form-panel__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.console-form-panel__grid--compact {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.console-form-panel__actions {
  display: flex;
  justify-content: flex-end;
}

.console-form-panel__submit {
  min-width: 136px;
  min-height: 48px;
}

@media (max-width: 760px) {
  .console-form-panel__grid,
  .console-form-panel__grid--compact {
    grid-template-columns: 1fr;
  }

  .console-form-panel__actions {
    display: grid;
  }
}
</style>
