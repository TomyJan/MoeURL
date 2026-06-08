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
