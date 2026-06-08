<template>
  <v-container class="py-10">
    <h1 class="text-h4 mb-6">{{ t('page.login') }}</h1>
    <v-card max-width="520" variant="outlined">
      <v-card-text>
        <v-text-field v-model="username" label="Username" variant="outlined" />
        <v-text-field v-model="password" label="Password" type="password" variant="outlined" />
        <v-alert v-if="mutation.isError.value" class="mb-4" type="error" variant="tonal">
          {{ mutation.error.value?.message || 'Login failed' }}
        </v-alert>
        <v-btn color="primary" :loading="mutation.isPending.value" @click="submit">Login</v-btn>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useMutation } from '@tanstack/vue-query'

import { login } from '@/entities/auth/api'
import { queryClient } from '@/app/query'

const { t } = useI18n()
const router = useRouter()
const username = ref('')
const password = ref('')
const mutation = useMutation({
  mutationFn: login,
  onSuccess(data) {
    queryClient.setQueryData(['auth', 'me'], data)
    void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] })
    void router.push('/')
  },
})

function submit() {
  mutation.mutate({ username: username.value, password: password.value })
}
</script>
