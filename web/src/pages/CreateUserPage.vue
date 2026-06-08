<template>
  <section class="console-page" data-testid="console-page-create-user">
    <header class="console-page__header">
      <div>
        <p class="console-page__eyebrow">{{ t('pageMeta.createUserEyebrow') }}</p>
        <h1>{{ t('page.createUser') }}</h1>
      </div>
      <v-btn to="/admin/user" variant="text">{{ t('createUser.backToUsers') }}</v-btn>
    </header>
    <div class="console-form-panel" data-testid="console-form-panel">
      <div class="console-form-panel__intro">
        <span class="console-form-panel__mark">{{ t('createUser.mark') }}</span>
        <h2>{{ t('createUser.title') }}</h2>
        <p>{{ t('createUser.description') }}</p>
      </div>

      <form class="console-form-panel__body" @submit.prevent="submit">
        <fieldset class="console-form-panel__group" data-testid="console-form-group">
          <legend>{{ t('createUser.accountLegend') }}</legend>
          <div class="console-form-panel__grid">
            <v-text-field v-model="username" :label="t('createUser.username')" density="compact" variant="outlined" />
            <v-text-field v-model="password" :label="t('createUser.password')" density="compact" type="password" variant="outlined" />
            <v-text-field v-model="nickname" :label="t('createUser.nickname')" density="compact" variant="outlined" />
          </div>
        </fieldset>

        <fieldset class="console-form-panel__group" data-testid="console-form-group">
          <legend>{{ t('createUser.accessLegend') }}</legend>
          <div class="console-form-panel__grid console-form-panel__grid--compact">
            <v-select v-model="groupKey" :label="t('createUser.group')" :items="groupOptions" density="compact" variant="outlined" />
            <v-select v-model="status" :label="t('createUser.status')" :items="statusOptions" density="compact" variant="outlined" />
          </div>
        </fieldset>

        <div class="console-form-panel__actions">
          <v-btn class="console-form-panel__submit" color="primary" :loading="mutation.isPending.value" type="submit">
            {{ t('createUser.submit') }}
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
import { computed, ref } from 'vue'
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
const groupOptions = computed(() => [
  { title: t('createUser.groups.user'), value: 'user' },
  { title: t('createUser.groups.admin'), value: 'admin' },
])
const statusOptions = computed(() => [
  { title: t('createUser.statuses.active'), value: 'active' },
  { title: t('createUser.statuses.disabled'), value: 'disabled' },
])

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
