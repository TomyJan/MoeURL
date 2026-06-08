<template>
  <section class="console-page" data-testid="console-page-create-user">
    <header class="console-page__header">
      <h1>{{ t('page.createUser') }}</h1>
    </header>
    <div class="console-form-panel" data-testid="console-form-panel">
      <v-card variant="flat">
        <v-card-text class="console-form-panel__body">
          <v-text-field v-model="username" label="Username" variant="outlined" />
          <v-text-field v-model="password" label="Password" type="password" variant="outlined" />
          <v-text-field v-model="nickname" label="Nickname" variant="outlined" />
          <v-select v-model="groupKey" label="Group" :items="['user', 'admin']" variant="outlined" />
          <v-select v-model="status" label="Status" :items="['active', 'disabled']" variant="outlined" />
          <v-btn color="primary" :loading="mutation.isPending.value" @click="submit">创建用户</v-btn>
          <v-alert v-if="createdUsername" class="mt-4" type="success" variant="tonal">
            {{ createdUsername }}
          </v-alert>
        </v-card-text>
      </v-card>
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
  gap: 18px;
}

.console-page__header h1 {
  margin: 0;
  font-size: 1.9rem;
  line-height: 1.2;
}

.console-form-panel {
  width: min(680px, 100%);
  padding: 18px;
  border: 1px solid var(--moeurl-outline);
  border-radius: var(--moeurl-radius-panel);
  background: rgb(var(--v-theme-surface));
}

.console-form-panel__body {
  display: grid;
  gap: 14px;
}
</style>
