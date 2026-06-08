<template>
  <section class="console-page" data-testid="console-page-create-user">
    <header class="console-page__header">
      <p class="console-page__eyebrow">New user</p>
      <h1>{{ t('page.createUser') }}</h1>
    </header>
    <div class="console-form-panel" data-testid="console-form-panel">
      <div class="console-form-panel__body">
        <v-text-field v-model="username" label="Username" variant="outlined" />
        <v-text-field v-model="password" label="Password" type="password" variant="outlined" />
        <v-text-field v-model="nickname" label="Nickname" variant="outlined" />
        <v-select v-model="groupKey" label="Group" :items="['user', 'admin']" variant="outlined" />
        <v-select v-model="status" label="Status" :items="['active', 'disabled']" variant="outlined" />
        <v-btn color="primary" :loading="mutation.isPending.value" @click="submit">创建用户</v-btn>
        <v-alert v-if="createdUsername" class="mt-4" type="success" variant="tonal">
          {{ createdUsername }}
        </v-alert>
      </div>
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
  width: min(680px, 100%);
  padding: clamp(16px, 3vw, 24px);
  border: 1px solid var(--moeurl-outline);
  border-radius: var(--moeurl-radius-panel);
  background: var(--moeurl-surface-glass);
  box-shadow: 0 18px 48px color-mix(in srgb, rgb(var(--v-theme-primary)) 8%, transparent);
  backdrop-filter: blur(18px);
}

.console-form-panel__body {
  display: grid;
  gap: 14px;
}
</style>
