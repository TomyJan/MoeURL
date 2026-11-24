<template>
  <section class="console-page" data-testid="console-page-create-user">
    <header class="console-page__header">
      <div>
        <h1>{{ t('page.createUser') }}</h1>
      </div>
      <v-btn to="/admin/user" variant="text">{{ t('createUser.backToUsers') }}</v-btn>
    </header>
    <div class="console-form-panel" data-testid="console-form-panel">
      <div class="console-form-panel__intro">
        <h2>{{ t('createUser.title') }}</h2>
        <p>{{ t('createUser.description') }}</p>
      </div>

      <form class="console-form-panel__body" @submit.prevent="submit">
        <v-alert v-if="groupsQuery.isError.value" type="error" variant="tonal">
          {{ t('createUser.groupsLoadFailed') }} <v-btn variant="text" @click="groupsQuery.refetch()">{{ t('createUser.retryGroups') }}</v-btn>
        </v-alert>
        <v-alert v-else-if="canManage && !groupsQuery.isPending.value && !groupOptions.length" type="warning" variant="tonal">
          {{ t('createUser.noAssignableGroups') }}
        </v-alert>
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
            <v-select v-model="groupKey" :label="t('createUser.group')" :items="groupOptions" :disabled="groupsQuery.isPending.value || groupsQuery.isError.value || !groupOptions.length || mutation.isPending.value" density="compact" variant="outlined" />
            <v-select v-model="status" :label="t('createUser.status')" :items="statusOptions" density="compact" variant="outlined" />
          </div>
        </fieldset>

        <div class="console-form-panel__actions">
          <v-btn class="console-form-panel__submit" color="primary" :disabled="!groupOptions.length || groupsQuery.isPending.value || groupsQuery.isError.value || mutation.isPending.value" :loading="mutation.isPending.value" type="submit">
            {{ t('createUser.submit') }}
          </v-btn>
        </div>

        <ActionToast v-if="createdUsername" type="success">{{ t('feedback.created') }} · {{ createdUsername }}</ActionToast>
        <ActionToast v-if="mutation.isError.value" type="error">{{ t('feedback.failed') }}</ActionToast>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import ActionToast from '@/shared/feedback/ActionToast.vue'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMutation, useQuery } from '@tanstack/vue-query'

import { createUser } from '@/entities/user/api'
import type { CreateUserInput } from '@/entities/user/api'
import { listUserGroups, userGroupQueryKey } from '@/entities/user-group/api'
import { me } from '@/entities/auth/api'
import { useAccountIdentity } from '@/shared/preferences/useAccountPreferences'

const { t } = useI18n()
const identity = useAccountIdentity()
const auth = useQuery({ queryKey: ['auth', 'me'], queryFn: me, retry: false })
const canManage = computed(() => !!identity.scope.value.userId && auth.data.value?.user.id === identity.scope.value.userId && auth.data.value.user.permissions.includes('admin:access'))
const groupsQuery = useQuery({ queryKey: computed(() => [...userGroupQueryKey, identity.scope.value.userId, identity.scope.value.epoch]), queryFn: listUserGroups, enabled: canManage, retry: false })
const username = ref('')
const password = ref('')
const nickname = ref('')
const groupKey = ref<CreateUserInput['groupKey']>('user')
const status = ref<CreateUserInput['status']>('active')
const createdUsername = ref('')
const groupOptions = computed(() => [
  ...(groupsQuery.data.value?.groups ?? []).filter(({ key }) => key !== 'guest').map(({ key, name }) => ({ title: name, value: key })),
])
watch(groupOptions, (options) => { if (!options.some(({ value }) => value === groupKey.value)) groupKey.value = options.find(({ value }) => value === 'user')?.value ?? options[0]?.value ?? '' }, { immediate: true })
const statusOptions = computed(() => [
  { title: t('createUser.statuses.active'), value: 'active' },
  { title: t('createUser.statuses.disabled'), value: 'disabled' },
])

const mutation = useMutation({
  mutationFn: createUser,
  /** Displays the created account and clears the submitted form. */
  onSuccess(result) {
    createdUsername.value = result.user.username
    resetForm()
  },
})

/** Submits the current account fields to the user-creation mutation. */
function submit() {
  if (!groupOptions.value.some(({ value }) => value === groupKey.value) || !canManage.value) return
  createdUsername.value = ''
  mutation.mutate({
    username: username.value,
    password: password.value,
    nickname: nickname.value,
    groupKey: groupKey.value,
    status: status.value,
  })
}

/** Restores the user-creation form to its defaults. */
function resetForm() {
  username.value = ''
  password.value = ''
  nickname.value = ''
  groupKey.value = groupOptions.value.find(({ value }) => value === 'user')?.value ?? groupOptions.value[0]?.value ?? ''
  status.value = 'active'
}
</script>
